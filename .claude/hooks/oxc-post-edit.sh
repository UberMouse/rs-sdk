#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): format the edited conductor/ TypeScript file with oxfmt and
# lint it with oxlint, so every agent edit is checked the moment it lands. Lint problems exit 2,
# which hands them back to the agent that made the edit. Anything else — not a conductor .ts file,
# tools not installed, garbled payload — exits 0 silently.
hook_input=$(cat)
cwd=$(jq -r '.cwd // ""' <<<"$hook_input" 2>/dev/null) || exit 0
file=$(jq -r '.tool_input.file_path // ""' <<<"$hook_input" 2>/dev/null) || exit 0
[[ -n "$cwd" && -n "$file" ]] || exit 0
[[ "$file" == "$cwd"/conductor/*.ts && -f "$file" ]] || exit 0
[[ -x "$cwd/node_modules/.bin/oxfmt" && -x "$cwd/node_modules/.bin/oxlint" ]] || exit 0

cd "$cwd" || exit 0
node_modules/.bin/oxfmt "$file" >/dev/null 2>&1
if ! out=$(node_modules/.bin/oxlint --deny-warnings "$file" 2>&1); then
  printf 'oxlint found problems in %s (the file was also reformatted by oxfmt; re-read it before editing again):\n%s\n' \
    "${file#"$cwd"/}" "$out" >&2
  exit 2
fi
exit 0
