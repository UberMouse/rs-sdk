#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): format the edited conductor/ TypeScript file with oxfmt and
# lint it with oxlint, so every agent edit is checked the moment it lands. Lint problems exit 2,
# which hands them back to the agent that made the edit. Anything else — not a conductor .ts file,
# tools not installed, garbled payload — exits 0 silently.
#
# conductor/runs/ is in both configs' ignorePatterns, so `bun run lint` and `fmt` never touch local
# run artifacts. A task-runner's draft plan (conductor/runs/<bot>/plans/<name>.ts) is still checked
# like any conductor file (conductor/docs/plans.md): it gets copies of the configs without the
# ignore patterns (oxlint's --no-ignore does not lift a config's ignorePatterns). Anything else
# under conductor/runs/ is skipped.
hook_input=$(cat)
cwd=$(jq -r '.cwd // ""' <<<"$hook_input" 2>/dev/null) || exit 0
file=$(jq -r '.tool_input.file_path // ""' <<<"$hook_input" 2>/dev/null) || exit 0
[[ -n "$cwd" && -n "$file" ]] || exit 0
[[ "$file" == "$cwd"/conductor/*.ts && -f "$file" ]] || exit 0
[[ -x "$cwd/node_modules/.bin/oxfmt" && -x "$cwd/node_modules/.bin/oxlint" ]] || exit 0

cd "$cwd" || exit 0
fmt_args=() lint_args=()
rel=${file#"$cwd"/}
if [[ "$rel" =~ ^conductor/runs/[^/]+/plans/[^/]+\.ts$ ]]; then
  tmp=$(mktemp -d) || exit 0
  trap 'rm -rf "$tmp"' EXIT
  jq 'del(.ignorePatterns)' .oxfmtrc.json >"$tmp/oxfmtrc.json" || exit 0
  jq 'del(.ignorePatterns)' .oxlintrc.json >"$tmp/oxlintrc.json" || exit 0
  fmt_args=(-c "$tmp/oxfmtrc.json") lint_args=(-c "$tmp/oxlintrc.json")
elif [[ "$rel" == conductor/runs/* ]]; then
  exit 0
fi

node_modules/.bin/oxfmt "${fmt_args[@]}" "$file" >/dev/null 2>&1
if ! out=$(node_modules/.bin/oxlint --deny-warnings "${lint_args[@]}" "$file" 2>&1); then
  printf 'oxlint found problems in %s (the file was also reformatted by oxfmt; re-read it before editing again):\n%s\n' \
    "$rel" "$out" >&2
  exit 2
fi
exit 0
