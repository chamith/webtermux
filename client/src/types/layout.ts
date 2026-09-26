// Layout modes — how many panes and how they're arranged.
// single:  1 pane  (full area)
// hsplit:  2 panes (left | right)
// vsplit:  2 panes (top / bottom)
// quad:    4 panes (2×2 grid)
export type LayoutMode = "single" | "hsplit" | "vsplit" | "quad";

// Number of pane slots for each layout.
export const LAYOUT_PANE_COUNT: Record<LayoutMode, number> = {
  single: 1,
  hsplit: 2,
  vsplit: 2,
  quad: 4,
};

// A View is one entry in the tab bar: a layout mode + one session name per pane slot.
// Slots are null when no session has been assigned yet.
export interface View {
  id: string;           // stable identity for React keys
  layout: LayoutMode;
  panes: (string | null)[];  // length always === LAYOUT_PANE_COUNT[layout]
  focusedPane: number;       // index of the currently focused pane (0-based)
}

function randomId(): string {
  // crypto.randomUUID() requires a secure context (HTTPS/localhost).
  // Fall back to a manual implementation for plain HTTP origins.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Create a new View with the given layout, all pane slots empty.
export function makeView(layout: LayoutMode = "single", firstSession?: string): View {
  const count = LAYOUT_PANE_COUNT[layout];
  const panes: (string | null)[] = Array(count).fill(null);
  if (firstSession !== undefined) panes[0] = firstSession;
  return {
    id: randomId(),
    layout,
    panes,
    focusedPane: 0,
  };
}

// Change a view's layout, preserving as many existing pane sessions as possible.
export function changeLayout(view: View, layout: LayoutMode): View {
  const count = LAYOUT_PANE_COUNT[layout];
  const panes: (string | null)[] = Array(count).fill(null);
  for (let i = 0; i < count; i++) {
    panes[i] = view.panes[i] ?? null;
  }
  return {
    ...view,
    layout,
    panes,
    focusedPane: Math.min(view.focusedPane, count - 1),
  };
}
