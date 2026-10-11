// Turns one aircraft's day of thinned ADS-B points into flight legs with OOOI times.
//
// A leg is a run of airborne points under one callsign. It ends at a ground point, a
// callsign change, or a coverage gap long enough to hide a landing. Its ends are matched to
// the nearest airport when the aircraft was low enough near one.
//
//   OFF  wheels-up: first airborne point, back-dated by the climb from field elevation
//        (only when that point is below 1500 ft above the field, or a ground point sits
//        within 3 min before it)
//   ON   touchdown: same, mirrored, for the last airborne point (below 1200 ft AGL)
//   OUT  off-block: needs continuous ground coverage (no gap > 4 min) back from take-off to
//        either a parked spell (stationary ≥ 8 min) or the point where the transponder came
//        on at the stand (≥ 10 min of silence before, aircraft stopped or pushing back);
//        OUT = first movement. Must be 4–60 min before OFF.
//   IN   on-block: continuous ground coverage from landing to the first stop that lasts
//        ≥ 2 min or after which the transponder goes quiet for ≥ 10 min. 2–45 min after ON.
// Anything not met → null. Times are seconds since 00:00 UTC of the track's day.
//
// Climb-out fallback (inferEnd, used by the build only when an end is still unknown after the
// standing-data fill): some airports have no low-altitude coverage (Pristina: nothing seen below
// ~8 000 ft), so a departure first shows up climbing well above 7 000 ft. If the first point is
// below 15 000 ft and still climbing, a scheduled airport within 30 NM behind it, in line with the
// track (±45°) and at a plausible climb gradient (150–1 200 ft/NM), is a candidate origin;
// mirrored for a descent into the destination. The build takes the likeliest candidate the airline
// is seen flying to on other flights (3+ confirmed legs), and skips the leg when there is none. Such ends are
// flagged (Flight.inf) and listed only when Settings → Display asks for them.
import { nearestAirport } from "./sources/reference.mjs";
import { distNm } from "./util.mjs";

const GAP_LANDING_S = 20 * 60; // gap while low: could have landed unseen
const GAP_ANY_S = 100 * 60; // any gap longer than this ends a leg
// a gap with a descent below FL150 before it and a climb below FL150 after it is a turnaround at an
// airport with no low coverage (Pristina: last seen descending at ~11 000 ft, back climbing at 12 000 ft)
const TURN_FT = 15000;
const LOW_FT = 10000;
const GROUND_CHAIN_GAP_S = 240;
const PARKED_S = 8 * 60;
const STOP_IN_S = 120;
const NEAR_FIELD_NM = 4;
const TRANSPONDER_OFF_S = 10 * 60; // silence this long = transponder off on stand

/** Unpack and time-sort an aircraft's points. Returns array of {t, lat, lon, alt, gs}. */
export function unpack(p, tOffset = 0) {
  const out = [];
  for (let i = 0; i < p.length; i += 5) out.push({ t: p[i] + tOffset, lat: p[i + 1] / 1e4, lon: p[i + 2] / 1e4, alt: p[i + 3], gs: p[i + 4] });
  return out;
}

/** Callsign in force at time t (last change at or before t; first one if none yet within 10 min). */
function callsignAt(events, t) {
  let cs = null;
  for (const [et, c] of events) {
    if (et <= t) cs = c;
    else {
      if (cs === null && et - t <= 600) cs = c;
      break;
    }
  }
  return cs;
}

/**
 * Split points (sorted) into airborne legs and the ground runs around them.
 * Returns {legs: [{pts, cs, before: groundPts[], after: groundPts[]}], open: pointsTail|null}.
 * `dayEnd`: legs still airborne within 20 min of it are returned as `open` instead.
 */
