import { useEffect, useRef, useState } from "react";
import { sessionsSocketUrl, type TmuxSession } from "../api";

export function useSessionsSocket(enabled: boolean): TmuxSession[] {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let closedByEffect = false;
    let ws: WebSocket;

    const connect = () => {
      ws = new WebSocket(sessionsSocketUrl());
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "sessions") setSessions(msg.sessions);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (!closedByEffect) {
          retryTimer.current = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      ws?.close();
    };
  }, [enabled]);

  return sessions;
}
