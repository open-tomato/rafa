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

# Sets the global array `rafa_live_runs` to one entry per live loop:
# "branch<TAB>stub<TAB>state<TAB>plan". A loop is live while a record
# under `.rafa/runs/` in one of the given roots is `running` or `paused`
# and its process is alive; records whose process is gone are left out,
# and a branch counts once however many records name it.
_rafa_prompt_live_runs() {
  typeset -ga rafa_live_runs
  rafa_live_runs=()
  local -A seen
  local root record content state pid branch stub plan
  for root in ${(u)@}; do
    for record in $root/.rafa/runs/*.json(N); do
      content=$(<$record)
      [[ $content =~ '"state": "(running|paused)"' ]] || continue
      state=${match[1]}
      [[ $content =~ '"pid": ([0-9]+)' ]] || continue
      pid=${match[1]}
      kill -0 $pid 2>/dev/null || continue
      [[ $content =~ '"branch": "([^"]*)"' ]] || continue
      branch=${match[1]}
      (( ${+seen[$branch]} )) && continue
      seen[$branch]=1
      stub=${branch#*/}
      [[ $content =~ '"planStub": "([^"]+)"' ]] && stub=${match[1]}
      plan=''
      [[ $content =~ '"plan": "([^"]+)"' ]] && plan=${match[1]}
      [[ -n $plan && $plan != /* ]] && plan=$root/$plan
      rafa_live_runs+=("$branch"$'\t'"$stub"$'\t'"$state"$'\t'"$plan")
    done
  done
}

# Sets `reply` to (done open blocked), the task lines of a tracker or plan.
_rafa_prompt_count() {
  setopt localoptions extendedglob
  reply=(0 0 0)
  [[ -r $1 ]] || return 1
  local -a lines
  lines=("${(@f)$(<$1)}")
  reply=(${#${(M)lines:#[[:space:]]#- \[x\]*}} ${#${(M)lines:#[[:space:]]#- \[ \]*}}
    ${#${(M)lines:#[[:space:]]#- \[BLOCKED\]*}})
}

# Sets REPLY to the label for a stub: `#<n>` for a `rafa-<n>-…` stub,
# else the stub with `%` escaped, since it goes into a prompt.
_rafa_prompt_label() {
  if [[ $1 =~ '^[a-z0-9]+-([0-9]+)(-|$)' ]]; then
    REPLY="#${match[1]}"
  else
    REPLY=${1//\%/%%}
  fi
}

# Sets REPLY to "#<n> <task>/<total>" for one entry of `rafa_live_runs`:
# the task in progress for a running loop, the tasks done for a paused one.
_rafa_prompt_live_entry() {
  local -a f
  f=("${(@ps:\t:)1}")
  local stub=${f[2]} state=${f[3]} plan=${f[4]} file=${f[4]}
  [[ -f ${plan:h}/PLAN_TRACKER-$stub.md ]] && file=${plan:h}/PLAN_TRACKER-$stub.md
  _rafa_prompt_count $file
  local total=$(( reply[1] + reply[2] + reply[3] )) at=${reply[1]}
  [[ $state == running ]] && at=$(( reply[1] + 1 ))
  _rafa_prompt_label $stub
  REPLY="$REPLY $at/$total"
}

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
# `open`, `blocked`, `total` and `run`. It also fills `rafa_live_runs`
# with every live loop of the project. With a first argument it reuses
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
  _rafa_prompt_live_runs $main $top
  [[ $branch == (main|master|HEAD) ]] && return 0

  local stub=${branch#*/} issue=''
  [[ $stub =~ '^[a-z0-9]+-([0-9]+)(-|$)' ]] && issue=${match[1]}
  _rafa_prompt_label $stub
  rafa_plan+=(stub $stub issue "$issue" label $REPLY)

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

  _rafa_prompt_count ${tracker:-$plan}
  local done=${reply[1]} open=${reply[2]} blocked=${reply[3]}
  local entry run=''
  for entry in $rafa_live_runs; do
    if [[ ${entry%%$'\t'*} == $branch ]]; then
      run=${${(@ps:\t:)entry}[3]}
      break
    fi
  done
  rafa_plan+=(plan $plan title "$title" done $done open $open
    blocked $blocked total $(( done + open + blocked )) run "$run")
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
    REPLY="%F{red}🍅 $label $(( done + 1 ))/$total%f"
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
