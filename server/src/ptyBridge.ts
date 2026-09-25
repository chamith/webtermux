import type { WebSocket } from "ws";
import * as pty from "node-pty";
import { config } from "./config";
import { hasSession } from "./tmux";

interface ClientMessage {
  type: "resize";
  cols?: number;
  rows?: number;
}

export async function attachTerminal(ws: WebSocket, sessionName: string): Promise<void> {
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
      cols: 80,
      rows: 24,
      env: process.env as Record<string, string>,
    },
  );

  const onData = ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  const onExit = ptyProcess.onExit(() => {
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      // Keystrokes are sent as binary frames so they never need escaping/parsing.
      ptyProcess.write(raw.toString("utf8"));
      return;
    }
    // Non-binary (text) frames are control messages, e.g. terminal resize.
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === "resize" && msg.cols && msg.rows) {
        ptyProcess.resize(msg.cols, msg.rows);
      }
    } catch {
      // ignore malformed control frames
    }
  });

  ws.on("close", () => {
    onData.dispose();
    onExit.dispose();
    // Kills only this attach client — equivalent to `tmux detach`, the session itself lives on.
    ptyProcess.kill();
  });
}
