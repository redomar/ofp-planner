/**
 * Whole-browser backup: every "ofp-planner:" localStorage entry (plus the theme) as raw
 * strings in one gzipped JSON file, and a restore that puts them back exactly. The weather
 * cache is left out (stale within the hour). Restoring replaces what's stored here.
 */
import { KEYS } from "./storage";
import { WX_PREFIX } from "./wx/cache";
import { THEME_KEY } from "./keys";

export const BACKUP_SCHEMA = "ofp-planner/backup";
const NS = "ofp-planner:";
const MAX_BYTES = 20 * 1024 * 1024;

export interface Backup {
  schema: typeof BACKUP_SCHEMA;
  version: 1;
  createdAt: string; // ISO
  /** localStorage key → value, exactly as stored. */
  entries: Record<string, string>;
}

const kept = (k: string) => (k.startsWith(NS) && !k.startsWith(WX_PREFIX)) || k === THEME_KEY;

export function collectBackup(): Backup {
  const entries: Record<string, string> = {};
  for (const k of Object.keys(localStorage).sort()) if (kept(k)) entries[k] = localStorage.getItem(k) ?? "";
  return { schema: BACKUP_SCHEMA, version: 1, createdAt: new Date().toISOString(), entries };
}

const count = (raw: string | undefined) => {
  if (raw == null) return 0;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
};

/** "12 logbook flights · 8 favourites · 2 airframes" — what a backup holds, for the confirm step. */
export function describeBackup(b: Backup): string {
  const e = b.entries;
  const parts = [
    [count(e[KEYS.logbook]), "logbook flight"],
    [count(e[KEYS.favourites]), "favourite"],
    [count(e[KEYS.airframes]), "airframe"],
    [count(e[KEYS.history]), "recent flight"],
  ] as const;
  const s = parts.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`);
  return s.length ? s.join(" · ") : `${Object.keys(e).length} settings`;
}

async function pipe(data: BlobPart, stream: CompressionStream | DecompressionStream): Promise<Blob> {
  return new Response(new Blob([data]).stream().pipeThrough(stream)).blob();
}

/** The backup as a .json.gz download. */
export async function downloadBackup(b: Backup = collectBackup()) {
  const gz = await pipe(JSON.stringify(b), new CompressionStream("gzip"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([gz], { type: "application/gzip" }));
  a.download = `ofp-planner-backup-${b.createdAt.slice(0, 10)}.json.gz`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Read a backup file (gzipped or plain JSON) and check it; never trusts its contents. */
export async function readBackup(file: File): Promise<Backup | { error: string }> {
  if (file.size > MAX_BYTES) return { error: "That file is too big to be a backup." };
  const buf = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = buf[0] === 0x1f && buf[1] === 0x8b ? await (await pipe(buf, new DecompressionStream("gzip"))).text() : new TextDecoder().decode(buf);
  } catch {
    return { error: "Couldn't unpack that file (not a gzip backup?)." };
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { error: "That file isn't JSON." };
  }
  const r = v as Partial<Backup> | null;
  if (!r || r.schema !== BACKUP_SCHEMA || r.version !== 1 || typeof r.entries !== "object" || r.entries == null) return { error: "That isn't an OFP Planner backup." };
  const entries: Record<string, string> = {};
  for (const [k, val] of Object.entries(r.entries)) if (kept(k) && typeof val === "string") entries[k] = val;
  if (!Object.keys(entries).length) return { error: "That backup is empty." };
  return { schema: BACKUP_SCHEMA, version: 1, createdAt: typeof r.createdAt === "string" ? r.createdAt : "", entries };
}

/** Replace what's stored here with the backup (weather cache untouched). If the browser refuses part-way, puts the previous data back and returns false. */
export function restoreBackup(b: Backup): boolean {
  const before = collectBackup().entries;
  const put = (entries: Record<string, string>) => {
    for (const k of Object.keys(localStorage)) if (kept(k)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  };
  try {
    put(b.entries);
    return true;
  } catch {
    try {
      put(before);
    } catch {
      /* nothing more we can do */
    }
    return false;
  }
}
