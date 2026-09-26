import { useEffect, useState, useCallback, useRef } from "react";
import LoginPage from "./components/LoginPage";
import SessionSidebar from "./components/SessionSidebar";
import TerminalPane from "./components/TerminalPane";
import { api } from "./api";
import { useSessionsSocket } from "./hooks/useSessionsSocket";
import { type LayoutMode, type View, makeView, changeLayout, LAYOUT_PANE_COUNT } from "./types/layout";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 600;
const SIDEBAR_DEFAULT = 170;

// ── Layout picker icons (SVG) ─────────────────────────────────────────────────

function IconSingle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="14" height="14" rx="1" />
    </svg>
  );
}
function IconHSplit() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="6" height="14" rx="1" />
      <rect x="9" y="1" width="6" height="14" rx="1" />
    </svg>
  );
}
function IconVSplit() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="14" height="6" rx="1" />
      <rect x="1" y="9" width="14" height="6" rx="1" />
    </svg>
  );
}
function IconQuad() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

const LAYOUT_ICONS: Record<LayoutMode, React.ReactNode> = {
  single: <IconSingle />,
  hsplit: <IconHSplit />,
  vsplit: <IconVSplit />,
  quad:   <IconQuad />,
};
const LAYOUT_LABELS: Record<LayoutMode, string> = {
  single: "Single",
  hsplit:  "Split horizontal",
  vsplit:  "Split vertical",
  quad:    "Quad",
};
const LAYOUTS: LayoutMode[] = ["single", "hsplit", "vsplit", "quad"];

// ── ViewArea: renders the pane grid for one View ──────────────────────────────

