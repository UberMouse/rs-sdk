#!/usr/bin/env python3
"""Read Claude Code session transcripts (JSONL) into forms an analysing agent can work with.

A raw session transcript is mostly tool payloads: a 2.6 MB main transcript is ~95% file
contents and command output that no longer matters. Feeding one to an agent burns the
context window before any analysis happens. Every subcommand here exists to get an agent
to the ~5% that carries signal.

Subcommands
  snapshot   copy a live session tree (main + subagents + task outputs) somewhere stable
  index      one row per transcript: agent type, task, turns, tools, wall time
  corpus     one row per transcript across EVERY session in a date window -- for
             multi-session questions ("token spend this month", "which sessions used X")
  render     transcript -> readable markdown, tool payloads truncated, turns numbered
  stats      tool-call counts, failure counts, model/effort, timing
  friction   heuristic signal extraction (see FRICTION_SIGNALS below)
  grep       search rendered text, reporting turn numbers to render around
  turn       print one turn (or a range) in full, no truncation
  journal    a Workflow's per-agent results -- where a fan-out run's conclusions live
  writes     every file the agents wrote (Write, optionally Edit), listed or extracted --
             for comparing the scripts a fan-out's agents each reinvented

Turn numbers are stable for a given input file, so `grep` -> `turn` -> `render --from`
is the normal drill-down loop.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# loading
# ---------------------------------------------------------------------------


def load(path: Path) -> list[dict]:
    """Parse a JSONL transcript, tolerating partial trailing lines on a live session."""
    out = []
    with path.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def ts(rec: dict):
    raw = rec.get("timestamp")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def content_blocks(rec: dict) -> list[dict]:
    msg = rec.get("message")
    if not isinstance(msg, dict):
        return []
    content = msg.get("content")
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if isinstance(content, list):
        return [b for b in content if isinstance(b, dict)]
    return []


def flat_text(value, limit: int = 4000) -> str:
    """Best-effort flatten of the many shapes a tool result takes.

    `limit=0` means no cap. `render` keeps a cap so a session's payloads never all sit in
    memory at once, but `grep` and `turn` pass 0: a result the drill-down loop cannot reach
    is indistinguishable to the analyst from one that never happened, and a silent cap
    there makes the tool lie about what the session contains.
    """

    def cut(s: str) -> str:
        return s[:limit] if limit else s

    if value is None:
        return ""
    if isinstance(value, str):
        return cut(value)
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or cut(json.dumps(item)))
            else:
                parts.append(str(item))
        return cut("\n".join(str(p) for p in parts))
    if isinstance(value, dict):
        for key in ("stdout", "text", "content", "output", "result"):
            if key in value:
                return flat_text(value[key], limit)
        return cut(json.dumps(value))
    return cut(str(value))


# Directories to search for the out-of-line payload of a `<persisted-output>` result.
# Populated from the transcript's own location; a snapshot moves the transcript away from
# the absolute path the marker names, so the basename has to be findable relatively too.
PERSISTED_SEARCH: list[Path] = []

_PERSISTED = re.compile(
    r"<persisted-output>\s*\n?\s*Output too large.*?saved to:\s*(?P<path>\S+)", re.S
)


def set_persisted_search(transcript: Path) -> None:
    """Register where `tool-results/` might live relative to this transcript."""
    PERSISTED_SEARCH.clear()
    here = transcript.parent
    for cand in (
        here / "tool-results",
        here.parent / "tool-results",
        here / transcript.stem / "tool-results",
        here.parent.parent / "tool-results",
    ):
        if cand.is_dir() and cand not in PERSISTED_SEARCH:
            PERSISTED_SEARCH.append(cand)


def resolve_persisted(text: str) -> str:
    """Splice a `<persisted-output>` pointer's real payload back into the result text.

    Large tool results are written to `<project>/<session>/tool-results/<id>.txt` and the
    transcript keeps only a 2KB preview. Analysing the preview and calling it the output is
    how a forensics run concludes something never happened when it merely scrolled past.
    """
    m = _PERSISTED.search(text)
    if not m:
        return text
    named = Path(m.group("path"))
    for cand in [named, *(d / named.name for d in PERSISTED_SEARCH)]:
        try:
            if cand.is_file():
                body = cand.read_text(encoding="utf-8", errors="replace")
                return f"[persisted-output resolved from {cand}]\n{body}"
        except OSError:
            continue
    return text + f"\n[persisted-output NOT resolved: {named} is missing from this snapshot]"


# ---------------------------------------------------------------------------
# turn model
# ---------------------------------------------------------------------------


class Turn:
    """One assistant or user record, normalised for display and analysis."""

    def __init__(self, n: int, rec: dict, *, result_limit: int = 4000):
        self.n = n
        self.rec = rec
        self.role = rec.get("type")
        self.time = ts(rec)
        self.text: list[str] = []
        self.thinking: list[str] = []
        self.tools: list[dict] = []  # {name, input, id}
        self.results: list[dict] = []  # {tool_use_id, is_error, text}
        for block in content_blocks(rec):
            kind = block.get("type")
            if kind == "text":
                self.text.append(block.get("text", ""))
            elif kind == "thinking":
                self.thinking.append(block.get("thinking", ""))
            elif kind == "tool_use":
                self.tools.append(
                    {"name": block.get("name", "?"), "input": block.get("input", {}), "id": block.get("id")}
                )
            elif kind == "tool_result":
                # Resolve the pointer before capping, so a cap trims the real output rather
                # than the boilerplate that stands in front of it.
                body = resolve_persisted(flat_text(block.get("content"), 0))
                full_len = len(body)
                if result_limit and full_len > result_limit:
                    body = body[:result_limit]
                self.results.append(
                    {
                        "tool_use_id": block.get("tool_use_id"),
                        "is_error": bool(block.get("is_error")),
                        "text": body,
                        "full_len": full_len,
                    }
                )
        # The richer result payload lives outside message.content on some records.
        tur = rec.get("toolUseResult")
        if tur is not None and self.results:
            self.results[0].setdefault("detail", tur)
        self.tool_use_result = tur

    @property
    def is_meta(self) -> bool:
        return bool(self.rec.get("isMeta"))


def build_turns(records: list[dict], *, result_limit: int = 4000) -> list[Turn]:
    turns = []
    n = 0
    for rec in records:
        if rec.get("type") not in ("assistant", "user"):
            continue
        n += 1
        turns.append(Turn(n, rec, result_limit=result_limit))
    return turns


def human_turns(turns: list[Turn]) -> list[Turn]:
    """User records a person actually typed.

    Most `user` records are tool results or system-injected notifications; only
    origin.kind == "human" / promptSource == "typed" is a real interjection.
    """
    out = []
    for t in turns:
        if t.role != "user" or t.results or t.is_meta:
            continue
        origin = t.rec.get("origin") or {}
        if origin.get("kind") == "human" or t.rec.get("promptSource") == "typed":
            out.append(t)
    return out


# ---------------------------------------------------------------------------
# summarising a tool call in one line
# ---------------------------------------------------------------------------

_SUMMARY_KEYS = (
    "command",
    "file_path",
    "pattern",
    "path",
    "prompt",
    "url",
    "description",
    "query",
    "skill",
    "notebook_path",
    "old_string",
)


def tool_summary(call: dict, width: int = 220) -> str:
    inp = call.get("input") or {}
    if not isinstance(inp, dict):
        return str(inp)[:width]

    # A file-mutating call's *content* is the whole point of it. Summarising Write/Edit by
    # file_path alone renders every change a run shipped as a bare filename, which makes
    # judging the run's output impossible from the digest.
    name = call.get("name")
    if name in ("Write", "Edit", "NotebookEdit") and any(
        k in inp for k in ("content", "old_string", "new_string", "new_source")
    ):
        head = f"file_path={inp.get('file_path') or inp.get('notebook_path') or '?'}"
        parts = [head]
        for key in ("old_string", "new_string", "new_source", "content"):
            val = inp.get(key)
            if val:
                text = str(val)
                shown = text[:width]
                more = f" …[+{len(text) - width} chars]" if len(text) > width else ""
                parts.append(f"  {key}:\n{shown}{more}")
        return "\n".join(parts)

    for key in _SUMMARY_KEYS:
        if key in inp and inp[key]:
            val = str(inp[key]).replace("\n", " \\n ")
            more = f" …[+{len(val) - width} chars]" if len(val) > width else ""
            return f"{key}={val[:width]}{more}"
    return json.dumps(inp)[:width]


# ---------------------------------------------------------------------------
# render
# ---------------------------------------------------------------------------


def _clip(text: str, truncate: int) -> str:
    """Truncate, but never silently.

    An unmarked cut is worse than a shorter one: the analyst reads a half-sentence
    conclusion as the whole conclusion and cites it as such.
    """
    if not truncate or len(text) <= truncate:
        return text
    return text[:truncate] + f"\n...[{len(text) - truncate} more chars truncated]"


def render(turns: list[Turn], *, truncate: int, show_thinking: bool, start: int, end: int) -> str:
    lines = []
    for t in turns:
        if t.n < start or t.n > end:
            continue
        stamp = t.time.strftime("%H:%M:%S") if t.time else "--:--:--"
        header_role = "ASSISTANT" if t.role == "assistant" else "USER"
        if t.results:
            header_role = "TOOL-RESULT"
        lines.append(f"\n===== turn {t.n} [{header_role} {stamp}] =====")
        if show_thinking:
            for th in t.thinking:
                lines.append(f"<thinking>\n{_clip(th, truncate)}\n</thinking>")
        for txt in t.text:
            if txt.strip():
                lines.append(_clip(txt, truncate))
        for call in t.tools:
            lines.append(f"[tool_use {call['name']}] {tool_summary(call, 1200)}")
        for res in t.results:
            flag = "ERROR " if res["is_error"] else ""
            # A result can be cut twice -- once by the parse-time cap, again by --truncate.
            # Count both against the original length in a single number: a marker that
            # reports only the second cut understates the loss by the size of the first,
            # which is the same lie as no marker at all.
            shown = res["text"][:truncate] if truncate else res["text"]
            dropped = res.get("full_len", len(res["text"])) - len(shown)
            body = shown + (f"\n...[{dropped} more chars truncated]" if dropped > 0 else "")
            lines.append(f"[tool_result {flag}]\n{body}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# stats
# ---------------------------------------------------------------------------


def bash_failed(turn: Turn, res: dict) -> bool:
    if res["is_error"]:
        return True
    detail = turn.tool_use_result
    if isinstance(detail, dict):
        code = detail.get("exitCode", detail.get("exit_code"))
        if isinstance(code, int) and code != 0:
            return True
        if detail.get("interrupted"):
            return True
    return False


def stats(records: list[dict], turns: list[Turn]) -> dict:
    tools = Counter()
    errors = Counter()
    by_id = {}
    for t in turns:
        for call in t.tools:
            tools[call["name"]] += 1
            by_id[call["id"]] = call
    for t in turns:
        for res in t.results:
            call = by_id.get(res["tool_use_id"])
            name = call["name"] if call else "?"
            if bash_failed(t, res):
                errors[name] += 1

    times = [t.time for t in turns if t.time]
    span = None
    if len(times) >= 2:
        span = (max(times) - min(times)).total_seconds()

    models = Counter()
    efforts = Counter()
    for rec in records:
        if rec.get("type") == "assistant":
            msg = rec.get("message") or {}
            if msg.get("model"):
                models[msg["model"]] += 1
            if rec.get("effort"):
                efforts[str(rec["effort"])] += 1

    # A streamed API message is written as one record per content block, each repeating the
    # message's usage block, and only the last copy carries the final output count. Summing
    # every record over-reported a real session 3-5x, so keep one block per message id.
    per_message: dict = {}
    for i, rec in enumerate(records):
        msg = rec.get("message") or {}
        u = msg.get("usage") if isinstance(msg, dict) else None
        if isinstance(u, dict):
            per_message[msg.get("id") or f"record-{i}"] = u
    usage = Counter()
    for u in per_message.values():
        for k, v in u.items():
            if isinstance(v, int):
                usage[k] += v

    return {
        "records": len(records),
        "turns": len(turns),
        "assistant_turns": sum(1 for t in turns if t.role == "assistant"),
        "human_turns": len(human_turns(turns)),
        "tool_calls": sum(tools.values()),
        "tools": dict(tools.most_common()),
        "failed_results": dict(errors.most_common()),
        "wall_seconds": round(span) if span else None,
        "first": min(times).isoformat() if times else None,
        "last": max(times).isoformat() if times else None,
        "models": dict(models),
        "efforts": dict(efforts),
        "usage": dict(usage),
    }


# ---------------------------------------------------------------------------
# friction
# ---------------------------------------------------------------------------

FRICTION_SIGNALS = """\
failed-tool       a tool result marked is_error, or a Bash exit code != 0
repeat-command    the same Bash command run 3+ times (retry loops, re-derivation)
denied            the user or a hook rejected a tool call
interrupt         the user interrupted the assistant mid-turn
human-turn        a human typed something after the opening prompt (a correction,
                  an unblock, or an answer the agent could not get itself)
