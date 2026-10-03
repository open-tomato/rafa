#!/usr/bin/env bash
# check — run the gates on this device and post what failed, so a reading
# taken on another machine (a Mac, a second Bun version) reaches the
# tracker without copying terminal output between devices.
#
#   bash scripts/device/check.sh                  run bun test and eslint, write the report
#   bash scripts/device/check.sh --issue=708      … and post the report on issue 708
#   bash scripts/device/check.sh --from-log=<f>   build the report from a saved bun test log
#
# Flags:
#   --issue=<n>      post the report as a comment on issue or pull request <n>
#   --out=<dir>      where the logs and report go (default: a fresh temp directory)
#   --skip-install   skip `bun install --frozen-lockfile`
#   --skip-eslint    skip `bunx eslint .`
#
# Exits 0 when every gate it ran passed, 1 otherwise, and 3 when the gates
# passed but the post failed. Posting needs `gh`
# signed in; a device with no rafa install still has gh, so this uses it.
# Written for bash 3.2 and BSD tools, as macOS ships them.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# GitHub refuses a comment body over 65536 characters; leave room for the header.
REPORT_LIMIT=60000
# Lines kept before each (fail) line: the assertion and its source excerpt.
DETAIL_LINES=14

usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
fail() { echo "check: $*" >&2; exit 2; }

ISSUE=""
OUT=""
FROM_LOG=""
INSTALL=1
ESLINT=1
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --issue=*) ISSUE="${arg#--issue=}"
      case "$ISSUE" in ''|*[!0-9]*) fail "--issue takes a number: $arg" ;; esac ;;
    --out=*) OUT="${arg#--out=}" ;;
    --from-log=*) FROM_LOG="${arg#--from-log=}" ;;
    --skip-install) INSTALL=0 ;;
    --skip-eslint) ESLINT=0 ;;
    *) fail "unknown flag: $arg" ;;
  esac
done

ROOT="$(cd "$HERE/../.." && pwd)"
# The script moves to the repository root, so a relative path is taken
# from where it was called, now.
absolute() { case "$1" in ''|/*) printf '%s\n' "$1" ;; *) printf '%s\n' "$PWD/$1" ;; esac; }
OUT="$(absolute "$OUT")"
FROM_LOG="$(absolute "$FROM_LOG")"
[ -n "$OUT" ] || OUT="$(mktemp -d "${TMPDIR:-/tmp}/rafa-device-check.XXXXXX")"
mkdir -p "$OUT" || fail "cannot make $OUT"
TEST_LOG="$OUT/test.log"
ESLINT_LOG="$OUT/eslint.log"
REPORT="$OUT/report.md"

# failure_details <log>: each failing case's own lines, the (pass) lines
# between them dropped, and the unhandled errors that fail no named case.
failure_details() {
  awk -v keep="$DETAIL_LINES" '
    /^[0-9]+ tests? failed:$/ { exit }
    /^# Unhandled error/ { grab = keep }
    grab > 0 { print; grab--; if (grab == 0) print ""; next }
    /^[^ ].*\.test\.[jt]sx?:$/ { n = 0; next }
    /^\(pass\)/ || /^\(skip\)/ || /^\(todo\)/ { n = 0; next }
    /^\(fail\)/ {
      start = (n > keep) ? n - keep : 0
      for (i = start; i < n; i++) print buf[i]
      print; print ""; n = 0; next
    }
    { buf[n++] = $0 }
  ' "$1"
}

# fence <file>: the file in a text fence of four backticks, since a test's
# own output can hold a fence of three.
fence() { printf '````text\n'; cat "$1"; printf '````\n'; }

TEST_CODE=0
ESLINT_CODE=""
POST_CODE=0
cd "$ROOT" || fail "cannot enter $ROOT"
if [ -n "$FROM_LOG" ]; then
  [ -f "$FROM_LOG" ] || fail "no log at $FROM_LOG"
  cp "$FROM_LOG" "$TEST_LOG"
  grep -Eq '^ *[1-9][0-9]* (fail|errors?)$' "$TEST_LOG" && TEST_CODE=1
  # A run that crashed before its summary printed no counts; that is no pass.
  grep -Eq '^Ran [0-9]+ tests?' "$TEST_LOG" || TEST_CODE=1
  ESLINT=0
else
  if [ "$INSTALL" -eq 1 ]; then
    echo "check: bun install --frozen-lockfile"
    bun install --frozen-lockfile >"$OUT/install.log" 2>&1 || { cat "$OUT/install.log"; fail "bun install failed"; }
  fi
  echo "check: bun test (about 20 minutes; the log is $TEST_LOG)"
  bun test >"$TEST_LOG" 2>&1
  TEST_CODE=$?
  if [ "$ESLINT" -eq 1 ]; then
    echo "check: bunx eslint ."
    bunx eslint . >"$ESLINT_LOG" 2>&1
    ESLINT_CODE=$?
  fi
fi

grep -E '^ *[0-9]+ (pass|skip|fail|errors?)$|^Ran [0-9]+ tests' "$TEST_LOG" | tail -6 >"$OUT/summary.txt"
grep -E '^\(fail\)' "$TEST_LOG" | sort -u >"$OUT/failed.txt"
failure_details "$TEST_LOG" >"$OUT/details.txt"

{
  echo "## Device check"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| host | $(uname -s) $(uname -r), $(uname -m) |"
  echo "| bun | $(bun --version 2>/dev/null || echo 'not found') |"
  echo "| git | $(git --version 2>/dev/null | sed 's/^git version //') |"
  echo "| commit | $(git rev-parse --short HEAD 2>/dev/null)$(git diff --quiet 2>/dev/null || echo ', with local changes') |"
  echo "| taken | $(date -u '+%Y-%m-%d %H:%M UTC') |"
  echo
  echo "### bun test: exit $TEST_CODE"
  echo
  fence "$OUT/summary.txt"
  if [ -s "$OUT/failed.txt" ]; then
    echo
    echo "$(wc -l <"$OUT/failed.txt" | tr -d ' ') failing cases:"
    echo
    fence "$OUT/failed.txt"
    echo
    echo "<details><summary>Each failure's output</summary>"
    echo
    fence "$OUT/details.txt"
    echo
    echo "</details>"
  fi
  if [ -n "$ESLINT_CODE" ]; then
    echo
    echo "### bunx eslint .: exit $ESLINT_CODE"
    if [ "$ESLINT_CODE" -ne 0 ]; then
      tail -30 "$ESLINT_LOG" >"$OUT/eslint-tail.txt"
      echo
      fence "$OUT/eslint-tail.txt"
    fi
  fi
} >"$REPORT"

if [ "$(wc -c <"$REPORT")" -gt "$REPORT_LIMIT" ]; then
  head -c "$REPORT_LIMIT" "$REPORT" >"$REPORT.cut"
  printf '\n````\n\nCut at %s characters; the full logs are in %s on the device.\n' "$REPORT_LIMIT" "$OUT" >>"$REPORT.cut"
  mv "$REPORT.cut" "$REPORT"
fi

echo "check: report at $REPORT"
if [ -n "$ISSUE" ]; then
  if gh issue comment "$ISSUE" --body-file "$REPORT"; then
    echo "check: posted on #$ISSUE"
  else
    echo "check: posting on #$ISSUE failed; the report is still at $REPORT" >&2
    POST_CODE=3
  fi
fi

[ "$TEST_CODE" -eq 0 ] && { [ -z "$ESLINT_CODE" ] || [ "$ESLINT_CODE" -eq 0 ]; } || exit 1
exit "$POST_CODE"
