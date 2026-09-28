#!/usr/bin/env bash
# diagnose — READ-ONLY check of what a machine has before setting up a rafa
# loop on it. Installs nothing, writes nothing, reads no secret values. Its
# platform and install-owner checks follow an earlier workstation preflight.
#
#   bash diagnose.sh          human report
#   bash diagnose.sh --json   one JSON object per line (for diffing machines)
#
# Next iteration: the binary checks become stack-aware (see the note above the
# binary lists below).
set -uo pipefail

JSON=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'; }
# row <section> <name> <status ok|missing|warn|info> <detail>
row() {
  if [ "$JSON" -eq 1 ]; then
    printf '{"section":"%s","name":"%s","status":"%s","detail":"%s"}\n' \
      "$1" "$(esc "$2")" "$3" "$(esc "$4")"
  else
    local mark="·"
    case "$3" in ok) mark="✓" ;; missing) mark="✗" ;; warn) mark="⚠" ;; esac
    printf '  %s %-22s %s\n' "$mark" "$2" "$4"
  fi
}
head_() { [ "$JSON" -eq 1 ] || printf '\n%s\n' "$1"; }

# --- platform ---------------------------------------------------------------
head_ "platform"
OS="$(uname -s)"; ARCH="$(uname -m)"
DISTRO="$OS"
if [ "$OS" = "Linux" ] && [ -r /etc/os-release ]; then
  DISTRO="$(. /etc/os-release; echo "${PRETTY_NAME:-$ID}")"
elif [ "$OS" = "Darwin" ]; then
  DISTRO="macOS $(sw_vers -productVersion 2>/dev/null)"
fi
row platform os info "$DISTRO ($ARCH)"
row platform host info "$(hostname)"
row platform user info "$(id -un) uid=$(id -u) home=$HOME"
row platform shell info "${SHELL:-unknown}"
if id -Gn | tr ' ' '\n' | grep -qxE 'sudo|wheel|admin'; then
  row platform sudo-group ok "member of an admin group"
else
  row platform sudo-group info "not in sudo/wheel/admin (expected for a blank user)"
fi
FREE="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2 {printf "%.1f GB free", $4/1048576}')"
row platform disk info "${FREE:-unknown}"

# --- binaries (provenance logic from workstation/preflight.sh) -------------
owner_of() {
  case "$1" in
    /opt/homebrew/*|*/usr/local/Cellar/*|/home/linuxbrew/*) echo brew ;;
    /snap/*) echo snap ;;
    "$HOME"/.nvm/*|"$HOME"/.volta/*|"$HOME"/.asdf/*|"$HOME"/.fnm/*) echo version-manager ;;
    "$HOME"/.bun/*) echo bun-script ;;
    "$HOME"/.rafa/*) echo rafa-installer ;;
    "$HOME"/.local/*|"$HOME"/.claude/*) echo user-local ;;
    /usr/bin/*|/bin/*|/usr/sbin/*) echo system ;;
    /usr/local/*) echo usr-local ;;
    *) echo unknown ;;
  esac
}
resolve_real() { local p="$1"; while [ -L "$p" ]; do
  local t; t="$(readlink "$p")"; case "$t" in /*) p="$t" ;; *) p="$(dirname "$p")/$t" ;; esac
done; echo "$p"; }

check_bin() { # $1 name, $2 required|optional
  local path real ver n
  if path="$(command -v "$1" 2>/dev/null)"; then
    real="$(resolve_real "$path")"
    ver="$({ "$1" --version 2>/dev/null || true; } | head -1)"
    # count distinct files, not PATH entries: on usrmerge systems /bin is a
    # link to /usr/bin, so /bin/git and /usr/bin/git are one file
    n="$(type -a "$1" 2>/dev/null | awk '{print $NF}' | while read -r p; do
      d="$(cd "$(dirname "$p")" 2>/dev/null && pwd -P)"; resolve_real "$d/$(basename "$p")"
    done | sort -u | wc -l | tr -d ' ')"
    if [ "$n" -gt 1 ]; then
      row bin "$1" warn "$ver — $path ($(owner_of "$real")), $n copies on PATH"
    else
      row bin "$1" ok "$ver — $path ($(owner_of "$real"))"
    fi
  else
    # installed by a user-level installer, but this shell's PATH lacks its dir
    # (a remote command's shell reads neither ~/.zshrc nor the interactive part of ~/.bashrc)
    local d
    for d in "$HOME/.rafa/bin" "$HOME/.bun/bin" "$HOME/.local/bin" "$HOME"/.nvm/versions/node/*/bin "$HOME/.volta/bin" "$HOME/.npm-global/bin"; do
      if [ -x "$d/$1" ]; then
        row bin "$1" warn "installed at $d/$1 but $d is not on this shell's PATH"
        return
      fi
    done
    if [ "$2" = required ]; then row bin "$1" missing "not on PATH"
    else row bin "$1" info "not on PATH (optional)"; fi
  fi
}
# Next iteration: stack-aware checks. Today every machine is checked for the
# same lists, so a Python-only project would be told it lacks bun or node. The
# checks will read stack flags from the project's config (the stack `rafa init`
# records, TypeScript/Node by default until it offers a choice): the core list
# stays required everywhere (git, curl, claude, gh, rafa and the runtime rafa
# itself needs), and each stack adds its own list (node/npm/bun for
# TypeScript, python3/pip for Python, go for Go). A dependency that belongs to
# no configured stack is not checked, so it can never fail the run.
head_ "binaries (required for a rafa loop)"
for b in git curl bun claude gh rafa; do check_bin "$b" required; done
head_ "binaries (optional)"
for b in node npm jq sqlite3 unzip zsh tmux; do check_bin "$b" optional; done