export function segment(points, events, dayEnd) {
  events = [...events].sort((a, b) => a[0] - b[0]);
  const legs = [];
  let ground = []; // current ground run
  let cur = null;
  const close = () => {
    if (cur && cur.pts.length >= 3) legs.push(cur);
    cur = null;
  };
  let prev = null;
  let prev2 = null;
  for (let k = 0; k < points.length; k++) {
    const pt = points[k];
    if (prev && pt.t === prev.t) continue;
    const cs = callsignAt(events, pt.t);
    const gap = prev ? pt.t - prev.t : 0;
    if (pt.alt < 0) {
      if (cur) {
        close();
        ground = [];
      } else if (gap > GROUND_CHAIN_GAP_S * 4) ground = [];
      ground.push(pt);
      // remember the ground run that follows the last closed leg
      if (legs.length && !cur) {
        const last = legs[legs.length - 1];
        if (!last.afterClosed) last.after.push(pt);
      }
    } else {
      if (cur) {
        const next = points[k + 1];
        const turn = prev.alt < TURN_FT && pt.alt < TURN_FT && prev2 != null && prev2.alt > prev.alt && next != null && next.alt > pt.alt;
        const lowGap = gap > GAP_LANDING_S && (prev.alt < LOW_FT || pt.alt < LOW_FT || turn);
        const changed = cs && cur.cs && cs !== cur.cs;
        // a callsign that changes in the first minutes is the crew updating a stale one
        if (changed && !lowGap && gap <= GAP_ANY_S && pt.t - cur.pts[0].t < 10 * 60) cur.cs = cs;
        else if (gap > GAP_ANY_S || lowGap || changed) close();
      }
      if (!cur) {
        for (const l of legs) l.afterClosed = true;
        cur = { pts: [], cs, before: ground, after: [], afterClosed: false };
        ground = [];
      }
      if (!cur.cs && cs) cur.cs = cs;
      cur.pts.push(pt);
    }
    prev2 = prev;
    prev = pt;
  }
  let open = null;
  if (cur) {
    const last = cur.pts[cur.pts.length - 1];
    if (dayEnd - last.t < 20 * 60) open = cur;
    else close();
  }
  return { legs, open };
}

const INFER_MAX_FT = 15000;
const INFER_MAX_NM = 30;
const INFER_MAX_DEG = 45;

/** Initial great-circle bearing a → b, degrees. */
function bearing(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Airports a leg may have left from ("o": behind its first point, which must be climbing) or gone
 * to ("d": ahead of its last point, which must be descending), most likely first. See the header.
 */
export function inferEnds(pts, airports, side) {
  const first = side === "o";
  const p = first ? pts[0] : pts[pts.length - 1];
  if (p.alt < 0 || p.alt > INFER_MAX_FT) return [];
  // a point 2–8 min further into (or back from) the flight gives the track and the vertical trend
  const want = first ? p.t + 120 : p.t - 120;
  const q = first ? pts.find((x) => x.t >= want && x.t <= p.t + 480) : [...pts].reverse().find((x) => x.t <= want && x.t >= p.t - 480);
  if (!q || q.alt < p.alt + 1000) return [];
  // direction from p away from the flight: back along the climb, or on along the descent
  const away = bearing(q.lat, q.lon, p.lat, p.lon);
  const found = [];
  const la = Math.floor(p.lat);
  const lo = Math.floor(p.lon);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const a of airports.index.get(`${la + i},${lo + j}`) ?? []) {
        if (!a.sched) continue;
        const dist = distNm(p.lat, p.lon, a.lat, a.lon);
        if (dist > INFER_MAX_NM || dist < 1) continue;
        const off = angleDiff(bearing(p.lat, p.lon, a.lat, a.lon), away);
        if (off > INFER_MAX_DEG) continue;
        const grad = (p.alt - (a.elev ?? 0)) / dist;
        if (grad < 150 || grad > 1200) continue;
        found.push({ a, score: off / 15 + dist / 10 });
      }
    }
  }
  return found.sort((x, y) => x.score - y.score).map((x) => x.a);
}

function agl(pt, ap) {
  return ap?.elev != null ? pt.alt - ap.elev : pt.alt;
}