long-gap          >180s of wall time between consecutive turns
self-correction   assistant text admitting a wrong earlier claim
missing-tool      an error naming a command/binary/script that does not exist
masked-failure    a traceback or fatal error in output whose exit code was swallowed by a
                  pipe (`cmd 2>&1 | tail`), so no other signal reports it
"""

_SELF_CORRECTION = re.compile(
    r"\b(i was wrong|that was wrong|my (earlier|previous) (claim|statement|analysis) was|"
    r"correction:|i mis(read|stated|understood|diagnosed)|actually,? (it|the|that) (is|was) not|"
    r"retract|i incorrectly)\b",
    re.I,
)
_MISSING_TOOL = re.compile(
    r"(command not found|no such file or directory|is not recognized|"
    r"unknown (command|option|flag)|ENOENT|not invocable|does not exist)",
    re.I,
)
_DENIED = re.compile(
    r"(user (has )?(denied|rejected|doesn't want)|permission (denied|to use)|"
    r"requested permissions? .*but|blocked by hook|hook.*(blocked|denied))",
    re.I,
)
# `python3 script.py 2>&1 | tail -20` exits 0 whatever the script did, so the crash is
# invisible to every exit-code check. The most consequential failure in an analysed run --
# this skill's own snapshot step dying -- was hidden exactly this way.
_MASKED_FAILURE = re.compile(
    r"(Traceback \(most recent call last\)|^\s*[A-Za-z_]*(Error|Exception):\s|"
    r"panic:|FATAL ERROR:|Segmentation fault)",
    re.M,
)


def friction(turns: list[Turn], *, gap_seconds: int = 180) -> list[dict]:
    events: list[dict] = []
    by_id = {}
    for t in turns:
        for call in t.tools:
            by_id[call["id"]] = call

    bash_counts: dict[str, list[int]] = defaultdict(list)

    prev_time = None
    for t in turns:
        if t.time and prev_time:
            gap = (t.time - prev_time).total_seconds()
            if gap > gap_seconds:
                events.append({"turn": t.n, "kind": "long-gap", "detail": f"{round(gap)}s since previous turn"})
        if t.time:
            prev_time = t.time

        for call in t.tools:
            if call["name"] == "Bash":
                cmd = (call["input"] or {}).get("command")
                if cmd:
                    bash_counts[" ".join(str(cmd).split())].append(t.n)

        for res in t.results:
            call = by_id.get(res["tool_use_id"])
            name = call["name"] if call else "?"
            body = res["text"]
            failed = bash_failed(t, res)
            if failed:
                events.append(
                    {
                        "turn": t.n,
                        "kind": "failed-tool",
                        "tool": name,
                        "call": tool_summary(call) if call else "",
                        "detail": body[:400],
                    }
                )
            elif _MASKED_FAILURE.search(body):
                m = _MASKED_FAILURE.search(body)
                events.append(
                    {
                        "turn": t.n,
                        "kind": "masked-failure",
                        "tool": name,
                        "call": tool_summary(call) if call else "",
                        "detail": body[m.start() : m.start() + 400],
                    }
                )
            if _DENIED.search(body[:1500]):
                events.append({"turn": t.n, "kind": "denied", "tool": name, "detail": body[:300]})
            if _MISSING_TOOL.search(body[:1500]):
                events.append({"turn": t.n, "kind": "missing-tool", "tool": name, "detail": body[:300]})

        if t.role == "assistant":
            joined = "\n".join(t.text)
            if _SELF_CORRECTION.search(joined):
                m = _SELF_CORRECTION.search(joined)
                lo = max(0, m.start() - 150)
                events.append({"turn": t.n, "kind": "self-correction", "detail": joined[lo : m.end() + 250]})

        if t.rec.get("interruptedMessageId") or any("[Request interrupted by user" in x for x in t.text):
            events.append({"turn": t.n, "kind": "interrupt", "detail": "assistant turn interrupted by the user"})

    for t in human_turns(turns)[1:]:  # the first human turn is the task itself
        events.append({"turn": t.n, "kind": "human-turn", "detail": " ".join(t.text)[:400]})

    for cmd, seen in bash_counts.items():
        if len(seen) >= 3:
            events.append(
                {
                    "turn": seen[0],
                    "kind": "repeat-command",
                    "detail": f"{len(seen)}x at turns {seen[:12]}: {cmd[:200]}",
                }
            )

    events.sort(key=lambda e: (e["turn"], e["kind"]))
    return events


# ---------------------------------------------------------------------------
# index / snapshot
# ---------------------------------------------------------------------------


def describe(path: Path) -> dict:
    records = load(path)
    turns = build_turns(records)
    st = stats(records, turns)
    meta_path = path.with_suffix("").with_suffix(".meta.json")
    if not meta_path.exists():
        meta_path = Path(str(path).replace(".jsonl", ".meta.json"))
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
        except json.JSONDecodeError:
            meta = {}
    task = ""
    for t in turns:
        if t.role == "user" and t.text:
            task = " ".join(t.text)[:300].replace("\n", " ")
            break
    return {
        "file": str(path),
        "agentType": meta.get("agentType", "main"),
        "description": meta.get("description", ""),
        "parentAgentId": meta.get("parentAgentId"),
        "spawnDepth": meta.get("spawnDepth", 0),
        "task": task,
        **{k: st[k] for k in ("turns", "tool_calls", "wall_seconds", "first", "last")},
        "failed_results": sum(st["failed_results"].values()),
        "top_tools": dict(list(st["tools"].items())[:6]),
    }


# ---------------------------------------------------------------------------
# corpus
# ---------------------------------------------------------------------------

PROJECTS_ROOT = Path.home() / ".claude" / "projects"


def _corpus_kind(rel: tuple[str, ...]) -> tuple[str, str | None]:
    # <proj>/<session>.jsonl | <proj>/<session>/subagents/agent-*.jsonl
    # | <proj>/<session>/subagents/workflows/<wf id>/agent-*.jsonl
    if "workflows" in rel:
        return "workflow", rel[rel.index("workflows") + 1]
    if "subagents" in rel:
        return "subagent", None
    return "main", None


def corpus_row(args: tuple[str, str, str, str]) -> dict | None:
    """One transcript, streamed: a 14 GB projects tree cannot be `load()`ed file by file."""
    path_s, root_s, since, until = args
    path = Path(path_s)
    rel = path.relative_to(root_s).parts
    kind, wf = _corpus_kind(rel)
    session = rel[1][: -len(".jsonl")] if kind == "main" else rel[1]
    per_message: dict = {}
    models: Counter = Counter()
    first = last = active = None
    prompt = ""
    try:
        with open(path, "rb") as fh:
            for line in fh:
                # Cheap byte test first: most lines are tool payloads carrying neither.
                has_usage = b'"usage"' in line
                if not has_usage and (prompt or b'"user"' not in line):
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts = rec.get("timestamp") or ""
                if ts:
                    first = min(first, ts) if first else ts
                    last = max(last, ts) if last else ts
                msg = rec.get("message") if isinstance(rec.get("message"), dict) else {}
                if not prompt and rec.get("type") == "user" and not rec.get("isMeta"):
                    c = msg.get("content")
                    text = c if isinstance(c, str) else " ".join(
                        b.get("text", "") for b in c or [] if isinstance(b, dict) and b.get("type") == "text"
                    )
                    if not text.lstrip().startswith("<local-command-caveat>"):
                        prompt = " ".join(text.split())[:240]
                u = msg.get("usage")
                if rec.get("type") != "assistant" or not isinstance(u, dict):
                    continue
                if not (since <= ts[:10] and (not until or ts[:10] < until)):
                    continue
                mid = msg.get("id") or f"line-{len(per_message)}"
                if mid not in per_message:
                    models[msg.get("model") or "?"] += 1
                    # A session started before `since` still bills its in-window turns to the
                    # window, so group by the first counted message, not the file's first line.
                    active = min(active, ts) if active else ts
                # Streamed copies of one message repeat the block; the last carries final counts.
                per_message[mid] = u
    except OSError:
        return None
    if not per_message:
        return None
    usage: Counter = Counter()
    for u in per_message.values():
        for k, v in u.items():
            if isinstance(v, int):
                usage[k] += v
        cc = u.get("cache_creation") or {}
        usage["cache_write_1h"] += cc.get("ephemeral_1h_input_tokens") or 0
        usage["cache_write_5m"] += cc.get("ephemeral_5m_input_tokens") or 0
    meta = {}
    meta_path = path.with_suffix(".meta.json")
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
        except (OSError, json.JSONDecodeError):
            meta = {}
    return {
        "file": str(path),
        "project": rel[0],
        "session": session,
        "kind": kind,
        "workflow": wf,
        "agentType": meta.get("agentType", "main" if kind == "main" else "?"),
        "description": meta.get("description", ""),
        "first": first,
        "last": last,
        "month": active[:7],
        "prompt": prompt,
        "messages": len(per_message),
        "models": dict(models),
        "usage": dict(usage),
    }


def corpus(root: Path, since: str, until: str | None, jobs: int) -> list[dict]:
    from multiprocessing import Pool

    cutoff = datetime.fromisoformat(since).timestamp()
    files = [
        str(f)
        for f in root.glob("*/**/*.jsonl")
        if not f.name.endswith("journal.jsonl") and f.stat().st_mtime >= cutoff
    ]
    work = [(f, str(root), since, until or "") for f in files]
    with Pool(jobs) as pool:
        rows = [r for r in pool.map(corpus_row, work, chunksize=8) if r]
    rows.sort(key=lambda r: r["first"] or "")
    return rows


def corpus_summary(rows: list[dict]) -> str:
    keys = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
    groups: dict = defaultdict(lambda: [0, 0, set(), Counter()])
    for r in rows:
        for g in (r["month"], "all"):
            for kind in (r["kind"], "ALL"):
                acc = groups[(g, kind)]
                acc[0] += 1
                acc[1] += r["messages"]
                acc[2].add(r["session"])
                acc[3].update({k: r["usage"].get(k, 0) for k in keys})
    out = [f"{'month':<8} {'kind':<9} {'files':>6} {'sessions':>8} {'msgs':>8} "
           f"{'input':>9} {'cacheW':>9} {'cacheR':>11} {'output':>9}"]
    for (g, kind), (n, msgs, sess, u) in sorted(groups.items()):
        m = lambda k: f"{u[k] / 1e6:,.1f}M"  # noqa: E731
        out.append(f"{g:<8} {kind:<9} {n:>6} {len(sess):>8} {msgs:>8} {m(keys[0]):>9} "
                   f"{m(keys[1]):>9} {m(keys[2]):>11} {m(keys[3]):>9}")
    return "\n".join(out)


def snapshot(session_jsonl: Path, dest: Path) -> dict:
    """Copy a session's transcripts somewhere stable. A live session keeps appending."""
    dest.mkdir(parents=True, exist_ok=True)
    written = {"main": None, "subagents": [], "task_outputs": 0}
    shutil.copy2(session_jsonl, dest / "main.jsonl")
    written["main"] = str(dest / "main.jsonl")

    session_id = session_jsonl.stem
    # Subagent transcripts live beside the session, but a session that entered a worktree
    # writes them under the worktree's own project directory, so search both.
    roots = {session_jsonl.parent}
    projects = session_jsonl.parent.parent
    if projects.exists():
        for sib in projects.iterdir():
            if sib.is_dir():
                roots.add(sib)
    sub_dest = dest / "subagents"
    for root in sorted(roots):
        cand = root / session_id / "subagents"
        if not cand.is_dir():
            continue
        sub_dest.mkdir(exist_ok=True)
        # A Workflow nests its agents one level deeper, under `subagents/workflows/<wf id>/`,
        # so a flat iterdir hits that directory and dies -- which broke snapshot for exactly
        # the fan-out runs this skill is most useful on. Walk instead, and flatten: agent ids
        # are unique, and the workflow's own journal is copied out by name below.
        for f in sorted(cand.rglob("*")):
            if not f.is_file():
                continue
            if f.name == "journal.jsonl":
                target = sub_dest / f"{f.parent.name}.journal.jsonl"
                shutil.copy2(f, target)
                written.setdefault("journals", []).append(str(target))
                continue
            shutil.copy2(f, sub_dest / f.name)
            if f.suffix == ".jsonl":
                written["subagents"].append(str(sub_dest / f.name))

    # Results too large to inline are written to `<session>/tool-results/<id>.txt` and the
    # transcript keeps a 2KB preview pointing at an absolute path. Leave them behind and the
    # snapshot is not a freeze: the payloads vanish when the session directory is cleaned.
    for root in sorted(roots):
        for sub in ("tool-results", "workflows"):
            cand = root / session_id / sub
            if not cand.is_dir():
                continue
            tgt = dest / sub
            tgt.mkdir(exist_ok=True)
            for f in sorted(cand.iterdir()):
                if f.is_file():
                    shutil.copy2(f, tgt / f.name)
                    written[sub] = written.get(sub, 0) + 1

    # Background-task outputs. A `local_agent` task's .output is a symlink to the subagent
    # transcript already copied above, so copying it through would double the snapshot for
    # nothing; only the real files (bash task stdout) are worth keeping.
    tmp_root = Path(f"/tmp/claude-{os.getuid()}")
    for cand in tmp_root.glob(f"*/{session_id}/tasks"):
        task_dest = dest / "tasks"
        task_dest.mkdir(exist_ok=True)
        for f in cand.iterdir():
            if f.is_symlink():
                continue
            try:
                shutil.copy2(f, task_dest / f.name)
                written["task_outputs"] += 1
            except OSError:
                continue
    return written


