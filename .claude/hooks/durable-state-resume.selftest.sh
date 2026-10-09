#!/usr/bin/env bash
# Table test for durable-state-resume.sh. The hook runs on EVERY compact/resume, so silence
# without state matters as much as the content with it.
#
# Usage: .claude/hooks/durable-state-resume.selftest.sh   (exit 0 = all rows pass)

set -u
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/durable-state-resume.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fail=0

# row <name> <cwd> <session_id> <source> <expect: "silent" | grep -E pattern> [<must-not-match>]
row() {
  local name=$1 cwd=$2 sid=$3 src=$4 expect=$5 reject=${6:-}
  local out
  out=$(jq -n --arg cwd "$cwd" --arg sid "$sid" --arg src "$src" \
    '{cwd: $cwd, session_id: $sid, source: $src}' | bash "$HOOK" 2>&1)
  local ok=1
  if [[ "$expect" == silent ]]; then
    [[ -z "$out" ]] || ok=0
  else
    grep -qE -- "$expect" <<<"$out" || ok=0
  fi
  if [[ -n "$reject" ]] && grep -qE -- "$reject" <<<"$out"; then ok=0; fi
  if (( ok )); then
    printf 'ok   %s\n' "$name"
  else
    printf 'FAIL %s\n---\n%s\n---\n' "$name" "$out"
    fail=1
  fi
}

# No state -> silent.
mkdir -p "$WORK/none"
row "no state is silent" "$WORK/none" s1 compact silent

# Conductor run owned by s1.
C="$WORK/cond"
mkdir -p "$C/.durable-state" "$C/.claude/skills/conductor"
touch "$C/.claude/skills/conductor/SKILL.md"
jq -n '{skill:"conductor", sessionId:"s1", phase:"run", goal:"get conductor1 to 30 woodcutting",
  bot:"conductor1",
  standingInstructions:["use the local server only"],
  invariants:["Only one controller per bot."],
  tasks:[{id:"T1",title:"chop",status:"done"},{id:"T2",title:"bank",status:"in-progress"},{id:"T3",title:"fish",status:"pending"}],
  inFlight:[{kind:"agent",id:"a1",what:"run woodcutting task"}],
  openGate:{kind:"script-approval", doc:"/abs/conductor/tasks/fish.ts", taskId:"T3"},
  notes:["client runs headless"]}' > "$C/.durable-state/state.json"

row "owner skill pointer" "$C" s1 compact 'Read \.claude/skills/conductor/SKILL\.md §Resuming'
row "in-progress outranks pending" "$C" s1 compact 'next task: T2 bank \[in-progress\]'
row "standing instructions verbatim" "$C" s1 compact '> use the local server only'
row "invariants printed" "$C" s1 compact 'Only one controller per bot\.'
row "in-flight listed" "$C" s1 compact 'agent a1: run woodcutting task'
row "gate advice on compact" "$C" s1 compact 'OPEN GATE: script-approval .*re-launch it only if'
row "gate advice on resume" "$C" s1 resume 'did not survive the resume'
row "unknown keys listed" "$C" s1 compact 'other keys .*: bot'
row "foreign session on compact" "$C" s2 compact 'not yours to resume' 'Durable state'
row "foreign session on resume" "$C" s2 resume 'only if it is your own run' 'Durable state'

# Missing owner skill falls back to durable-state; no sessionId flags it.
U="$WORK/unowned"
mkdir -p "$U/.durable-state"
jq -n '{skill:"nonexistent", phase:"x"}' > "$U/.durable-state/state.json"
row "unknown skill -> generic" "$U" s1 resume 'Read \.claude/skills/durable-state/SKILL\.md'
row "no owner recorded" "$U" s1 resume 'no owning session recorded'

# Garbage in -> no crash, says so.
G="$WORK/garbage"
mkdir -p "$G/.durable-state"
printf '{not json' > "$G/.durable-state/state.json"
row "garbled state" "$G" s1 compact 'did not parse'

# Garbled payload -> silent.
out=$(printf 'nope' | bash "$HOOK" 2>&1)
if [[ -z "$out" ]]; then printf 'ok   garbled payload is silent\n'; else printf 'FAIL garbled payload\n%s\n' "$out"; fail=1; fi

exit $fail
