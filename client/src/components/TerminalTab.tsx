import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { terminalSocketUrl } from "../api";

interface Props {
  sessionName: string;
  active: boolean;
}

export default function TerminalTab({ sessionName, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "Menlo, Consolas, 'Liberation Mono', monospace",
      theme: { background: "#0a0a0a" },
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    termRef.current = term;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    // Fit before opening the WebSocket so the pty is spawned at the correct
    // size rather than the default 80×24.
    fitAddon.fit();
    if (active) term.focus();

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
      // Read dimensions after fit so the pty is spawned at the right size.
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

    // Defer ResizeObserver callback so the browser finishes layout before
    // FitAddon measures the container dimensions.
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
    if (active) {
      // Two-step defer: rAF waits for React's paint, setTimeout waits for
      // the browser to finish layout of the now-visible container before
      // measuring dimensions for fit.
      requestAnimationFrame(() =>
        setTimeout(() => {
          fitAddonRef.current?.fit();
          termRef.current?.focus();
        }, 0)
      );
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden p-2 ${active ? "flex" : "hidden"}`}
      style={{ flexDirection: "column" }}
    />
  );
}
