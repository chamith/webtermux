# Webtermux

A small web app for managing multiple named terminal sessions in your browser —
like `tmux` + `ttyd`, but with a UI for creating, listing, attaching to,
renaming, and killing sessions instead of typing tmux commands.

Sessions are real `tmux` sessions **on this host machine** (on a private
socket, `-L webterm`), so they're your actual host shells — they keep running,
with your real files/tools/environment, even if the web app restarts.

## How it works

- The server manages tmux sessions on the host (via a private tmux socket)
  and exposes them over a small REST API + WebSocket.
- Opening a session in the browser spawns a `tmux attach-session` process and
  streams it to an `xterm.js` terminal over WebSocket. Closing the browser tab
  just detaches (like closing a tmux client) — the session and its shell state
  keep running.
- The sidebar's session list updates live (polls tmux every ~1.5s server-side,
  pushes changes to all connected browsers).
- The server runs directly on the host (not in a container) specifically so
  tmux sessions are real host sessions with your actual environment — not
  sandboxed inside a container's filesystem.

## Install (new server)

Requires Node.js 18+ already on the host (e.g. via
[nvm](https://github.com/nvm-sh/nvm)) and a Debian/Ubuntu host (`apt`). Clone
the repo onto the server, then:

```bash
./install.sh
```

This installs `tmux` and native-build tooling (prompts for `sudo`), builds
the server and client, walks you through setting a login password (writing
`.env`), and installs + starts a systemd **user** service (`webtermux`) so it
survives logout and crashes and starts on boot. Safe to re-run — it skips
`.env` generation if one already exists.

When it finishes, open `http://<server>:3000`. Manage the service with:

```bash
systemctl --user status webtermux
systemctl --user restart webtermux
journalctl --user -u webtermux -f
```

To also have it start on boot without needing to log in first:

```bash
loginctl enable-linger $USER
```

**Persistence note:** tmux is its own daemon process, independent of the
Node server — restarting/crashing the web app (or `systemctl restart`) never
touches your tmux sessions. Only a full host reboot ends them, same as any
tmux session would. (The service's `KillMode=process` is what makes this
work — see [deploy/webtermux.service.template](deploy/webtermux.service.template).)

### Manual setup

If you're not on apt, or want more control than `install.sh` gives you:

```bash
sudo apt install -y tmux build-essential python3   # or your distro's equivalent
(cd server && npm install && npm run build)
(cd client && npm install && npm run build)

cd server && npm run hash-password -- 'your-password-here'   # -> bcrypt hash
openssl rand -hex 32                                          # -> session secret
```

Create `.env` in the project root (see [.env.example](.env.example)) with
those two values, then run it in the foreground to try it out:

```bash
cd server && npm start   # http://localhost:3000
```

Or install it as a systemd user service yourself, filling in the template's
placeholders (`install.sh` does exactly this):

```bash
mkdir -p ~/.config/systemd/user
sed -e "s#__PROJECT_DIR__#$(pwd)#g" -e "s#__NODE_BIN__#$(command -v node)#g" \
  deploy/webtermux.service.template > ~/.config/systemd/user/webtermux.service
systemctl --user daemon-reload
systemctl --user enable --now webtermux
```

## Development

```bash
cd server && npm run dev      # API + WS on :3000, hot reload
cd client && npm run dev      # Vite dev server, proxies /api and /ws to :3000
```

Open the Vite dev URL it prints (typically `http://localhost:5173`).

## Remote access (from anywhere) via Tailscale

This app has no built-in public HTTPS/exposure — the recommended way to reach
it from anywhere is [Tailscale](https://tailscale.com/), which needs no public
port, no TLS certs, and no reverse proxy:

1. Install Tailscale on this host and join it to your tailnet.
2. Access the app at `http://<tailscale-machine-name>:3000` from any other
   device on your tailnet.

If you'd rather expose it publicly with a real domain/TLS instead, put a
reverse proxy (e.g. Caddy) in front of port 3000 — the app works fine behind
one as-is.

## Notes / limitations (v1)

- Single user, single shared password (no per-user accounts).
- Session names: letters, numbers, `-`, `_` only.
- Manages sessions, not individual tmux windows/panes — one shell per session.
- The server runs as your own user, with full access to your host account —
  same trust model as giving yourself an SSH login, so treat the login
  password and `.env` (gitignored) accordingly.
