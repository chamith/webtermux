#!/usr/bin/env bash
# Removes what install.sh set up: the systemd user service, and (optionally,
# with confirmation) build artifacts, .env, and your tmux sessions.
#
# By default this is conservative: it stops/removes the service but leaves
# your tmux sessions (real shells, possibly with unsaved work) and .env
# (your login secret) untouched. Use --purge to remove everything
# non-interactively, or answer the prompts to pick and choose.
#
# Usage: ./uninstall.sh [--purge]

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

PURGE=false
[[ "${1:-}" == "--purge" ]] && PURGE=true

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1"; }

confirm() {
  # confirm "question" -> 0 (yes) or 1 (no). Always "yes" under --purge.
  $PURGE && return 0
  local reply
  read -rp "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

TMUX_SOCKET_NAME="webterm"
if [[ -f .env ]]; then
  configured="$(grep -o '^TMUX_SOCKET_NAME=.*' .env 2>/dev/null | cut -d= -f2)"
  [[ -n "$configured" ]] && TMUX_SOCKET_NAME="$configured"
fi

# --- systemd user service ----------------------------------------------------
UNIT_PATH="$HOME/.config/systemd/user/webtermux.service"
if systemctl --user list-unit-files webtermux.service >/dev/null 2>&1; then
  log "Stopping and disabling the webtermux service"
  systemctl --user disable --now webtermux 2>/dev/null || true
fi
if [[ -f "$UNIT_PATH" ]]; then
  rm -f "$UNIT_PATH"
  systemctl --user daemon-reload
  log "Removed $UNIT_PATH"
else
  log "No systemd service installed, nothing to stop"
fi

# --- tmux sessions ------------------------------------------------------------
if command -v tmux >/dev/null 2>&1 && tmux -L "$TMUX_SOCKET_NAME" list-sessions >/dev/null 2>&1; then
  echo
  echo "You have live tmux sessions on the '$TMUX_SOCKET_NAME' socket:"
  tmux -L "$TMUX_SOCKET_NAME" list-sessions
  if confirm "Kill these sessions too? This ends any running work in them and can't be undone."; then
    tmux -L "$TMUX_SOCKET_NAME" kill-server
    log "tmux sessions killed"
  else
    log "Leaving tmux sessions running — reattach directly with: tmux -L $TMUX_SOCKET_NAME attach -t <name>"
  fi
else
  log "No live tmux sessions on the '$TMUX_SOCKET_NAME' socket"
fi

# --- .env (contains your login password hash + session secret) --------------
if [[ -f .env ]]; then
  if confirm "Remove .env (your login password hash + session secret)?"; then
    rm -f .env
    log "Removed .env"
  else
    log "Leaving .env in place"
  fi
fi

# --- build artifacts / dependencies -------------------------------------------
if [[ -d server/node_modules || -d server/dist || -d client/node_modules || -d client/dist ]]; then
  if confirm "Remove build artifacts and installed dependencies (server/dist, server/node_modules, client/dist, client/node_modules)? Safe to regenerate later with install.sh."; then
    rm -rf server/dist server/node_modules client/dist client/node_modules
    log "Removed build artifacts and node_modules"
  fi
fi

log "Uninstall complete."
echo "Note: system packages installed by install.sh (tmux, build-essential, python3) were left in place —"
echo "remove them yourself if nothing else on this host needs them, e.g.: sudo apt remove tmux build-essential python3"
echo "The project directory itself ($PROJECT_DIR) was left in place; delete it manually if you're done with it."
