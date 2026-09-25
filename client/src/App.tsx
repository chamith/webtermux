import { useEffect, useState, useCallback, useRef } from "react";
import LoginPage from "./components/LoginPage";
import SessionSidebar from "./components/SessionSidebar";
import TerminalTab from "./components/TerminalTab";
import { api } from "./api";
import { useSessionsSocket } from "./hooks/useSessionsSocket";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 600;
const SIDEBAR_DEFAULT = 170;

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [openNames, setOpenNames] = useState<string[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const dragging = useRef(false);

  const sessions = useSessionsSocket(authenticated);

  useEffect(() => {
    api
      .checkSession()
      .then((r) => setAuthenticated(r.authenticated))
      .finally(() => setAuthChecked(true));
  }, []);

  // Drop tabs for sessions that no longer exist (e.g. killed from elsewhere).
  useEffect(() => {
    if (!authenticated) return;
    const names = new Set(sessions.map((s) => s.name));
    setOpenNames((prev) => prev.filter((n) => names.has(n)));
    setActiveName((prev) => (prev && names.has(prev) ? prev : null));
  }, [sessions, authenticated]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  if (!authChecked) return null;
  if (!authenticated) {
    return <LoginPage onLoggedIn={() => setAuthenticated(true)} />;
  }

  const openTab = (name: string) => {
    setOpenNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setActiveName(name);
  };

  const closeTab = (name: string) => {
    setOpenNames((prev) => prev.filter((n) => n !== name));
    setActiveName((prev) => (prev === name ? null : prev));
  };

  const handleCreate = async (name: string) => {
    try {
      const res = await api.createSession(name || undefined);
      openTab(res.name);
    } catch (err: any) {
      alert(err.message ?? "Failed to create session");
    }
  };

  const handleRename = async (oldName: string, newName: string) => {
    try {
      await api.renameSession(oldName, newName);
      setOpenNames((prev) => prev.map((n) => (n === oldName ? newName : n)));
      setActiveName((prev) => (prev === oldName ? newName : prev));
    } catch (err: any) {
      alert(err.message ?? "Failed to rename session");
    }
  };

  const handleKill = async (name: string) => {
    try {
      await api.killSession(name);
      closeTab(name);
    } catch (err: any) {
      alert(err.message ?? "Failed to kill session");
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setAuthenticated(false);
  };

  return (
    <div className="flex h-full w-full">
      <SessionSidebar
        width={sidebarWidth}
        sessions={sessions}
        openNames={openNames}
        activeName={activeName}
        onOpen={openTab}
        onCreate={handleCreate}
        onRename={handleRename}
        onKill={handleKill}
        onLogout={handleLogout}
      />
      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        className="group relative z-10 w-1 flex-none cursor-col-resize bg-neutral-800 hover:bg-emerald-600 active:bg-emerald-500"
        title="Drag to resize"
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {openNames.length > 0 && (
          <div className="flex border-b border-neutral-800 bg-neutral-900">
            {openNames.map((name) => (
              <div
                key={name}
                onClick={() => setActiveName(name)}
                className={`flex cursor-pointer items-center gap-2 border-r border-neutral-800 px-3 py-1.5 text-sm ${
                  activeName === name
                    ? "bg-neutral-950 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-800/60"
                }`}
              >
                {name}
                <button
                  className="text-neutral-500 hover:text-neutral-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(name);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden" style={{ backgroundColor: "#2b2b2b" }}>
          {openNames.length === 0 && (
            <div className="flex h-full items-center justify-center text-neutral-600">
              Select or create a session to get started.
            </div>
          )}
          {openNames.map((name) => (
            <TerminalTab key={name} sessionName={name} active={name === activeName} />
          ))}
        </div>
      </div>
    </div>
  );
}