function gridStyle(layout: LayoutMode): React.CSSProperties {
  switch (layout) {
    case "hsplit": return { display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr" };
    case "vsplit": return { display: "grid", gridTemplateColumns: "1fr", gridTemplateRows: "1fr 1fr" };
    case "quad":   return { display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" };
    default:       return { display: "flex" };
  }
}

interface ViewAreaProps {
  view: View;
  visible: boolean;
  onFocusPane: (idx: number) => void;
  onNeedSession: (paneIdx: number) => void; // pane clicked but has no session
}

function ViewArea({ view, visible, onFocusPane, onNeedSession }: ViewAreaProps) {
  return (
    <div
      className="absolute inset-0"
      style={{ ...gridStyle(view.layout), display: visible ? (view.layout === "single" ? "flex" : "grid") : "none" }}
    >
      {view.panes.map((sessionName, idx) => {
        const isFocused = view.focusedPane === idx;
        if (!sessionName) {
          return (
            <div
              key={idx}
              className={`relative flex min-h-0 min-w-0 flex-1 cursor-pointer items-center justify-center text-sm text-neutral-600 hover:text-neutral-400 ${
                isFocused ? "ring-1 ring-inset ring-emerald-600" : ""
              }`}
              style={{ backgroundColor: "#2b2b2b" }}
              onClick={() => { onFocusPane(idx); onNeedSession(idx); }}
            >
              Click a session to open here
            </div>
          );
        }
        return (
          <TerminalPane
            key={`${view.id}-${idx}-${sessionName}`}
            sessionName={sessionName}
            focused={isFocused}
            onFocus={() => onFocusPane(idx)}
          />
        );
      })}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [views, setViews] = useState<View[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const dragging = useRef(false);

  const sessions = useSessionsSocket(authenticated);

  useEffect(() => {
    api
      .checkSession()
      .then((r) => setAuthenticated(r.authenticated))
      .finally(() => setAuthChecked(true));

    api.info().then(({ hostname }) => {
      document.title = `${hostname} - webtermux`;
    }).catch(() => {/* leave default title */});
  }, []);

  // Null out pane slots for sessions that have disappeared externally.
  useEffect(() => {
    if (!authenticated) return;
    const names = new Set(sessions.map((s) => s.name));
    setViews((prev) =>
      prev.map((v) => ({
        ...v,
        panes: v.panes.map((p) => (p && names.has(p) ? p : null)),
      }))
    );
  }, [sessions, authenticated]);

  const onSidebarDragStart = useCallback((e: React.MouseEvent) => {
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

  const activeView = views.find((v) => v.id === activeViewId) ?? null;

  // Open a session into the focused pane of the active view, or create a new single view.
  const openSession = (name: string) => {
    if (!activeView) {
      const v = makeView("single", name);
      setViews([v]);
      setActiveViewId(v.id);
      return;
    }
    setViews((prev) =>
      prev.map((v) =>
        v.id === activeView.id
          ? { ...v, panes: v.panes.map((p, i) => (i === v.focusedPane ? name : p)) }
          : v
      )
    );
  };

  const newView = (layout: LayoutMode = "single") => {
    const v = makeView(layout);
    setViews((prev) => [...prev, v]);
    setActiveViewId(v.id);
  };

  const closeView = (id: string) => {
    setViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      if (activeViewId === id) {
        setActiveViewId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  };

  const setViewLayout = (id: string, layout: LayoutMode) => {
    setViews((prev) => prev.map((v) => (v.id === id ? changeLayout(v, layout) : v)));
  };

  const focusPane = (viewId: string, paneIdx: number) => {
    setViews((prev) =>
      prev.map((v) => (v.id === viewId ? { ...v, focusedPane: paneIdx } : v))
    );
  };

  const handleCreate = async (name: string) => {
    try {
      const res = await api.createSession(name || undefined);
      openSession(res.name);
    } catch (err: any) {
      alert(err.message ?? "Failed to create session");
    }
  };

  const handleRename = async (oldName: string, newName: string) => {
    try {
      await api.renameSession(oldName, newName);
      setViews((prev) =>
        prev.map((v) => ({
          ...v,
          panes: v.panes.map((p) => (p === oldName ? newName : p)),
        }))
      );
    } catch (err: any) {
      alert(err.message ?? "Failed to rename session");
    }
  };

  const handleKill = async (name: string) => {
    try {
      await api.killSession(name);
      // Pane slots will be nulled by the sessions effect above.
    } catch (err: any) {
      alert(err.message ?? "Failed to kill session");
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setAuthenticated(false);
  };

  // All session names currently open in any pane across all views.
  const openNames = new Set(views.flatMap((v) => v.panes.filter(Boolean) as string[]));

  return (
    <div className="flex h-full w-full">
      <SessionSidebar
        width={sidebarWidth}
        sessions={sessions}
        openNames={[...openNames]}
        activeName={activeView?.panes[activeView.focusedPane] ?? null}
        onOpen={openSession}
        onCreate={handleCreate}
        onRename={handleRename}
        onKill={handleKill}
        onLogout={handleLogout}
      />

      {/* Sidebar drag handle */}
      <div
        onMouseDown={onSidebarDragStart}
        className="z-10 w-1 flex-none cursor-col-resize bg-neutral-800 hover:bg-emerald-600 active:bg-emerald-500"
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Tab bar */}
        <div className="flex items-stretch border-b border-neutral-800 bg-neutral-900">
          {/* View tabs */}
          <div className="flex flex-1 overflow-x-auto">
            {views.map((v) => {
              const label = v.panes.filter(Boolean).join(" | ") || "empty";
              const isActive = v.id === activeViewId;
              return (
                <div
                  key={v.id}
                  onClick={() => setActiveViewId(v.id)}
                  className={`flex cursor-pointer items-center gap-2 border-r border-neutral-800 px-3 py-1.5 text-sm whitespace-nowrap ${
                    isActive
                      ? "bg-neutral-950 text-neutral-100"
                      : "text-neutral-400 hover:bg-neutral-800/60"
                  }`}
                >
                  <span className="text-neutral-500">{LAYOUT_ICONS[v.layout]}</span>
                  <span className="max-w-[160px] truncate">{label}</span>
                  <button
                    className="text-neutral-500 hover:text-neutral-200"
                    onClick={(e) => { e.stopPropagation(); closeView(v.id); }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            {/* New view button */}
            <button
              onClick={() => newView("single")}
              className="px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-200"
              title="New tab"
            >
              +
            </button>
          </div>

          {/* Layout picker — only shown when a view is active */}
          {activeView && (
            <div className="flex items-center gap-0.5 border-l border-neutral-800 px-2">
              {LAYOUTS.map((mode) => (
                <button
                  key={mode}
                  title={LAYOUT_LABELS[mode]}
                  onClick={() => setViewLayout(activeView.id, mode)}
                  className={`rounded p-1 ${
                    activeView.layout === mode
                      ? "text-emerald-400"
                      : "text-neutral-500 hover:text-neutral-200"
                  }`}
                >
                  {LAYOUT_ICONS[mode]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Terminal area */}
        <div className="relative min-h-0 flex-1 overflow-hidden" style={{ backgroundColor: "#2b2b2b" }}>
          {views.length === 0 && (
            <div className="flex h-full items-center justify-center text-neutral-600">
              Select or create a session to get started.
            </div>
          )}
          {views.map((v) => (
            <ViewArea
              key={v.id}
              view={v}
              visible={v.id === activeViewId}
              onFocusPane={(idx) => focusPane(v.id, idx)}
              onNeedSession={(idx) => {
                // Focus the pane so the next sidebar click goes here
                focusPane(v.id, idx);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
