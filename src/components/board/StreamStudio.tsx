"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { allStages, PRESETS, STAGES, type GateFlight, type GateState, type SceneRule, type StageTurns } from "@/lib/board/gate";
import {
  BACKS,
  look,
  layersTo,
  MAX_ALTS,
  MAX_LAYERS,
  MAX_STEPS,
  SHOWS_VS,
  SIZES,
  STEP_DEFAULT_S,
  STEP_MAX_S,
  STEP_MIN_S,
  stepAt,
  turnsFrom,
  turnsTo,
  turning,
  VIEW_GROUPS,
  VIEW_INFO,
  type Layers,
  type Look,
  type LookPos,
  type ShownView,
  type Turns,
} from "@/lib/board/looks";
import { viewStage, type FlightState, type ViewStage } from "@/lib/feed/core";
import type { FlightFeed } from "@/lib/feed/useFlightFeed";
import { MiniScreen, sampleLive } from "./GateViews";
import type { GateWx } from "./GateScreen";

/**
 * The Stream studio (1.12): what each OBS scene shows at each stage of the flight. Scenes on the
 * left (like OBS's own Scenes dock), the chosen scene's flight as a timeline in the middle, what
 * OBS shows on the right. A stage opens the look editor: every view, its size and corner, the flip
 * card's back sides, up to three layers.
 */

export const STAGE_INFO: Record<ViewStage, { name: string; when: string }> = {
  ready: { name: "At the gate", when: "until the aircraft moves" },
  taxi: { name: "Taxi", when: "push-back to wheels off" },
  climb: { name: "Climb", when: "wheels off to the cruise level" },
  cruise: { name: "Cruise", when: "at the cruise level, and the descent above FL100" },
  approaching: { name: "Approaching", when: "below FL100 with the seatbelt sign on, to the stand" },
  arrived: { name: "Arrived", when: "engines and seatbelt sign off, or 2 min after the sign goes off" },
};

/** -1: "any other scene" (the stage table); 0…: a named OBS scene. */
type SceneIx = number;
const OTHER = -1;

const MY_LOOKS = "ofp:my-looks";
type MyLook = { name: string; token: string };
function readMyLooks(): MyLook[] {
  try {
    const v = JSON.parse(localStorage.getItem(MY_LOOKS) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x?.name === "string" && typeof x?.token === "string" && turnsFrom(x.token)).slice(0, 24) : [];
  } catch {
    return [];
  }
}
function writeMyLooks(v: MyLook[]) {
  try {
    localStorage.setItem(MY_LOOKS, JSON.stringify(v));
  } catch {
    /* private window: they last for this page */
  }
}

const lookName = (l: Look) => VIEW_INFO[l.v].name;
const sizeName = (l: Look) => (VIEW_INFO[l.v].kind === "screen" ? "Full screen" : SIZES.find((s) => s.k === l.size)!.name);
const layersName = (ls: Layers) => ls.map(lookName).join(" + ");
const codes = (ls: Layers) => ls.map((l) => VIEW_INFO[l.v].code).join("+");
/** 1.14: a stage's first look (its rotation's first step). */
const first = (t: Turns) => t[0].alts[0];
/** The picker's group a view is in. */
const groupOf = (v: ShownView) => VIEW_GROUPS.find((g) => g.views.includes(v))?.k ?? "screens";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const turnsName = (t: Turns) => (turning(t) ? `Rotation: ${t.map((st) => `${st.alts.map(layersName).join(" / ")} ${mmss(st.secs)}`).join(" → ")}` : layersName(first(t)));
const turnsCodes = (t: Turns) => (turning(t) ? t.map((st) => st.alts.map(codes).join("/")).join(" → ") : codes(first(t)));