# --- accounts (exit codes only; no token values are read) ------------------
head_ "accounts"
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then row account gh ok "gh auth status passes"
  else row account gh missing "gh is not logged in"; fi
fi
N="$(git config --global user.name 2>/dev/null)"; E="$(git config --global user.email 2>/dev/null)"
if [ -n "$N" ] && [ -n "$E" ]; then row account git-identity ok "$N <$E>"
else row account git-identity missing "git config --global user.name / user.email unset"; fi
if [ -f "$HOME/.claude.json" ] && grep -q '"oauthAccount"' "$HOME/.claude.json" 2>/dev/null; then
  row account claude ok "~/.claude.json has an oauthAccount entry"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  row account claude ok "ANTHROPIC_API_KEY is set"
else
  row account claude missing "no Claude login found"
fi

# --- user-level Claude tooling ----------------------------------------------
head_ "user-level Claude tooling (~/.claude)"
C="$HOME/.claude"
if [ -d "$C" ]; then
  for d in skills agents commands rules hooks plugins; do
    if [ -d "$C/$d" ]; then
      row claude-home "$d" info "$(find "$C/$d" -mindepth 1 -maxdepth 1 ! -name '.*' | wc -l | tr -d ' ') entries"
    else
      row claude-home "$d" info "absent"
    fi
  done
  for f in settings.json CLAUDE.md; do
    [ -f "$C/$f" ] && row claude-home "$f" info "present" || row claude-home "$f" info "absent"
  done
  for d in projects sessions todos; do # machine-local state that must never be copied
    [ -d "$C/$d" ] && row claude-home "$d (local state)" warn "present — do not sync"
  done
else
  row claude-home "~/.claude" info "absent (blank user)"
fi

# --- network -----------------------------------------------------------------
head_ "network"
for u in https://github.com https://registry.npmjs.org https://api.anthropic.com; do
  if curl -sS -o /dev/null -m 5 "$u" 2>/dev/null; then row net "${u#https://}" ok "reachable"
  else row net "${u#https://}" missing "unreachable in 5s"; fi
done

# --- ssh (Linux target only) ------------------------------------------------
if [ "$OS" = "Linux" ]; then
  head_ "ssh"
  if command -v systemctl >/dev/null 2>&1 && { systemctl is-active --quiet ssh 2>/dev/null \
     || systemctl is-active --quiet sshd 2>/dev/null; }; then
    row ssh sshd ok "active"
  else
    row ssh sshd warn "ssh/sshd service not reported active"
  fi
  if [ -f "$HOME/.ssh/authorized_keys" ]; then
    row ssh authorized_keys ok "$(grep -c . "$HOME/.ssh/authorized_keys") key(s)"
  else
    row ssh authorized_keys info "absent"
  fi
fi
[ "$JSON" -eq 1 ] || echo
