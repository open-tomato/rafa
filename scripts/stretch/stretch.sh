#!/usr/bin/env bash
# stretch — deprecated: a wrapper over `rafa stretch start`, kept for one
# release so the lines people already type keep working. It prints a
# deprecation line and runs the `rafa` on PATH with the same intent:
#
#   bash scripts/stretch/stretch.sh start         rafa stretch start
#   bash scripts/stretch/stretch.sh engineer      rafa stretch start --role=engineer
#   bash scripts/stretch/stretch.sh watchtower    rafa stretch start --role=watchtower
#   bash scripts/stretch/stretch.sh analyst       rafa stretch start --role=analyst
#
# Flags, after the command:
#   --remote-control   passed on as it is
#   --dry-run          passed on as it is
#   --stretch=<n>      passed on as --n=<n>
# Any other flag is passed on as it is, and `rafa stretch start` refuses
# what it does not know. rafa's exit code is the script's.
#
# The operators and the stretch folder are described in context/operators.md.
set -uo pipefail

usage() { sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
fail() { echo "stretch: $*" >&2; exit 1; }

COMMAND="${1:-}"
[ -n "$COMMAND" ] || { usage; exit 2; }
shift

case "$COMMAND" in
  -h|--help|help) usage; exit 0 ;;
  start) WORDS=(stretch start) ;;
  engineer|watchtower|analyst) WORDS=(stretch start "--role=$COMMAND") ;;
  *) fail "unknown command: $COMMAND (start, engineer, watchtower, analyst)" ;;
esac

for arg in "$@"; do
  case "$arg" in
    --stretch=*) WORDS+=("--n=${arg#--stretch=}") ;;
    *) WORDS+=("$arg") ;;
  esac
done

command -v rafa >/dev/null 2>&1 || fail "rafa is not on PATH; install @open-tomato/rafa and run: rafa ${WORDS[*]}"
echo "stretch: scripts/stretch/stretch.sh is deprecated and goes in the next release; run: rafa ${WORDS[*]}" >&2
exec rafa "${WORDS[@]}"