export function StreamStudio({
  gate,
  flight,
  now,
  wx,
  feed,
  urlFor,
  onPatch,
}: {
  gate: GateState;
  flight: GateFlight;
  now: number;
  wx: GateWx | null;
  feed: FlightFeed;
  urlFor: (scene: string) => string;
  onPatch: (p: Partial<GateState>) => void;
}) {
  const [sel, setSel] = useState<SceneIx>(() => (gate.scenes.length ? 0 : OTHER));
  const [pv, setPv] = useState<ViewStage | "now">("now");
  const [pvBack, setPvBack] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ scene: SceneIx; stage: ViewStage } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const scene = sel >= 0 && sel < gate.scenes.length ? sel : OTHER;
  const stagesOf = (i: SceneIx) => (i === OTHER ? gate.stages : gate.scenes[i][1]);
  const nameOf = (i: SceneIx) => (i === OTHER ? "Any other scene" : gate.scenes[i][0]);
  const cur = stagesOf(scene);
  const liveStage: ViewStage | null = gate.hold ?? (feed.state ? viewStage(feed.state, feed.plan) : null);
  const samples = useMemo(() => Object.fromEntries(STAGES.map((k) => [k, sampleLive(flight, k, now)])) as Record<ViewStage, FlightState>, [flight, now]);

  const setStages = (i: SceneIx, st: StageTurns) => {
    if (i === OTHER) onPatch({ stages: st });
    else onPatch({ scenes: gate.scenes.map((sc, j): SceneRule => (j === i ? [sc[0], st] : sc)) });
  };
  const addScene = () => {
    const n = gate.scenes.length + 1;
    onPatch({ scenes: [...gate.scenes, [`Scene ${n}`, allStages("frame")]] });
    setSel(gate.scenes.length);
  };
  const rename = (i: SceneIx, name: string) => onPatch({ scenes: gate.scenes.map((sc, j): SceneRule => (j === i ? [name.replace(/[;:,]/g, "").slice(0, 40), sc[1]] : sc)) });
  const remove = (i: SceneIx) => {
    if (!window.confirm(`Remove the scene “${gate.scenes[i][0]}”? Its OBS source then shows “Any other scene”.`)) return;
    onPatch({ scenes: gate.scenes.filter((_, j) => j !== i) });
    setSel(OTHER);
  };
  const copy = (key: string, text: string) =>
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });

  const pvStage: ViewStage = pv === "now" ? (liveStage ?? "ready") : pv;
  const pvLive = pv === "now" ? (feed.state ?? samples[pvStage]) : samples[pvStage];
  // a rotation turns in the preview too (on the clock)
  const pvTurns = cur[pvStage];
  const pvLayers = stepAt(pvTurns, now).ls;
  const pvFlip = pvLayers.find((l) => VIEW_INFO[l.v].flip);
  const sceneName = scene === OTHER ? null : gate.scenes[scene][0];

  return (
    <div className="st">
      {/* scenes, like OBS's own Scenes dock */}
      <nav className="st-scenes" aria-label="OBS scenes">
        <h4 className="ctl-label">OBS scenes</h4>
        <ul>
          {[OTHER, ...gate.scenes.map((_, i) => i)].map((i) => (
            <li key={i}>
              <button type="button" className={`st-scene${i === scene ? " is-on" : ""}`} aria-current={i === scene} onClick={() => setSel(i)}>
                <b>{nameOf(i)}</b>
                <small>{i === OTHER ? "every scene not named here" : summary(stagesOf(i))}</small>
                <span className="st-scene-strip" aria-hidden="true">
                  {STAGES.map((k) => (
                    <Glyph key={k} ls={first(stagesOf(i)[k])} />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="st-add" onClick={addScene} disabled={gate.scenes.length >= 8}>
          + Add an OBS scene
        </button>
        <p className="muted small">Name them exactly as in OBS. A source that isn’t in a named scene follows “Any other scene”.</p>
      </nav>

      <div className="st-main">
        {/* the chosen scene's flight */}
        <section className="st-card" aria-label={`${nameOf(scene)}: what it shows at each stage`}>
          <div className="st-head">
            {scene === OTHER ? (
              <h4 className="st-title">Any other scene</h4>
            ) : (
              <input className="st-title st-name" value={gate.scenes[scene][0]} aria-label="OBS scene name" maxLength={40} onChange={(e) => rename(scene, e.target.value)} />
            )}
            <span className="st-badge">{scene === OTHER ? "Default" : "OBS scene"}</span>
            <span className="st-grow" />
            <label className="st-from">
              <span className="sr-only">Start this scene from a preset</span>
              <select
                className="ctl-input"
                value=""
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.name === e.target.value);
                  if (p) setStages(scene, p.stages);
                }}
              >
                <option value="">Start from…</option>
                {PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}: {p.note}
                  </option>
                ))}
              </select>
            </label>
            {sceneName && (
              <button type="button" className="btn" onClick={() => copy(`url:${scene}`, urlFor(sceneName))}>
                {copied === `url:${scene}` ? "Copied" : "Copy URL for this scene"}
              </button>
            )}
            {scene !== OTHER && (
              <button type="button" className="btn btn-icon" aria-label={`Remove ${gate.scenes[scene][0]}`} title="Remove this scene" onClick={() => remove(scene)}>
                ×
              </button>
            )}
          </div>
          <ol className="st-timeline">
            {STAGES.map((k, i) => {
              const t = cur[k];
              const ls = first(t);
              const same = i > 0 && turnsTo(cur[STAGES[i - 1]]) === turnsTo(t);
              return (
                <li key={k} className={`st-stage${k === liveStage ? " is-now" : ""}`}>
                  <span className="st-dot" aria-hidden="true" />
                  <span className="st-stage-name">
                    <b>{STAGE_INFO[k].name}</b>
                    {k === liveStage && <small>now</small>}
                  </span>
                  <button type="button" className={`st-look${edit?.scene === scene && edit.stage === k ? " is-open" : ""}`} onClick={() => setEdit({ scene, stage: k })} aria-label={`${STAGE_INFO[k].name}: ${turnsName(t)}. Change`}>
                    <MiniScreen view={ls} flight={flight} state={{ ...gate, hold: null }} now={now} wx={wx} live={samples[k]} source="link" trail={[]} plan={feed.plan} />
                    <span className="st-look-name">
                      <b>{turning(t) ? `${layersName(ls)} and ${t.length > 1 ? `${t.length - 1} more` : "others"}` : layersName(ls)}</b>
                      <span className="mono">{turnsCodes(t)}</span>
                    </span>
                    <span className="st-tags">
                      {turning(t) && <span className="st-tag is-turn">rotates</span>}
                      <span className="st-tag">{sizeName(ls[0])}</span>
                      {ls.some((l) => VIEW_INFO[l.v].flip) && <span className="st-tag is-flip">flips</span>}
                      {ls.length > 1 && <span className="st-tag">{ls.length} layers</span>}
                      {same && <span className="st-tag is-same">same as before</span>}
                    </span>
                  </button>
                  <small className="st-when">{STAGE_INFO[k].when}</small>
                </li>
              );
            })}
          </ol>
          <div className="st-quick" role="group" aria-label="Quick changes">
            <span className="ctl-label">Quick</span>
            <button type="button" className="btn btn-sm" onClick={() => setStages(scene, allStages(cur[pvStage]))}>
              {STAGE_INFO[pvStage].name}’s look all flight
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setStages(scene, { ...cur, arrived: cur.ready })}>
              Arrived = At the gate
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setStages(scene, { ...cur, climb: cur.cruise })}>
              Climb = Cruise
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setStages(scene, { ...cur, approaching: cur.cruise })}>
              Approaching = Cruise
            </button>
          </div>
        </section>

        {/* every scene × stage at a glance */}
        <section className="st-card st-ov" aria-label="All scenes at a glance">
          <h4 className="ctl-label">All scenes at a glance</h4>
          <div className="st-ov-grid" role="table">
            <div role="row" className="st-ov-row is-head">
              <span role="columnheader" />
              {STAGES.map((k) => (
                <span role="columnheader" key={k}>
                  {STAGE_INFO[k].name}
                </span>
              ))}
            </div>
            {[OTHER, ...gate.scenes.map((_, i) => i)].map((i) => (
              <div role="row" className={`st-ov-row${i === scene ? " is-on" : ""}`} key={i}>
                <span role="rowheader">
                  <button type="button" className="linkish" onClick={() => setSel(i)}>
                    {nameOf(i)}
                  </button>
                </span>
                {STAGES.map((k) => {
                  const t = stagesOf(i)[k];
                  const ls = first(t);
                  return (
                    <span role="cell" key={k}>
                      <button
                        type="button"
                        className="st-ov-cell"
                        onClick={() => {
                          setSel(i);
                          setEdit({ scene: i, stage: k });
                        }}
                        title={`${nameOf(i)} · ${STAGE_INFO[k].name}: ${turnsName(t)}`}
                      >
                        <Glyph ls={ls} />
                        <span className="mono">
                          {turning(t) ? `${codes(ls)} ⟳${t.length}` : codes(ls)}
                          {!turning(t) && VIEW_INFO[ls[0].v].kind !== "screen" && ` ${ls[0].size.toUpperCase()}`}
                        </span>
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* what OBS shows */}
      <aside className="st-card st-pv" aria-label="What OBS shows">
        <h4 className="ctl-label">What OBS shows · {nameOf(scene)}</h4>
        <div className="seg st-pv-seg" role="radiogroup" aria-label="At which stage">
          <button type="button" role="radio" aria-checked={pv === "now"} className="seg-btn" onClick={() => setPv("now")}>
            Now
          </button>
          {STAGES.map((k) => (
            <button type="button" role="radio" key={k} aria-checked={pv === k} className="seg-btn" onClick={() => setPv(k)}>
              {STAGE_INFO[k].name}
            </button>
          ))}
        </div>
        <MiniScreen view={pvLayers} back={pvFlip ? (pvBack ?? (pv === "now" ? null : -1)) : -1} flight={flight} state={{ ...gate, hold: null }} now={now} wx={wx} live={pvLive} source={pv === "now" && feed.state ? feed.using : "link"} trail={pv === "now" ? feed.trail : []} plan={feed.plan} />
        {pvFlip && (
          <div className="seg st-pv-seg" role="radiogroup" aria-label="Which side of the flip card">
            <button type="button" role="radio" aria-checked={pvBack == null} className="seg-btn" onClick={() => setPvBack(null)}>
              Front
            </button>
            {pvFlip.backs.map((b, i) => (
              <button type="button" role="radio" key={b} aria-checked={pvBack === i} className="seg-btn" onClick={() => setPvBack(i)}>
                {BACKS.find((x) => x.k === b)?.name}
              </button>
            ))}
          </div>
        )}
        <p className="muted small">
          {nameOf(scene)} {pv === "now" ? (liveStage ? `now (${STAGE_INFO[liveStage].name.toLowerCase()})` : "now") : `at “${STAGE_INFO[pvStage].name}”, an example of this flight`}: {turnsName(pvTurns)}
          {pvFlip ? `, turning over every ${mmss(pvFlip.every)} for ${mmss(pvFlip.hold)}` : ""}. The see-through parts show your game.
        </p>
      </aside>

      {edit && (
        <LookEditor
          key={`${edit.scene}:${edit.stage}`}
          gate={gate}
          flight={flight}
          now={now}
          wx={wx}
          plan={feed.plan}
          samples={samples}
          sceneName={nameOf(edit.scene)}
          stage={edit.stage}
          stages={stagesOf(edit.scene)}
          onSave={(st) => setStages(edit.scene, st)}
          onStage={(k) => setEdit({ scene: edit.scene, stage: k })}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function summary(st: StageTurns): string {
  const u = [...new Set(STAGES.map((k) => turnsCodes(st[k])))];
  return u.length === 1 ? `${turnsName(st.ready)} all flight` : u.join(" · ");
}

/** A tiny picture of where the look sits on the screen (the scenes list and the overview). */
function Glyph({ ls }: { ls: Layers }) {
  return (
    <span className="st-glyph">
      {ls.map((l, i) => {
        const k = VIEW_INFO[l.v].kind;
        if (k === "screen") return <i key={i} className={`is-screen${l.v === "frame" || l.v === "mapwin" ? " is-win" : ""}`} />;
        const sz = l.size === "s" ? 0.75 : l.size === "l" ? 1.3 : 1;
        const w = (k === "bar" ? 84 : k === "pill" ? 34 : 34) * (k === "bar" ? 1 : sz);
        const h = (k === "box" ? 34 : 14) * sz;
        const left = k === "bar" ? 8 : l.pos.endsWith("l") ? 6 : l.pos.endsWith("r") ? 94 - w : (100 - w) / 2;
        const top = l.pos.startsWith("t") ? 8 : l.pos.startsWith("b") ? 92 - h : (100 - h) / 2;
        return <i key={i} className={`is-${k}`} style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` } as CSSProperties} />;
      })}
    </span>
  );
}

/* ---------- the look editor: a stage of a scene, every view, its settings, layers ---------- */

const GRID: (LookPos | null)[] = ["tl", "tc", "tr", "ml", null, "mr", "bl", "bc", "br"];
const POS_NAME: Record<LookPos, string> = { tl: "top left", tc: "top centre", tr: "top right", ml: "middle left", mr: "middle right", bl: "bottom left", bc: "bottom centre", br: "bottom right" };

function LookEditor({
  gate,
  flight,
  now,
  wx,
  plan,
  samples,
  sceneName,
  stage,
  stages,
  onSave,
  onStage,
  onClose,
}: {
  gate: GateState;
  flight: GateFlight;
  now: number;
  wx: GateWx | null;
  plan: FlightFeed["plan"];
  samples: Record<ViewStage, FlightState>;
  sceneName: string;
  stage: ViewStage;
  stages: StageTurns;
  onSave: (st: StageTurns) => void;
  onStage: (k: ViewStage) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // 1.14: the stage's rotation; the look being edited is one step's look (one of its alternatives)
  const [turns, setTurns] = useState<Turns>(() => turnsFrom(turnsTo(stages[stage]))!);
  const [at, setAt] = useState({ i: 0, a: 0 });
  const draft = turns[at.i].alts[at.a];
  const setDraft = (v: Layers | ((d: Layers) => Layers)) =>
    setTurns((t) => t.map((st, i) => (i !== at.i ? st : { ...st, alts: st.alts.map((ls, a) => (a !== at.a ? ls : typeof v === "function" ? v(ls) : v)) })));
  const [layer, setLayer] = useState(0);
  const [also, setAlso] = useState<ViewStage[]>([]);
  const [group, setGroup] = useState(() => groupOf(first(stages[stage])[0].v));
  const [back, setBack] = useState<number | null>(null);
  const [mine, setMine] = useState<MyLook[]>(readMyLooks);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const cur = draft[Math.min(layer, draft.length - 1)];
  const info = VIEW_INFO[cur.v];
  const setCur = (p: Partial<Look>) => setDraft((d) => d.map((l, i) => (i === layer ? { ...l, ...p } : l)));
  const pick = (v: ShownView) => {
    const i = VIEW_INFO[v];
    // keep the size and corner when they still apply
    const keep = i.kind !== "screen" && VIEW_INFO[cur.v].kind === i.kind;
    setCur({ ...look(v), size: i.kind === "screen" ? "m" : cur.size, pos: keep ? cur.pos : i.pos });
    setBack(null);
  };
  const save = (next?: ViewStage) => {
    const st = { ...stages, [stage]: turns };
    for (const k of also) st[k] = turns;
    onSave(st);
    if (next) onStage(next);
    else onClose();
  };
  const myGroup = group === "mine";
  const shown = myGroup ? [] : (VIEW_GROUPS.find((g) => g.k === group)?.views ?? []);

  return (
    <dialog ref={ref} className="st-dlg" aria-labelledby="st-dlg-h" onClose={onClose} onCancel={onClose}>
      <header className="st-dlg-h">
        <h3 id="st-dlg-h">
          {sceneName} <span>· {STAGE_INFO[stage].name}</span>
        </h3>
        <span className="st-grow" />
        <div className="seg" role="radiogroup" aria-label="Stage (keeps this change)">
          {STAGES.map((k) => (
            <button type="button" role="radio" key={k} aria-checked={k === stage} className="seg-btn" onClick={() => k !== stage && save(k)}>
              {STAGE_INFO[k].name}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-icon" aria-label="Close without saving" onClick={onClose}>
          ×
        </button>
      </header>

      <TurnsBar
        turns={turns}
        at={at}
        onPick={(i, a) => {
          setAt({ i, a });
          setLayer(0);
          setGroup(groupOf(turns[i].alts[a][0].v));
        }}
        onChange={(t, next) => {
          setTurns(t);
          if (next) {
            setAt(next);
            const ls = t[next.i]?.alts[next.a];
            if (ls) setGroup(groupOf(ls[0].v));
          }
          setLayer(0);
        }}
      />

      <div className="st-layers" role="tablist" aria-label="Layers">
        {draft.map((l, i) => (
          <button type="button" role="tab" key={i} aria-selected={i === layer} className={`st-layer${i === layer ? " is-on" : ""}`} onClick={() => setLayer(i)}>
            <span className="ctl-label">Layer {i + 1}</span>
            {lookName(l)}
            {draft.length > 1 && (
              <span
                className="st-layer-x"
                role="button"
                tabIndex={0}
                aria-label={`Remove layer ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDraft((d) => d.filter((_, j) => j !== i));
                  setLayer(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDraft((d) => d.filter((_, j) => j !== i));
                    setLayer(0);
                  }
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        {draft.length < MAX_LAYERS && (
          <button
            type="button"
            className="st-layer is-add"
            onClick={() => {
              setDraft((d) => [...d, look("pill")]);
              setLayer(draft.length);
              setGroup("bars");
            }}
          >
            + Add a layer
          </button>
        )}
        <span className="muted small st-layers-note">Layers stack on one screen, e.g. a strip with a map corner above it.</span>
      </div>

      <div className="st-dlg-body">
        <nav className="st-groups" aria-label="Kinds of view">
          {VIEW_GROUPS.map((g) => (
            <button type="button" key={g.k} className={`st-group${group === g.k ? " is-on" : ""}`} aria-pressed={group === g.k} onClick={() => setGroup(g.k)}>
              {g.name}
              <small>{g.views.length}</small>
            </button>
          ))}
          <hr />
          <button type="button" className={`st-group${myGroup ? " is-on" : ""}`} aria-pressed={myGroup} onClick={() => setGroup("mine")}>
            My looks
            <small>{mine.length}</small>
          </button>
        </nav>

        <div className="st-gallery">
          {shown.map((v) => {
            const l = cur.v === v ? cur : { ...look(v), size: VIEW_INFO[v].kind === "screen" ? "m" : cur.size, pos: VIEW_INFO[v].kind === VIEW_INFO[cur.v].kind ? cur.pos : VIEW_INFO[v].pos };
            const others = draft.filter((_, i) => i !== layer);
            return (
              <button type="button" key={v} className={`st-opt${cur.v === v ? " is-on" : ""}`} aria-pressed={cur.v === v} onClick={() => pick(v)}>
                <MiniScreen view={layer === 0 ? [l as Look, ...others] : [...others.slice(0, layer), l as Look, ...others.slice(layer)]} flight={flight} state={{ ...gate, hold: null }} now={now} wx={wx} live={samples[stage]} source="link" trail={[]} plan={plan} />
                <span className="st-look-name">
                  <b>{VIEW_INFO[v].name}</b>
                  <span className="mono">{VIEW_INFO[v].code}</span>
                </span>
                <small>{VIEW_INFO[v].note}</small>
              </button>
            );
          })}
          {myGroup &&
            (mine.length ? (
              mine.map((m, i) => {
                const mt = turnsFrom(m.token)!;
                const ls = first(mt);
                return (
                  <div key={`${m.token}${i}`} className="st-opt is-mine">
                    <button
                      type="button"
                      className="st-opt-pick"
                      onClick={() => {
                        // a saved rotation takes the stage's whole rotation; a look this step's look
                        if (turning(mt)) {
                          setTurns(mt);
                          setAt({ i: 0, a: 0 });
                        } else setDraft(ls);
                        setLayer(0);
                      }}
                    >
                      <MiniScreen view={ls} flight={flight} state={{ ...gate, hold: null }} now={now} wx={wx} live={samples[stage]} source="link" trail={[]} plan={plan} />
                      <span className="st-look-name">
                        <b>{m.name}</b>
                        <span className="mono">{turnsCodes(mt)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="linkish small"
                      onClick={() => {
                        const v = mine.filter((_, j) => j !== i);
                        setMine(v);
                        writeMyLooks(v);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="muted small st-empty">Nothing saved yet. Set up a look, then “Save to My looks” to use it again in any scene. They’re kept in this browser.</p>
            ))}
        </div>

        <div className="st-side">
          <MiniScreen view={draft} back={info.flip ? (back ?? -1) : -1} flight={flight} state={{ ...gate, hold: null }} now={now} wx={wx} live={samples[stage]} source="link" trail={[]} plan={plan} />
          <p className="st-side-name">
            <b>{lookName(cur)}</b> <span className="mono">{info.code}</span>
            <br />
            <span className="muted small">{info.note}</span>
          </p>

          {info.kind !== "screen" && (
            <>
              <div className="st-field">
                <span className="ctl-label">Size</span>
                <div className="seg" role="radiogroup" aria-label="Size">
                  {SIZES.map((s) => (
                    <button type="button" role="radio" key={s.k} aria-checked={cur.size === s.k} className="seg-btn" onClick={() => setCur({ size: s.k })}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="st-field">
                <span className="ctl-label">Position</span>
                <div className="st-pos" role="radiogroup" aria-label="Position on the screen">
                  {GRID.map((p, i) =>
                    p ? (
                      <button type="button" role="radio" key={p} aria-checked={cur.pos === p} aria-label={POS_NAME[p]} title={POS_NAME[p]} disabled={info.kind === "bar" && !p.endsWith("c")} onClick={() => setCur({ pos: p })} />
                    ) : (
                      <span key={i} aria-hidden="true" />
                    ),
                  )}
                </div>
                {info.kind === "bar" && <small className="muted">The strip runs the width: top, middle or bottom.</small>}
              </div>
            </>
          )}

          {info.flip && (
            <fieldset className="st-field st-flip">
              <legend className="ctl-label">Back sides, in turn</legend>
              {BACKS.map((b) => (
                <label key={b.k} className={`st-check${b.ready ? "" : " is-later"}`}>
                  <input
                    type="checkbox"
                    disabled={!b.ready}
                    checked={cur.backs.includes(b.k)}
                    onChange={(e) => setCur({ backs: e.target.checked ? [...cur.backs, b.k] : cur.backs.filter((x) => x !== b.k) })}
                  />
                  <span>
                    {b.name}
                    <small>{b.ready ? b.note : b.needs}</small>
                  </span>
                </label>
              ))}
              <label className="st-range">
                <span>Front for</span>
                <input type="range" min={60} max={600} step={30} value={cur.every} onChange={(e) => setCur({ every: Number(e.target.value) })} />
                <b className="mono">{mmss(cur.every)}</b>
              </label>
              <label className="st-range">
                <span>Back for</span>
                <input type="range" min={20} max={120} step={5} value={cur.hold} onChange={(e) => setCur({ hold: Number(e.target.value) })} />
                <b className="mono">{mmss(cur.hold)}</b>
              </label>
              <label className="st-check">
                <input type="checkbox" checked={cur.only} onChange={(e) => setCur({ only: e.target.checked })} />
                <span>
                  Back sides only
                  <small>For a rotation’s step: straight to the back sides, each for the “Back for” time, from when the step begins.</small>
                </span>
              </label>
              <small className="muted">{cur.only ? "Back sides only: it doesn’t wait on the front." : "It stays on the front on the ground, at take-off, on approach and landing."}</small>
              <div className="seg" role="radiogroup" aria-label="Preview side">
                <button type="button" role="radio" aria-checked={back == null} className="seg-btn" onClick={() => setBack(null)}>
                  Front
                </button>
                {cur.backs.map((b, i) => (
                  <button type="button" role="radio" key={b} aria-checked={back === i} className="seg-btn" onClick={() => setBack(i)}>
                    {BACKS.find((x) => x.k === b)?.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {!info.noBelt && (
            <label className="st-check">
              <input type="checkbox" checked={cur.belt} onChange={(e) => setCur({ belt: e.target.checked })} />
              <span>
                Seatbelt sign
                <small>A small lit sign while it’s on in the aircraft.</small>
              </span>
            </label>
          )}
          {SHOWS_VS.includes(cur.v) && (
            <label className="st-check">
              <input type="checkbox" checked={cur.vs} onChange={(e) => setCur({ vs: e.target.checked })} />
              <span>
                Vertical speed
                <small>{cur.v === "strip" ? "Climbing ↑, descending ↓ or level, in ft/min." : "The level and ↑ or ↓ ft/min while climbing or descending."}</small>
              </span>
            </label>
          )}
        </div>
      </div>

      <footer className="st-dlg-f">
        <span className="ctl-label">Also use for</span>
        <div className="st-also" role="group" aria-label="Also use this look for">
          {STAGES.filter((k) => k !== stage).map((k) => (
            <button type="button" key={k} className="btn btn-sm" aria-pressed={also.includes(k)} onClick={() => setAlso((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))}>
              {STAGE_INFO[k].name}
            </button>
          ))}
        </div>
        <span className="st-grow" />
        <button
          type="button"
          className="linkish"
          onClick={() => {
            // a rotation is saved whole; else the look
            const token = turning(turns) ? turnsTo(turns) : layersTo(draft);
            const name = turning(turns) ? turnsName(turns) : `${layersName(draft)} · ${sizeName(draft[0])}`;
            const v = [{ name, token }, ...mine.filter((m) => m.token !== token)].slice(0, 24);
            setMine(v);
            writeMyLooks(v);
          }}
        >
          Save to My looks
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => save()}>
          {turning(turns) ? "Use this rotation" : "Use this look"}
        </button>
      </footer>
    </dialog>
  );
}

/**
 * 1.14: a stage's rotation: its steps in order, each with its seconds and its looks (more than one:
 * one per time round). One step is the stage's only look.
 */
function TurnsBar({
  turns,
  at,
  onPick,
  onChange,
}: {
  turns: Turns;
  at: { i: number; a: number };
  onPick: (i: number, a: number) => void;
  onChange: (t: Turns, at?: { i: number; a: number }) => void;
}) {
  const many = turns.length > 1;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= turns.length) return;
    const t = [...turns];
    [t[i], t[j]] = [t[j], t[i]];
    onChange(t, { i: j, a: 0 });
  };
  const copy = (ls: Layers) => ls.map((l) => ({ ...l, backs: [...l.backs] }));
  return (
    <div className="st-turns" role="group" aria-label="Rotation">
      <span className="ctl-label">{many || turning(turns) ? "Rotation" : "Look"}</span>
      <ol className="st-turn-list">
        {turns.map((st, i) => (
          <li key={i} className={`st-turn${i === at.i ? " is-on" : ""}`}>
            <span className="st-turn-n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="st-turn-alts">
              {st.alts.map((ls, a) => (
                <button type="button" key={a} className="st-turn-alt" aria-pressed={i === at.i && a === at.a} onClick={() => onPick(i, a)} title={st.alts.length > 1 ? `Time round ${a + 1}` : undefined}>
                  {layersName(ls)}
                </button>
              ))}
              {st.alts.length < MAX_ALTS && many && (
                <button
                  type="button"
                  className="linkish small"
                  title="Each time round this step shows the next of its looks"
                  onClick={() => onChange(turns.map((x, j) => (j === i ? { ...x, alts: [...x.alts, copy(x.alts[x.alts.length - 1])] } : x)), { i, a: st.alts.length })}
                >
                  + another look, next time round
                </button>
              )}
            </span>
            {many && (
              <label className="st-turn-secs">
                <span className="sr-only">Step {i + 1} for</span>
                <input
                  type="number"
                  className="ctl-input mono"
                  min={STEP_MIN_S}
                  max={STEP_MAX_S}
                  step={5}
                  value={st.secs}
                  onChange={(e) => onChange(turns.map((x, j) => (j === i ? { ...x, secs: Math.max(STEP_MIN_S, Math.min(STEP_MAX_S, Number(e.target.value) || STEP_DEFAULT_S)) } : x)))}
                />
                <span>s</span>
              </label>
            )}
            {many && (
              <span className="st-turn-act">
                <button type="button" className="btn btn-icon btn-sm" aria-label={`Move step ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ←
                </button>
                <button type="button" className="btn btn-icon btn-sm" aria-label={`Move step ${i + 1} later`} disabled={i === turns.length - 1} onClick={() => move(i, 1)}>
                  →
                </button>
                <button
                  type="button"
                  className="btn btn-icon btn-sm"
                  aria-label={i === at.i && st.alts.length > 1 ? `Remove this look from step ${i + 1}` : `Remove step ${i + 1}`}
                  onClick={() =>
                    i === at.i && st.alts.length > 1
                      ? onChange(turns.map((x, j) => (j === i ? { ...x, alts: x.alts.filter((_, a) => a !== at.a) } : x)), { i, a: 0 })
                      : onChange(turns.filter((_, j) => j !== i), { i: Math.max(0, Math.min(i, turns.length - 2)), a: 0 })
                  }
                >
                  ×
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {turns.length < MAX_STEPS && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onChange([...turns.map((x) => (turns.length === 1 ? { ...x, secs: 240 } : x)), { alts: [[look("strip")]], secs: STEP_DEFAULT_S }], { i: turns.length, a: 0 })}
        >
          {many ? "+ Add a step" : "+ Rotate: add a second look"}
        </button>
      )}
      <small className="muted st-turns-note">
        {many ? "The steps take turns, round and round, from the first each time the stage starts. A step with several looks shows the next one each time round." : "One look the whole stage. Add a second to make them take turns."}
      </small>
    </div>
  );
}
