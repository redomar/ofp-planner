"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { applyTheme, readTheme } from "@/lib/storage";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="OFP Planner home">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="13" cy="13" r="11" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M5 17 C 9 7, 17 7, 21 17" fill="none" stroke="var(--magenta)" strokeWidth="2" strokeDasharray="2.5 2" />
        <circle cx="5" cy="17" r="2.2" fill="currentColor" />
        <circle cx="21" cy="17" r="2.2" fill="currentColor" />
      </svg>
      <span>OFP Planner</span>
    </Link>
  );
}

export function ThemeToggle() {
  const toggle = () => {
    const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const pref = readTheme();
    const current = pref === "system" ? (sysDark ? "dark" : "light") : pref;
    applyTheme(current === "dark" ? "light" : "dark");
  };
  return (
    <button className="btn btn-icon" type="button" onClick={toggle} aria-label="Toggle day / night theme" title="Toggle day / night">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1v14" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 1a7 7 0 0 1 0 14z" fill="currentColor" />
      </svg>
    </button>
  );
}

const ICONS = {
  finder: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5.5 5.5" />
    </>
  ),
  journeys: (
    <>
      <circle cx="5" cy="18" r="2.2" />
      <circle cx="12" cy="7" r="2.2" />
      <circle cx="19" cy="16" r="2.2" />
      <path d="M6.3 16.1 10.7 8.9M13.6 8.6l4.2 5.6" strokeDasharray="2.2 1.8" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M6.5 9.5h4M13 9.5h4.5M6.5 14.5h4M13 14.5h4.5" />
    </>
  ),
  brief: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </>
  ),
  logbook: (
    <>
      <path d="M6 3.5h11.5a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 6 3.5z" />
      <path d="M8.5 3.5v17M11.5 9.5l2.2 1.2 2.6-3.2M11.5 14.5h4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
};

/** The pages as tabs in the top bar; the current one is marked. */
export function PageNav({ finderHref = "/" }: { finderHref?: string }) {
  const path = (usePathname() ?? "/").replace(/\/$/, "") || "/";
  const tabs = [
    ["finder", "Finder", finderHref, "/"],
    ["journeys", "Journeys", "/journeys", "/journeys"],
    ["board", "Board", "/board", "/board"],
    ["brief", "Brief", "/brief", "/brief"],
    ["logbook", "Logbook", "/logbook", "/logbook"],
    ["settings", "Settings", "/settings", "/settings"],
  ] as const;
  return (
    <nav className="pagenav" aria-label="Pages">
      {tabs.map(([k, label, href, at]) => (
        <Link key={k} href={href} className="pagenav-tab" aria-current={path === at ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            {ICONS[k]}
          </svg>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function TopBar({ children, finderHref }: { children?: ReactNode; finderHref?: string }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <PageNav finderHref={finderHref} />
        <div className="topbar-end">
          {children}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/** Fixed-height line under the top bar: what's loaded, or progress with a thin bar. */
export function StatusLine({ children, progress }: { children: ReactNode; progress?: number | null }) {
  return (
    <div className="statusline" role="status">
      <div className="statusline-inner">{children}</div>
      {progress != null && progress < 1 && (
        <div className="statusline-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
        </div>
      )}
    </div>
  );
}
