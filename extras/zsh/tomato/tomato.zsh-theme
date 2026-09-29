# tomato: a two-line zsh prompt for rafa projects. See README.md.
#
#   rafa feat/rafa-367-… +3130 -160 │ rafa:0.24.1 │ spec: #367 - Releases settle… [4/10]      🍅 #367 task 8/47
#   host >
#
# Git and rafa on the left, the task counter alone on the right, and a
# spacer between them for short status messages. Everything is read from
# local files and git, never from rafa or the network: the epic progress
# comes from rafa's board cache, so it is as fresh as the last rafa
# command that read the board.

typeset -g _tomato_dir=${${(%):-%x}:A:h}
source $_tomato_dir/../rafa-prompt/rafa-prompt.plugin.zsh

zmodload -F zsh/stat b:zstat 2>/dev/null
autoload -Uz add-zsh-hook

# Longest spec title before it is cut with an ellipsis; a narrow
# terminal cuts it further.
: ${TOMATO_TITLE_MAX:=32}

# An untracked file larger than this many bytes is left out of the added
# line count, so a stray build output or dump does not slow the prompt.
: ${TOMATO_UNTRACKED_MAX_BYTES:=1048576}

# The dim divider between the groups on the left side.
: ${TOMATO_DIVIDER:=│}
typeset -g _tomato_divider="%F{240}${TOMATO_DIVIDER}%f"

# The narrowest spacer worth keeping, in columns: room for a short
# sentence. With less free room, the spacer is off and the spec title
# takes the room instead.
: ${TOMATO_SPACER_MIN:=40}

# Functions whose output fills the spacer between the left side and the
# task counter, joined by two spaces. Each prints one short message, or
# nothing. Empty by default; see README.md.
typeset -ga tomato_spacer_functions

# Sets REPLY to the version of the installed rafa, or to nothing.
_tomato_rafa_version() {
  REPLY=''
  local bin=${commands[rafa]:-$HOME/.rafa/bin/rafa}
  if [[ ! -e $bin ]]; then
    typeset -g _tomato_version_key='' _tomato_version=''
    return 1
  fi
  local real=${bin:A}
  if [[ $real != "$_tomato_version_key" ]]; then
    local version=''
    if [[ ${real:h:h:t} == runtime ]]; then
      version=${real:h:t}
    elif [[ -r ${real:h:h}/package.json && $(<${real:h:h}/package.json) =~ '"version": *"([^"]+)"' ]]; then
      version=${match[1]}
    fi
    typeset -g _tomato_version_key=$real _tomato_version=$version
  fi
  REPLY=$_tomato_version
}

# Sets the global array `tomato_board` to the fields board.jq prints for
# the issue in $1 (empty off a spec), rerunning jq only when the board
# cache or the issue changed.
_tomato_board_read() {
  local issue=$1 file='' candidate
  for candidate in ${rafa_git[main]}/.rafa/cache/board.json ${rafa_git[top]}/.rafa/cache/board.json; do
    [[ -r $candidate ]] && { file=$candidate; break; }
  done
  typeset -ga tomato_board
  if [[ -z $file ]] || (( ! $+commands[jq] )); then
    tomato_board=()
    return 1
  fi
  local -a mtime
  zstat -A mtime +mtime -- $file 2>/dev/null
  local key="$file:${mtime[1]}:$issue"
  if [[ $key != "$_tomato_board_key" ]]; then
    tomato_board=("${(@ps:\t:)$(jq -r --argjson n ${issue:-null} -f $_tomato_dir/board.jq $file 2>/dev/null)}")
    typeset -g _tomato_board_key=$key
  fi
}

