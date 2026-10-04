// Writes <out>/routes.json: flights per airline on every route, so the app can show which
// airlines serve an airport (and how many flights) without downloading every airline file.
//   { schema: 1, routes: { ORIG: { DEST: { BRAND: flights } } } }
// Run on its own (`node scripts/snapshot/route-index.mjs [outDir]`) or from writeOutput.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function writeRouteIndex(outDir) {
  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const routes = {};
  for (const info of manifest.airlines) {
    const { flights } = JSON.parse(readFileSync(join(outDir, "airlines", `${info.icao}.json`), "utf8"));
    for (const f of flights) {
      const byDest = (routes[f.o] ??= {});
      const byAl = (byDest[f.d] ??= {});
      byAl[info.icao] = (byAl[info.icao] ?? 0) + 1;
    }
  }
  writeFileSync(join(outDir, "routes.json"), JSON.stringify({ schema: 1, routes }));
  return Object.keys(routes).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? process.env.SNAPSHOT_OUT ?? "public/data";
  console.log(`routes.json: ${writeRouteIndex(out)} origins`);
}
