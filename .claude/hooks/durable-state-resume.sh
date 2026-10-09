#!/usr/bin/env bash
# SessionStart (matcher `compact|resume`): re-orient any session that keeps durable state
# (`.claude/skills/durable-state/SKILL.md`) after compaction or a resumed session.
#
# Ported from kawaka (minus its kx-ops registry and `.plan-impl/` legacy location). The harness
# re-attaches an invoked skill only on some compaction boundaries, truncated, and never the files
# a skill tells the model to Read; conductors that lost those drifted. So on every compact/resume
# we print a pointer back to the owner skill's §Resuming plus a summary of
# `<worktree>/.durable-state/state.json`.
#
# The payload's `cwd` is the worktree; CLAUDE_PROJECT_DIR is the MAIN checkout, so it cannot be
# used to find state. No state file (or no/garbled payload) -> print nothing, exit 0: a
# SessionStart hook must never get in the way of a session that keeps no state.

hook_input=$(cat)
cwd=$(jq -r '.cwd // ""' <<<"$hook_input" 2>/dev/null) || exit 0
[[ -n "$cwd" ]] || exit 0

state="$cwd/.durable-state/state.json"
[[ -f "$state" ]] || exit 0

# Point at the owner skill only if it exists in the worktree or beside this hook; anything else
# (missing, garbled, a path) gets the generic skill, whose §Resuming works for any owner.
hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
skill=$(jq -r '.skill // ""' "$state" 2>/dev/null)
if ! [[ "$skill" =~ ^[a-z0-9][a-z0-9-]*$ ]] ||
  ! [[ -f "$cwd/.claude/skills/$skill/SKILL.md" || -f "$hook_dir/../skills/$skill/SKILL.md" ]]; then
  skill=durable-state
fi

# A `resume` is a new process: every background task, gate included, died with the old one. A
# `compact` keeps the process, so a background gate may still be up.
source=$(jq -r '.source // ""' <<<"$hook_input" 2>/dev/null)
if [[ "$source" == "compact" ]]; then
  gate_advice='check the matching inFlight gate entry / its background task first; re-launch it only if that task is gone.'
else
  gate_advice='the gate process did not survive the resume; re-launch it.'
fi

session_id=$(jq -r '.session_id // ""' <<<"$hook_input" 2>/dev/null)

# Another session (a second terminal) may share the worktree; it must not resume the owner's run.
owner=$(jq -r 'if type == "object" then (.sessionId | if type == "string" then . else "" end)
               else error("not an object") end' "$state" 2>/dev/null) || owner="?"
if [[ -n "$owner" && "$owner" != "?" && -n "$session_id" && "$owner" != "$session_id" ]]; then
  if [[ "$source" == "compact" ]]; then
    printf 'Durable-state note: another session owns the %s run in this worktree (%s names it in sessionId); it is not yours to resume.\n' \
      "$skill" "$state"
  else
    printf 'Durable-state note: another session owns the %s run in this worktree (%s names it in sessionId); resume it only if it is your own run under a new session id (a handoff), per .claude/skills/durable-state/SKILL.md §Resuming.\n' \
      "$skill" "$state"
  fi
  exit 0
fi

printf 'You are running the %s skill. Before any other tool call: Read .claude/skills/%s/SKILL.md §Resuming and every file it names for your phase, then %s\n\n' \
  "$skill" "$skill" "$state"
if [[ -z "$owner" ]]; then
  printf 'This run has no owning session recorded (no sessionId), and other sessions may share this worktree: claim it per .claude/skills/durable-state/SKILL.md §Resuming step 2 only if it is yours.\n\n'
fi

# The summary is a convenience; the pointer above is the load-bearing part. Only fields that are
# present are printed. An in-progress task outranks the first pending one.
if ! summary=$(jq -r --arg gate_advice "$gate_advice" '
  def known: ["skill","sessionId","phase","goal","tasks","openGate","inFlight",
              "standingInstructions","invariants","loop","notes"];
  ([(.tasks // [])[] | select(.status == "in-progress")] + [(.tasks // [])[] | select(.status == "pending")] | first) as $next |
  "Durable state (from state.json):",
  "  phase: \(.phase // "unknown")",
  (if .goal then "  goal: \(.goal)" else empty end),
  (if ((.tasks // []) | length) == 0 then empty
   elif $next then "  next task: \($next.id) \($next.title // "") [\($next.status)]"
   else "  next task: none pending" end),
  (if .openGate then "  OPEN GATE: \(.openGate.kind) on \(.openGate.doc // "?")" + (if .openGate.taskId then " (task \(.openGate.taskId))" else "" end) + " — \($gate_advice)"
   else empty end),
  (if ((.inFlight // []) | length) > 0 then "  in flight before the boundary (check each is still alive):", ((.inFlight)[] | "    - \(.kind) \(.id): \(.what // "")") else empty end),
  (if ((.standingInstructions // []) | length) > 0 then "  standing user instructions (verbatim):", ((.standingInstructions)[] | "    > \(.)") else empty end),
  (if .loop then "  loop: \(.loop)" else empty end),
  (if ((.notes // []) | length) > 0 then "  notes:", ((.notes)[] | "    - \(.)") else empty end),
  ([keys[] | select(. as $k | known | index($k) | not)] as $other |
   if ($other | length) > 0 then "  other keys (Read state.json for them): \($other | join(", "))" else empty end),
  (if ((.invariants // []) | length) > 0 then "", "Invariants of the \(.skill // "owner") skill:", (.invariants[] | "  - \(.)") else empty end)
' "$state" 2>/dev/null); then
  printf 'state.json did not parse — Read it directly before continuing.\n'
  exit 0
fi
printf '%s\n' "$summary"
exit 0
