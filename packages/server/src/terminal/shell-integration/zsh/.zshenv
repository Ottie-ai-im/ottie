typeset -g OTTIE_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${OTTIE_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${OTTIE_ZSH_ZDOTDIR}"
else
  unset ZDOTDIR
fi

if [[ -n "${ZDOTDIR-}" ]]; then
  if [[ -f "${ZDOTDIR}/.zshenv" ]]; then
    source "${ZDOTDIR}/.zshenv"
  fi
elif [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi

source "${OTTIE_SHELL_INTEGRATION_DIR}/ottie-integration.zsh"
