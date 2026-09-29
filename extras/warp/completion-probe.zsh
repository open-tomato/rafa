# Warp spike for open-tomato/rafa#347: a stand-in command with a zsh
# completion shaped like the one `rafa completion zsh` would install.
# Load it with `source <this file>`, then press TAB after `rafaprobe`.

(( $+functions[compdef] )) || { autoload -Uz compinit && compinit; }

rafaprobe() { print -r -- "rafaprobe: $*"; }

_rafaprobe() {
  local -a subjects
  subjects=(
    'loop:run a plan task by task'
    'plan:create and read plans'
    'pr:open, merge and triage pull requests'
  )
  if (( CURRENT == 2 )); then
    _describe 'subject' subjects
    return
  fi
  _arguments \
    '--plan=[the plan to run]:plan:_files -g "*.md"' \
    '--inject=[how much of the plan each task gets]:inject:(full stage task)' \
    '*::word:'
}

compdef _rafaprobe rafaprobe
