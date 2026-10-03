#!/usr/bin/env bash
# stretch — start the stretch operators on the loop host, in the project's
# main checkout, without copying their prompts by hand. From a project that
# is not rafa, run it by its path in the rafa checkout:
# bash <rafa>/scripts/stretch/stretch.sh start
#
#   bash scripts/stretch/stretch.sh link          link the operators into ~/.claude
#   bash scripts/stretch/stretch.sh start         engineer, watchtower and analyst in one tmux session
#   bash scripts/stretch/stretch.sh engineer      the engineer alone, in this terminal
#   bash scripts/stretch/stretch.sh watchtower    the watchtower alone, in this terminal
#   bash scripts/stretch/stretch.sh analyst       the analyst (da²) alone, in this terminal
#
# Flags, after the command:
#   --remote-control   start each session with Remote Control, so another
#                      device can drive it from claude.ai
#   --stretch=<n>      the stretch the watchtower and analyst read (default:
#                      the newest with an agent.json; start passes the one it opens)
#   --dry-run          print what would run, and run nothing
#
# The engineer's prompt is the project's .rafa/stretch/engineer-prompt.md,
# else rafa's own engineer-prompt.md in the rafa checkout, else
# engineer-prompt-default.md. A first stretch drops lines naming {{PREVIOUS}}.
#
# The operators and the stretch folder are described in context/operators.md.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# The rafa checkout this script sits in: the operators and prompts are its.
RAFA_ROOT="$(cd "$HERE/../.." && pwd -P)"
OPERATORS="$RAFA_ROOT/src/bundled/operators"
RAFA_PROMPT="$HERE/engineer-prompt.md"
DEFAULT_PROMPT="$HERE/engineer-prompt-default.md"
PROJECT_PROMPT=".rafa/stretch/engineer-prompt.md"
AGENT_WAIT_SECONDS=5

usage() { sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
fail() { echo "stretch: $*" >&2; exit 1; }

COMMAND="${1:-}"
[ -n "$COMMAND" ] || { usage; exit 2; }
shift
REMOTE=0
DRY=0
STRETCH=""
for arg in "$@"; do
  case "$arg" in
    --remote-control) REMOTE=1 ;;
    --dry-run) DRY=1 ;;
    --stretch=*)
      STRETCH="${arg#--stretch=}"
      case "$STRETCH" in ''|*[!0-9]*) fail "--stretch takes a number: $arg" ;; esac ;;
    *) fail "unknown flag: $arg" ;;
  esac
done

# run <words…>: runs the command, or prints it under --dry-run.
run() {
  if [ "$DRY" -eq 1 ]; then
    printf '%q ' "$@"; printf '\n'
    return 0
  fi
  "$@"
}

# The main checkout: the one whose git dir is the common dir, holding .rafa/.
main_checkout() {
  local top git_dir common_dir
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "not inside a git repository"
  git_dir="$(cd "$top" && cd "$(git rev-parse --git-dir)" && pwd)"
  common_dir="$(cd "$top" && cd "$(git rev-parse --git-common-dir)" && pwd)"
  [ "$git_dir" = "$common_dir" ] || fail "run this from the main checkout, not a worktree ($top)"
  [ -d "$top/.rafa" ] || fail "$top has no .rafa/; run it from the project rafa is set up in"
  printf '%s\n' "$top"
}