# Sets the globals `_tomato_added` and `_tomato_removed` to the lines the
# branch changes against its base, as the Claude app counts them: the
# working tree against the merge base with `origin/HEAD` (so commits,
# staged and unstaged changes all count), plus every line of untracked
# files. With no `origin/HEAD`, the base is `HEAD`.
_tomato_diff_count() {
  typeset -g _tomato_added=0 _tomato_removed=0
  local base='' line
  if [[ -r ${rafa_git[common]}/refs/remotes/origin/HEAD ]]; then
    IFS= read -r line < ${rafa_git[common]}/refs/remotes/origin/HEAD
    [[ $line == 'ref: refs/remotes/'* ]] && base=${line#ref: refs/remotes/}
  fi
  local stat
  if [[ -n $base ]]; then
    stat=$(git diff --shortstat --merge-base $base 2>/dev/null)
  else
    stat=$(git diff --shortstat HEAD 2>/dev/null)
  fi
  [[ $stat =~ '([0-9]+) insertion' ]] && _tomato_added=${match[1]}
  [[ $stat =~ '([0-9]+) deletion' ]] && _tomato_removed=${match[1]}

  local -a untracked size
  untracked=("${(@0)$(git -C ${rafa_git[top]} ls-files --others --exclude-standard -z 2>/dev/null)}")
  local file
  for file in ${untracked:#}; do
    file=${rafa_git[top]}/$file
    [[ -f $file ]] || continue
    zstat -A size +size -- $file 2>/dev/null
    (( ${size[1]:-0} <= TOMATO_UNTRACKED_MAX_BYTES )) || continue
    local text=$(<$file)
    [[ -n $text ]] || continue
    # Quoted with `@`, so blank lines count as lines, as `wc -l` counts them.
    local -a flines
    flines=("${(@f)text}")
    (( _tomato_added += ${#flines} ))
  done
}

# Sets REPLY to "repo branch +added -removed", the branch cut in its
# middle to $1 characters when longer (0 leaves it whole). The counts are
# left out when both are zero.
_tomato_git() {
  REPLY=''
  (( ${#rafa_git} )) || return 1
  local max=${1:-0} branch=${rafa_git[branch]}
  if (( max > 0 && ${#branch} > max )); then
    local head=$(( (max - 1) / 2 ))
    branch="${branch[1,head]}…${branch[-(max - 1 - head),-1]}"
  fi
  # The repository's name, from the main checkout so a worktree shows the
  # repository and not its own folder, plus the path below the root.
  local repo=${rafa_git[main]:t} sub=${PWD#${rafa_git[top]}}
  REPLY="%F{242}${repo//\%/%%}${sub//\%/%%}%f %B${branch//\%/%%}%b"
  if (( _tomato_added || _tomato_removed )); then
    REPLY+=" %F{green}+$_tomato_added%f %F{red}-$_tomato_removed%f"
  fi
}

# Sets REPLY to the rafa part of the left side: the version, then the
# spec with its title cut to $1 characters (0 drops the title, -1 keeps it
# whole) or the roadmap, and the epic progress, the groups divided by a
# dim vertical line. $2 set to 0 drops the version.
_tomato_rafa_part() {
  local title_max=$1 show_version=${2:-1}
  local -a groups
  (( show_version )) && [[ -n $_tomato_version_shown ]] && groups+=("%F{242}rafa:$_tomato_version_shown%f")
  if (( _tomato_in_rafa )); then
    local item
    if [[ -n ${rafa_plan[issue]} ]]; then
      item="%F{yellow}spec: #${rafa_plan[issue]}"
      if (( title_max != 0 )) && [[ -n $_tomato_title ]]; then
        local title=$_tomato_title
        (( title_max > 0 && ${#title} > title_max )) && title="${title[1,title_max-1]}…"
        item+=" - ${title//\%/%%}"
      fi
      item+="%f"
    else
      item="%F{yellow}roadmap${tomato_board[2]:+: #${tomato_board[2]}}%f"
    fi
    [[ -n ${tomato_board[5]} ]] && item+=" %F{242}[${tomato_board[4]}/${tomato_board[5]}]%f"
    groups+=("$item")
  fi
  local sep=" $_tomato_divider "
  REPLY=${(pj:$sep:)groups}
}

# Sets REPLY to the width a prompt string takes on screen.
_tomato_width() {
  local zero='%([BSUbfksu]|([FK]|){*})'
  # One `%` flag: `%` escapes only. Doubled, it would also run the `$(…)`
  # that prompt_subst allows, and a title or branch could hold one.
  REPLY=${(m)#${(S%)1//$~zero/}}
}

_tomato_precmd() {
  typeset -g _tomato_in_rafa=0 _tomato_title=''
  typeset -gA rafa_plan
  rafa_plan=()
  local in_git=0
  _rafa_prompt_git && in_git=1
  (( in_git )) && _rafa_prompt_read reuse && _tomato_in_rafa=1

  typeset -g _tomato_version_shown=''
  if (( _tomato_in_rafa )) || [[ -d $HOME/.rafa ]]; then
    _tomato_rafa_version && _tomato_version_shown=$REPLY
  fi
  if (( _tomato_in_rafa )); then
    _tomato_board_read "${rafa_plan[issue]}"
    _tomato_title=${tomato_board[3]:-${rafa_plan[title]}}
  fi
  (( in_git )) && _tomato_diff_count

  local -a messages
  local fn out
  for fn in $tomato_spacer_functions; do
    (( $+functions[$fn] )) || continue
    out=$($fn 2>/dev/null)
    [[ -n $out ]] && messages+=("${out//\%/%%}")
  done
  local middle=${(j:  :)messages}

  # The top right holds the task counter alone.
  local right=''
  (( _tomato_in_rafa )) && { _rafa_prompt_task_segment; right=$REPLY; }
  local wr=0
  [[ -n $right ]] && { _tomato_width "$right"; wr=$REPLY; }

  # One column is kept spare: some terminals draw an emoji one cell
  # narrower or wider than zsh counts it, and a line one cell too long
  # wraps. `free` is what is left between the left side and the counter.
  local room=$(( COLUMNS - 1 ))
  local branch_max=0 title_max=$TOMATO_TITLE_MAX show_version=1
  local left wl free
  _tomato_fit() {
    if (( in_git )); then _tomato_git $branch_max; left=$REPLY
    else left='%F{242}%(4~|…/%3~|%~)%f'; fi
    _tomato_rafa_part $title_max $show_version
    [[ -n $REPLY ]] && left+=" $_tomato_divider $REPLY"
    _tomato_width "$left"; wl=$REPLY
    free=$(( room - wl - (wr ? wr + 1 : 0) ))
  }
  _tomato_fit

  # The spacer keeps its room only when a message of TOMATO_SPACER_MIN
  # columns fits beside a title cut to TOMATO_TITLE_MAX. Otherwise it is
  # off and the title takes the room, as much of it as it needs.
  local spacer=1
  if (( free > TOMATO_SPACER_MIN )) && [[ -n ${rafa_plan[issue]} && -n $_tomato_title ]] \
      && (( ${#_tomato_title} > TOMATO_TITLE_MAX )); then
    # Room beyond what the spacer needs goes to the title first.
    title_max=$(( TOMATO_TITLE_MAX + free - TOMATO_SPACER_MIN )); _tomato_fit
  fi
  if (( free < TOMATO_SPACER_MIN )); then
    spacer=0
    if [[ -n ${rafa_plan[issue]} && -n $_tomato_title ]]; then
      title_max=-1; _tomato_fit
      if (( free < 0 )); then
        title_max=$(( ${#_tomato_title} + free < 12 ? 12 : ${#_tomato_title} + free )); _tomato_fit
      fi
    fi
  fi

  # Still too wide: the branch, then the version, then the title give
  # way, before the task counter or a wrapped line.
  if (( free < 0 && in_git )); then
    branch_max=$(( ${#rafa_git[branch]} + free < 16 ? 16 : ${#rafa_git[branch]} + free )); _tomato_fit
  fi
  (( free < 0 )) && { show_version=0; _tomato_fit; }
  if (( free < 0 )) && [[ -n ${rafa_plan[issue]} ]]; then
    title_max=0; _tomato_fit
    # Dropping the whole title can free more than was needed; give the
    # spare columns back to it when a readable part fits (" - " + 6).
    if (( free >= 9 )) && [[ -n $_tomato_title ]]; then
      title_max=$(( free - 3 )); _tomato_fit
    fi
  fi
  (( free < 0 )) && { right=''; wr=0; _tomato_fit; }
  unfunction _tomato_fit

  local line=$left fill=$(( free > 0 ? free : 0 ))
  if (( spacer )) && [[ -n $middle ]]; then
    local wm
    _tomato_width "$middle"; wm=$REPLY
    if (( wm + 2 <= fill )); then
      line+="  %F{242}$middle%f"
      fill=$(( fill - wm - 2 ))
    fi
  fi
  if [[ -n $right ]]; then
    local pad
    printf -v pad '%*s' $fill ''
    line+="$pad $right"
  fi

  local host='%m'
  [[ $OSTYPE == darwin* ]] || host='%n@%m'
  typeset -g _tomato_line1=$line
  typeset -g _tomato_line2="%F{242}$host%f %(?.%F{green}.%F{red})>%f "
}

add-zsh-hook precmd _tomato_precmd

# The lines are built in precmd and only referenced here. A value that
# prompt_subst expands is not scanned again, so a title or branch name
# holding `$(…)` prints as text and never runs.
setopt prompt_subst
PROMPT='${_tomato_line1}'$'\n''${_tomato_line2}'
RPROMPT=''
