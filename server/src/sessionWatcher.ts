import type { WebSocket } from "ws";
import { listSessions, type TmuxSession } from "./tmux";

const POLL_INTERVAL_MS = 1500;

export class SessionWatcher {
  private clients = new Set<WebSocket>();
  private lastSnapshot = "";
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.poll().catch((err) => console.error("session poll failed:", err));
    }, POLL_INTERVAL_MS);
    this.poll().catch((err) => console.error("session poll failed:", err));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
    // Send current state immediately on connect.
    if (this.lastSnapshot) {
      ws.send(this.lastSnapshot);
    } else {
      this.poll().catch((err) => console.error("session poll failed:", err));
    }
  }

  private async poll(): Promise<void> {
    const sessions: TmuxSession[] = await listSessions();
    const snapshot = JSON.stringify({ type: "sessions", sessions });
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(snapshot);
      }
    }
  }
}

export const sessionWatcher = new SessionWatcher();
