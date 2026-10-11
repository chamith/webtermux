#!/usr/bin/env bash
# Installs and starts Webtermux on this host: system packages, app deps,
# .env (login password + session secret), and a systemd service.
#
# Usage: ./install.sh
# Safe to re-run: skips steps that are already done (existing .env, already
# installed packages, already-built dist/ output is rebuilt fresh each time).
#
# Supports running as root (e.g. on servers with only a root account) or as a
# regular user with sudo. When run as root a system-wide service is installed
# under /etc/systemd/system/; otherwise a systemd user service is used, with
# lingering enabled so it keeps running (and starts at boot) while the user is
# logged out. Either way the service doesn't depend on anyone being logged in.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || die "This installer targets Linux (Debian/Ubuntu). See README.md for manual setup on other platforms."
command -v apt-get >/dev/null 2>&1 || die "This installer requires apt (Debian/Ubuntu). See README.md for manual setup."

# --- Privilege helpers -------------------------------------------------------
# When running as root, "sudo" is a no-op wrapper; otherwise we use real sudo.
AS_ROOT=false
SUDO=""
RUN_USER="$(id -un)"
if [[ "$(id -u)" -eq 0 ]]; then
  AS_ROOT=true
else
  command -v sudo >/dev/null 2>&1 || die "sudo is required when running as a non-root user."
  SUDO="sudo"
fi

apt_install() {
  # Usage: apt_install pkg1 pkg2 ...
  $SUDO apt-get install -y --no-install-recommends "$@" >/dev/null
}

# --- System packages (tmux + build tools for node-pty's native addon) ------
log "Installing system packages — $([ "$AS_ROOT" = true ] && echo 'running as root' || echo 'may prompt for your sudo password')"
$SUDO apt-get update -qq
apt_install tmux build-essential python3 curl ca-certificates gnupg

# --- Node.js ---------------------------------------------------------------
NODE_NEEDS_INSTALL=false
if ! command -v node >/dev/null 2>&1; then
  log "Node.js not found — installing Node.js 20 LTS via NodeSource"
  NODE_NEEDS_INSTALL=true
else
  NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [[ "$NODE_MAJOR" -lt 18 ]]; then
    log "Node.js $(node -v) is too old — upgrading to Node.js 20 LTS via NodeSource"
    NODE_NEEDS_INSTALL=true
  fi
fi

if [[ "$NODE_NEEDS_INSTALL" == true ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - >/dev/null
  apt_install nodejs
fi

NODE_BIN="$(command -v node)"
log "Using Node.js $(node -v) at $NODE_BIN"
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

# --- systemd service ---------------------------------------------------------
if [[ "$AS_ROOT" == true ]]; then
  # System-wide service (root installation)
  log "Installing the systemd system service"
  SERVICE_FILE="/etc/systemd/system/webtermux.service"
  sed \
    -e "s#__PROJECT_DIR__#${PROJECT_DIR}#g" \
    -e "s#__NODE_BIN__#${NODE_BIN}#g" \
    deploy/webtermux.system.service.template > "$SERVICE_FILE"
  chmod 644 "$SERVICE_FILE"

  systemctl daemon-reload
  systemctl enable --now webtermux

  sleep 1
  if systemctl is-active --quiet webtermux; then
    PORT="$(grep -o '^PORT=.*' .env 2>/dev/null | cut -d= -f2)"
    PORT="${PORT:-3000}"
    log "Webtermux is running: http://localhost:${PORT}"
    echo "Manage it with: systemctl {status|stop|restart} webtermux"
    echo "Logs: journalctl -u webtermux -f"
    echo "Runs as a system service: starts at boot and keeps running with nobody logged in."
  else
    die "Service failed to start. Check: journalctl -u webtermux -e"
  fi

else
  # Per-user service (non-root installation)
  log "Installing the systemd user service"
  mkdir -p "$HOME/.config/systemd/user"
  sed \
    -e "s#__PROJECT_DIR__#${PROJECT_DIR}#g" \
    -e "s#__NODE_BIN__#${NODE_BIN}#g" \
    deploy/webtermux.service.template > "$HOME/.config/systemd/user/webtermux.service"

  # Lingering tells systemd to start this user's service manager at boot and
  # keep it running after the last session ends, so the service stays up while
  # nobody is logged in. Without it a user service stops on logout and doesn't
  # start at boot. Do this before any `systemctl --user` call: it also starts
  # the user manager (and creates /run/user/<uid>) on headless hosts where
  # nobody has logged in yet.
  LINGER_OK=false
  log "Enabling lingering so the service runs while you're logged out — may prompt for your sudo password"
  if $SUDO loginctl enable-linger "$RUN_USER"; then
    LINGER_OK=true
  else
    warn "Could not enable lingering for $RUN_USER. The service will stop when you log out and won't start at boot until you run: sudo loginctl enable-linger $RUN_USER"
  fi

  # When running over SSH or in a non-login session, $XDG_RUNTIME_DIR and
  # $DBUS_SESSION_BUS_ADDRESS may not be set, causing "systemctl --user" to
  # fail with "Failed to connect to user scope bus". Setting XDG_RUNTIME_DIR
  # to the standard path (/run/user/<uid>) is sufficient for systemd to locate
  # the user manager socket without a full D-Bus session.
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

  # The user manager starts asynchronously after enable-linger; give it a few
  # seconds to come up before talking to it.
  for _ in $(seq 1 20); do
    systemctl --user show-environment >/dev/null 2>&1 && break
    sleep 0.5
  done

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
    echo "NOTE: If 'systemctl --user' fails in a new SSH session with a D-Bus error,"
    echo "run this first (or add it to ~/.bashrc on this host):"
    echo "  export XDG_RUNTIME_DIR=/run/user/\$(id -u)"
    echo
    if [[ "$LINGER_OK" == true ]]; then
      echo "Lingering is enabled: the service starts at boot and keeps running while you're logged out."
    else
      echo "WARNING: lingering is NOT enabled, so the service stops when you log out. Fix with:"
      echo "  sudo loginctl enable-linger $RUN_USER"
    fi
    echo "For remote access from other devices, see the Tailscale section in README.md."
  else
    die "Service failed to start. Check: journalctl --user -u webtermux -e"
  fi
fi
