"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

/* ---------- airport / country combobox ---------- */

export interface PlaceOption {
  /** "LEMD" or "C:ES" */
  value: string;
  /** Primary code shown in mono ("LEMD", "ES"). */
  code: string;
  /** Secondary code (IATA) */
  alt: string | null;
  name: string;
  /** Second line, e.g. "Madrid · Spain" or "28 airports". */
  detail: string;
  /** For ranking: number of flights. */
  weight: number;
  country: boolean;
}

const MAX_OPTIONS = 40;

function rank(o: PlaceOption, q: string): number {
  if (!q) return 1 + o.weight / 1e6;
  const Q = q.toUpperCase();
  if (o.code === Q || o.alt === Q) return 100;
  if (o.code.startsWith(Q) || o.alt?.startsWith(Q)) return 50 + o.weight / 1e6;
  const hay = `${o.name} ${o.detail}`.toUpperCase();
  if (hay.split(/[\s·,/()-]+/).some((w) => w.startsWith(Q))) return 20 + o.weight / 1e6;
  if (hay.includes(Q)) return 5 + o.weight / 1e6;
  return 0;
}

/**
 * Accessible combobox (WAI-ARIA 1.2 pattern): type an ICAO/IATA code, city, airport or
 * country; arrows move, Enter picks, Escape closes. "Any" is a clear button.
 */
