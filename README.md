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

## Setup

Requires `tmux` on the host:

```bash
sudo apt install -y tmux
```

Generate a login password hash and a session secret:

```bash
cd server && npm install
npm run hash-password -- 'your-password-here'
openssl rand -hex 32
```

Create `.env` in the project root (see [.env.example](.env.example)):

```
ADMIN_PASSWORD_HASH=<bcrypt hash from above>
SESSION_SECRET=<random hex from above>
```

Build both apps:

```bash
(cd server && npm install && npm run build)
(cd client && npm install && npm run build)
```

## Running it

**Quick start** (foreground, for trying it out):

```bash
cd server && npm start
```

Open `http://localhost:3000`.

**Persistent (recommended)** — run it as a systemd user service so it
survives logout/crashes and starts automatically:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/webtermux.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now webtermux
```

Check it's up: `systemctl --user status webtermux`, logs via
`journalctl --user -u webtermux -f`.

To also have it start on boot without needing to log in first:

```bash
loginctl enable-linger $USER
```

**Persistence note:** tmux is its own daemon process, independent of the
Node server — restarting/crashing the web app (or `systemctl restart`) never
touches your tmux sessions. Only a full host reboot ends them, same as any
tmux session would.

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
