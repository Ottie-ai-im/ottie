if [[ -n "${_OTTIE_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _OTTIE_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _OTTIE_ZSH_COMMAND_ACTIVE=0

function _ottie_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _ottie_precmd() {
  local command_status=$?
  if [[ "$_OTTIE_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _ottie_osc633 "D;${command_status}"
    _OTTIE_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _ottie_osc633 "A"
}

function _ottie_preexec() {
  _OTTIE_ZSH_COMMAND_ACTIVE=1
  _ottie_osc633 "B"
  _ottie_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _ottie_precmd
add-zsh-hook preexec _ottie_preexec
