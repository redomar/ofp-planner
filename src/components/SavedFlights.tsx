"use client";

import { Flag } from "./Flag";
import Link from "next/link";
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { airportLabel, cityName, hhmm } from "@/lib/data/flight";
import { loadAirports, loadManifest, type Airport } from "@/lib/data/load";
import type { AirlineInfo } from "@/lib/data/types";
import {
  addGroup,
  clearHistory,
  deleteGroup,
  moveFavourite,
  moveGroup,
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

  if (!saved) return <div className="sk-block" aria-hidden="true" />;
  const { favourites, groups, history } = saved;
  const ungrouped = favourites.filter((f) => !f.group || !groups.includes(f.group));
  const favIds = new Set(favourites.map((f) => f.id));
  const row = (f: SavedFlight, kind: "fav" | "recent") => (
    <Row key={`${kind}-${f.id}`} f={f} kind={kind} ref_={ref} groups={groups} onOpen={onOpen} starred={favIds.has(f.id)} />
  );

  return (
    <div className="lib">
      <section className="lib-sec" aria-labelledby="lib-fav-h">
        <header className="lib-head">
          <h3 id="lib-fav-h">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" className="lib-star">
              <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
            </svg>
            Favourites <span className="lib-count mono">{favourites.length}</span>
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
              <Group name={null} flights={ungrouped} total={groups.length} index={-1} ref_={ref}>
                {ungrouped.map((f) => row(f, "fav"))}
              </Group>
            )}
            {groups.map((g, i) => {
              const items = favourites.filter((f) => f.group === g);
              return (
                <Group key={g} name={g} flights={items} total={groups.length} index={i} last={saved.prefs.lastGroup === g} ref_={ref}>
                  {items.map((f) => row(f, "fav"))}
                </Group>
              );
            })}
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
  children,
}: {
  name: string | null;
  flights: SavedFlight[];
  total: number;
  index: number;
  last?: boolean;
  ref_: { airlines: Map<string, AirlineInfo>; airports: Map<string, Airport> } | null;
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
    <div className={`grp${last ? " is-last" : ""}`}>
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
          <p className="lib-empty small">Empty. Move a flight here with its group menu, or star one while this group is marked “new stars”.</p>
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
}: {
  f: SavedFlight;
  kind: "fav" | "recent";
  ref_: { airlines: Map<string, AirlineInfo>; airports: Map<string, Airport> } | null;
  groups: string[];
  onOpen?: (id: string) => void;
  starred: boolean;
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
    <li className="fl-row">
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
        aria-label={`Brief ${ident}, ${place(o, f.o)} to ${place(d, f.d)}${dep != null ? `, departs ${hhmm(dep)} UTC` : ""}`}
      >
        <span className="fl-ident">
          <FlightIdent airline={al} fallback={f.al} ident={ident} />
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
            value={f.group && groups.includes(f.group) ? f.group : ""}
            onChange={(e) => moveFavourite(f.id, e.target.value || null)}
          >
            <option value="">Ungrouped</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
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
          <button type="button" className="icon-chip" title="Remove from favourites" aria-label={`Remove ${ident} from favourites`} onClick={() => removeFavourite(f.id)}>
            ×
          </button>
        )}
      </div>
    </li>
  );
}
