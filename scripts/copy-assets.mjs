// Copies runtime assets from node_modules into public/ (gitignored, regenerated on dev/build):
//  - flag-icons 4x3 SVGs, served at /flags/<iso2>.svg
//  - coastline and border outlines for the maps, at /geo/outlines-50m.json (see build-geo.mjs)
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { buildGeo } from "./build-geo.mjs";

const require = createRequire(import.meta.url);
mkdirSync("public", { recursive: true });
const flags = join(dirname(require.resolve("flag-icons/package.json")), "flags", "4x3");
cpSync(flags, "public/flags", { recursive: true });
buildGeo("50m");
