"use client";

import { Flag } from "./Flag";
import Link from "next/link";
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";
import { airportLabel, cityName, hhmm } from "@/lib/data/flight";
import { loadAirports, loadManifest, type Airport } from "@/lib/data/load";
import type { AirlineInfo } from "@/lib/data/types";
import {
  addGroup,
  clearHistory,
  deleteGroup,
  groupsById,
  moveFavourite,
  moveGroup,
  placeFavourite,
  removeFavourite,
  renameGroup,
  toggleSavedFavourite,
  useSaved,
  writePrefs,
  type SavedFlight,
} from "@/lib/saved";
import { routeColor } from "@/lib/colors";
import { overrideFor, useFnOverrides } from "@/lib/fnoverride";
import { FlightIdent, TypeBadge, WeekStrip } from "./badges";
import { RouteMap, type MapRoute } from "./RouteMap";

type Ref = { airlines: Map<string, AirlineInfo>; airports: Map<string, Airport> } | null;
/** Where a dragged favourite would land: in `group`, before `before` (null = at the end). `over` is the row under the pointer. */
type DropAt = { group: string | null; before: string | null; over: string | null; pos: "before" | "after" | "into" };
type Drag = { id: string; from: string | null; label: string; x: number; y: number; at: DropAt | null };
const sameAt = (a: DropAt | null, b: DropAt | null) => a?.group === b?.group && a?.before === b?.before && a?.over === b?.over && a?.pos === b?.pos;
const EDGE = 56;

/**
 * Favourites (in groups) and recent flights as rich rows: airline tag, route with places,
 * departure time, aircraft and days. Used by the brief's start page and Settings.
 * `onOpen` (the brief) opens a flight in place; without it, rows link to /brief.
 */
