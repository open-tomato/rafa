# rafa-prompt: a prompt segment for the rafa plan of the current branch.
#
# `rafa_prompt_info` prints one short segment, or nothing outside a rafa
# project. It reads local files only (the plan, its tracker and the run
# records), never starts rafa and never reaches the network, because a
# prompt redraws on every Enter. See README.md beside this file.
#
# The tomato theme (../tomato/) reuses `_rafa_prompt_read` and
# `_rafa_prompt_task_segment` from this file.

# Wrapped around the segment, as ZSH_THEME_GIT_PROMPT_PREFIX is around git's.
: ${RAFA_PROMPT_PREFIX:=''}
: ${RAFA_PROMPT_SUFFIX:=''}

# Sets REPLY to the plan directory for a checkout root: `plan.dir` from its
# `.rafa/config.yaml` when set, `.rafa/plans` otherwise.
_rafa_prompt_plan_dir() {
  local root=$1 config=$1/.rafa/config.yaml line dir='' in_plan=0
  if [[ -r $config ]]; then
    while IFS= read -r line; do
      if [[ $line == plan:* ]]; then
        in_plan=1
        continue
      fi
      [[ $line == [^[:space:]#]* ]] && in_plan=0
      if (( in_plan )) && [[ $line =~ '^[[:space:]]+dir:[[:space:]]*["'\'']?([^"'\''#]*[^"'\''#[:space:]])' ]]; then
        dir=${match[1]}
        break
      fi
    done < $config
  fi
  dir=${dir:-.rafa/plans}
  [[ $dir == /* ]] && REPLY=$dir || REPLY=$root/$dir
}

# Sets REPLY to the state of the live run of this branch, `running` or
# `paused`: a record under `.rafa/runs/` naming the branch in one of those
# states, whose process is still alive. Returns 1 when there is none.
_rafa_prompt_live_run() {
  local branch=$1 record content pid
  shift
  REPLY=''
  for record in ${^@}/.rafa/runs/*.json(N); do
    content=$(<$record)
    [[ $content == *\"branch\":\ \"$branch\"* ]] || continue
    [[ $content =~ '"state": "(running|paused)"' ]] || continue
    local state=${match[1]}
    [[ $content =~ '"pid": ([0-9]+)' ]] || continue
    pid=${match[1]}
    kill -0 $pid 2>/dev/null || continue
    REPLY=$state
    return 0
  done
  return 1
}

# Reads the current checkout into the global association `rafa_plan`.
# Reads the checkout into the global association `rafa_git` with one git
# call: `top` (this checkout's root), `common` (the shared git directory),
# `main` (the main checkout's root) and `branch`. Returns 1 outside git.
_rafa_prompt_git() {
  typeset -gA rafa_git
  rafa_git=()
  local -a git_out
  git_out=("${(@f)$(git rev-parse --path-format=absolute --show-toplevel \
    --git-common-dir --abbrev-ref HEAD 2>/dev/null)}")
  (( ${#git_out} == 3 )) || return 1
  rafa_git=(top ${git_out[1]} common ${git_out[2]} main ${git_out[2]:h}
    branch ${git_out[3]})
}

# Reads the current checkout into the global association `rafa_plan`.
# Returns 1 outside a rafa project. Inside one it always sets `top`,
# `main` and `branch`; on a branch other than the base it also sets
# `stub`, `issue` (the number in a `rafa-<n>-…` stub, else empty) and
# `label`, and, when the branch has a plan, `plan`, `title`, `done`,
# `open`, `blocked`, `total` and `run`. With a first argument it reuses
# the `rafa_git` a caller has just read instead of calling git again.
_rafa_prompt_read() {
  setopt localoptions extendedglob
  typeset -gA rafa_plan
  rafa_plan=()
  [[ -n $1 ]] || _rafa_prompt_git || return 1
  (( ${#rafa_git} )) || return 1
  local top=${rafa_git[top]} main=${rafa_git[main]} branch=${rafa_git[branch]}
  [[ -d $top/.rafa || -d $main/.rafa ]] || return 1
  rafa_plan=(top $top main $main branch $branch)
  [[ $branch == (main|master|HEAD) ]] && return 0

  local stub=${branch#*/} issue=''
  [[ $stub =~ '^[a-z0-9]+-([0-9]+)(-|$)' ]] && issue=${match[1]}
  # A `%` in a branch name would otherwise read as a prompt escape.
  local label=${${issue:+#$issue}:-${stub//\%/%%}}
  rafa_plan+=(stub $stub issue "$issue" label $label)

  # Plans are gitignored, so a worktree reads them from the main checkout.
  local root dir plan='' tracker=''
  for root in $top $main; do
    _rafa_prompt_plan_dir $root
    dir=$REPLY
    if [[ -f $dir/PLAN-$stub.md ]]; then
      plan=$dir/PLAN-$stub.md
      [[ -f $dir/PLAN_TRACKER-$stub.md ]] && tracker=$dir/PLAN_TRACKER-$stub.md
      break
    fi
  done
  [[ -n $plan ]] || return 0

  local title=''
  IFS= read -r title < $plan
  title=${${title#\# Plan: }//\`/}

  local -a lines
  lines=("${(@f)$(<${tracker:-$plan})}")
  local done=${#${(M)lines:#[[:space:]]#- \[x\]*}}
  local open=${#${(M)lines:#[[:space:]]#- \[ \]*}}
  local blocked=${#${(M)lines:#[[:space:]]#- \[BLOCKED\]*}}
  _rafa_prompt_live_run $branch $top $main
  rafa_plan+=(plan $plan title "$title" done $done open $open
    blocked $blocked total $(( done + open + blocked )) run "$REPLY")
}

# Sets REPLY to the task segment for what `_rafa_prompt_read` read, or to
# nothing when there is none to show.
_rafa_prompt_task_segment() {
  REPLY=''
  local label=${rafa_plan[label]} done=${rafa_plan[done]} total=${rafa_plan[total]}
  [[ -n $label ]] || return 0
  if [[ -z ${rafa_plan[plan]} ]]; then
    # rafa names its branches `feat/<stub>`; any other branch without a
    # plan is not rafa's, so it gets no segment.
    [[ ${rafa_plan[branch]} == feat/* ]] && REPLY="%F{244}📝 $label no plan%f"
  elif [[ ${rafa_plan[run]} == running ]]; then
    REPLY="%F{red}🍅 $label task $(( done + 1 ))/$total%f"
  elif [[ ${rafa_plan[run]} == paused ]]; then
    REPLY="%F{yellow}⏸ $label paused $done/$total%f"
  elif (( ${rafa_plan[blocked]} > 0 )); then
    REPLY="%F{yellow}⚠ $label ${rafa_plan[blocked]} blocked, check plan%f"
  elif (( total > 0 && done == total )); then
    REPLY="%F{green}✅ $label done%f"
  elif (( done == 0 )); then
    REPLY="%F{green}▶ $label ready 0/$total%f"
  else
    REPLY="%F{cyan}⏳ $label $done/$total%f"
  fi
}

rafa_prompt_info() {
  _rafa_prompt_read || return 0
  _rafa_prompt_task_segment
  [[ -n $REPLY ]] && print -rn -- "$RAFA_PROMPT_PREFIX$REPLY$RAFA_PROMPT_SUFFIX"
  return 0
}
