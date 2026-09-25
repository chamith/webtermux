#!/usr/bin/env bash
# Installs and starts Webtermux on this host: system packages, app deps,
# .env (login password + session secret), and a systemd user service.
#
# Usage: ./install.sh
# Safe to re-run: skips steps that are already done (existing .env, already
# installed packages, already-built dist/ output is rebuilt fresh each time).

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || die "This installer targets Linux (Debian/Ubuntu). See README.md for manual setup on other platforms."
command -v apt-get >/dev/null 2>&1 || die "This installer requires apt (Debian/Ubuntu). See README.md for manual setup."

# --- Node.js ---------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js is required but wasn't found. Install Node 18+ (e.g. via nvm: https://github.com/nvm-sh/nvm) and re-run this script."
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" -ge 18 ]] || die "Node.js 18+ required, found $(node -v). Upgrade and re-run."
log "Using Node.js $(node -v) at $NODE_BIN"

# --- System packages (tmux + build tools for node-pty's native addon) ------
log "Installing system packages (tmux, build tools) — may prompt for your sudo password"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends tmux build-essential python3 >/dev/null
log "tmux $(tmux -V) installed"

# --- App dependencies + build ------------------------------------------------
log "Installing and building the server"
(cd server && npm install --no-fund --no-audit && npm run build)

log "Installing and building the client"
(cd client && npm install --no-fund --no-audit && npm run build)

# --- .env (login password + session secret) ---------------------------------
if [[ -f .env ]]; then
  log ".env already exists, leaving it as-is"
else
  log "Setting up .env"
  while true; do
    read -rsp "Choose a login password for the web UI: " WEBTERMUX_PASSWORD
    echo
    [[ -n "$WEBTERMUX_PASSWORD" ]] && break
    echo "Password can't be empty."
  done

  PASSWORD_HASH="$(cd server && node -e '
    const bcrypt = require("bcryptjs");
    bcrypt.hash(process.argv[1], 12).then((h) => process.stdout.write(h));
  ' "$WEBTERMUX_PASSWORD")"
  unset WEBTERMUX_PASSWORD

  if command -v openssl >/dev/null 2>&1; then
    SESSION_SECRET="$(openssl rand -hex 32)"
  else
    SESSION_SECRET="$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi

  cat > .env <<EOF
ADMIN_PASSWORD_HASH=$PASSWORD_HASH
SESSION_SECRET=$SESSION_SECRET
EOF
  chmod 600 .env
  log ".env written (chmod 600)"
fi

# --- systemd user service ----------------------------------------------------
log "Installing the systemd user service"
mkdir -p "$HOME/.config/systemd/user"
sed \
  -e "s#__PROJECT_DIR__#${PROJECT_DIR}#g" \
  -e "s#__NODE_BIN__#${NODE_BIN}#g" \
  deploy/webtermux.service.template > "$HOME/.config/systemd/user/webtermux.service"

# When running over SSH or in a non-login session, $XDG_RUNTIME_DIR and
# $DBUS_SESSION_BUS_ADDRESS may not be set, causing "systemctl --user" to
# fail with "Failed to connect to user scope bus". Setting XDG_RUNTIME_DIR
# to the standard path (/run/user/<uid>) is sufficient for systemd to locate
# the user manager socket without a full D-Bus session.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [[ ! -d "$XDG_RUNTIME_DIR" ]]; then
  # The runtime dir is normally created by systemd-logind on first login.
  # On headless servers where the user has never had an interactive session
  # it may not exist yet — create it with the required permissions.
  sudo mkdir -p "$XDG_RUNTIME_DIR"
  sudo chown "$(id -u):$(id -g)" "$XDG_RUNTIME_DIR"
  sudo chmod 700 "$XDG_RUNTIME_DIR"
fi

systemctl --user daemon-reload
systemctl --user enable --now webtermux

sleep 1
if systemctl --user is-active --quiet webtermux; then
  PORT="$(grep -o '^PORT=.*' .env 2>/dev/null | cut -d= -f2)"
  PORT="${PORT:-3000}"
  log "Webtermux is running: http://localhost:${PORT}"
  echo "Manage it with: systemctl --user {status|stop|restart} webtermux"
  echo "Logs: journalctl --user -u webtermux -f"
  echo
  echo "To start on boot without an active login session: loginctl enable-linger \$USER"
  echo "For remote access from other devices, see the Tailscale section in README.md."
else
  die "Service failed to start. Check: journalctl --user -u webtermux -e"
fi
