import type { WebSocket } from "ws";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";
import { config } from "./config";
import { hasSession } from "./tmux";

const execFileAsync = promisify(execFile);

interface ClientMessage {
  type: "resize" | "scroll";
  cols?: number;
  rows?: number;
  lines?: number;
}

function tmux(...args: string[]): Promise<void> {
  return execFileAsync("tmux", ["-L", config.tmuxSocketName, ...args])
    .then(() => {})
    .catch(() => {}); // best-effort
}

export async function attachTerminal(ws: WebSocket, sessionName: string, cols = 80, rows = 24): Promise<void> {
  if (!(await hasSession(sessionName))) {
    ws.send(JSON.stringify({ type: "error", message: `Session "${sessionName}" does not exist.` }));
    ws.close();
    return;
  }

  const ptyProcess = pty.spawn(
    "tmux",
    ["-L", config.tmuxSocketName, "attach-session", "-t", sessionName],
    {
      name: "xterm-256color",
      cols,
      rows,
      env: process.env as Record<string, string>,
    },
  );

  // Disable tmux mouse mode so it doesn't send escape sequences back as junk.
  setTimeout(() => tmux("set-option", "-t", sessionName, "mouse", "off"), 200);

  const onData = ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      // Strip any residual mouse escape sequences.
      const clean = data.replace(/\x1b\[M.{3}/g, "").replace(/\x1b\[<[\d;]+[Mm]/g, "");
      if (clean.length > 0) ws.send(clean);
    }
  });

  const onExit = ptyProcess.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close();
  });

  // Serialise scroll operations to avoid race conditions between
  // copy-mode entry and scroll-up/scroll-down commands.
  let scrollQueue = Promise.resolve();

  // Check if the session is currently in copy-mode.
  const isInCopyMode = (): Promise<boolean> =>
    execFileAsync("tmux", ["-L", config.tmuxSocketName, "display-message", "-t", sessionName, "-p", "#{pane_in_mode}"])
      .then(({ stdout }) => stdout.trim() === "1")
      .catch(() => false);

  const exitCopyMode = async () => {
    if (await isInCopyMode()) {
      await tmux("send-keys", "-t", sessionName, "-X", "cancel");
    }
  };

  const enqueueScroll = (lines: number) => {
    scrollQueue = scrollQueue.then(async () => {
      const count = Math.abs(lines);
      if (lines < 0) {
        // Scroll up: enter copy-mode (if not already), then scroll.
        if (!(await isInCopyMode())) {
          await tmux("copy-mode", "-t", sessionName);
        }
        for (let i = 0; i < count; i++) {
          await tmux("send-keys", "-t", sessionName, "-X", "scroll-up");
        }
      } else {
        // Scroll down.
        for (let i = 0; i < count; i++) {
          await tmux("send-keys", "-t", sessionName, "-X", "scroll-down");
        }
      }
    });
  };

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      // Keystroke — exit copy-mode first, then pass through to pty.
      scrollQueue = scrollQueue.then(() => exitCopyMode()).then(() => {
        ptyProcess.write(raw.toString("utf8"));
      });
      return;
    }
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === "resize" && msg.cols && msg.rows) {
        ptyProcess.resize(msg.cols, msg.rows);
      } else if (msg.type === "scroll" && msg.lines) {
        enqueueScroll(msg.lines);
      }
    } catch {
      // ignore malformed frames
    }
  });

  ws.on("close", () => {
    onData.dispose();
    onExit.dispose();
    ptyProcess.kill();
  });
}