export function PlacePicker({
  label,
  value,
  options,
  onChange,
  anyLabel = "Anywhere",
}: {
  label: string;
  value: string | null;
  options: PlaceOption[];
  onChange: (v: string | null) => void;
  anyLabel?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value) ?? null;

  const matches = useMemo(() => {
    const q = text.trim();
    return options
      .map((o) => [o, rank(o, q)] as const)
      .filter(([, r]) => r > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_OPTIONS)
      .map(([o]) => o);
  }, [options, text]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const pick = (o: PlaceOption | null) => {
    onChange(o?.value ?? null);
    setText("");
    setOpen(false);
  };

  const shown = open
    ? text
    : current
      ? `${current.code}${current.alt && !current.country ? ` / ${current.alt}` : ""} · ${current.name}`
      : (value?.replace(/^C:/, "") ?? "");

  return (
    <div className={cx("combo", open && "open", value && "has-value")}>
      <label className="ctl-label" htmlFor={id}>
        {label}
      </label>
      <div className="combo-box">
        <input
          ref={inputRef}
          id={id}
          className="ctl-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[hi] ? `${id}-o${hi}` : undefined}
          placeholder={anyLabel}
          value={shown}
          spellCheck={false}
          autoComplete="off"
          onFocus={(e) => {
            setOpen(true);
            setHi(0);
            e.currentTarget.select();
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHi((h) => Math.min(h + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              if (open && matches[hi]) {
                e.preventDefault();
                pick(matches[hi]);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              setText("");
            }
          }}
        />
        {value && (
          <button type="button" className="combo-clear" aria-label={`Clear ${label}`} title="Any" onClick={() => pick(null)}>
            ×
          </button>
        )}
      </div>
      {open && (
        <ul className="combo-list" id={`${id}-list`} role="listbox" aria-label={label} ref={listRef}>
          {matches.length === 0 && <li className="combo-none">No airport or country matches “{text}”</li>}
          {matches.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-o${i}`}
              data-i={i}
              role="option"
              aria-selected={i === hi}
              className={cx(o.country && "is-country")}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setHi(i)}
            >
              <span className="combo-code">{o.code}</span>
              <span className="combo-alt">{o.alt ?? ""}</span>
              <span className="combo-name">
                {o.name}
                <small>{o.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- multi-select popover (airlines, aircraft) ---------- */

export interface MultiOption {
  value: string;
  label: string;
  detail?: string;
  swatch?: string;
  count?: number;
  /** Listed after a dashed divider (e.g. airlines not flying the chosen airport). */
  dim?: boolean;
}

export function MultiPicker({
  label,
  values,
  options,
  onChange,
  allLabel,
  summary,
  searchable,
  note,
  restLabel,
}: {
  label: string;
  values: string[];
  options: MultiOption[];
  onChange: (v: string[]) => void;
  allLabel: string;
  summary?: ReactNode;
  searchable?: boolean;
  /** Small heading over the counts ("Flights to DLM"). */
  note?: string;
  /** Label on the dashed divider before the dimmed options. */
  restLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const shown = q ? options.filter((o) => `${o.value} ${o.label} ${o.detail ?? ""}`.toUpperCase().includes(q.toUpperCase())) : options;
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  const text =
    summary ??
    (values.length === 0
      ? allLabel
      : values.length <= 2
        ? values.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ")
        : `${values.length} selected`);

  return (
    <div className={cx("multi", open && "open")} ref={ref}>
      <span className="ctl-label" id={`${id}-l`}>
        {label}
      </span>
      <button
        type="button"
        className="ctl-input multi-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby={`${id}-l ${id}-v`}
        onClick={() => setOpen((o) => !o)}
      >
        <span id={`${id}-v`}>{text}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <div className="multi-pop" role="group" aria-label={label}>
          <div className="multi-head">
            {searchable && (
              <input className="ctl-input" placeholder="Filter" aria-label={`Filter ${label}`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            )}
            <button type="button" className="chip" onClick={() => onChange([])} aria-pressed={values.length === 0}>
              {allLabel}
            </button>
          </div>
          {note && (
            <p className="multi-note">
              <span>{note}</span>
              <span>flights</span>
            </p>
          )}
          <ul>
            {shown.map((o, i) => (
              <li key={o.value} className={cx(o.dim && "dim", o.dim && !shown[i - 1]?.dim && "first-dim")} data-rest={o.dim && !shown[i - 1]?.dim ? restLabel : undefined}>
                <label>
                  <input type="checkbox" checked={values.includes(o.value)} onChange={() => toggle(o.value)} />
                  {o.swatch && <span className="swatch" style={{ background: o.swatch }} aria-hidden="true" />}
                  <span className="multi-label">
                    {o.label}
                    {o.detail && <small>{o.detail}</small>}
                  </span>
                  {o.count != null && <span className="multi-count">{o.count.toLocaleString("en-GB")}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- days of week ---------- */

export function DayPicker({ values, onChange }: { values: number[]; onChange: (v: number[]) => void }) {
  const names = ["M", "T", "W", "T", "F", "S", "S"];
  const full = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return (
    <div className="days" role="group" aria-label="Operating days">
      <span className="ctl-label">Days</span>
      <div className="days-row">
        {names.map((n, i) => {
          const d = i + 1;
          const on = values.includes(d);
          return (
            <button
              key={d}
              type="button"
              className="day"
              aria-pressed={on}
              aria-label={full[i]}
              title={full[i]}
              onClick={() => onChange(on ? values.filter((x) => x !== d) : [...values, d].sort())}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- block time range ---------- */

const STEPS = [0, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 480];
const lbl = (m: number) => (m < 60 ? `${m}m` : m % 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m / 60}h`);

export function LengthPicker({
  min,
  max,
  onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const id = useId();
  return (
    <div className="len">
      <span className="ctl-label" id={id}>
        Block time
      </span>
      <div className="len-row" role="group" aria-labelledby={id}>
        <select className="ctl-input" aria-label="Shortest block time" value={min ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, max)}>
          <option value="">Any</option>
          {STEPS.filter((s) => s > 0).map((s) => (
            <option key={s} value={s} disabled={max != null && s > max}>
              ≥ {lbl(s)}
            </option>
          ))}
        </select>
        <span aria-hidden="true">–</span>
        <select className="ctl-input" aria-label="Longest block time" value={max ?? ""} onChange={(e) => onChange(min, e.target.value ? Number(e.target.value) : null)}>
          <option value="">Any</option>
          {STEPS.filter((s) => s > 0).map((s) => (
            <option key={s} value={s} disabled={min != null && s < min}>
              ≤ {lbl(s)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