# ---------------------------------------------------------------------------
# workflow journal
# ---------------------------------------------------------------------------


def journal(path: Path) -> list[dict]:
    """Read a Workflow's `journal.jsonl` into one row per agent.

    A fan-out run's *conclusions* are here, not in the transcripts: each agent's
    schema-validated return value, keyed by agent id. Without this an analyst reconstructs
    them by hand from 37 transcripts, which is both expensive and lossy.
    """
    rows: dict[str, dict] = {}
    order: list[str] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        agent = rec.get("agentId")
        if not agent:
            continue
        if agent not in rows:
            rows[agent] = {"agentId": agent, "key": rec.get("key"), "started": False, "result": None}
            order.append(agent)
        if rec.get("type") == "started":
            rows[agent]["started"] = True
        elif rec.get("type") == "result":
            rows[agent]["result"] = rec.get("result")
    return [rows[a] for a in order]


# ---------------------------------------------------------------------------
# writes
# ---------------------------------------------------------------------------


def agent_label(path: Path) -> str:
    """The transcript's agent id as the other subcommands name it: its filename stem."""
    return path.stem


def writes(paths: list[Path], *, path_regex: re.Pattern | None = None, include_edits: bool = False) -> list[dict]:
    """Every Write (and optionally Edit) across these transcripts, chronologically.

    Agents in a fan-out run routinely reinvent the same helper script in /tmp or
    `.plan-impl/`; the variants exist only as tool inputs, so comparing them otherwise means
    hand-rolling a loop over every transcript.
    """
    wanted = {"Write", "Edit"} if include_edits else {"Write"}
    rows: list[dict] = []
    for path in paths:
        agent = agent_label(path)
        turns = build_turns(load(path), result_limit=1)
        failed = {res["tool_use_id"] for t in turns for res in t.results if res["is_error"]}
        for t in turns:
            for call in t.tools:
                inp = call["input"] if isinstance(call["input"], dict) else {}
                file_path = str(inp.get("file_path") or "")
                if call["name"] not in wanted or (path_regex and not path_regex.search(file_path)):
                    continue
                row = {
                    "timestamp": str(t.rec.get("timestamp") or ""),
                    "agent": agent,
                    "transcript": str(path),
                    "turn": t.n,
                    "tool": call["name"],
                    "file_path": file_path,
                    # A denied or failed Write never reached disk; its content is still the
                    # agent's intent, but must not read as what the file ended up holding.
                    "failed": call["id"] in failed,
                }
                if call["name"] == "Write":
                    row["content"] = str(inp.get("content") or "")
                    row["bytes"] = len(row["content"].encode("utf-8"))
                else:
                    row["old_string"] = str(inp.get("old_string") or "")
                    row["new_string"] = str(inp.get("new_string") or "")
                    row["replace_all"] = bool(inp.get("replace_all"))
                    row["bytes"] = len(row["new_string"].encode("utf-8"))
                rows.append(row)
    # Keyed on the full transcript path, not the agent label: two snapshots' `main.jsonl`
    # share a label, and a missing timestamp ("") must still order the same on every run.
    rows.sort(key=lambda r: (r["timestamp"], r["transcript"], r["turn"]))
    return rows


