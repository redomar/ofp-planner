"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { COLLAPSE_KEY } from "@/lib/collapse-boot";

/**
 * Which page sections are collapsed. One list for every plan (and both pages; their
 * section ids don't overlap), kept in localStorage so hidden sections stay hidden.
 * The inline boot script in layout.tsx hides them before first paint.
 */
const CHANGE = "ofp-planner:collapsed-change";

function read(): string {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function write(ids: string[]) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: state still updates for this tab via the event below */
    memory = JSON.stringify(ids);
  }
  window.dispatchEvent(new Event(CHANGE));
}

let memory: string | null = null;

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => e.key === COLLAPSE_KEY && cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE, cb);
  };
}

interface CollapseApi {
  /** False until client storage has been read (server render / hydration). */
  ready: boolean;
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
  open: (id: string) => void;
  setAll: (ids: readonly string[], collapsed: boolean) => void;
}

const CollapseContext = createContext<CollapseApi>({
  ready: false,
  isCollapsed: () => false,
  toggle: () => {},
  open: () => {},
  setAll: () => {},
});

export const useCollapse = () => useContext(CollapseContext);

export function CollapseProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, () => memory ?? read(), () => null);
  const set = useMemo(() => {
    try {
      const v = JSON.parse(raw ?? "[]");
      return new Set<string>(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [raw]);

  // Once React reflects the stored state, drop the pre-paint style from the boot script.
  useEffect(() => {
    if (raw !== null) document.getElementById("opl-collapse-boot")?.remove();
  }, [raw]);

  const update = useCallback((fn: (s: Set<string>) => void) => {
    const next = new Set<string>(JSON.parse(memory ?? read()));
    fn(next);
    write([...next]);
  }, []);

  const api = useMemo<CollapseApi>(
    () => ({
      ready: raw !== null,
      isCollapsed: (id) => set.has(id),
      toggle: (id) => update((s) => (s.has(id) ? s.delete(id) : s.add(id))),
      open: (id) => {
        if (set.has(id)) update((s) => s.delete(id));
      },
      setAll: (ids, collapsed) => update((s) => ids.forEach((id) => (collapsed ? s.add(id) : s.delete(id)))),
    }),
    [raw, set, update],
  );

  return <CollapseContext.Provider value={api}>{children}</CollapseContext.Provider>;
}

/** Drafting-box toggle icon: boxed − when open (click collapses), boxed + when closed. */
export function BoxToggleIcon({ open, size = 12 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="box-toggle" shapeRendering="crispEdges">
      <rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor" />
      <path d={open ? "M3 6h6" : "M3 6h6M6 3v6"} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** "Collapse all" / "Expand all" for a list of section ids. */
export function CollapseAllButton({ ids, className }: { ids: readonly string[]; className?: string }) {
  const { isCollapsed, setAll } = useCollapse();
  const allClosed = ids.length > 0 && ids.every(isCollapsed);
  return (
    <button type="button" className={className} onClick={() => setAll(ids, !allClosed)} aria-label={allClosed ? "Expand all sections" : "Collapse all sections"}>
      <BoxToggleIcon open={!allClosed} /> {allClosed ? "Expand all" : "Collapse all"}
    </button>
  );
}