export function SavedFlights({ onOpen, recentMax = 8, showRecent = true }: { onOpen?: (id: string) => void; recentMax?: number; showRecent?: boolean }) {
  const saved = useSaved();
  const [ref, setRef] = useState<{ airlines: Map<string, AirlineInfo>; airports: Map<string, Airport> } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([loadManifest(), loadAirports()]).then(
      ([m, a]) => live && setRef({ airlines: new Map(m.airlines.map((x) => [x.icao, x])), airports: a }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState("");
  // a flight in several groups: hovering or focusing one of its rows lights up the others
  const [twin, setTwin] = useState<string | null>(null);

  if (!saved) return <div className="sk-block" aria-hidden="true" />;
  const { favourites, groups, history } = saved;
  const inGroups = groupsById(favourites, groups);
  const ungrouped = favourites.filter((f) => !inGroups.get(f.id)?.length);
  const favIds = new Set(favourites.map((f) => f.id));
  const groupOf = (f: SavedFlight) => (f.group && groups.includes(f.group) ? f.group : null);
  // each group's flights in display order; "" = ungrouped
  const lists = new Map<string, SavedFlight[]>([["", ungrouped], ...groups.map((g) => [g, favourites.filter((f) => f.group === g)] as [string, SavedFlight[]])]);
  const titleOf = (g: string | null) => g ?? "Ungrouped";

  /** The drop target under the pointer: a row (above or below its middle) or a group box (its end). */
  const dropAt = (x: number, y: number): DropAt | null => {
    const hit = document.elementFromPoint(x, y);
    const row = hit?.closest<HTMLElement>("[data-fav]");
    if (row) {
      const over = row.dataset.fav!;
      const key = row.dataset.group ?? "";
      const r = row.getBoundingClientRect();
      const pos = y < r.top + r.height / 2 ? "before" : "after";
      const list = lists.get(key) ?? [];
      const before = pos === "before" ? over : (list[list.findIndex((f) => f.id === over) + 1]?.id ?? null);
      return { group: key || null, before, over, pos };
    }
    const box = hit?.closest<HTMLElement>("[data-fav-group]");
    return box ? { group: box.dataset.favGroup || null, before: null, over: null, pos: "into" } : null;
  };

  /** Drag by the grip with mouse, pen or touch; Escape cancels. Listeners live only for the gesture. */
  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, f: SavedFlight, label: string) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let at: DropAt | null = null;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      started = true;
      const next = dropAt(ev.clientX, ev.clientY);
      if (!sameAt(next, at)) at = next;
      setDrag({ id: f.id, from: groupOf(f), label, x: ev.clientX, y: ev.clientY, at });
      if (ev.clientY < EDGE) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - EDGE) window.scrollBy(0, 12);
    };
    const stop = (commit: boolean) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      setDrag(null);
      if (commit && started && at) {
        placeFavourite(f.id, groupOf(f), at.group, at.before);
        setSaid(`Moved ${label} to ${titleOf(at.group)}.`);
      }
    };
    const up = () => stop(true);
    const cancel = () => stop(false);
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && stop(false);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
  };

  /** Arrow keys on the grip move a flight up or down within its group. */
  const nudge = (f: SavedFlight, label: string, by: -1 | 1) => {
    const group = groupOf(f);
    const list = lists.get(group ?? "") ?? [];
    const i = list.findIndex((x) => x.id === f.id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    placeFavourite(f.id, group, group, by < 0 ? list[j].id : (list[j + 1]?.id ?? null));
    setSaid(`${label}: ${j + 1} of ${list.length} in ${titleOf(group)}.`);
    // moving the row in the DOM drops focus; put it back on the grip
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-fav-group="${CSS.escape(group ?? "")}"] [data-grip="${CSS.escape(f.id)}"]`)?.focus());
  };

  const row = (f: SavedFlight, kind: "fav" | "recent") => {
    const g = kind === "fav" ? groupOf(f) : null;
    const self = drag?.id === f.id && drag.from === g;
    const over = kind === "fav" && drag?.at?.over === f.id && (drag.at.group ?? null) === g && !self;
    const others = kind === "fav" ? (inGroups.get(f.id) ?? []).filter((x) => x !== g) : [];
    return (
      <Row
        key={`${kind}-${g ?? ""}-${f.id}`}
        f={f}
        kind={kind}
        ref_={ref}
        groups={groups}
        onOpen={onOpen}
        starred={favIds.has(f.id)}
        groupKey={kind === "fav" ? (g ?? "") : undefined}
        others={others}
        twin={others.length > 0 && twin === f.id}
        onTwin={setTwin}
        dragging={self}
        drop={over ? (drag!.at!.pos as "before" | "after") : null}
        onGrip={startDrag}
        onNudge={nudge}
      />
    );
  };
  const into = (g: string | null) => drag?.at?.pos === "into" && drag.at.group === g;

  return (
    <div className="lib">
      <section className="lib-sec" aria-labelledby="lib-fav-h">
        <header className="lib-head">
          <h3 id="lib-fav-h">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" className="lib-star">
              <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
            </svg>
            Favourites <span className="lib-count mono">{favIds.size}</span>
          </h3>
          <NewGroup />
        </header>

        {favourites.length === 0 && groups.length === 0 ? (
          <p className="lib-empty">
            Star a flight on its card in the Finder (<span className="lib-star-inline" aria-hidden="true">☆</span>) to keep it here. Make groups for trips, airlines or
            aircraft (“Alps hops”, “easyJet A20N”) and new stars go into the last group you used.
          </p>
        ) : (
          <div className="lib-groups">
            {(ungrouped.length > 0 || groups.length === 0) && (
              <Group name={null} flights={ungrouped} total={groups.length} index={-1} ref_={ref} dropInto={into(null)} shared={0}>
                {ungrouped.map((f) => row(f, "fav"))}
              </Group>
            )}
            {groups.map((g, i) => {
              const items = favourites.filter((f) => f.group === g);
              const shared = items.filter((f) => (inGroups.get(f.id)?.length ?? 0) > 1).length;
              return (
                <Group key={g} name={g} flights={items} total={groups.length} index={i} last={saved.prefs.lastGroup === g} ref_={ref} dropInto={into(g)} shared={shared}>
                  {items.map((f) => row(f, "fav"))}
                </Group>
              );
            })}
            {drag && ungrouped.length === 0 && groups.length > 0 && (
              <div className={`grp grp-drop${into(null) ? " is-drop" : ""}`} data-fav-group="">
                <p className="lib-empty small">Drop here to take it out of its group</p>
              </div>
            )}
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {said}
        </p>
        {drag?.at && (
          <div className="fl-ghost" style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }} aria-hidden="true">
            {drag.label} <span className="muted">→ {titleOf(drag.at.group)}</span>
          </div>
        )}
      </section>

      {showRecent && (
        <section className="lib-sec" aria-labelledby="lib-rec-h">
          <header className="lib-head">
            <h3 id="lib-rec-h">
              Recent <span className="lib-count mono">{history.length}</span>
            </h3>
            {history.length > 0 && (
              <button type="button" className="chip" onClick={clearHistory}>
                Clear recent
              </button>
            )}
          </header>
          {history.length ? (
            <ul className="fl-list">{history.slice(0, recentMax).map((f) => row(f, "recent"))}</ul>
          ) : (
            <p className="lib-empty">Flights you open in the Finder show up here.</p>
          )}
        </section>
      )}
    </div>
  );
}

function NewGroup() {
  const [name, setName] = useState("");
  const [err, setErr] = useState(false);
  const submit = (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    const n = addGroup(name);
    if (n) {
      writePrefs({ lastGroup: n });
      setName("");
      setErr(false);
    } else setErr(true);
  };
  return (
    <form className="lib-new" onSubmit={submit}>
      <input
        className="ctl-input"
        value={name}
        placeholder="New group"
        aria-label="New group name"
        aria-invalid={err || undefined}
        maxLength={40}
        onChange={(e) => {
          setName(e.target.value);
          setErr(false);
        }}
      />
      <button type="submit" className="btn" disabled={!name.trim()}>
        Add group
      </button>
      {err && (
        <span className="form-err" role="alert">
          That group already exists
        </span>
      )}
    </form>
  );
}

function Group({
  name,
  flights,
  total,
  index,
  last,
  ref_,
  dropInto,
  shared,
  children,
}: {
  name: string | null;
  flights: SavedFlight[];
  total: number;
  index: number;
  last?: boolean;
  ref_: Ref;
  dropInto: boolean;
  /** How many of its flights are in other groups too. */
  shared: number;
  children: React.ReactNode;
}) {
  const [map, setMap] = useState(false);
  // one line per route, in the colour of its first flight's airline
  const routes = useMemo<MapRoute[]>(() => {
    if (!map || !ref_) return [];
    const seen = new Map<string, MapRoute>();
    for (const f of flights) {
      const key = `${f.o}-${f.d}`;
      const from = ref_.airports.get(f.o);
      const to = ref_.airports.get(f.d);
      if (!from || !to || seen.has(key)) continue;
      seen.set(key, { key, from, to, color: routeColor(ref_.airlines.get(f.al)) });
    }
    return [...seen.values()];
  }, [map, ref_, flights]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? "");
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState(true);
  const title = name ?? (total ? "Ungrouped" : "All favourites");
  return (
    <div className={`grp${last ? " is-last" : ""}${dropInto ? " is-drop" : ""}`} data-fav-group={name ?? ""}>
      <div className="grp-head">
        {editing && name ? (
          <form
            className="grp-rename"
            onSubmit={(e) => {
              e.preventDefault();
              if (renameGroup(name, draft)) setEditing(false);
            }}
          >
            <input className="ctl-input" value={draft} aria-label={`Rename ${name}`} maxLength={40} autoFocus onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="chip">
              Save
            </button>
            <button type="button" className="chip" onClick={() => (setEditing(false), setDraft(name))}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="grp-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span className="grp-caret" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            {title}
            <span className="lib-count mono">{flights.length}</span>
            {last && <span className="badge b-blue">new stars</span>}
          </button>
        )}
        {!editing && shared > 0 && (
          <span
            className="badge b-amber grp-shared"
            tabIndex={0}
            data-tip={`${shared === 1 ? "One flight here is" : `${shared} flights here are`} in another group too. Removing ${shared === 1 ? "it" : "one"} here keeps it there.`}
            data-tip-title="Shared flights"
            data-tip-note="Hover a flight to light up its other rows"
          >
            {shared} shared
          </span>
        )}
        {!editing && flights.length > 0 && (
          <button
            type="button"
            className={`chip grp-map-btn${map ? " on" : ""}`}
            aria-pressed={map}
            onClick={() => {
              setMap((m) => !m);
              setOpen(true);
            }}
          >
            {map ? "Hide map" : "Map"}
          </button>
        )}
        {name && !editing && (
          <div className="grp-tools">
            {confirm ? (
              <>
                <span className="small">Remove group? Flights stay in favourites.</span>
                <button type="button" className="chip" onClick={() => deleteGroup(name)}>
                  Remove
                </button>
                <button type="button" className="chip" onClick={() => setConfirm(false)}>
                  Keep
                </button>
              </>
            ) : (
              <>
                <button type="button" className="icon-chip" aria-label={`Move ${name} up`} title="Move up" disabled={index <= 0} onClick={() => moveGroup(name, -1)}>
                  ↑
                </button>
                <button type="button" className="icon-chip" aria-label={`Move ${name} down`} title="Move down" disabled={index >= total - 1} onClick={() => moveGroup(name, 1)}>
                  ↓
                </button>
                <button type="button" className="chip" onClick={() => setEditing(true)}>
                  Rename
                </button>
                <button type="button" className="chip" onClick={() => setConfirm(true)}>
                  Remove
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {open && map && routes.length > 0 && (
        <div className="grp-map">
          <RouteMap routes={routes} height={320} label={`Map of the ${routes.length} routes in ${title}.`} />
        </div>
      )}
      {open &&
        (flights.length ? (
          <ul className="fl-list">{children}</ul>
        ) : (
          <p className="lib-empty small">Empty. Drag a flight here by its handle, pick this group in its menu, or star one while this group is marked “new stars”.</p>
        ))}
    </div>
  );
}

function Row({
  f,
  kind,
  ref_,
  groups,
  onOpen,
  starred,
  groupKey,
  others,
  twin,
  onTwin,
  dragging,
  drop,
  onGrip,
  onNudge,
}: {
  f: SavedFlight;
  kind: "fav" | "recent";
  ref_: Ref;
  groups: string[];
  onOpen?: (id: string) => void;
  starred: boolean;
  /** Favourites only: the row's group ("" = ungrouped), for drop targets. */
  groupKey?: string;
  /** Favourites only: the other groups this flight is in. */
  others: string[];
  /** Light up as the twin of a hovered row in another group. */
  twin: boolean;
  onTwin: (id: string | null) => void;
  dragging: boolean;
  drop: "before" | "after" | null;
  onGrip: (e: ReactPointerEvent<HTMLButtonElement>, f: SavedFlight, label: string) => void;
  onNudge: (f: SavedFlight, label: string, by: -1 | 1) => void;
}) {
  const fnOv = useFnOverrides();
  const al = ref_?.airlines.get(f.al);
  const o = ref_?.airports.get(f.o);
  const d = ref_?.airports.get(f.d);
  const fn = f.fn ?? overrideFor(f.op, f.cs, fnOv);
  const ident = fn ? `${al?.iata ?? f.al}${fn}` : (f.cs ?? `${f.op} —`);
  const dep = f.dep ?? f.std;
  const href = `/brief?f=${encodeURIComponent(f.id)}`;
  const place = (a: Airport | undefined, icao: string) => (a ? (cityName(a) ?? airportLabel(a)) : icao);
  return (
    <li
      className={`fl-row${dragging ? " is-dragging" : ""}${drop ? ` drop-${drop}` : ""}${others.length ? " is-shared" : ""}${twin ? " is-twin" : ""}`}
      data-fav={kind === "fav" ? f.id : undefined}
      data-group={groupKey}
      onMouseEnter={others.length ? () => onTwin(f.id) : undefined}
      onMouseLeave={others.length ? () => onTwin(null) : undefined}
      onFocus={others.length ? () => onTwin(f.id) : undefined}
      onBlur={others.length ? () => onTwin(null) : undefined}
    >
      {kind === "fav" && (
        <button
          type="button"
          className="fl-grip"
          data-grip={f.id}
          title="Drag to reorder or move to another group (arrow keys move it up or down)"
          aria-label={`Reorder ${ident}. Up and down arrows move it within the group.`}
          onPointerDown={(e) => onGrip(e, f, ident)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              onNudge(f, ident, e.key === "ArrowUp" ? -1 : 1);
            }
          }}
        >
          <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
            <circle cx="2.5" cy="3" r="1.5" />
            <circle cx="7.5" cy="3" r="1.5" />
            <circle cx="2.5" cy="8" r="1.5" />
            <circle cx="7.5" cy="8" r="1.5" />
            <circle cx="2.5" cy="13" r="1.5" />
            <circle cx="7.5" cy="13" r="1.5" />
          </svg>
        </button>
      )}
      <a
        className="fl-main"
        href={href}
        onClick={
          onOpen
            ? (e) => {
                e.preventDefault();
                onOpen(f.id);
              }
            : undefined
        }
        aria-label={`Brief ${ident}, ${place(o, f.o)} to ${place(d, f.d)}${dep != null ? `, departs ${hhmm(dep)} UTC` : ""}${others.length ? `. Also in ${others.join(", ")}` : ""}`}
      >
        <span className="fl-ident">
          <FlightIdent airline={al} fallback={f.al} ident={ident} />
          {others.length > 0 && (
            <span
              className="badge b-amber fl-shared"
              aria-hidden="true"
              data-tip={`Also in ${others.map((g) => `“${g}”`).join(", ")}. Removing or moving it here leaves ${others.length === 1 ? "that group" : "those groups"} as they are.`}
              data-tip-title="In more than one group"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                <rect x="1" y="3.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M4 3.5V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H8" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              +{others.length}
            </span>
          )}
        </span>
        <span className="fl-route">
          <span className="fl-codes mono">
            {f.o} <span aria-hidden="true">→</span> {f.d}
          </span>
          <small className="fl-places">
            {o?.country && <Flag cc={o.country} />}
            {place(o, f.o)}
            <span aria-hidden="true"> → </span>
            {d?.country && <Flag cc={d.country} />}
            {place(d, f.d)}
          </small>
        </span>
        <span className="fl-time mono">{dep != null ? `${hhmm(dep)}Z` : "—"}</span>
        <span className="fl-type">{f.type ? <TypeBadge type={f.type} airline={al} /> : null}</span>
        <span className="fl-days">{f.days?.length ? <WeekStrip days={f.days} /> : null}</span>
      </a>
      <div className="fl-actions">
        {kind === "fav" && groups.length > 0 && (
          <select
            className="ctl-input fl-group"
            aria-label={`Group for ${ident}`}
            value={groupKey ?? ""}
            onChange={(e) => moveFavourite(f.id, groupKey || null, e.target.value || null)}
          >
            {!others.length && <option value="">Ungrouped</option>}
            {groups.map((g) => (
              <option key={g} value={g} disabled={others.includes(g)}>
                {g}
                {others.includes(g) ? " (already in)" : ""}
              </option>
            ))}
          </select>
        )}
        <Link className="icon-chip" href={`/?al=${f.al}&dep=${f.o}&arr=${f.d}&f=${encodeURIComponent(f.id)}`} title="Open in the Finder" aria-label={`Open ${ident} in the Finder`}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M15 15l5.5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </Link>
        {kind === "recent" && (
          <button
            type="button"
            className={`icon-chip fav-chip${starred ? " on" : ""}`}
            aria-pressed={starred}
            title={starred ? "In favourites" : "Add to favourites"}
            aria-label={`${starred ? "Remove" : "Add"} ${ident} ${starred ? "from" : "to"} favourites`}
            onClick={() => toggleSavedFavourite(f)}
          >
            {starred ? "★" : "☆"}
          </button>
        )}
        {kind === "fav" && (
          <button
            type="button"
            className="icon-chip"
            title={others.length ? `Remove from ${groupKey} (stays in ${others.join(", ")})` : "Remove from favourites"}
            aria-label={others.length ? `Remove ${ident} from ${groupKey}; it stays in ${others.join(", ")}` : `Remove ${ident} from favourites`}
            onClick={() => removeFavourite(f.id, groupKey || null)}
          >
            ×
          </button>
        )}
      </div>
    </li>
  );
}