/** Resolve a leg to {cs, o, d, out, off, on, in} (seconds; airports as objects or null). */
export function resolveLeg(leg, airports) {
  const { pts, before, after } = leg;
  const p0 = pts[0];
  const p1 = pts[pts.length - 1];
  const gBefore = before.length ? before[before.length - 1] : null;
  const gAfter = after.length ? after[0] : null;

  // origin: from the last ground point before take-off if close in time, else first airborne point
  let o = null;
  if (gBefore && p0.t - gBefore.t <= 600) o = nearestAirport(airports.index, gBefore.lat, gBefore.lon, -1, NEAR_FIELD_NM);
  if (!o && p0.alt < 7000) o = nearestAirport(airports.index, p0.lat, p0.lon, p0.alt, 10);
  let d = null;
  if (gAfter && gAfter.t - p1.t <= 600) d = nearestAirport(airports.index, gAfter.lat, gAfter.lon, -1, NEAR_FIELD_NM);
  if (!d && p1.alt < 7000) d = nearestAirport(airports.index, p1.lat, p1.lon, p1.alt, 10);

  // OFF
  let off = null;
  if (o) {
    const h = Math.max(0, agl(p0, o));
    if (h < 1500) off = p0.t - Math.round((h / 2000) * 60);
    else if (gBefore && p0.t - gBefore.t <= 180) off = Math.round((p0.t + gBefore.t) / 2);
    if (off != null && gBefore && off < gBefore.t) off = gBefore.t;
  }
  // ON
  let on = null;
  if (d) {
    const h = Math.max(0, agl(p1, d));
    if (h < 1200) on = p1.t + Math.round((h / 750) * 60);
    else if (gAfter && gAfter.t - p1.t <= 180) on = Math.round((p1.t + gAfter.t) / 2);
    if (on != null && gAfter && on > gAfter.t) on = gAfter.t;
  }

  // OUT: walk back along the continuous ground track before take-off
  let out = null;
  if (o && off != null && gBefore && off - gBefore.t <= GROUND_CHAIN_GAP_S) {
    let i = before.length - 1;
    let moveStart = null; // earliest moving point seen so far (walking backwards)
    while (i >= 0) {
      const pt = before[i];
      if (distNm(pt.lat, pt.lon, o.lat, o.lon) > NEAR_FIELD_NM) break;
      const prevGap = i > 0 ? pt.t - before[i - 1].t : Infinity;
      if (pt.gs <= 1) {
        // stationary spell [j..i]
        let j = i;
        while (j > 0 && before[j - 1].gs <= 1 && before[j].t - before[j - 1].t <= GROUND_CHAIN_GAP_S) j--;
        const span = pt.t - before[j].t;
        const gapBefore = j > 0 ? before[j].t - before[j - 1].t : Infinity;
        // parked: a long stop, or the stop where the transponder came on (nothing before it)
        if (span >= PARKED_S || gapBefore >= TRANSPONDER_OFF_S) {
          if (moveStart) out = Math.round((pt.t + moveStart.t) / 2);
          break;
        }
        if (gapBefore > GROUND_CHAIN_GAP_S) break; // coverage hole mid-taxi
        i = j - 1;
        continue;
      }
      moveStart = pt;
      if (prevGap > GROUND_CHAIN_GAP_S) {
        // track starts while moving slowly: pushback seen from its first second
        if (prevGap >= TRANSPONDER_OFF_S && pt.gs <= 4) out = pt.t;
        break;
      }
      i--;
    }
    if (out != null && (off - out > 60 * 60 || off - out < 4 * 60)) out = null;
  }

  // IN: walk forward along the continuous ground track after landing
  let inn = null;
  if (d && on != null && gAfter && gAfter.t - on <= GROUND_CHAIN_GAP_S) {
    for (let i = 0; i < after.length; i++) {
      const pt = after[i];
      if (distNm(pt.lat, pt.lon, d.lat, d.lon) > NEAR_FIELD_NM) break;
      if (i > 0 && pt.t - after[i - 1].t > GROUND_CHAIN_GAP_S) break;
      if (pt.gs > 1) continue;
      let j = i;
      while (j + 1 < after.length && after[j + 1].gs <= 1 && after[j + 1].t - after[j].t <= GROUND_CHAIN_GAP_S) j++;
      const span = after[j].t - pt.t;
      const gapAfter = j + 1 < after.length ? after[j + 1].t - after[j].t : Infinity;
      // on stand: a stop that lasts, or the stop after which the transponder went off
      if (span >= STOP_IN_S || (gapAfter >= TRANSPONDER_OFF_S && j > i)) {
        const prevMoving = i > 0 ? after[i - 1] : null;
        inn = prevMoving ? Math.round((pt.t + prevMoving.t) / 2) : pt.t;
        break;
      }
      i = j;
    }
    if (inn != null && (inn - on > 45 * 60 || inn - on < 2 * 60)) inn = null;
  }

  return { cs: leg.cs, o, d, out, off, on, in: inn, t0: p0.t };
}
