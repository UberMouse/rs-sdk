#!/usr/bin/env python3
"""Self-contained checks for transcript.py's fidelity guarantees.

Every assertion here corresponds to a way the reduction pipeline was once silently lossy —
an analyst reading the output could not tell the difference between "the session did not do
this" and "the tool did not show it". Run: python3 verify-transcript.py

Synthesises its own fixtures, so it survives cleanup of any real session.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import transcript as T  # noqa: E402

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  ok   {name}")
    else:
        FAILURES.append(f"{name}: {detail}")
        print(f"  FAIL {name} — {detail}")


def rec_assistant(blocks: list[dict]) -> dict:
    return {"type": "assistant", "timestamp": "2026-01-01T00:00:00.000Z", "message": {"content": blocks}}


def rec_result(tool_use_id: str, text: str, *, is_error: bool = False, exit_code: int = 0) -> dict:
    return {
        "type": "user",
        "timestamp": "2026-01-01T00:00:01.000Z",
        "message": {
            "content": [
                {"type": "tool_result", "tool_use_id": tool_use_id, "is_error": is_error, "content": text}
            ]
        },
        "toolUseResult": {"exitCode": exit_code},
    }


def write_jsonl(path: Path, records: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="verify-transcript-"))
    try:
        run(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failure(s):")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("all checks passed")
    return 0


def run(tmp: Path) -> None:
    # ---- a session tree shaped like a real one: workflow agents nested a level deeper,
    # ---- a persisted-output pointer, and a journal.
    proj = tmp / "projects" / "-some-repo"
    sess = proj / "sess-1"
    wf = sess / "subagents" / "workflows" / "wf_abc"
    wf.mkdir(parents=True)
    (sess / "tool-results").mkdir()

    big = "NEEDLE_PAST_THE_CAP " * 800  # ~16 KB, far beyond the old 4000-char parse cap
    (sess / "tool-results" / "big1.txt").write_text(big, encoding="utf-8")

    pointer = (
        "<persisted-output>\nOutput too large (16.0KB). Full output saved to: "
        f"{sess / 'tool-results' / 'big1.txt'}\n\nPreview (first 2KB):\nPREVIEW_ONLY\n</persisted-output>"
    )

    long_text = "CONCLUSION " * 400  # 4400 chars of assistant prose
    agent_recs = [
        rec_assistant([{"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "git diff"}}]),
        rec_result("t1", pointer),
        rec_assistant([{"type": "text", "text": long_text}]),
        rec_assistant(
            [{"type": "tool_use", "id": "t2", "name": "Edit",
              "input": {"file_path": "/x/y.ts", "old_string": "OLD_MARKER_TEXT", "new_string": "NEW_MARKER_TEXT"}}]
        ),
        rec_result("t2", "The file /x/y.ts has been updated successfully."),
        # a crash whose exit code a pipe swallowed
        rec_assistant([{"type": "tool_use", "id": "t3", "name": "Bash",
                        "input": {"command": "python3 s.py 2>&1 | tail -20"}}]),
        rec_result("t3", "Traceback (most recent call last):\n  File \"s.py\"\nIsADirectoryError: nope"),
    ]
    write_jsonl(wf / "agent-a1.jsonl", agent_recs)
    (wf / "agent-a1.meta.json").write_text(json.dumps({"agentType": "workflow-subagent", "spawnDepth": 1}))
    write_jsonl(
        wf / "journal.jsonl",
        [
            {"type": "started", "key": "k1", "agentId": "a1"},
            {"type": "result", "key": "k1", "agentId": "a1", "result": {"findings": ["JOURNAL_FINDING"]}},
            {"type": "started", "key": "k2", "agentId": "a2"},
        ],
    )
    main_jsonl = proj / "sess-1.jsonl"
    write_jsonl(main_jsonl, [rec_assistant([{"type": "text", "text": "main"}])])

    # ---- snapshot -----------------------------------------------------------------
    print("snapshot")
    dest = tmp / "snap"
    out = T.snapshot(main_jsonl, dest)
    check("survives a Workflow's nested subagents dir", len(out["subagents"]) == 1,
          f"copied {out['subagents']}")
    check("copies the workflow journal", len(out.get("journals", [])) == 1, str(out.get("journals")))
    check("copies tool-results/ (persisted payloads)", out.get("tool-results") == 1, str(out.get("tool-results")))

    snap_agent = dest / "subagents" / "agent-a1.jsonl"
    check("agent transcript is in the snapshot", snap_agent.is_file())
    if not snap_agent.is_file():
        # Every check below reads this file; without the early exit a broken snapshot
        # reports as a traceback rather than as the failures it actually caused.
        FAILURES.append("snapshot produced no agent transcript — later checks not run")
        return

    # ---- persisted-output + uncapped parse ----------------------------------------
    print("fidelity")
    T.set_persisted_search(snap_agent)
    recs = T.load(snap_agent)
    turns_full = T.build_turns(recs, result_limit=0)
    body = turns_full[1].results[0]["text"]
    check("resolves a <persisted-output> pointer", "NEEDLE_PAST_THE_CAP" in body, body[:120])
    check("grep/turn see past the old 4000-char cap", len(body) > 10000, f"len={len(body)}")

    # the pointer must resolve from the snapshot alone, after the original tree is gone
    shutil.rmtree(sess / "tool-results")
    T.set_persisted_search(snap_agent)
    body2 = T.build_turns(T.load(snap_agent), result_limit=0)[1].results[0]["text"]
    check("resolves from the snapshot when the original is gone", "NEEDLE_PAST_THE_CAP" in body2, body2[:120])

    turns_capped = T.build_turns(recs)
    check("render still caps results", len(turns_capped[1].results[0]["text"]) == 4000,
          str(len(turns_capped[1].results[0]["text"])))
    real_len = turns_capped[1].results[0]["full_len"]

    # ---- render --------------------------------------------------------------------
    print("render")
    md = T.render(turns_capped, truncate=1200, show_thinking=True, start=1, end=99)
    check("marks truncated assistant text", "CONCLUSION" in md and "more chars truncated" in md)
    check("never cuts assistant text silently",
          md.count("more chars truncated") >= 2, f"markers={md.count('more chars truncated')}")
    # A result cut twice -- parse cap then --truncate -- must report the loss against the
    # ORIGINAL length. Counting only the second cut understates it by the size of the first,
    # which is the same lie as printing no marker.
    counts = [int(x) for x in re.findall(r"\[(\d+) more chars truncated\]", md)]
    check("truncation marker counts BOTH cuts, not just the render cut",
          (real_len - 1200) in counts, f"expected {real_len - 1200}, markers say {counts}")
    check("Edit shows old_string", "OLD_MARKER_TEXT" in md)
    check("Edit shows new_string", "NEW_MARKER_TEXT" in md)

    # ---- friction ------------------------------------------------------------------
    print("friction")
    kinds = {e["kind"] for e in T.friction(turns_capped)}
    check("reports a pipe-masked traceback", "masked-failure" in kinds, str(sorted(kinds)))

    # ---- journal -------------------------------------------------------------------
    print("journal")
    rows = T.journal(dest / "subagents" / "wf_abc.journal.jsonl")
    check("one row per agent", len(rows) == 2, str(len(rows)))
    check("carries the agent's return value",
          rows[0]["result"] == {"findings": ["JOURNAL_FINDING"]}, str(rows[0]))
    check("flags an agent that started and never returned",
          rows[1]["result"] is None and rows[1]["started"], str(rows[1]))

    # ---- index ---------------------------------------------------------------------
    print("index")
    resolved = T._resolve([str(dest / "subagents")])
    check("index does not treat a journal as a transcript",
          all(not p.name.endswith("journal.jsonl") for p in resolved), str([p.name for p in resolved]))

    run_writes(tmp)


def write_call(tool_id: str, stamp: str, name: str, **inp: object) -> dict:
    return {"type": "assistant", "timestamp": stamp,
            "message": {"content": [{"type": "tool_use", "id": tool_id, "name": name, "input": inp}]}}


def run_writes(tmp: Path) -> None:
    print("writes")
    snap = tmp / "writes-snap"
    (snap / "subagents").mkdir(parents=True)
    # Two agents interleaved in time, so order across inputs is only right if rows are sorted
    # globally rather than emitted per file.
    write_jsonl(snap / "subagents" / "agent-b1.jsonl", [
        write_call("w1", "2026-01-01T00:00:01.000Z", "Write", file_path="/a/tmp/shoot.cjs", content="FIRST_DRAFT"),
        rec_result("w1", "File created"),
        write_call("w2", "2026-01-01T00:00:05.000Z", "Edit", file_path="/a/tmp/shoot.cjs",
                   old_string="FIRST", new_string="EDITED"),
        rec_result("w2", "updated"),
        write_call("w3", "2026-01-01T00:00:07.000Z", "Write", file_path="/a/tmp/shoot.cjs", content="FINAL_DRAFT"),
        rec_result("w3", "File created"),
        write_call("w4", "2026-01-01T00:00:08.000Z", "Write", file_path="/a/notes.md", content="prose"),
    ])
    write_jsonl(snap / "subagents" / "agent-b2.jsonl", [
        write_call("x1", "2026-01-01T00:00:03.000Z", "Write", file_path="/c/pair.js", content="é"),
        rec_result("x1", "Write is disabled", is_error=True),
        write_call("x2", "2026-01-01T00:00:04.000Z", "Edit", file_path="/c/pair.js",
                   old_string="é", new_string="NEVER_LANDED"),
        rec_result("x2", "File has not been read yet", is_error=True),
    ])
    write_jsonl(snap / "main.jsonl", [rec_assistant([{"type": "text", "text": "main"}])])

    paths = T._resolve([str(snap)])
    check("a snapshot dir expands to main + subagents", len(paths) == 3, str([p.name for p in paths]))
    rows = T.writes(paths)
    order = [(r["agent"], r["turn"]) for r in rows]
    check("rows are chronological across transcripts, Edits excluded by default",
          order == [("agent-b1", 1), ("agent-b2", 1), ("agent-b1", 5), ("agent-b1", 7)], str(order))
    check("turn numbers are the ones `turn` prints",
          T.build_turns(T.load(snap / "subagents" / "agent-b1.jsonl"))[4].tools[0]["id"] == "w3")
    check("bytes counts UTF-8, not characters", rows[1]["bytes"] == 2, str(rows[1]["bytes"]))
    check("a Write whose result was an error is flagged failed",
          [r["failed"] for r in rows] == [False, True, False, False], str([r["failed"] for r in rows]))

    rx = re.compile(r"\.c?js$")
    with_edits = T.writes(paths, path_regex=rx, include_edits=True)
    check("--path-regex filters on file_path",
          all(rx.search(r["file_path"]) for r in with_edits) and len(with_edits) == 5, str(len(with_edits)))
    edit = next((r for r in with_edits if r["tool"] == "Edit" and r["agent"] == "agent-b1"), {})
    check("--include-edits records old and new strings",
          edit.get("old_string") == "FIRST" and edit.get("new_string") == "EDITED", str(edit))

    T.assign_out_names(with_edits)
    names = [r.get("out_name") for r in with_edits]
    check("a re-written path versions the earlier copy and keeps the last plain; a failed Write gets no name",
          names == ["b1__shoot.v1.cjs", None, "b2__pair.js.edits.jsonl", "b1__shoot.cjs.edits.jsonl",
                    "b1__shoot.cjs"], str(names))
    out = tmp / "writes-out"
    T.extract_writes(with_edits, out)
    T.extract_writes(with_edits, out)  # a re-run into the same dir must not duplicate edit lines
    check("--out holds each Write's exact content",
          (out / "b1__shoot.v1.cjs").read_text() == "FIRST_DRAFT"
          and (out / "b1__shoot.cjs").read_text() == "FINAL_DRAFT")
    check("--out never materialises a failed Write",
          not any(f.name.startswith("b2__pair.js") and not f.name.endswith(".edits.jsonl") for f in out.iterdir()),
          str(sorted(f.name for f in out.iterdir())))
    edit_lines = (out / "b1__shoot.cjs.edits.jsonl").read_text().splitlines()
    check("Edits land one JSON line each in <name>.edits.jsonl, idempotently",
          len(edit_lines) == 1 and json.loads(edit_lines[0])["new_string"] == "EDITED", str(edit_lines))
    failed_edit = [json.loads(x) for x in (out / "b2__pair.js.edits.jsonl").read_text().splitlines()]
    check("a failed Edit is logged with failed: true",
          len(failed_edit) == 1 and failed_edit[0]["failed"] is True, str(failed_edit))

    script = Path(__file__).parent / "transcript.py"
    dry = tmp / "writes-dry"
    proc = subprocess.run([sys.executable, str(script), "writes", str(snap), "--out", str(dry), "--list"],
                          capture_output=True, text=True)
    lines = proc.stdout.splitlines()
    check("CLI prints one line per write in the documented shape",
          len(lines) == 4 and lines[0] == "2026-01-01T00:00:01 agent-b1 turn 1 Write /a/tmp/shoot.cjs 11 -> b1__shoot.v1.cjs"
          and lines[1].endswith("[failed] (not extracted: failed)"), proc.stdout + proc.stderr)
    check("--list with --out is a dry run", not dry.exists())

    run_writes_collisions(tmp)
    run_writes_ordering(tmp)


def run_writes_collisions(tmp: Path) -> None:
    d = tmp / "writes-collide"
    d.mkdir()
    write_jsonl(d / "agent-c1.jsonl", [
        # two different files that share a basename, one of them re-written
        write_call("c1", "2026-01-01T00:00:01Z", "Write", file_path="/w/.plan-impl/tmp/shoot.js", content="PLAN_V1"),
        write_call("c2", "2026-01-01T00:00:02Z", "Write", file_path="/tmp/shoot.js", content="TMP_ONLY"),
        write_call("c3", "2026-01-01T00:00:03Z", "Write", file_path="/w/.plan-impl/tmp/shoot.js", content="PLAN_V2"),
        # a re-written run.js versions to run.v1.js, which is also a file this agent wrote itself
        write_call("c4", "2026-01-01T00:00:04Z", "Write", file_path="/x/run.js", content="RUN_V1"),
        write_call("c5", "2026-01-01T00:00:05Z", "Write", file_path="/x/run.js", content="RUN_V2"),
        write_call("c6", "2026-01-01T00:00:06Z", "Write", file_path="/y/run.v1.js", content="LITERAL_V1"),
    ])
    rows = T.writes([d / "agent-c1.jsonl"])
    T.assign_out_names(rows)
    by_path: dict[str, set[str]] = {}
    for r in rows:
        by_path.setdefault(r["file_path"], set()).add(r["out_name"])
    plan, tmp_only = by_path["/w/.plan-impl/tmp/shoot.js"], by_path["/tmp/shoot.js"]
    check("same-basename files from one agent are not versioned as one file",
          len(plan) == 2 and len(tmp_only) == 1 and not plan & tmp_only
          and not any(".v" in n for n in tmp_only), str(by_path))
    out = tmp / "writes-collide-out"
    T.extract_writes(rows, out)
    lost = [r["file_path"] for r in rows if (out / r["out_name"]).read_text() != r["content"]]
    check("no extracted file overwrites another", not lost and len({r["out_name"] for r in rows}) == len(rows),
          f"overwritten: {lost}, names: {[r['out_name'] for r in rows]}")


def run_writes_ordering(tmp: Path) -> None:
    # Two transcripts with the same stem (two snapshots' main.jsonl) tie on the agent label,
    # so only a key on the transcript path keeps their equal-timestamp rows in a fixed order.
    p1, p2 = tmp / "order-1" / "main.jsonl", tmp / "order-2" / "main.jsonl"
    p1.parent.mkdir()
    p2.parent.mkdir()
    no_stamp = write_call("o0", "", "Write", file_path="/n/nostamp.js", content="x")
    del no_stamp["timestamp"]
    write_jsonl(p1, [write_call("o1", "2026-01-01T00:00:01Z", "Write", file_path="/n/a.js", content="x"),
                     write_call("o2", None, "Write", file_path="/n/null.js", content="x")])  # type: ignore[arg-type]
    # Same turn numbers as p1's rows, so the old (timestamp, agent label, turn) key ties exactly.
    write_jsonl(p2, [write_call("o3", "2026-01-01T00:00:01Z", "Write", file_path="/n/b.js", content="x"), no_stamp])
    try:
        fwd = [r["file_path"] for r in T.writes([p1, p2])]
        rev = [r["file_path"] for r in T.writes([p2, p1])]
    except Exception as exc:  # noqa: BLE001 -- a crash is the failure this check exists for
        check("a missing or null timestamp does not crash", False, repr(exc))
        return
    check("a missing or null timestamp does not crash, and sorts first",
          set(fwd[:2]) == {"/n/null.js", "/n/nostamp.js"}, str(fwd))
    check("equal timestamps order by transcript path then turn, whatever the input order",
          fwd == rev == ["/n/null.js", "/n/nostamp.js", "/n/a.js", "/n/b.js"], f"fwd={fwd} rev={rev}")


if __name__ == "__main__":
    sys.exit(main())