# The stretch the next engineer opens: one more than the highest folder.
next_stretch() {
  local highest=0 dir n
  for dir in "$1"/.rafa/stretch/*/; do
    [ -d "$dir" ] || continue
    n="$(basename "$dir")"
    case "$n" in *[!0-9]*) continue ;; esac
    [ "$n" -gt "$highest" ] && highest="$n"
  done
  echo $((highest + 1))
}

require_operators() {
  local name
  for name in rafa-stretch-engineer rafa-stretch-watchtower rafa-stretch-analyst; do
    [ -e "$HOME/.claude/agents/$name.md" ] \
      || fail "~/.claude/agents/$name.md is missing; run: bash $HERE/stretch.sh link"
  done
  command -v claude >/dev/null 2>&1 || fail "claude is not on PATH"
}

# The newest stretch whose engineer has written its agent.json, or 0.
newest_watched() {
  local n
  for n in $(seq $(($(next_stretch "$1") - 1)) -1 1); do
    [ -f "$1/.rafa/stretch/$n/agent.json" ] && { echo "$n"; return; }
  done
  echo 0
}

# claude_session <agent> <session name> <prompt>: Remote Control names the
# session itself, so it replaces -n rather than joining it.
claude_session() {
  local name_flag=-n
  [ "$REMOTE" -eq 1 ] && name_flag=--remote-control
  run claude --agent "$1" "$name_flag" "$2" "$3"
}

cmd_link() {
  local kind src name target
  [ -d "$OPERATORS" ] || fail "$OPERATORS is missing; run link from a rafa checkout's scripts/stretch/"
  for kind in agents skills; do
    run mkdir -p "$HOME/.claude/$kind"
    for src in "$OPERATORS/$kind"/*; do
      [ -e "$src" ] || continue
      name="$(basename "$src")"
      target="$HOME/.claude/$kind/$name"
      if [ -e "$target" ] && [ ! -L "$target" ]; then
        echo "  kept     $target (a file, not a link; remove it to link the operator)"
        continue
      fi
      run ln -sfn "$src" "$target"
      [ "$DRY" -eq 1 ] || echo "  linked   $target"
    done
  done
}

# engineer_prompt_file <root>: the project's own prompt, rafa's own for the
# rafa checkout, or the default, so no project is handed rafa's carried work.
engineer_prompt_file() {
  if [ -f "$1/$PROJECT_PROMPT" ]; then
    echo "$1/$PROJECT_PROMPT"
  elif [ "$1" = "$RAFA_ROOT" ]; then
    echo "$RAFA_PROMPT"
  else
    echo "$DEFAULT_PROMPT"
  fi
}

cmd_engineer() {
  local root="$1" stretch file fill prompt
  require_operators
  stretch="$(next_stretch "$root")"
  file="$(engineer_prompt_file "$root")"
  [ -f "$file" ] || fail "$file is missing"
  fill="s/{{STRETCH}}/$stretch/g; s/{{PREVIOUS}}/$((stretch - 1))/g"
  # A first stretch has no previous report to read.
  [ "$stretch" -eq 1 ] && fill="/{{PREVIOUS}}/d; $fill"
  prompt="$(sed "$fill" "$file" | cat -s)"
  echo "prompt: $file"
  cd "$root" || fail "cannot enter $root"
  claude_session rafa-stretch-engineer "stretch $stretch engineer" "$prompt"
}

# beside_engineer <root> <agent> <role> <prompt>: a session that reads a
# running stretch. It finds the engineer by the agent.json the engineer
# writes first, so one started beside a new engineer waits for that file.
beside_engineer() {
  local root="$1" stretch="$STRETCH"
  require_operators
  [ -n "$stretch" ] || stretch="$(newest_watched "$root")"
  [ "$stretch" -gt 0 ] || fail "no .rafa/stretch/<n>/agent.json yet; start the engineer first, or pass --stretch=<n>"
  while [ "$DRY" -eq 0 ] && [ ! -f "$root/.rafa/stretch/$stretch/agent.json" ]; do
    echo "waiting for .rafa/stretch/$stretch/agent.json …"
    sleep "$AGENT_WAIT_SECONDS"
  done
  cd "$root" || fail "cannot enter $root"
  claude_session "$2" "stretch $stretch $3" "${4//\{\{STRETCH\}\}/$stretch}"
}

cmd_watchtower() { beside_engineer "$1" rafa-stretch-watchtower watchtower "/loop"; }

cmd_analyst() {
  beside_engineer "$1" rafa-stretch-analyst analyst \
    "Stretch {{STRETCH}} is running. Read .rafa/stretch/{{STRETCH}}/, then wait for my first hunch."
}

cmd_start() {
  local root="$1" stretch session flags=""
  require_operators
  stretch="$(next_stretch "$root")"
  session="rafa-stretch-$stretch"
  [ "$REMOTE" -eq 1 ] && flags=" --remote-control"
  if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux is not installed: starting the engineer here. In a second terminal run:"
    echo "  bash '$HERE/stretch.sh' watchtower --stretch=$stretch$flags"
    echo "and in a third, for the analyst:"
    echo "  bash '$HERE/stretch.sh' analyst --stretch=$stretch$flags"
    cmd_engineer "$root"
    return
  fi
  if tmux has-session -t "$session" 2>/dev/null; then
    fail "tmux session $session already runs; attach with: tmux attach -t $session"
  fi
  # A window closes with its command, taking a refusal's message with it,
  # so each one waits for Enter after the session ends.
  local hold='; echo "exited: $?, press Enter to close"; read -r _'
  run tmux new-session -d -s "$session" -c "$root" -n engineer "bash '$HERE/stretch.sh' engineer$flags$hold"
  run tmux new-window -t "$session" -c "$root" -n watchtower "bash '$HERE/stretch.sh' watchtower --stretch=$stretch$flags$hold"
  run tmux new-window -t "$session" -c "$root" -n analyst "bash '$HERE/stretch.sh' analyst --stretch=$stretch$flags$hold"
  run tmux select-window -t "$session:engineer"
  if [ "$DRY" -eq 1 ]; then
    echo "dry run: would start stretch $stretch in tmux session $session"
    return
  fi
  echo "stretch $stretch started in tmux session $session (windows: engineer, watchtower, analyst)"
  if [ -n "${TMUX:-}" ]; then
    tmux switch-client -t "$session"
  elif [ -t 1 ]; then
    tmux attach -t "$session"
  else
    echo "attach with: tmux attach -t $session"
  fi
}

case "$COMMAND" in
  -h|--help|help) usage; exit 0 ;;
esac
ROOT="$(main_checkout)" || exit 1
case "$COMMAND" in
  link) cmd_link ;;
  start) cmd_start "$ROOT" ;;
  engineer) cmd_engineer "$ROOT" ;;
  watchtower) cmd_watchtower "$ROOT" ;;
  analyst) cmd_analyst "$ROOT" ;;
  *) fail "unknown command: $COMMAND (link, start, engineer, watchtower, analyst)" ;;
esac