def assign_out_names(rows: list[dict]) -> None:
    """Set `out_name` on every row `--out` extracts. A failed Write gets none.

    One source file is `<agent id>__<basename>`. Its last Write keeps that name, because it
    is the version the agent ended on. Earlier Writes get `.v1`, `.v2`, ... before the
    extension so they still open with the right syntax highlighting. Edits go to one
    `.edits.jsonl` per source file, and a failed Edit is logged there too, with
    `"failed": true`.

    Versions are per source *path*, not per basename. If one agent wrote both
    `.plan-impl/tmp/shoot.js` and `/tmp/shoot.js`, each gets a short hash of its full path
    (`shoot.3f2a1c.js`), so they are never presented as revisions of one file. Any name still
    claimed twice, such as an agent's own literal `shoot.v1.js`, gets `~2`, `~3`, ... so no
    extracted file overwrites another.
    """
    extracted = [r for r in rows if not (r["tool"] == "Write" and r["failed"])]

    def short(r: dict) -> str:
        return r["agent"].removeprefix("agent-")

    def basename(r: dict) -> str:
        return Path(r["file_path"]).name or "unnamed"

    paths_per_name: dict[tuple[str, str], set[str]] = defaultdict(set)
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in extracted:
        paths_per_name[(short(r), basename(r))].add(r["file_path"])
        groups[(r["transcript"], r["file_path"])].append(r)

    for (_, file_path), group in groups.items():
        s, name = short(group[0]), basename(group[0])
        p = Path(name)
        tag = f".{hashlib.sha1(file_path.encode()).hexdigest()[:6]}" if len(paths_per_name[(s, name)]) > 1 else ""
        stem = f"{s}__{p.stem}{tag}"
        write_rows = [r for r in group if r["tool"] == "Write"]
        for i, r in enumerate(write_rows, start=1):
            r["out_name"] = f"{stem}{p.suffix}" if i == len(write_rows) else f"{stem}.v{i}{p.suffix}"
        for r in group:
            if r["tool"] == "Edit":
                r["out_name"] = f"{stem}{p.suffix}.edits.jsonl"

    # The rows of one edits log share a key, so they keep sharing the resolved name.
    owner: dict[str, tuple] = {}
    resolved: dict[tuple, str] = {}
    for r in extracted:
        key = (r["transcript"], r["file_path"], r["tool"], r["out_name"])
        if key not in resolved:
            cand, n, p = r["out_name"], 1, Path(r["out_name"])
            while cand in owner:
                n += 1
                cand = f"{p.stem}~{n}{p.suffix}"
            owner[cand] = key
            resolved[key] = cand
        r["out_name"] = resolved[key]


