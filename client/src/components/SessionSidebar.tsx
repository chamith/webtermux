import { useRef, useState } from "react";
import type { TmuxSession } from "../api";

interface Props {
  sessions: TmuxSession[];
  openNames: string[];
  activeName: string | null;
  onOpen: (name: string) => void;
  onCreate: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onKill: (name: string) => void;
  onLogout: () => void;
}

export default function SessionSidebar({
  sessions,
  openNames,
  activeName,
  onOpen,
  onCreate,
  onRename,
  onKill,
  onLogout,
}: Props) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const newNameInputRef = useRef<HTMLInputElement>(null);

  const submitCreate = () => {
    onCreate(newName.trim());
    setNewName("");
    newNameInputRef.current?.blur();
  };

  const startRename = (name: string) => {
    setRenaming(name);
    setRenameValue(name);
  };

  const submitRename = () => {
    if (renaming && renameValue.trim() && renameValue.trim() !== renaming) {
      onRename(renaming, renameValue.trim());
    }
    setRenaming(null);
  };

  return (
    <div className="flex h-full w-64 flex-col border-r border-neutral-800 bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="text-sm font-semibold text-neutral-300">Sessions</span>
        <button
          onClick={onLogout}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          Log out
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <p className="px-3 py-4 text-sm text-neutral-500">No sessions yet.</p>
        )}
        {sessions.map((s) => {
          const isOpen = openNames.includes(s.name);
          const isActive = activeName === s.name;
          return (
            <div
              key={s.name}
              className={`group flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${
                isActive ? "bg-neutral-800" : "hover:bg-neutral-800/60"
              }`}
              onClick={() => onOpen(s.name)}
            >
              {renaming === s.name ? (
                <input
                  autoFocus
                  className="w-full rounded bg-neutral-950 px-1 py-0.5 text-neutral-100 outline-none ring-1 ring-neutral-700"
                  value={renameValue}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <span
                  className="truncate text-neutral-200"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(s.name);
                  }}
                  title="Double-click to rename"
                >
                  <span
                    className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${
                      s.attached ? "bg-emerald-500" : "bg-neutral-600"
                    }`}
                  />
                  {s.name}
                  {isOpen && <span className="ml-1 text-xs text-neutral-500">(open)</span>}
                </span>
              )}
              <button
                className="ml-2 hidden text-neutral-500 hover:text-red-400 group-hover:block"
                title="Kill session"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Kill session "${s.name}"?`)) onKill(s.name);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-neutral-800 p-2">
        <div className="flex gap-1">
          <input
            className="w-full rounded bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none ring-1 ring-neutral-700 placeholder:text-neutral-600"
            ref={newNameInputRef}
            placeholder="New session name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
            }}
          />
          <button
            onClick={submitCreate}
            className="rounded bg-emerald-700 px-2 py-1 text-sm font-medium text-white hover:bg-emerald-600"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
