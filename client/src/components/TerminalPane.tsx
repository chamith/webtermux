import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { terminalSocketUrl } from "../api";

interface Props {
  sessionName: string;
  focused: boolean;       // whether this pane is the focused one (gets focus ring + keyboard)
  onFocus: () => void;    // called when user clicks the pane
}

export default function TerminalPane({ sessionName, focused, onFocus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "monospace",
      lineHeight: 1.125,
      theme: { background: "#2b2b2b", foreground: "#d0d0d0" },
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    termRef.current = term;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    // Fit before opening the WebSocket so the pty is spawned at the correct size.
    fitAddon.fit();
    if (focused) term.focus();

    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let everConnected = false;

    const sendResize = () => {
      fitAddon.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    const connect = () => {
      ws = new WebSocket(terminalSocketUrl(sessionName, term.cols, term.rows));
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (everConnected) term.write("\r\n\x1b[90m[reconnected]\x1b[0m\r\n");
        everConnected = true;
        sendResize();
      };
      ws.onmessage = (event) => {
        const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
        term.write(typeof data === "string" ? data : new TextDecoder().decode(data));
      };
      ws.onclose = () => {
        if (cancelled) return;
        term.write("\r\n\x1b[90m[disconnected — reconnecting...]\x1b[0m\r\n");
        retryTimer = setTimeout(connect, 1500);
      };
    };
    connect();

    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => setTimeout(sendResize, 0));
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      inputDisposable.dispose();
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName]);

  useEffect(() => {
    if (focused) {
      requestAnimationFrame(() =>
        setTimeout(() => {
          fitAddonRef.current?.fit();
          termRef.current?.focus();
        }, 0)
      );
    }
  }, [focused]);

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      style={{ backgroundColor: "#2b2b2b" }}
      onMouseDown={onFocus}
    >
      {/* Focus ring to indicate the active pane in splits */}
      {focused && (
        <div className="pointer-events-none absolute inset-0 z-10 ring-1 ring-inset ring-emerald-600" />
      )}
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden p-1"
        style={{ backgroundColor: "#2b2b2b", flexDirection: "column" }}
      />
    </div>
  );
}