def extract_writes(rows: list[dict], out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    edit_files: set[str] = set()
    for r in rows:
        if "out_name" not in r:  # a failed Write: its content never reached disk
            continue
        target = out / r["out_name"]
        if r["tool"] == "Write":
            target.write_text(r["content"], encoding="utf-8")
            continue
        # Truncate on first touch so a re-run into the same --out does not double the log.
        mode = "a" if r["out_name"] in edit_files else "w"
        edit_files.add(r["out_name"])
        keep = ("timestamp", "turn", "file_path", "old_string", "new_string", "replace_all", "failed")
        with target.open(mode, encoding="utf-8") as fh:
            fh.write(json.dumps({k: r[k] for k in keep}) + "\n")


# ---------------------------------------------------------------------------
# cli
# ---------------------------------------------------------------------------


def _resolve(paths: list[str]) -> list[Path]:
    out = []
    for p in paths:
        path = Path(p)
        if not path.exists():
            # A session with no subagents snapshots no `subagents/` dir, and the documented
            # `index main.jsonl subagents` call must still index main rather than crash. A
            # missing transcript is a typo, though, and must not pass as an empty index.
            if path.suffix == ".jsonl":
                sys.exit(f"transcript not found: {p}")
            print(f"skipping {p}: does not exist", file=sys.stderr)
            continue
        if path.is_dir():
            # A journal sits beside the transcripts but is not one; indexing it yields a row
            # of zeroes that reads like an agent that did nothing.
            out.extend(sorted(f for f in path.rglob("*.jsonl") if not f.name.endswith("journal.jsonl")))
        else:
            out.append(path)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("snapshot", help="copy a live session tree somewhere stable")
    p.add_argument("session_jsonl")
    p.add_argument("dest")

    p = sub.add_parser("index", help="one row per transcript")
    p.add_argument("paths", nargs="+")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("corpus", help="one JSONL row per transcript across every session in a window")
    p.add_argument("--since", required=True, help="YYYY-MM-DD, inclusive")
    p.add_argument("--until", help="YYYY-MM-DD, exclusive")
    p.add_argument("--root", default=str(PROJECTS_ROOT))
    p.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    p.add_argument("--summary", action="store_true", help="month x kind token table instead of rows")
    p.add_argument("--out", help="write rows to this JSONL file (stdout otherwise)")

    p = sub.add_parser("render", help="readable markdown")
    p.add_argument("path")
    p.add_argument("--truncate", type=int, default=1500, help="max chars per block (0 = unlimited)")
    p.add_argument("--thinking", action="store_true")
    p.add_argument("--from", dest="start", type=int, default=1)
    p.add_argument("--to", dest="end", type=int, default=10**9)
    p.add_argument("--out", help="write to a file instead of stdout")
    p.add_argument("--chunk", type=int, default=0, help="with --out, split into N-turn files")

    p = sub.add_parser("stats", help="counts and timing")
    p.add_argument("path")

    p = sub.add_parser("friction", help="heuristic friction signals")
    p.add_argument("path", nargs="?")
    p.add_argument("--kind", action="append", help="restrict to these signal kinds")
    p.add_argument("--gap", type=int, default=180)
    p.add_argument("--json", action="store_true")
    p.add_argument("--signals", action="store_true", help="print the signal catalogue and exit")

    p = sub.add_parser("grep", help="search rendered text, report turn numbers")
    p.add_argument("path")
    p.add_argument("pattern")
    p.add_argument("-i", "--ignore-case", action="store_true")
    p.add_argument("-C", "--context", type=int, default=120, help="chars of context")
    p.add_argument("--max", type=int, default=80)

    p = sub.add_parser("turn", help="print turns in full")
    p.add_argument("path")
    p.add_argument("n", type=int)
    p.add_argument("--to", dest="end", type=int)

    p = sub.add_parser("journal", help="a Workflow journal's per-agent results")
    p.add_argument("path", help="journal.jsonl, or a snapshot's <wf id>.journal.jsonl")
    p.add_argument("--json", action="store_true")
    p.add_argument("--agent", help="only this agent id")
    p.add_argument("--truncate", type=int, default=1200, help="max chars per result (0 = unlimited)")

    p = sub.add_parser(
        "writes",
        help="list or extract every file the agents wrote",
        description="One line per Write, chronological across all inputs: "
        "<timestamp> <agent> turn <n> <Write|Edit> <path> <bytes>. Edit's bytes are its "
        "new_string's. A trailing [failed] means the tool result was an error, so the "
        "content never reached disk. Rows tie-break on (timestamp, transcript path, turn), "
        "and rows with no timestamp sort first.",
    )
    p.add_argument("paths", nargs="+", help="transcripts and/or snapshot dirs (expanded like index)")
    p.add_argument("--path-regex", help="only file_paths this regex searches successfully")
    p.add_argument("--include-edits", action="store_true", help="Edit calls too (old/new strings)")
    p.add_argument(
        "--out",
        help="also extract each Write to DIR/<agent id>__<basename>. When one agent writes the same "
        "path more than once, the last Write keeps that name and earlier ones become "
        "<stem>.v1<ext>, .v2, ... When one agent wrote different paths with the same basename, "
        "each name gets a short hash of its path, and a name that would still collide gets "
        "~2, ~3, ... Failed Writes are listed but not extracted. Edits, failed ones included "
        "with \"failed\": true, are logged to DIR/<agent id>__<basename>.edits.jsonl",
    )
    p.add_argument("--list", action="store_true", help="with --out, a dry run: list target names, write nothing")

    args = ap.parse_args()

    if args.cmd == "snapshot":
        print(json.dumps(snapshot(Path(args.session_jsonl), Path(args.dest)), indent=2))
        return 0

    if args.cmd == "index":
        rows = [describe(p) for p in _resolve(args.paths)]
        rows.sort(key=lambda r: (r["spawnDepth"], r["first"] or ""))
        if args.json:
            print(json.dumps(rows, indent=2))
            return 0
        for r in rows:
            mins = f"{r['wall_seconds'] // 60}m" if r["wall_seconds"] else "?"
            print(
                f"{r['agentType']:<22} d{r['spawnDepth']} turns={r['turns']:<5} tools={r['tool_calls']:<5} "
                f"fails={r['failed_results']:<4} {mins:<6} {r['description'] or r['task'][:70]}"
            )
            print(f"    {r['file']}")
        return 0

    if args.cmd == "corpus":
        rows = corpus(Path(args.root), args.since, args.until, args.jobs)
        if args.summary:
            print(corpus_summary(rows))
        body = "".join(json.dumps(r) + "\n" for r in rows)
        if args.out:
            Path(args.out).write_text(body)
        elif not args.summary:
            sys.stdout.write(body)
        print(f"{len(rows)} transcripts with usage in window", file=sys.stderr)
        return 0

    if args.cmd == "writes":
        rx = None
        if args.path_regex:
            try:
                rx = re.compile(args.path_regex)
            except re.error as exc:
                print(f"bad --path-regex {args.path_regex!r}: {exc}", file=sys.stderr)
                return 2
        # A snapshot dir plus its own main.jsonl must not list main's writes twice.
        paths = list(dict.fromkeys(p.resolve() for p in _resolve(args.paths)))
        rows = writes(paths, path_regex=rx, include_edits=args.include_edits)
        if args.out:
            assign_out_names(rows)
        for r in rows:
            stamp = r["timestamp"][:19] or "--"
            line = f"{stamp} {r['agent']} turn {r['turn']} {r['tool']} {r['file_path']} {r['bytes']}"
            if r["failed"]:
                line += " [failed]"
            if args.out:
                line += f" -> {r['out_name']}" if "out_name" in r else " (not extracted: failed)"
            print(line)
        if args.out and not args.list:
            extract_writes(rows, Path(args.out))
        n_files = len({r["out_name"] for r in rows if "out_name" in r}) if args.out else 0
        where = f", {n_files} files {'would be ' if args.list else ''}in {args.out}" if args.out else ""
        print(f"\n{len(rows)} writes across {len(paths)} transcripts{where}", file=sys.stderr)
        return 0

    if args.cmd == "friction" and args.signals:
        print(FRICTION_SIGNALS)
        return 0

    if not args.path:
        ap.error("a transcript path is required")
    path = Path(args.path)

    if args.cmd == "journal":
        rows = journal(path)
        if args.agent:
            rows = [r for r in rows if r["agentId"] == args.agent]
        if args.json:
            print(json.dumps(rows, indent=2))
            return 0
        for r in rows:
            state = "result" if r["result"] is not None else ("started, NO RESULT" if r["started"] else "?")
            print(f"\n===== {r['agentId']} [{state}] =====")
            if r["result"] is not None:
                body = json.dumps(r["result"], indent=2)
                print(_clip(body, args.truncate))
        print(f"\n{len(rows)} agents, {sum(1 for r in rows if r['result'] is not None)} with results", file=sys.stderr)
        return 0

    set_persisted_search(path)
    # grep and turn are the drill-down loop's full-fidelity escape hatch; capping their view
    # of a result would make the escape hatch silently lossy too.
    records = load(path)
    turns = build_turns(records, result_limit=0 if args.cmd in ("grep", "turn") else 4000)

    if args.cmd == "stats":
        print(json.dumps(stats(records, turns), indent=2))
        return 0

    if args.cmd == "render":
        text = render(
            turns,
            truncate=args.truncate,
            show_thinking=args.thinking,
            start=args.start,
            end=args.end,
        )
        if not args.out:
            print(text)
            return 0
        out = Path(args.out)
        if args.chunk:
            out.mkdir(parents=True, exist_ok=True)
            lo = args.start
            top = min(args.end, turns[-1].n if turns else 0)
            while lo <= top:
                hi = lo + args.chunk - 1
                chunk = render(
                    turns, truncate=args.truncate, show_thinking=args.thinking, start=lo, end=hi
                )
                f = out / f"turns-{lo:05d}-{min(hi, top):05d}.md"
                f.write_text(chunk, encoding="utf-8")
                print(f)
                lo = hi + 1
        else:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text, encoding="utf-8")
            print(out)
        return 0

    if args.cmd == "friction":
        events = friction(turns, gap_seconds=args.gap)
        if args.kind:
            wanted = set(args.kind)
            events = [e for e in events if e["kind"] in wanted]
        if args.json:
            print(json.dumps(events, indent=2))
            return 0
        for e in events:
            detail = " ".join(str(e.get("detail", "")).split())[:300]
            print(f"turn {e['turn']:<5} {e['kind']:<16} {e.get('tool', ''):<14} {detail}")
        print(f"\n{len(events)} events", file=sys.stderr)
        return 0

    if args.cmd == "grep":
        flags = re.I if args.ignore_case else 0
        try:
            rx = re.compile(args.pattern, flags)
        except re.error as exc:
            # Transcript searches are full of literal brackets and parens copied out
            # of log lines; a traceback here reads as "the tool is broken".
            print(f"bad regex {args.pattern!r}: {exc}", file=sys.stderr)
            print("(escape regex metacharacters, or use re.escape-style literals)", file=sys.stderr)
            return 2
        hits = 0
        for t in turns:
            haystacks = []
            haystacks.extend(t.text)
            haystacks.extend(t.thinking)
            for call in t.tools:
                haystacks.append(f"[{call['name']}] {tool_summary(call, 4000)}")
            for res in t.results:
                haystacks.append(res["text"])
            for hay in haystacks:
                # Report every match, not just the first in each block. A term that appears
                # 30 times in one long result is a different fact from one that appears once,
                # and collapsing them to a single hit hides the difference. Matches whose
                # context windows overlap are still collapsed, so a dense cluster reads as one.
                last_end = -1
                for m in rx.finditer(hay):
                    lo = max(0, m.start() - args.context)
                    if lo <= last_end:
                        continue
                    hi = m.end() + args.context
                    snippet = " ".join(hay[lo:hi].split())
                    print(f"turn {t.n}: ...{snippet}...")
                    last_end = hi
                    hits += 1
                    if hits >= args.max:
                        print(f"[stopped at --max {args.max}]", file=sys.stderr)
                        return 0
        print(f"\n{hits} hits", file=sys.stderr)
        return 0

    if args.cmd == "turn":
        end = args.end or args.n
        print(render(turns, truncate=0, show_thinking=True, start=args.n, end=end))
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
