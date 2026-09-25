import http from "node:http";
import path from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import { config } from "./config";
import { checkPassword, makeSessionCookie, clearSessionCookie, requireAuth, isRequestAuthenticated } from "./auth";
import {
  createSession,
  killSession,
  renameSession,
  listSessions,
  nextAutoName,
  InvalidSessionNameError,
  SessionExistsError,
  SessionNotFoundError,
} from "./tmux";
import { sessionWatcher } from "./sessionWatcher";
import { attachTerminal } from "./ptyBridge";

const app = express();
app.use(express.json());

app.post("/api/login", async (req, res) => {
  const { password } = req.body ?? {};
  if (typeof password !== "string" || !(await checkPassword(password))) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  res.setHeader("Set-Cookie", makeSessionCookie());
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

app.get("/api/session-check", (req, res) => {
  res.json({ authenticated: isRequestAuthenticated(req.headers.cookie) });
});

const api = express.Router();
api.use(requireAuth);

api.get("/sessions", async (_req, res) => {
  res.json({ sessions: await listSessions() });
});

api.post("/sessions", async (req, res) => {
  try {
    const name = (req.body?.name as string | undefined)?.trim() || (await nextAutoName());
    await createSession(name);
    res.json({ ok: true, name });
  } catch (err: any) {
    if (err instanceof InvalidSessionNameError || err instanceof SessionExistsError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

api.patch("/sessions/:name", async (req, res) => {
  try {
    const newName = (req.body?.newName as string | undefined)?.trim();
    if (!newName) {
      res.status(400).json({ error: "newName is required" });
      return;
    }
    await renameSession(req.params.name, newName);
    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof InvalidSessionNameError || err instanceof SessionExistsError || err instanceof SessionNotFoundError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to rename session" });
  }
});

api.delete("/sessions/:name", async (req, res) => {
  try {
    await killSession(req.params.name);
    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof SessionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to kill session" });
  }
});

app.use("/api", api);
app.use(express.static(config.staticDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(config.staticDir, "index.html"));
});

const server = http.createServer(app);

const sessionsWss = new WebSocketServer({ noServer: true });
sessionsWss.on("connection", (ws) => sessionWatcher.addClient(ws));

const terminalWss = new WebSocketServer({ noServer: true });
terminalWss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const match = url.pathname.match(/^\/ws\/terminal\/([^/?]+)/);
  const name = match ? decodeURIComponent(match[1]) : null;
  if (!name) {
    ws.close();
    return;
  }
  const cols = Math.max(1, Number(url.searchParams.get("cols")) || 80);
  const rows = Math.max(1, Number(url.searchParams.get("rows")) || 24);
  attachTerminal(ws, name, cols, rows).catch((err) => {
    console.error("attachTerminal failed:", err);
    ws.close();
  });
});

server.on("upgrade", (req, socket, head) => {
  if (!isRequestAuthenticated(req.headers.cookie)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const url = req.url ?? "";
  if (url === "/ws/sessions") {
    sessionsWss.handleUpgrade(req, socket, head, (ws) => sessionsWss.emit("connection", ws, req));
  } else if (url.startsWith("/ws/terminal/")) {
    terminalWss.handleUpgrade(req, socket, head, (ws) => terminalWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

sessionWatcher.start();

server.listen(config.port, () => {
  console.log(`webtermux server listening on :${config.port}`);
});
