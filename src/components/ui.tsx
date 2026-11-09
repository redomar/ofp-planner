"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useCollapse } from "./collapse";
import { Replay } from "./replay";
const isBlank = (v: string) => v.trim() === "";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

/** Hover/focus explanation. Keyboard-focusable; described for screen readers. */
export function Tip({
  tip,
  title,
  children,
  className,
  plain,
}: {
  tip: string | null | undefined;
  title?: string;
  children: ReactNode;
  className?: string;
  plain?: boolean;
}) {
  const id = useId();
  if (!tip) return <span className={className}>{children}</span>;
  return (
    <>
      <span
        className={cx("tip", plain && "tip-plain", className)}
        tabIndex={0}
        data-tip={tip}
        data-tip-title={title}
        aria-describedby={id}
      >
        {children}
      </span>
      <span id={id} hidden>
        {title ? `${title}: ` : ""}
        {tip}
      </span>
    </>
  );
}

/** A value slot: shows the value, or an empty dotted blank like an unfilled form. */
export function V({ v, w = 4, className, style }: { v: ReactNode; w?: number; className?: string; style?: CSSProperties }) {
  const empty = v == null || v === "" || (typeof v === "string" && isBlank(v));
  if (empty)
    return (
      <span className={cx("v v-empty", className)} style={{ ["--w" as string]: w, ...style }}>
        <span className="sr-only">blank</span>
      </span>
    );
  return (
    <span className={cx("v", className)} style={style}>
      {v}
    </span>
  );
}

export function Field({
  label,
  tip,
  children,
  sub,
  className,
  style,
}: {
  label: string;
  tip?: string | null;
  children: ReactNode;
  sub?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cx("field", className)} style={style}>
      <span className="field-label">
        <Tip tip={tip} title={label}>
          {label}
        </Tip>
      </span>
      <div className="field-value">
        {children}
        {sub != null && sub !== false && <span className="field-sub">{sub}</span>}
      </div>
    </div>
  );
}

/**
 * A page section ("sheet"). The whole header strip is the collapse toggle; there is
 * no caret on it (the Contents rail shows state). Collapsed bodies use
 * hidden="until-found", so the browser's find-in-page still reaches and reopens them.
 */
export function Section({
  id,
  no,
  title,
  meta,
  children,
}: {
  id: string;
  no: number;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const { isCollapsed, toggle, open } = useCollapse();
  const collapsed = isCollapsed(id);
  const bodyRef = useRef<HTMLDivElement>(null);

  // React only writes `hidden` as a boolean, so set "until-found" directly; browsers
  // without support treat it as plain hidden.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (collapsed) el.setAttribute("hidden", "until-found");
    else el.removeAttribute("hidden");
  }, [collapsed]);

  // Find-in-page match inside a collapsed section: expand it.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onMatch = () => open(id);
    el.addEventListener("beforematch", onMatch);
    return () => el.removeEventListener("beforematch", onMatch);
  }, [id, open]);

  return (
    <section id={id} className={cx("sheet", collapsed && "is-collapsed")} aria-labelledby={`${id}-h`} style={{ ["--sec" as string]: no }}>
      <h2 className="sheet-heading">
        <button type="button" className="sheet-head" aria-expanded={!collapsed} aria-controls={`${id}-body`} onClick={() => toggle(id)}>
          <span className="sheet-no" aria-hidden="true">
            {String(no).padStart(2, "0")}
          </span>
          <span className="sheet-title" id={`${id}-h`}>
            {title}
          </span>
          {meta && <span className="sheet-meta">{meta}</span>}
        </button>
      </h2>
      <div className="sheet-body" id={`${id}-body`} ref={bodyRef}>
        {children}
      </div>
    </section>
  );
}

export function Sub({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 className="sub" id={id}>
      {children}
    </h3>
  );
}

export function Badge({ tone = "ink", children, tip }: { tone?: "green" | "amber" | "red" | "blue" | "mag" | "ink"; children: ReactNode; tip?: string }) {
  const b = <span className={`badge b-${tone}`}>{children}</span>;
  return tip ? (
    <Tip tip={tip} plain>
      {b}
    </Tip>
  ) : (
    b
  );
}

/** Horizontal gauge: value against a max, with warn/bad thresholds (percent of max). */
export function Gauge({
  label,
  value,
  max,
  display,
  tip,
  warnAt = 95,
}: {
  label: string;
  value: number | null;
  max: number | null;
  display: ReactNode;
  tip?: string;
  warnAt?: number;
}) {
  const p = value != null && max ? Math.min(100, (value / max) * 100) : 0;
  const cls = p >= 100 ? "bad" : p >= warnAt ? "warn" : "";
  return (
    <div className="gauge">
      <Tip tip={tip} title={label}>
        <span style={{ fontFamily: "var(--font-cond)", fontWeight: 600, letterSpacing: "0.06em" }}>{label}</span>
      </Tip>
      <Replay>
      <div
        className="gauge-track"
        role="meter"
        aria-label={`${label} against maximum`}
        aria-valuemin={0}
        aria-valuemax={max ?? 100}
        aria-valuenow={value ?? 0}
      >
        <span className={cx("gauge-fill a-grow-x", cls)} style={{ width: `${p}%` }} />
      </div>
      </Replay>
      <span>{display}</span>
    </div>
  );
}

/** Controlled input for pilot-filled "actual" values. Kept in memory only. */
export function Act({
  label,
  value,
  onChange,
  w = 6,
  placeholder,
  inputMode = "numeric",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  w?: number;
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
}) {
  return (
    <input
      className="act"
      aria-label={label}
      value={value}
      placeholder={placeholder ?? "·".repeat(Math.min(w, 6))}
      inputMode={inputMode}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      style={{ ["--w" as string]: w }}
      spellCheck={false}
      autoComplete="off"
    />
  );
}

/**
 * A box that scrolls when its content is wider (or taller) than it. While it does, it takes the keyboard focus
 * (arrow keys scroll it) and is named, so its hidden columns can be reached without a pointer; when everything
 * fits it's a plain box and adds no tab stop.
 */
export function ScrollBox({ label, className, as = "div", children }: { label: string; className?: string; as?: "div" | "pre"; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    // a closed <details> doesn't resize what's in it when it opens: check again then
    const details = el.closest("details");
    details?.addEventListener("toggle", check);
    return () => {
      ro.disconnect();
      details?.removeEventListener("toggle", check);
    };
  }, []);
  const Tag = as;
  return (
    <Tag ref={ref as never} className={className} {...(over ? { tabIndex: 0, role: "region", "aria-label": label } : {})}>
      {children}
    </Tag>
  );
}

/**
 * Keyboard for a role="radiogroup" of buttons, as native radios behave: the arrow keys (and Home / End) move to
 * the next radio and select it. Pair with roving() so the group is one tab stop.
 */
export function radioKeys(e: KeyboardEvent<HTMLElement>) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step && e.key !== "Home" && e.key !== "End") return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')];
  const i = radios.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const n = radios.length;
  const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + step + n) % n;
  radios[j].focus();
  if (radios[j].getAttribute("aria-checked") !== "true") radios[j].click();
}

/** The tab stop of a radio in such a group: the checked one, or the first when none is. */
export const roving = (checked: boolean, index: number, anyChecked = true) => (checked || (!anyChecked && index === 0) ? 0 : -1);
