/* eslint-disable @typescript-eslint/no-unused-expressions -- cond ? fail() : pass() reads best here */
// End-to-end check of the production build (out/), in a real browser:
//   pnpm build && pnpm verify            (add --shots to save 2× day/night screenshots)
// Serves out/ on a local port, then for every page at desktop and phone width, day and
// night: console errors, sideways scroll, layout shift (CLS), WCAG text contrast; plus
// the finder's flows (filter, roll, random destination, destinations list, next leg,
// SimBrief link), the brief's weather, and settings (airframes, theme).
// Chromium: Playwright's own, or CHROME_PATH, or the newest cached ms-playwright build.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";

const OUT = resolve("out");
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = process.env.SHOT_DIR ?? resolve("..", "ofp-planner-previews", process.env.SHOT_SET ?? "release");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain" };

function serve() {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let p = join(OUT, url);
    // like nginx's try_files $uri $uri.html $uri/: a page beats the folder of the same name
    if (existsSync(p) && statSync(p).isFile());
    else if (existsSync(`${p}.html`)) p = `${p}.html`;
    else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
    if (!existsSync(p)) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const app = join(cache, d, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
    if (existsSync(app)) return app;
  }
  return undefined;
}

/** In-page: every visible text element whose contrast against its effective background is below AA. */
const CONTRAST = () => {
  const parse = (c) => {
    // color-mix() resolves to color(srgb r g b / a) with 0–1 channels
    const s = c.match(/color\(srgb ([^)]+)\)/);
    if (s) {
      const [r, g, b, a = 1] = s[1].replace("/", " ").split(/\s+/).filter(Boolean).map(Number);
      return [r * 255, g * 255, b * 255, a];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [r, g, b, a];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (top, under) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
  };
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none" && !cs.backgroundImage.includes("gradient")) return null; // images: skip
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) {
        stack.push(c);
        if (c[3] >= 1) break;
      }
    }
    let out = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) out = blend(stack[i], out);
    return out;
  };
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest("svg, .sr-only, [hidden], [aria-hidden='true'], option, .site-footer-dirty")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.95) continue;
    let fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    if (fg[3] < 1) fg = blend(fg, bg);
    const [L1, L2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const ratio = (L1 + 0.05) / (L2 + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    // disabled controls are exempt from WCAG 1.4.3
    if (el.closest("[disabled], [aria-disabled='true']")) continue;
    if (ratio < need) bad.push({ text: t.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, cls: el.className?.toString().slice(0, 40) });
  }
  return bad;
};

const results = [];
const fail = (msg) => results.push(`FAIL ${msg}`);
const pass = (msg) => results.push(`ok   ${msg}`);

async function run() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath() });
  if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });
  let shotNo = 0;

  const open = async (path, { width = 1280, height = 900, theme = "light" } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: SHOTS ? 2 : 1, colorScheme: theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    // live weather services may rate-limit or be down; the page handles it, so their failures aren't app errors
    page.on("response", (r) => {
      if (r.status() >= 400 && /open-meteo\.com|vatsim\.net/.test(r.url())) errors.push(`__weather_${r.status()}`);
    });
    // an example preferred airframe (the published build ships none), unless a test already changed them
    await page.addInitScript(() => {
      if (!localStorage.getItem("ofp-planner:airframes"))
        localStorage.setItem("ofp-planner:airframes", JSON.stringify({ list: [{ id: "ex", name: "G-ABCD", icao: "A20N", sbType: "123456_1700000000000", note: "example" }], preferred: "ex" }));
    });
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          if (!e.hadRecentInput) {
            window.__cls += e.value;
            (window.__shifts ??= []).push({ v: Math.round(e.value * 1000) / 1000, src: (e.sources ?? []).map((s) => (s.node?.className?.toString?.() || s.node?.nodeName || "?").slice(0, 40)) });
          }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(base + path, { waitUntil: "networkidle" });
    return { ctx, page, errors };
  };

  const checkPage = async (label, page, errors) => {
    await page.waitForTimeout(400);
    const { sw, iw, cls, shifts } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, cls: window.__cls, shifts: window.__shifts ?? [] }));
    sw > iw ? fail(`${label}: sideways scroll (${sw} > ${iw})`) : pass(`${label}: no sideways scroll`);
    cls > 0.02 ? fail(`${label}: layout shift CLS ${cls.toFixed(3)} ${JSON.stringify(shifts.slice(0, 4))}`) : pass(`${label}: CLS ${cls.toFixed(3)}`);
    const bad = await page.evaluate(CONTRAST);
    bad.length ? fail(`${label}: ${bad.length} contrast issues ${JSON.stringify(bad.slice(0, 6))}`) : pass(`${label}: text contrast AA`);
    // drop one "Failed to load resource" per weather-service failure seen, and the markers themselves
    let weatherFails = errors.filter((e) => e.startsWith("__weather_")).length;
    const errs = errors.filter((e) => {
      if (e.startsWith("__weather_")) return false;
      if (weatherFails > 0 && /^Failed to load resource/.test(e)) return (weatherFails--, false);
      return true;
    });
    errs.length ? fail(`${label}: console errors ${JSON.stringify(errs.slice(0, 3))}`) : pass(`${label}: 0 console errors`);
  };
  const shot = async (page, name) => {
    if (!SHOTS) return;
    shotNo++;
    await page.screenshot({ path: join(SHOT_DIR, `${String(shotNo).padStart(2, "0")}-${name}.png`), fullPage: false });
  };

  const section = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      fail(`${name}: ${String(e.message ?? e).split("\n")[0]}`);
    }
  };

  /* ---------- finder: flows (desktop, day) ---------- */
  await section("finder flows", async () => {
    const { ctx, page, errors } = await open("/?al=EZY");
    await page.waitForSelector("table.flights tbody tr", { timeout: 20000 });
    const n = await page.locator("table.flights tbody tr").count();
    n > 0 ? pass(`finder: ${n} rows shown`) : fail("finder: no rows");

    // airline tags fit the widest name in the result (no big empty space), and the list scrolls in a full-height box
    const fit = await page.evaluate(() => {
      const tags = [...document.querySelectorAll("table.flights .al-tag")].slice(0, 40);
      const slack = Math.min(...tags.map((t) => t.clientWidth - t.scrollWidth));
      const r = document.createRange();
      const widest = Math.max(...tags.map((t) => (r.selectNodeContents(t), r.getBoundingClientRect().width)));
      const w = tags[0]?.getBoundingClientRect().width ?? 0;
      return { w: Math.round(w), widest: Math.round(widest), slack };
    });
    fit.w - fit.widest <= 18 && fit.slack >= 0 ? pass(`finder: airline tag fits its names (${fit.w}px for ${fit.widest}px of text)`) : fail(`finder: airline tag ${fit.w}px for ${fit.widest}px of text`);
    const box = await page.evaluate(() => {
      const w = document.querySelector(".results .tbl-wrap");
      return { sh: w.scrollHeight, ch: w.clientHeight, vh: window.innerHeight };
    });
    box.sh > box.ch && box.ch <= box.vh ? pass(`finder: table scrolls in a ${box.ch}px box`) : fail(`finder: table box ${JSON.stringify(box)}`);

    // sorting by a column shows Reset sort; it returns to departure time, earliest first
    await page.locator("table.flights thead button.th-sort", { hasText: "Block" }).click();
    const shown = await page.getByRole("button", { name: "Reset sort" }).isVisible();
    await page.getByRole("button", { name: "Reset sort" }).click();
    const sortedCols = await page.locator("table.flights thead th[aria-sort]").count();
    const gone = await page.getByRole("button", { name: "Reset sort" }).count();
    shown && gone === 0 && sortedCols === 0 ? pass("finder: Reset sort appears after sorting and clears it (data order, no column sorted)") : fail(`finder: reset sort (shown ${shown}, gone ${gone}, sorted cols ${sortedCols})`);

    // filter: from LGW via the combobox
    await page.getByLabel("From", { exact: true }).fill("LGW");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const dep = new URL(page.url()).searchParams.get("dep");
    dep === "EGKK" ? pass("finder: From combobox (LGW → EGKK)") : fail(`finder: From combobox gave ${dep}`);

    // random destination from EGKK
    await page.getByRole("button", { name: "Random destination" }).first().click();
    await page.waitForSelector(".fcard");
    const sb = await page.locator(".fcard a.btn-primary").getAttribute("href");
    const u = new URL(sb);
    u.searchParams.get("orig") === "EGKK" && u.searchParams.get("dest") && u.searchParams.get("fltnum")
      ? pass(`finder: random destination → ${u.searchParams.get("airline")}${u.searchParams.get("fltnum")} ${u.searchParams.get("orig")}-${u.searchParams.get("dest")} type=${u.searchParams.get("type")}`)
      : fail(`finder: bad SimBrief link ${sb}`);
    u.searchParams.get("type") === "123456_1700000000000" || !/A3|A2/.test(await page.locator(".facts dd").first().innerText())
      ? pass("finder: preferred airframe (example G-ABCD) used for A320 family")
      : fail(`finder: expected the example airframe, got type=${u.searchParams.get("type")}`);
    await shot(page, "finder-day");

    // destinations tab
    await page.getByRole("tab", { name: /Destinations/ }).click();
    await page.waitForSelector(".place-list li");
    const sq = page.locator(".place-list .place-al").nth(1);
    await sq.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await sq.hover({ force: true });
    await page.waitForTimeout(150);
    const chipN = await page.locator("#ofp-tip .tip-chips .tip-chip").count();
    chipN > 0 ? pass(`finder: airline squares tooltip shows ${chipN} airline badge(s)`) : fail("finder: no airline badges in squares tooltip");
    await page.mouse.move(0, 0);
    const dn = await page.locator(".place-list li").count();
    dn > 3 ? pass(`finder: ${dn} destinations from EGKK`) : fail(`finder: only ${dn} destinations`);
    await shot(page, "destinations-day");
    // map: hovering a route loops its draw animation; destination codes shown (setting on by default)
    const mbox = await page.locator(".places .map").boundingBox();
    let loop = null;
    for (let i = 0; i < 40 && !loop; i++) {
      await page.mouse.move(mbox.x + mbox.width * (0.15 + i * 0.015), mbox.y + mbox.height * 0.6);
      loop = await page.evaluate(() => { const el = document.querySelector(".places .map-route.hover .map-line"); return el ? getComputedStyle(el).animationIterationCount : null; });
    }
    loop === "infinite" ? pass("map: hovered route replays its draw-in on a loop") : fail(`map: hover loop ${loop}`);
    await page.mouse.move(0, 0);
    // zoom: buttons in, can't go below the fitted view, ⌘/Ctrl+scroll zooms, reset returns
    const hubX = async () => page.locator(".places .map-port.hub").evaluate((g) => Number(g.getAttribute("transform").match(/translate\(([-\d.]+)/)[1]));
    const x0 = await hubX();
    const defDisabled = await page.locator(".places .map-zbtn[aria-label='Default view']").isDisabled();
    await page.locator(".places .map-zbtn[aria-label='Zoom in']").click();
    await page.locator(".places .map-zbtn[aria-label='Zoom in']").click();
    await page.waitForTimeout(300);
    const x1 = await hubX();
    await page.mouse.move(mbox.x + mbox.width / 2, mbox.y + mbox.height / 2);
    await page.mouse.wheel(0, -300); // two-finger scroll up
    await page.waitForTimeout(400);
    const kAfterWheel = await page.locator(".places .map.zoomed").count();
    await page.locator(".places .map-zreset").click();
    await page.waitForTimeout(200);
    const x2 = await hubX();
    // zooming out past the fitted view is allowed; Default view returns again
    await page.locator(".places .map-zbtn[aria-label='Zoom out']").click();
    await page.locator(".places .map-zbtn[aria-label='Zoom out']").click();
    await page.waitForTimeout(200);
    const out = await page.locator(".places .map.zoomed").count();
    await page.locator(".places .map-zreset").click();
    await page.waitForTimeout(200);
    const x3 = await hubX();
    defDisabled && x1 !== x0 && kAfterWheel === 1 && Math.abs(x2 - x0) < 0.5 && out === 1 && Math.abs(x3 - x0) < 0.5
      ? pass(`map: zoom in (+, two-finger scroll) and out past the fitted view; Default view returns (hub x ${x0.toFixed(0)} → ${x1.toFixed(0)} → ${x2.toFixed(0)})`)
      : fail(`map: zoom (default disabled ${defDisabled}, x ${x0} → ${x1} → ${x2} → ${x3}, zoomed ${kAfterWheel}, out ${out})`);
    const codesOn = await page.locator(".places .map-port:not(.hub) text").count();
    codesOn > 10 ? pass(`map: ${codesOn} destination codes shown`) : fail(`map: only ${codesOn} codes`);
    const terrainBands = await page.locator(".places .map-height, .places .map-depth").count();
    terrainBands >= 8 ? pass(`map: terrain drawn (${terrainBands} height/depth bands)`) : fail(`map: terrain bands ${terrainBands}`);
    await page.locator(".place-list .place-main").first().click({ position: { x: 40, y: 12 } });
    const arr = new URL(page.url()).searchParams.get("arr");
    arr ? pass(`finder: picking a destination sets To=${arr}`) : fail("finder: destination pick didn't set To");

    // next leg
    await page.locator("table.flights tbody tr").first().click();
    const firstDest = (await page.locator(".fcard-end.arr .code-flap .flap").getAttribute("aria-label"))?.slice(0, 4);
    await page.getByRole("button", { name: /^Next leg from/ }).click();
    await page.waitForTimeout(300);
    const dep2 = new URL(page.url()).searchParams.get("dep");
    dep2 === firstDest ? pass(`finder: next leg continues from ${dep2}`) : fail(`finder: next leg from ${dep2}, expected ${firstDest}`);

    // flag hover label: country chip + snapshot figures
    const fl = page.locator(".drawer .fcard-place .flag-tip").first();
    await fl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await fl.hover();
    await page.waitForTimeout(200);
    const ft = await page.locator("#ofp-tip").innerText();
    /airports? ·.*departing/.test(ft) ? pass(`finder: flag label (${ft.split("\n")[0]}: ${ft.split("\n")[1]?.slice(0, 40)}…)`) : fail(`finder: flag label "${ft}"`);
    await page.mouse.move(0, 0);

    // aircraft badge tooltip: maker chip + full name
    const tb = page.locator(".drawer .tbadge").first();
    await tb.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await tb.hover();
    await page.waitForTimeout(150);
    const tipText = await page.locator("#ofp-tip").innerText();
    /Airbus|Boeing|Embraer|ATR/.test(tipText) ? pass(`finder: type badge tooltip (${tipText.split("\n")[0]})`) : fail(`finder: type tooltip missing maker (${tipText})`);
    await page.mouse.move(0, 0);

    // reload keeps the view
    const before = page.url();
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".fcard");
    page.url() === before ? pass("finder: reload keeps filters and flight") : fail(`finder: reload changed URL ${page.url()}`);

    // add a flight number to a callsign-only flight: shown on the card and in the SimBrief link
    const addBtn = page.locator(".drawer .fn-add", { hasText: "Add flight number" });
    if (await addBtn.count()) {
      await addBtn.click();
      await page.locator(".drawer .fn-edit input").fill("U2 1016");
      await page.locator(".drawer .fn-edit").getByRole("button", { name: "Save" }).click();
      const title = await page.locator(".drawer .fcard-no > span").first().innerText();
      const sbFn = new URL(await page.locator(".drawer a.btn-primary").getAttribute("href")).searchParams.get("fltnum");
      const edit = await page.locator(".drawer .fn-add", { hasText: "your number" }).count();
      /1016$/.test(title) && sbFn === "1016" && edit === 1 ? pass(`finder: added flight number shows as ${title} and goes to SimBrief (fltnum=${sbFn})`) : fail(`finder: added number (title ${title}, fltnum ${sbFn}, edit ${edit})`);
      await page.locator(".drawer .fn-add", { hasText: "your number" }).click();
      await page.locator(".drawer .fn-edit").getByRole("button", { name: "Remove" }).click();
      (await page.locator(".drawer .fn-add", { hasText: "Add flight number" }).count()) === 1 ? pass("finder: removing the added number restores the callsign") : fail("finder: remove didn't restore");
    } else pass("finder: (selected flight already has a flight number)");

    // the card header folds the card (and stays pinned while it scrolls)
    await page.locator(".drawer .fcard-head .fcard-title").click();
    (await page.locator(".drawer .fcard-body").isHidden()) ? pass("finder: clicking the card header folds it") : fail("finder: header click didn't fold");
    await page.locator(".drawer .fcard-head .fcard-title").click();
    await page.locator(".drawer").evaluate((d) => d.scrollTo(0, 600));
    const headTop = await page.locator(".drawer .fcard-head").evaluate((h) => Math.round(h.getBoundingClientRect().top - h.closest(".drawer").getBoundingClientRect().top));
    headTop === 0 ? pass("finder: card header stays pinned when scrolling") : fail(`finder: header moved ${headTop}px`);

    // close the flight card → back to the empty state
    await page.getByRole("button", { name: "Close this flight" }).click();
    (await page.locator(".drawer").count()) === 0 && !new URL(page.url()).searchParams.get("f")
      ? pass("finder: × closes the flight card")
      : fail("finder: close didn't return to No flight picked");

    // clear filters resets the airline as well
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.waitForTimeout(200);
    const p2 = new URL(page.url()).searchParams;
    p2.get("al") === "" && !p2.get("dep") ? pass("finder: Clear filters resets airline to all") : fail(`finder: clear left al=${p2.get("al")} dep=${p2.get("dep")}`);

    errors.length ? fail(`finder flows: console errors ${JSON.stringify(errors.slice(0, 3))}`) : pass("finder flows: 0 console errors");
    await ctx.close();
  });

  /* ---------- airline dropdown counts for an airport ---------- */
  await section("airline counts", async () => {
    const { ctx, page, errors } = await open("/?al=&arr=LTDB");
    await page.waitForSelector("table.flights tbody tr", { timeout: 30000 });
    await page.locator(".filters .multi-btn").first().click();
    await page.waitForSelector(".multi-pop li.first-dim");
    const info = await page.evaluate(() => {
      const lis = [...document.querySelectorAll(".multi-pop li")];
      const flying = lis.filter((l) => !l.classList.contains("dim")).map((l) => [l.querySelector(".multi-label")?.firstChild?.textContent, Number(l.querySelector(".multi-count")?.textContent.replace(/,/g, ""))]);
      const rest = lis.filter((l) => l.classList.contains("dim")).map((l) => Number(l.querySelector(".multi-count")?.textContent));
      return { flying, restCount: rest.length, restMax: Math.max(0, ...rest), note: document.querySelector(".multi-note")?.textContent };
    });
    info.flying.length > 0 && info.flying.every(([, n]) => n > 0) && info.restMax === 0
      ? pass(`airline dropdown for →LTDB: ${info.flying.map(([n, c]) => `${n} ${c}`).join(", ")} · ${info.restCount} others at 0 (${info.note})`)
      : fail(`airline dropdown counts ${JSON.stringify(info)}`);
    await shot(page, "airline-counts-day");
    await checkPage("airline dropdown open 1280 light", page, errors);
    await ctx.close();
  });

  /* ---------- After (Z) filter ---------- */
  await section("after filter", async () => {
    const { ctx, page, errors } = await open("/?al=EZY&dep=EGKK&after=1200&ref=out");
    await page.waitForSelector("table.flights tbody tr");
    const deps = await page.$$eval("table.flights tbody tr td:nth-child(4)", (tds) => tds.map((t) => t.textContent.replace(/VAR|varies|~/g, "").trim()));
    const early = deps.filter((d) => !/^\d\d:\d\d$/.test(d) || d < "12:00");
    deps.length && !early.length ? pass(`after: ${deps.length} flights all off-block ≥ 12:00Z (first ${deps[0]})`) : fail(`after: early or blank rows ${JSON.stringify(early.slice(0, 5))}`);
    // layout checks on load, before the scripted typing (programmatic input isn't "recent input" for CLS)
    await checkPage("after filter 1280 light", page, errors);
    const total = await page.locator(".rollbar-count").innerText();
    // typing a time and switching to ON
    await page.getByLabel("After (Z)").fill("2000");
    await page.getByRole("radio", { name: "ON" }).click();
    await page.waitForTimeout(200);
    const u = new URL(page.url()).searchParams;
    u.get("after") === "2000" && u.get("ref") === "on" ? pass(`after: typed 2000 + ON → URL after=2000&ref=on (${await page.locator(".rollbar-count").innerText()} vs ${total} at 12:00 OUT)`) : fail(`after: URL ${u}`);
    // Clear filters leaves the After controls blank: no time, no OOOI, Scheduled unticked
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.waitForTimeout(150);
    const blank = await page.evaluate(() => ({
      time: document.querySelector(".after-time").value,
      checked: document.querySelectorAll('.seg-btn[aria-checked="true"]').length,
      sched: document.querySelector(".after-sched input").checked,
    }));
    !blank.time && !blank.checked && !blank.sched ? pass("after: Clear filters leaves time, OUT/OFF/ON/IN and Scheduled unselected") : fail(`after: not blank after clear ${JSON.stringify(blank)}`);
    await ctx.close();
  });

  /* ---------- Map tab: Madrid to anywhere in Spain ---------- */
  await section("map tab", async () => {
    const { ctx, page, errors } = await open("/?al=&dep=LEMD&arr=C:ES&view=map");
    await page.waitForSelector(".routes-tbl tbody tr", { timeout: 30000 });
    const rows = await page.$$eval(".routes-tbl tbody tr .route-btn", (bs) => bs.map((b) => b.textContent.replace(/\s+/g, "")));
    const okRows = rows.length > 3 && rows.every((r) => r.startsWith("LEMD→LE") || r.startsWith("LEMD→GC") || r.startsWith("LEMD→GE"));
    okRows ? pass(`map tab: LEMD → Spain lists ${rows.length} routes (${rows.slice(0, 4).join(", ")}…)`) : fail(`map tab rows ${JSON.stringify(rows.slice(0, 8))}`);
    const drawn = await page.locator(".routes-view .map-route").count();
    drawn === rows.length || drawn >= Math.min(rows.length, 400) ? pass(`map tab: ${drawn} routes drawn`) : fail(`map tab: drew ${drawn} of ${rows.length}`);
    await checkPage("map tab 1280 light", page, errors);
    await shot(page, "map-tab-day");
    await page.locator(".routes-tbl tbody tr").first().click();
    const u = new URL(page.url()).searchParams;
    u.get("dep") === "LEMD" && u.get("arr")?.length === 4 && !u.get("view") ? pass(`map tab: picking a route opens its flights (${u.get("dep")}→${u.get("arr")})`) : fail(`map tab: pick gave ${u}`);
    await ctx.close();
  });

  /* ---------- favourites in groups, brief start page ---------- */
  await section("favourites", async () => {
    const { ctx, page, errors } = await open("/brief");
    await page.waitForSelector(".brief-start");
    // make a group, then star a flight in the finder: it goes into that group
    await page.getByLabel("New group name").fill("Alps hops");
    await page.getByRole("button", { name: "Add group" }).click();
    await page.goto(page.url().replace(/\/brief.*$/, "/?al=EZY&dep=EGKK"), { waitUntil: "networkidle" });
    await page.waitForSelector("table.flights tbody tr");
    await page.locator("table.flights tbody tr").nth(1).click();
    await page.getByRole("button", { name: "Add to favourites" }).click();
    const grp = await page.locator(".fav-group select").inputValue();
    grp === "Alps hops" ? pass("favourites: a new star goes into the last group used") : fail(`favourites: star went to "${grp}"`);
    await page.goto(page.url().replace(/\/\?.*$/, "/brief"), { waitUntil: "networkidle" });
    await page.waitForSelector(".grp .fl-row");
    const inGroup = await page.locator(".grp", { hasText: "Alps hops" }).locator(".fl-row").count();
    inGroup === 1 ? pass("favourites: brief start page lists the group with its flight") : fail(`favourites: ${inGroup} rows in the group`);
    await page.locator(".grp", { hasText: "Alps hops" }).getByRole("button", { name: "Map" }).click();
    await page.waitForSelector(".grp-map .map-route");
    const gm = await page.locator(".grp-map .map-route").count();
    gm === 1 ? pass("favourites: a group opens its routes on a map") : fail(`favourites: group map drew ${gm} routes`);
    await checkPage("brief start page 1280 light", page, errors);
    await shot(page, "brief-start-day");
    await page.locator(".grp .fl-main").first().click();
    await page.waitForSelector(".fcard");
    /\/brief\?f=/.test(page.url()) ? pass("favourites: clicking a favourite opens its brief") : fail(`favourites: url ${page.url()}`);
    await ctx.close();
  });

  /* ---------- flight card departs/arrives styles × theme × width ---------- */
  await section("route head", async () => {
    for (const style of ["timeline", "pass", "board"])
      for (const theme of ["light", "dark"])
        for (const width of [1280, 390]) {
          const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, deviceScaleFactor: SHOTS ? 2 : 1 });
          await ctx.addInitScript((s) => localStorage.setItem("ofp-planner:display", JSON.stringify({ routeHead: s })), style);
          const page = await ctx.newPage();
          const errors = [];
          page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
          page.on("pageerror", (e) => errors.push(String(e)));
          // PC1528 LEBL→LTBJ: departure tracked, arrival not → estimated with an EST. badge
          await page.goto(`${base}/?al=PGT&dep=LEBL&arr=LTBJ`, { waitUntil: "networkidle" });
          await page.waitForSelector("table.flights tbody tr");
          await page.locator("table.flights tbody tr").first().click();
          await page.waitForSelector(".drawer .fcard");
          await page.waitForTimeout(700);
          const cls = { timeline: ".rh-timeline", pass: ".rh-pass", board: ".rh-board" }[style];
          const ok = (await page.locator(`.drawer ${cls}`).count()) === 1;
          const est = await page.locator(".drawer .rh .est-badge").count();
          const wavy = await page.locator(".drawer .rh").evaluate((el) => el.textContent.includes("≈"));
          ok && est > 0 && !wavy ? pass(`route head ${style} ${theme} ${width}px: shown, ${est} EST. badge(s), no ≈`) : fail(`route head ${style} ${theme} ${width}px: ok ${ok} est ${est} wavy ${wavy}`);
          const bad = await page.evaluate(CONTRAST);
          const inCard = bad.filter((b) => b);
          inCard.length ? fail(`route head ${style} ${theme} ${width}px: contrast ${JSON.stringify(inCard.slice(0, 4))}`) : pass(`route head ${style} ${theme} ${width}px: text contrast AA`);
          const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          sw > 0 ? fail(`route head ${style} ${width}px: sideways scroll ${sw}`) : null;
          errors.length ? fail(`route head ${style}: console errors ${JSON.stringify(errors.slice(0, 2))}`) : null;
          if (width === 1280) await shot(page, `route-${style}-${theme === "light" ? "day" : "night"}`);
          await ctx.close();
        }
  });

  /* ---------- journeys: multi-leg search ---------- */
  await section("journeys", async () => {
    const cards = (page) => page.locator(".jr-card .jr-chain").evaluateAll((els) => els.map((e) => [...e.querySelectorAll(".jr-stop")].map((s) => s.textContent.trim())));
    const go = async (page, qs) => {
      await page.goto(`${page.url().split("/journeys")[0]}/journeys?${qs}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.querySelector(".jr-card, .jr-results .empty-note") && !document.querySelector(".jr-split.is-stale"), null, { timeout: 60000 });
      await page.waitForTimeout(200);
    };
    const { ctx, page, errors } = await open("/journeys");
    await page.locator(".jr-example", { hasText: "EGBB → LOWI, shortest" }).click();
    await page.waitForSelector(".jr-card", { timeout: 60000 });
    /from=EGBB&to=LOWI/.test(page.url()) ? pass("journeys: an example fills the form and the URL") : fail(`journeys: example URL ${page.url()}`);
    let c = await cards(page);
    c.length && c.every((s) => s[0] === "EGBB" && s.at(-1) === "LOWI" && s.length === 3) ? pass(`journeys: no direct EGBB–LOWI, fewest is 2 legs (${c.length} routes)`) : fail(`journeys: fewest ${JSON.stringify(c.slice(0, 3))}`);
    await go(page, "from=EGBB&to=LOWI&legs=5");
    c = await cards(page);
    c.length >= 30 && c.every((s) => s.length === 6 && new Set(s).size === 6) ? pass("journeys: exactly 5 legs, no airport twice") : fail(`journeys: 5 legs ${JSON.stringify(c.slice(0, 2))}`);
    await go(page, "from=EGBB&via=EHAM&to=LEMD&t=1&sort=quickest");
    c = await cards(page);
    c.length && c.every((s) => s.join() === "EGBB,EHAM,LEMD") ? pass("journeys: timed via EHAM keeps the stop") : fail(`journeys: via ${JSON.stringify(c)}`);
    const turns = await page.locator(".jr-turn b:last-child").allTextContents();
    turns.length && turns.every((t) => { const m = t.match(/(?:(\d+)h )?(\d+)m/); const min = m ? +(m[1] ?? 0) * 60 + +m[2] : -1; return min >= 35 && min <= 180; }) ? pass(`journeys: turnarounds within 35 min–3 h (${turns.join(", ")})`) : fail(`journeys: turns ${turns}`);
    await go(page, "to=EPPO&legs=u6&t=1&sort=most&duty=360");
    c = await cards(page);
    const duties = await page.locator(".jr-card .jr-meta").allTextContents();
    const dutyMin = duties.map((t) => { const m = t.match(/duty (?:(\d+)h )?(\d+)m/); return m ? +(m[1] ?? 0) * 60 + +m[2] : 9999; });
    c.length && c.every((s) => s.at(-1) === "EPPO") && dutyMin.every((d) => d <= 360) ? pass(`journeys: 6 h duty ending in EPPO (${c.length} shown, max ${Math.max(...dutyMin)} min)`) : fail(`journeys: duty ${JSON.stringify(dutyMin.slice(0, 5))}`);
    await go(page, "from=EGBB&to=EGBB&legs=2&t=1&one=1");
    c = await cards(page);
    const als = await page.locator(".jr-card .jr-als").allTextContents();
    c.length && c.every((s) => s[0] === "EGBB" && s[2] === "EGBB") && als.every((a) => !a.includes("·")) ? pass("journeys: round trip on one airline") : fail(`journeys: round trip ${JSON.stringify(c.slice(0, 3))} ${als.slice(0, 3)}`);
    await go(page, "from=EGBB&to=LOWI");
    await page.getByRole("button", { name: "Find timed connections on this route" }).click();
    await page.waitForURL(/t=1/);
    /via=EHAM/.test(page.url()) && /legs=2/.test(page.url()) ? pass("journeys: a network route opens as timed connections on the same airports") : fail(`journeys: timed from route ${page.url()}`);
    // list sorting: Distance up, then down (reverses), Legs down = most legs
    await go(page, "from=EGBB&to=LOWI&legs=u4");
    const nms = async () => (await page.locator(".jr-card .jr-meta").allTextContents()).map((t) => +t.match(/([\d,]+) nm/)[1].replace(",", ""));
    let a = await nms();
    await page.locator(".jr-sort", { hasText: "Distance" }).click();
    await page.waitForURL(/dir=desc/);
    await page.waitForTimeout(300);
    let b = await nms();
    a.every((x, i) => !i || a[i - 1] <= x) && b.every((x, i) => !i || b[i - 1] >= x) && b[0] > a[0] ? pass(`journeys: list sorts by distance, up and down (${a[0]} → ${b[0]} nm first)`) : fail(`journeys: distance sort ${a.slice(0, 4)} / ${b.slice(0, 4)}`);
    await page.locator(".jr-sort", { hasText: "Legs" }).click();
    await page.locator(".jr-sort", { hasText: "Legs" }).click();
    await page.waitForURL(/sort=fewest&dir=desc/);
    await page.waitForFunction(() => !document.querySelector(".jr-split.is-stale") && !/updating/.test(document.querySelector(".jr-count")?.textContent ?? ""), null, { timeout: 60000 });
    c = await cards(page);
    c[0]?.length === 5 ? pass("journeys: Legs ▼ puts the most legs first") : fail(`journeys: most legs first ${JSON.stringify(c[0])}`);
    // timings: soonest date first; picking another date changes the legs and the brief link's date
    await go(page, "from=EGBB&via=EHAM&to=LEMD&t=1&sort=next");
    const at = await page.locator(".jr-tim-tbl tbody tr").count();
    const dates = await page.locator(".jr-tim-date").allTextContents();
    const out1 = await page.locator(".jr-times").first().textContent();
    await page.locator(".jr-tim-tbl tbody tr").nth(5).click();
    const out2 = await page.locator(".jr-times").first().textContent();
    const href = await page.locator(".jr-leg-acts a", { hasText: "Brief" }).first().getAttribute("href");
    at >= 8 && /today|tomorrow/.test(dates[0]) && out1 !== out2 && /&d=\d{4}-\d{2}-\d{2}/.test(href) ? pass(`journeys: timings table, soonest first (${dates[0]}); a picked date sets the legs and the brief date`) : fail(`journeys: timings ${at} ${dates[0]} ${out1}/${out2} ${href}`);
    await page.locator(".jr-tim-tbl thead button", { hasText: "Duty" }).click();
    const duties2 = (await page.locator(".jr-tim-tbl tbody td.num:nth-of-type(4)").allTextContents()).map((t) => { const m = t.match(/(?:(\d+)h )?(\d+)m/); return m ? +(m[1] ?? 0) * 60 + +m[2] : -1; });
    duties2.length && duties2.every((x, i) => !i || duties2[i - 1] <= x) ? pass("journeys: timings sort by duty") : fail(`journeys: timings duty sort ${duties2}`);
    // clear
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.waitForSelector(".jr-intro");
    !new URL(page.url()).search ? pass("journeys: Clear empties the form and the URL") : fail(`journeys: clear left ${page.url()}`);
    await go(page, "from=EGBB&via=EHAM&to=LEMD&t=1&sort=quickest");
    await page.getByRole("button", { name: "Save as a favourites group" }).click();
    await page.waitForSelector(".jr-acts [role=status]");
    await page.goto(page.url().replace(/\/journeys.*$/, "/brief"), { waitUntil: "networkidle" });
    await page.waitForSelector(".grp .fl-row");
    const legsSaved = await page.locator(".grp", { hasText: "EGBB → LEMD via 1 stop" }).locator(".fl-row").count();
    legsSaved === 2 ? pass("journeys: saved as a favourites group with both legs, on the brief") : fail(`journeys: saved group has ${legsSaved} rows`);
    errors.length ? fail(`journeys: console errors ${JSON.stringify(errors.slice(0, 2))}`) : pass("journeys: 0 console errors");
    await ctx.close();
  });

  /* ---------- 1.2.3: airport names, country filter, finder → journeys, journeys help ---------- */
  await section("1.2.3 fixes", async () => {
    const { ctx, page, errors } = await open("/?al=&dep=EGJJ&view=places");
    await page.waitForSelector(".place-list li");
    const labels = await page.locator(".place-label").allTextContents();
    labels.includes("Birmingham Airport") && labels.includes("London Gatwick Airport") && !labels.some((l) => /West Midlands|St\. Peter/.test(l))
      ? pass("airport names: no city or region prefix (Birmingham Airport, London Gatwick Airport)")
      : fail(`airport names: ${labels.slice(0, 6)}`);
    // Airports tab: every origin, then one country
    await page.goto(page.url().split("/?")[0] + "/?al=&view=places", { waitUntil: "networkidle" });
    await page.waitForSelector(".place-list li");
    const all = await page.locator(".place-list li").count();
    await page.locator(".places-cc").selectOption("PL");
    await page.waitForURL(/cc=PL/);
    const pl = await page.locator(".place-code").allTextContents();
    pl.length && pl.length < all && pl.every((c) => c.startsWith("EP")) ? pass(`airports tab: country filter lists Poland's ${pl.length} airports of ${all}`) : fail(`airports tab: country ${pl.length}/${all} ${pl.slice(0, 5)}`);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".place-list li");
    (await page.locator(".places-cc").inputValue()) === "PL" && (await page.locator(".place-list li").count()) === pl.length ? pass("airports tab: the country survives a reload") : fail("airports tab: country lost on reload");
    // a route with no flight offers Journeys, prefilled
    await page.goto(page.url().split("/?")[0] + "/?al=&dep=EGBB&arr=LOWI", { waitUntil: "networkidle" });
    const link = page.getByRole("link", { name: "Find a journey with stops" });
    await link.waitFor({ timeout: 20000 });
    await link.click();
    await page.waitForURL(/\/journeys\?from=EGBB&to=LOWI/);
    await page.waitForSelector(".jr-card", { timeout: 60000 });
    pass("finder: no EGBB–LOWI flight links to Journeys with the route filled in");
    // Journeys: Now beside First OUT after, help on the labels, guide and example cards
    await page.goto(page.url().split("/journeys")[0] + "/journeys?from=EGBB&t=1&legs=2", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Now", exact: true }).click();
    await page.waitForURL(/after=\d{4}/);
    const now = new Date();
    const want = `${String(now.getUTCHours()).padStart(2, "0")}`;
    new URL(page.url()).searchParams.get("after").startsWith(want) ? pass("journeys: Now fills First OUT after with the UTC time") : fail(`journeys: now ${page.url()}`);
    const tips = await page.locator(".jr-form .ctl-label .tip").evaluateAll((els) => els.map((e) => e.textContent.trim()));
    ["Legs", "Times", "Detour", "Day (UTC)", "First OUT after (Z)", "Duty limit", "Report before OUT", "Turnaround"].every((t) => tips.includes(t)) ? pass(`journeys: ${tips.length} labels explain themselves on hover`) : fail(`journeys: tips ${tips}`);
    await page.locator(".jr-guide summary").click();
    const defs = await page.locator(".jr-guide .jr-defs dt").count();
    defs === 15 ? pass("journeys: 'What the options mean' lists all 15 options") : fail(`journeys: guide has ${defs}`);
    await page.goto(page.url().split("/journeys")[0] + "/journeys", { waitUntil: "networkidle" });
    const cards = await page.locator(".jr-ex-card").count();
    const chips = await page.locator(".jr-example").count();
    cards === chips && cards >= 9 && (await page.locator(".jr-intro .jr-defs dt").count()) === 15 ? pass(`journeys: intro shows ${cards} examples and the option guide`) : fail(`journeys: intro ${cards}/${chips}`);
    for (let i = 5; i < cards; i++) {
      await page.goto(page.url().split("/journeys")[0] + "/journeys", { waitUntil: "networkidle" });
      const name = await page.locator(".jr-ex-card b").nth(i).textContent();
      await page.locator(".jr-ex-card").nth(i).click();
      await page.waitForFunction(() => document.querySelector(".jr-card, .jr-results .empty-note") && !document.querySelector(".jr-split.is-stale") && !/Searching|updating/.test(document.querySelector(".jr-results")?.textContent ?? ""), null, { timeout: 90000 });
      const n = await page.locator(".jr-card").count();
      n ? pass(`journeys: example “${name}” finds journeys (${n} shown)`) : fail(`journeys: example “${name}” found none`);
    }
    errors.length ? fail(`1.2.3: console errors ${JSON.stringify(errors.slice(0, 2))}`) : pass("1.2.3: 0 console errors");
    await ctx.close();
  });

  /* ---------- board: airport FIDS and gate screen ---------- */
  await section("board", async () => {
    const { ctx, page, errors } = await open("/board?ap=EGKK&h=12");
    await page.waitForSelector(".fids-tbl tbody tr", { timeout: 30000 });
    const n = await page.locator(".fids-tbl tbody tr").count();
    const rmk = await page.locator(".fids-rmk").allTextContents();
    const okRmk = rmk.every((r) => /^(On time|Expected \d\d:\d\d|Gate open|Boarding|Final call|Gate closed|Departed)$/.test(r));
    n > 5 && okRmk && (await page.locator(".bd-map svg").count()) > 0 ? pass(`board: EGKK departures (${n} rows, remarks from the clock, map)`) : fail(`board: ${n} rows, remarks ${rmk.slice(0, 5)}`);
    await page.getByRole("radio", { name: "Arrivals" }).click();
    await page.waitForURL(/side=arr/);
    await page.waitForSelector(".fids-tbl tbody tr", { timeout: 30000 });
    (await page.locator(".fids-head h2").textContent()) === "Arrivals" && (await page.locator(".fids-tbl tbody tr").count()) > 0 ? pass("board: arrivals") : fail("board: arrivals");
    await page.getByRole("radio", { name: "Departures" }).click();
    await page.waitForSelector(".fids-tbl tbody tr");
    // a narrowbody row opens its gate screen
    const row = page.locator(".fids-tbl tbody tr", { has: page.locator(".fids-ac", { hasText: /A3[12]|A2[01]N|A319|B73|B38M/ }) }).first();
    await row.locator(".fids-flight").click();
    await page.waitForURL(/tab=gate/);
    await page.waitForSelector(".gs-dest");
    const gateUrl = new URL(page.url());
    (await page.locator(".gs-dest").textContent()).length > 1 && gateUrl.searchParams.get("f") ? pass(`board: a row opens its gate screen (${await page.locator(".gs-dest").textContent()})`) : fail(`board: gate ${page.url()}`);
    await checkPage("gate screen 1280 light", page, errors);
    const statusAt = async (params) => {
      const u = new URL(gateUrl);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      await page.goto(u.toString(), { waitUntil: "networkidle" });
      await page.waitForSelector(".gs-status b");
      return (await page.locator(".gs-status").innerText()).replace(/\s+/g, " ");
    };
    const s90 = await statusAt({ in: "90" });
    const s30 = await statusAt({ in: "30" });
    const s17 = await statusAt({ in: "17" });
    const s0 = await statusAt({ in: "-1" });
    const sLate = await statusAt({ in: "90", late: "20" });
    const newTime = await page.locator(".gs-new b").count();
    const sCx = await statusAt({ in: "30", cx: "1" });
    /ON TIME/i.test(s90) && /BOARDING/i.test(s30) && /FINAL CALL/i.test(s17) && /PUSHBACK/i.test(s0) && /DELAYED/i.test(sLate) && newTime === 1 && /CANCELLED/i.test(sCx)
      ? pass("gate screen: virtual clock steps (on time → boarding → final call → pushback), delayed with a new time, cancelled")
      : fail(`gate screen: steps ${[s90, s30, s17, s0, sLate, newTime, sCx].join(" | ")}`);
    // controls: delay, gate change, message
    await statusAt({ in: "90", rot: "0" });
    await page.getByRole("button", { name: "+15", exact: true }).click();
    await page.locator(".gt-ctl input[placeholder='e.g. 12']").fill("12");
    await page.locator(".gt-ctl input[placeholder='e.g. 14']").fill("14");
    await page.getByRole("button", { name: "Change", exact: true }).click();
    const st = (await page.locator(".gs-status").innerText()).replace(/\s+/g, " ");
    /DELAYED/i.test(st) && /Gate change: 12 → 14/.test(st) && (await page.locator(".gs-gate b").textContent()) === "14" && /late=15/.test(page.url()) && /gate=14/.test(page.url())
      ? pass("gate screen: controls set the delay and a gate change, kept in the URL")
      : fail(`gate screen: controls ${st} ${page.url()}`);
    // the screen window follows the controls (BroadcastChannel), and has keys of its own
    const screenUrl = new URL(page.url());
    screenUrl.searchParams.set("screen", "1");
    screenUrl.searchParams.set("ch", "verify1");
    screenUrl.searchParams.set("late", "0");
    const ctlUrl = new URL(page.url());
    ctlUrl.searchParams.set("ch", "verify1");
    ctlUrl.searchParams.set("late", "0");
    await page.goto(ctlUrl.toString(), { waitUntil: "networkidle" });
    const scr = await ctx.newPage();
    await scr.goto(screenUrl.toString(), { waitUntil: "networkidle" });
    await scr.waitForSelector(".screen-root .gs");
    const chrome = await scr.locator(".topbar").isVisible();
    await page.getByRole("button", { name: "+30", exact: true }).click();
    await scr.waitForSelector(".gs-new", { timeout: 5000 });
    await scr.keyboard.press("0");
    await scr.waitForSelector(".gs-new", { state: "detached", timeout: 5000 });
    !chrome ? pass("gate screen window: screen only, follows the controls (+30 → new time), 0 key puts it back on time") : fail("gate screen window: page chrome visible");
    await scr.close();
    // SimBrief: the pilot's latest OFP (mocked here)
    await page.route(/simbrief\.com\/api\/xml\.fetcher\.php/, (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          fetch: { status: "Success" },
          general: { icao_airline: "EZY", flight_number: "8101", initial_altitude: "35000", gc_distance: "750" },
          atc: { callsign: "EZY81AB" },
          origin: { icao_code: "EGKK", pos_lat: "51.148", pos_long: "-0.190", name: "GATWICK", plan_rwy: "26L" },
          destination: { icao_code: "LEMD", pos_lat: "40.472", pos_long: "-3.561", name: "BARAJAS" },
          times: { sched_out: new Date(Date.now() + 3 * 3600e3).toISOString(), est_out: new Date(Date.now() + 3 * 3600e3 + 10 * 60e3).toISOString(), sched_block: "02:20:00", taxi_out: "00:15:00" },
          aircraft: { icaocode: "A20N", name: "A320-251N", reg: "G-ABCD" },
          weights: { pax_count: "180" },
          params: { time_generated: new Date().toISOString() },
        }),
      }),
    );
    await page.goto(base + "/board?tab=gate", { waitUntil: "networkidle" });
    await page.locator(".gt-sb input").fill("example-pilot");
    await page.getByRole("button", { name: "Use my latest OFP" }).click();
    await page.waitForSelector(".gs-dest");
    const sb = { dest: await page.locator(".gs-dest").textContent(), sub: await page.locator(".gs-dest-sub").textContent(), brand: await page.locator(".gs-wordmark").textContent(), st: await page.locator(".gs-status").innerText() };
    sb.dest === "Madrid" && /G-ABCD/.test(sb.sub) && sb.brand === "easyJet" && /sb=example-pilot/.test(page.url()) && /late=10/.test(page.url())
      ? pass("gate screen: a SimBrief OFP fills the screen (easyJet, Madrid, G-ABCD, its 10 min delay)")
      : fail(`gate screen: SimBrief ${JSON.stringify(sb)} ${page.url()}`);
    // entry points
    await page.goto(base + "/?al=EZY&dep=EGKK", { waitUntil: "networkidle" });
    await page.waitForSelector("table.flights tbody tr");
    await page.locator("table.flights tbody tr").first().click();
    await page.getByRole("link", { name: "Gate screen" }).click();
    await page.waitForURL(/\/board\?.*tab=gate/);
    await page.waitForSelector(".gs-dest");
    pass("finder: the flight card opens its gate screen");
    errors.filter((e) => !e.startsWith("__weather_") && !/Failed to load resource/.test(e)).length ? fail(`board: console errors ${JSON.stringify(errors.slice(0, 3))}`) : pass("board: 0 console errors");
    await ctx.close();
    for (const [width, theme] of [[1280, "dark"], [390, "light"], [390, "dark"]]) {
      const o = await open(gateUrl.pathname + gateUrl.search, { width, height: width < 500 ? 844 : 900, theme });
      await o.page.waitForSelector(".gs-dest");
      await checkPage(`gate screen ${width}px ${theme}`, o.page, o.errors);
      await o.ctx.close();
    }
  });

  /* ---------- every page × width × theme ---------- */
  const pages = ["/?al=EZY&dep=EGKK", "/?al=EZY&dep=EGKK&view=places", "/?al=&view=places&cc=GB", "/?al=&dep=EGBB&arr=LOWI", "/?al=&dep=LEMD&arr=C:ES&view=map", "/brief", "/settings", "/journeys", "/journeys?from=EGBB&to=LOWI&legs=5", "/journeys?from=EGBB&via=EHAM&to=LEMD&t=1&sort=quickest", "/board", "/board?ap=EGKK&h=12"];
  for (const theme of ["light", "dark"])
    for (const width of [1280, 390])
      for (const path of pages) {
        const { ctx, page, errors } = await open(path, { width, height: width < 500 ? 844 : 900, theme });
        if (path.startsWith("/?")) await page.waitForSelector(path.includes("places") ? ".place-list li" : path.includes("LOWI") ? ".empty-note .btn" : path.includes("map") ? ".routes-tbl tbody tr" : "table.flights tbody tr", { timeout: 20000 });
        if (path === "/brief") await page.waitForTimeout(300);
        if (path.startsWith("/journeys?")) await page.waitForSelector(".jr-detail .jr-leg", { timeout: 60000 });
        if (path.startsWith("/board?")) await page.waitForSelector(".fids-tbl tbody tr", { timeout: 30000 });
        await checkPage(`${path} ${width}px ${theme}`, page, errors);
        await ctx.close();
      }

  /* ---------- brief with a flight: weather ---------- */
  await section("brief", async () => {
    const { ctx, page, errors } = await open("/?al=EZY&dep=EGKK");
    await page.waitForSelector("table.flights tbody tr");
    await page.locator("table.flights tbody tr").first().click();
    await page.getByRole("link", { name: /Open brief/ }).click();
    await page.waitForURL(/\/brief/);
    await page.waitForSelector(".fcard");
    await page.waitForTimeout(4000);
    const wx = await page.locator("#weather").innerText();
    /kt|KT/.test(wx) ? pass("brief: weather rendered") : fail(`brief: no weather values (${wx.slice(0, 120)})`);
    const parts = await page.evaluate(() => ({
      halves: document.querySelectorAll("#weather .wb-half").length,
      scenes: document.querySelectorAll("#weather .wb-scene").length,
      strip: document.querySelectorAll("#weather .wb-tl-bar i").length,
      fcst: [...document.querySelectorAll("#weather .pp-line:not(.pp-foot)")].filter((p) => p.textContent.startsWith("FCST")).length,
    }));
    await page.locator("#weather .wtoggle summary").click();
    const cmpRows = await page.locator("#weather .wb-cmp tbody tr").count();
    parts.halves === 2 && parts.scenes === 2 && parts.strip === 48 && parts.fcst === 2 && cmpRows === 10
      ? pass(`brief: verdict, 2 scenes, trip strip (48 hours), 2 FCST lines, comparison table (${cmpRows} rows)`)
      : fail(`brief: weather parts ${JSON.stringify({ ...parts, cmpRows })}`);
    await checkPage("brief with flight 1280 light", page, errors);
    await shot(page, "brief-day");
    // next leg on the brief: the full list link, then the sample (previewed below its button)
    const destBefore = (await page.locator(".fcard-end.arr .code-flap .flap").getAttribute("aria-label"))?.slice(0, 4);
    const allHref = await page.getByRole("link", { name: /Next leg: all flights from/ }).getAttribute("href");
    allHref?.includes(`dep=${destBefore}`) ? pass(`brief: Next leg links to all flights from ${destBefore}`) : fail(`brief: next-leg link ${allHref}`);
    await page.waitForSelector(".nextleg-preview .leg-badge, .nextleg-preview .muted.small:not(:empty)");
    const preview = await page.locator(".nextleg-preview").innerText();
    if (await page.locator(".nextleg-preview .leg-badge").count()) {
      await page.getByRole("button", { name: "A sample next leg" }).click();
      await page.waitForTimeout(1500);
      const origAfter = (await page.locator(".fcard-end.dep .code-flap .flap").getAttribute("aria-label"))?.slice(0, 4);
      origAfter === destBefore ? pass(`brief: sample next leg (${preview.split("\n")[0].replace(/\s+/g, " ")}) departs ${destBefore}`) : fail(`brief: sample leg departs ${origAfter}, expected ${destBefore}`);
    } else pass(`brief: no sample leg available (${preview})`);
    // an airport on the brief opens the finder with it as the origin
    const arrIcao = (await page.locator(".fcard-end.arr .code-flap .flap").getAttribute("aria-label"))?.slice(0, 4);
    const placeHref = await page.locator(".fcard-end.arr a.fcard-placelink").getAttribute("href");
    placeHref === `/?al=&dep=${arrIcao}` ? pass(`brief: arrival airport links to finder from ${arrIcao}`) : fail(`brief: airport link ${placeHref}`);

    // and back to the finder with that flight open
    await page.getByRole("link", { name: /Back to finder/ }).click();
    await page.waitForSelector(".drawer .fcard");
    pass("brief: back to finder opens the flight");
    await page.goBack({ waitUntil: "networkidle" });
    await page.waitForSelector(".fcard");
    await page.locator("#weather").scrollIntoViewIfNeeded();
    await shot(page, "brief-weather-day");
    const briefPath = page.url().replace(/^https?:\/\/[^/]+/, "");
    await ctx.close();
    const n = await open(briefPath, { theme: "dark" });
    await n.page.waitForSelector(".fcard");
    await n.page.waitForTimeout(2500);
    await checkPage("brief with flight 1280 dark", n.page, n.errors);
    await n.page.locator("#weather").scrollIntoViewIfNeeded();
    await shot(n.page, "brief-weather-night");
    await n.ctx.close();
  });

  /* ---------- settings: add an airframe, then it's offered ---------- */
  await section("settings", async () => {
    const { ctx, page, errors } = await open("/settings");
    await page.getByLabel("Name", { exact: true }).fill("G-TEST");
    await page.getByLabel("ICAO type").fill("A21N");
    await page.getByLabel("SimBrief airframe id or Plan link").fill("https://dispatch.simbrief.com/options/custom?type=1_2");
    await page.getByRole("button", { name: "Add airframe" }).click();
    const rowText = await page.locator(".airframes tbody").innerText();
    rowText.includes("G-TEST") && rowText.includes("1_2") ? pass("settings: airframe added from a pasted Plan link") : fail("settings: airframe not added");
    // display options apply in the finder
    await page.getByRole("radio", { name: /Split pill/ }).check();
    await page.getByRole("radio", { name: /Airline, then flight/ }).check();
    await page.getByRole("radio", { name: "Colour by manufacturer, edge only" }).check();
    await page.locator("input[name=mapCodes]").nth(2).check();
    await page.goto(page.url().replace(/\/settings.*$/, "/?al=EZY&dep=EGKK"), { waitUntil: "networkidle" });
    await page.waitForSelector("table.flights tbody tr");
    const split = await page.locator("table.flights tbody tr").first().locator(".split-pill > *").first().getAttribute("class");
    const side = await page.locator("table.flights tbody .tbadge.tb-side").count();
    await page.getByRole("tab", { name: /Destinations/ }).click();
    await page.waitForSelector(".places .map svg");
    const codesOff = await page.locator(".places .map-port:not(.hub):not(.on) text").count();
    codesOff === 0 ? pass("settings: Destination codes off hides map codes") : fail(`settings: ${codesOff} codes still shown`);
    split?.includes("split-al") && side > 0 ? pass("settings: display choices apply (split pill, airline first, edge badges)") : fail(`settings: display not applied (${split}, ${side})`);
    await checkPage("finder with alt display 1280 light", page, errors);
    await page.goto(page.url().replace(/\/\?.*$/, "/settings"), { waitUntil: "networkidle" });
    await shot(page, "settings-day");
    // backup: download (gzip), clear everything, restore → the airframe and display choices come back
    await page.evaluate(() => localStorage.setItem("ofp-planner:logbook", JSON.stringify([{ id: "x", date: "2026-10-03", from: "EGBB", to: "LEMD" }])));
    const [bk] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download a backup/ }).click()]);
    const gz = readFileSync(await bk.path());
    const backup = JSON.parse(gunzipSync(gz).toString("utf8"));
    gz[0] === 0x1f && gz[1] === 0x8b && /\.json\.gz$/.test(bk.suggestedFilename()) && backup.schema === "ofp-planner/backup" && backup.entries["ofp-planner:airframes"]?.includes("G-TEST")
      ? pass(`settings: backup downloads as gzip with everything stored (${Object.keys(backup.entries).length} keys, ${gz.length} B)`)
      : fail(`settings: backup ${bk.suggestedFilename()} ${backup.schema} ${Object.keys(backup.entries ?? {})}`);
    await page.getByRole("button", { name: "Clear all saved data…" }).click();
    await page.getByRole("button", { name: "Yes, clear everything" }).click();
    const cleared = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ofp-planner:")).length);
    await page.locator(".backup input[type=file]").setInputFiles({ name: "ofp-planner-backup.json.gz", mimeType: "application/gzip", buffer: gz });
    const confirmText = await page.locator(".backup .note-red").innerText();
    await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Yes, restore" }).click()]);
    await page.waitForSelector(".airframes tbody");
    const restored = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("ofp-planner:")).map((k) => [k, localStorage.getItem(k)])));
    const same = Object.entries(backup.entries).every(([k, v]) => restored[k] === v) && Object.keys(restored).length === Object.keys(backup.entries).length;
    cleared === 0 && /1 logbook flight/.test(confirmText) && same && (await page.locator(".airframes tbody").innerText()).includes("G-TEST")
      ? pass("settings: restoring the backup after Clear all brings every entry back exactly")
      : fail(`settings: restore (cleared ${cleared}, confirm "${confirmText}", same ${same})`);
    await page.locator(".backup input[type=file]").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"schema":"other"}') });
    (await page.locator(".backup .form-err").innerText()).includes("isn't an OFP Planner backup") ? pass("settings: a file that isn't a backup is refused") : fail("settings: bad backup not refused");
    errors.length ? fail(`settings: console errors ${JSON.stringify(errors)}`) : pass("settings: 0 console errors");
    await ctx.close();
  });

  /* ---------- 1.5.0: one row per flight, times by weekday ---------- */
  await section("1.5.0", async () => {
    const FR = encodeURIComponent("RYR:RYR658:EBBR-EIDW:1234567");
    const fr658 = async (page) => {
      await page.waitForSelector("table.flights tbody tr");
      const row = page.locator("table.flights tbody tr", { hasText: "FR658" });
      return { n: await row.count(), dep: (await row.first().locator("td:nth-child(4)").textContent())?.trim() ?? "" };
    };
    const { ctx, page, errors } = await open("/?al=RYR&dep=EBBR&arr=EIDW&days=1");
    const mon = await fr658(page);
    await page.goto(`${base}/?al=RYR&dep=EBBR&arr=EIDW&days=3`, { waitUntil: "networkidle" });
    const wed = await fr658(page);
    mon.n === 1 && wed.n === 1 && /^07:35VAR$/.test(mon.dep) && /^08:30VAR$/.test(wed.dep)
      ? pass(`per-day: FR658 is one row; Monday shows 07:35, Wednesday 08:30, with the VAR mark (${mon.dep} / ${wed.dep})`)
      : fail(`per-day: FR658 rows/times ${JSON.stringify({ mon, wed })}`);
    for (const q of ["FR658", "FR 658"]) {
      await page.goto(`${base}/?al=RYR&dep=EBBR&arr=EIDW&q=${encodeURIComponent(q)}`, { waitUntil: "networkidle" });
      const n = (await fr658(page)).n;
      n === 1 ? pass(`search: "${q}" (IATA code) finds FR658`) : fail(`search: "${q}" found ${n} FR658 rows`);
    }
    await page.goto(`${base}/?al=RYR&dep=EBBR&arr=EIDW&days=3&after=0820&ref=out&sched=1`, { waitUntil: "networkidle" });
    const wedAfter = (await fr658(page)).n;
    await page.goto(`${base}/?al=RYR&dep=EBBR&arr=EIDW&days=1&after=0820&ref=out&sched=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const monAfter = await page.locator("table.flights tbody tr", { hasText: "FR658" }).count();
    await page.goto(`${base}/?al=RYR&dep=EBBR&arr=EIDW&days=1,3&after=0820&ref=out&sched=1`, { waitUntil: "networkidle" });
    const eitherAfter = (await fr658(page)).n;
    wedAfter === 1 && monAfter === 0 && eitherAfter === 1
      ? pass("per-day: After 08:20Z uses the chosen day's times (Wed 08:30 in, Mon 07:35 out, Mon+Wed in)")
      : fail(`per-day: after by day wed ${wedAfter} mon ${monAfter} either ${eitherAfter}`);
    // the brief: Monday 12 Oct shows Monday's times and highlights Monday in the week table
    await page.goto(`${base}/brief?f=${FR}&d=2026-10-12`, { waitUntil: "networkidle" });
    await page.waitForSelector(".week-tbl tr.cur");
    const cur = (await page.locator(".week-tbl tr.cur th").textContent())?.trim();
    const oooiOut = (await page.locator(".oooi").first().locator("tbody tr").first().locator("td").first().textContent())?.trim();
    const weekRows = await page.locator(".week-tbl tbody tr").count();
    cur === "Mon" && oooiOut?.startsWith("07:35Z") && weekRows === 7
      ? pass(`brief: Monday's times (STD ${oooiOut?.slice(0, 6)}), the week table's Monday row highlighted, 7 days`)
      : fail(`brief: per-day ${cur} ${oooiOut} rows ${weekRows}`);
    await checkPage("brief week table 1280 light", page, errors);
    await ctx.close();
    // the other styles from Settings → Display, and the day tabs switching the OOOI table
    for (const [week, sel] of [
      ["grouped", ".week-grp tbody tr"],
      ["timeline", ".week-tl-row:not(.week-tl-axis)"],
      ["tabs", ".week-tab"],
    ]) {
      const o = await open(`/brief?f=${FR}&d=2026-10-12`, { theme: week === "timeline" ? "dark" : "light" });
      await o.page.evaluate((w) => localStorage.setItem("ofp-planner:display", JSON.stringify({ week: w })), week);
      await o.page.reload({ waitUntil: "networkidle" });
      await o.page.waitForSelector(sel);
      const n = await o.page.locator(sel).count();
      let extra = "";
      if (week === "tabs") {
        await o.page.getByRole("button", { name: /^Wed/ }).click();
        extra = (await o.page.locator(".oooi").first().locator("tbody tr").first().locator("td").first().textContent())?.trim().slice(0, 6) ?? "";
      }
      const ok = week === "grouped" ? n === 5 : week === "timeline" ? n === 7 : n === 7 && extra === "08:30Z";
      ok ? pass(`brief: times by day as ${week} (${n}${extra ? `, Wed tab → ${extra}` : ""})`) : fail(`brief: ${week} ${n} ${extra}`);
      await checkPage(`brief week ${week} ${week === "timeline" ? "1280 dark" : "1280 light"}`, o.page, o.errors);
      await o.ctx.close();
    }
    // phone width: the week table fits
    const ph = await open(`/brief?f=${FR}&d=2026-10-12`, { width: 390, height: 844 });
    await ph.page.waitForSelector(".week-tbl");
    await checkPage("brief week table 390 light", ph.page, ph.errors);
    await ph.ctx.close();
    // the varies mark as a word; an id from before the merge still opens the flight; the gate screen uses that day's time
    const w = await open("/?al=RYR&dep=EBBR&arr=EIDW&days=1");
    await w.page.evaluate(() => localStorage.setItem("ofp-planner:display", JSON.stringify({ variesMark: "word" })));
    await w.page.reload({ waitUntil: "networkidle" });
    const word = (await fr658(w.page)).dep;
    /07:35\s*varies/i.test(word) ? pass(`finder: varies mark as a word (${word.replace(/\s+/g, " ")})`) : fail(`finder: varies word ${word}`);
    await w.page.goto(`${base}/brief?f=${encodeURIComponent("RYR:RYR658:EBBR-EIDW:234567~1")}`, { waitUntil: "networkidle" });
    await w.page.waitForSelector(".fcard-no");
    (await w.page.locator(".fcard-no").textContent())?.includes("658") ? pass("brief: a saved id from before the merge still finds FR658") : fail("brief: old id not found");
    await w.page.goto(`${base}/board?tab=gate&f=${FR}&d=2026-10-14`, { waitUntil: "networkidle" });
    await w.page.waitForSelector(".gs-status b");
    const gs = (await w.page.locator("main").innerText()).replace(/\s+/g, " ");
    /10:30/.test(gs) ? pass("gate screen: Wednesday's FR658 departs 10:30 local (08:30Z)") : fail(`gate screen: per-day time ${gs.slice(0, 200)}`);
    await w.ctx.close();
  });

  /* ---------- 1.3.1: board rows, favourites drag, route sort and flags, journeys avoid ---------- */
  await section("1.3.1", async () => {
    const { ctx, page, errors } = await open("/board?ap=EHAM");
    await page.waitForSelector(".fids-tbl tbody tr", { timeout: 30000 });
    const off = await page.$$eval(".fids-tbl tbody tr", (trs) => trs.slice(0, 12).flatMap((tr) => [...tr.cells].map((c) => Math.abs(c.getBoundingClientRect().bottom - tr.getBoundingClientRect().bottom))));
    off.length && Math.max(...off) < 1 ? pass(`board: every cell meets its row's bottom border (${off.length} cells)`) : fail(`board: cell bottoms off by ${Math.max(...off)} px`);

    // favourites: two groups seeded from real flights; drag within a group, across groups, and with the keyboard
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    const ids = await page.evaluate(async () => {
      const fl = (await fetch("/data/airlines/EZY.json").then((r) => r.json())).flights.slice(0, 5);
      const fav = fl.map((f, i) => ({ id: `EZY:${f.cs}:${f.o}-${f.d}:${f.days.join("")}`, al: "EZY", op: f.op, fn: f.fn, cs: f.cs, o: f.o, d: f.d, std: null, at: i, days: f.days, group: i < 3 ? "A" : "B" }));
      localStorage.setItem("ofp-planner:favourites", JSON.stringify(fav));
      localStorage.setItem("ofp-planner:fav-groups", JSON.stringify(["A", "B"]));
      return fav.map((f) => f.id);
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("[data-fav]");
    await page.evaluate(() => document.querySelector("#lib-fav-h").scrollIntoView({ block: "start" }));
    const order = () => page.$$eval("[data-fav-group]", (gs) => Object.fromEntries(gs.map((g) => [g.dataset.favGroup, [...g.querySelectorAll("[data-fav]")].map((r) => r.dataset.fav)])));
    const drag = async (from, to) => {
      const a = await from.boundingBox();
      const b = await to();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 12, { steps: 3 });
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
    };
    const lastRowA = async () => {
      const r = await page.locator('[data-fav-group="A"] [data-fav]').nth(2).boundingBox();
      return { x: r.x + 300, y: r.y + r.height - 4 };
    };
    await drag(page.locator(".fl-grip").first(), lastRowA);
    let o = await order();
    o.A.join() === [ids[1], ids[2], ids[0]].join() ? pass("favourites: dragging a row below another reorders the group") : fail(`favourites: reorder ${JSON.stringify(o.A)}`);
    await drag(page.locator(".fl-grip").first(), async () => {
      const h = await page.locator('[data-fav-group="B"] .grp-head').boundingBox();
      return { x: h.x + 300, y: h.y + h.height / 2 };
    });
    o = await order();
    o.A.length === 2 && o.B.at(-1) === ids[1] ? pass("favourites: dropping on another group moves the flight to its end") : fail(`favourites: move ${JSON.stringify(o)}`);
    await page.locator(`[data-grip="${ids[1]}"]`).focus();
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(100);
    o = await order();
    const focused = await page.evaluate(() => document.activeElement?.dataset.grip);
    o.B.indexOf(ids[1]) === 1 && focused === ids[1] ? pass("favourites: arrow keys on the grip move a row and keep focus") : fail(`favourites: keyboard ${JSON.stringify(o.B)} focus ${focused}`);
    await checkPage("settings favourites after drag 1280 light", page, errors);

    // map tab: city and flag on each route, distance sort
    await page.goto(`${base}/?al=&dep=EGKK&view=map`, { waitUntil: "networkidle" });
    await page.waitForSelector(".routes-tbl tbody tr");
    const flags = await page.locator(".routes-tbl tbody tr").first().locator(".route-names .flag").count();
    const aps = await page.locator(".routes-tbl tbody tr").first().locator(".route-aps > span").count();
    flags === 2 && aps === 2 ? pass("map tab: each route shows both cities with their flags, and the airport names beside them") : fail(`map tab: ${flags} flags, ${aps} airport names on the first route`);
    const sorted0 = await page.locator(".routes-tbl th[aria-sort]").evaluateAll((t) => t.map((x) => `${x.textContent}:${x.getAttribute("aria-sort")}`));
    sorted0.length === 1 && /Flights \/ week.*descending/.test(sorted0[0]) ? pass("map tab: sorted by flights a week by default") : fail(`map tab: default sort ${sorted0}`);
    await page.getByRole("button", { name: "Distance" }).click();
    const nm = (await page.locator(".routes-tbl tbody tr td:last-child").allTextContents()).map((t) => parseInt(t)).filter((n) => !Number.isNaN(n));
    nm.length > 5 && nm.every((x, i) => !i || nm[i - 1] >= x) ? pass(`map tab: Distance sorts longest first (${nm[0]} nm)`) : fail(`map tab: distance sort ${nm.slice(0, 6)}`);
    await page.getByRole("button", { name: "Busiest first" }).click();
    const sorted1 = await page.locator(".routes-tbl th[aria-sort]").evaluateAll((t) => t.map((x) => `${x.textContent}:${x.getAttribute("aria-sort")}`));
    sorted1.length === 1 && /Flights \/ week.*descending/.test(sorted1[0]) ? pass("map tab: Busiest first goes back to flights a week") : fail(`map tab: reset gave ${sorted1}`);

    // journeys: avoid Germany
    const stops = async (qs) => {
      await page.goto(`${base}/journeys?${qs}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.querySelector(".jr-card, .jr-results .empty-note") && !document.querySelector(".jr-split.is-stale"), null, { timeout: 60000 });
      return page.locator(".jr-card .jr-chain").evaluateAll((els) => els.map((e) => [...e.querySelectorAll(".jr-stop")].map((s) => s.textContent.trim())));
    };
    const plain = await stops("from=EGBB&to=LTFM&legs=2");
    const avoided = await stops("from=EGBB&to=LTFM&legs=2&avoid=C:DE");
    const chip = await page.locator(".jr-chip-avoid").allTextContents();
    plain.some((s) => s.some((x) => x.startsWith("ED"))) && avoided.length && !avoided.some((s) => s.some((x) => x.startsWith("ED"))) && chip.some((c) => c.includes("Germany"))
      ? pass(`journeys: avoid Germany drops the German stops (${plain.length} → ${avoided.length} journeys)`)
      : fail(`journeys: avoid ${JSON.stringify(avoided.slice(0, 3))} chips ${chip}`);
    errors.length ? fail(`1.3.1: console errors ${JSON.stringify(errors.slice(0, 2))}`) : pass("1.3.1: 0 console errors");
    await ctx.close();
  });

  /* ---------- logbook: import, map, totals, add, export ---------- */
  await section("logbook", async () => {
    const ROW = ".log-tbl tbody tr:not(.log-detail):not(.log-month)";
    const { ctx, page, errors } = await open("/logbook");
    await page.waitForSelector(".log-form");
    const file = {
      schema: "ofp-planner/logbook",
      version: 1,
      flights: [
        { date: "2026-10-03", from: "EGBB", to: "LEMD", callsign: "EZY22N", flight: "U2227", type: "A20N", reg: "G-ABCD", airMin: 128, landingFpm: -407, status: "on-time" },
        { date: "2026-10-05", from: "LOWI", to: "EGBB", callsign: "EZY34MH", type: "A20N", std: "16:00", sta: "17:50", out: "16:05", off: "16:18", on: "18:02", in: "18:10", landingFpm: 180 },
        { date: "2026-10-06", from: "XX", to: "EGBB" },
      ],
    };
    await page.locator("input[type=file]").setInputFiles({ name: "log.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    await page.waitForSelector(".log-tbl tbody tr");
    const msg = await page.locator(".log-io [role=status]").innerText();
    const rows = await page.locator(ROW).count();
    /2 new/.test(msg) && /Skipped 1/.test(msg) && rows === 2 ? pass("logbook: import adds good flights and names the skipped one") : fail(`logbook: import ${msg} rows ${rows}`);
    const late = await page.locator(ROW, { hasText: "EZY34MH" }).first().innerText();
    /LATE/.test(late) && /-180(?!\d)/.test(late) && /2h 05m/.test(late) ? pass("logbook: status, landing rate and block time from OOOI (late +20, -180 fpm, 2h 05m)") : fail(`logbook: derived ${late.replace(/\s+/g, " ")}`);
    await page.waitForSelector(".log-map .map-route", { timeout: 20000 });
    (await page.locator(".log-map .map-route").count()) === 2 ? pass("logbook: map draws each route flown") : fail("logbook: map routes");
    // the list: month headings, a scrolling box, hover → route on the map, tooltips for times and airports
    const month = await page.locator(".log-tbl .log-month").first().innerText();
    const box = await page.locator(".log-wrap").evaluate((el) => getComputedStyle(el).maxHeight);
    /OCTOBER 2026/i.test(month) && /2 flights/.test(month) && box !== "none" ? pass(`logbook: flights under month headings in a box of at most ${box} (${month.replace(/\s+/g, " ")})`) : fail(`logbook: month ${month} box ${box}`);
    await page.locator(ROW, { hasText: "EZY34MH" }).first().hover();
    await page.waitForTimeout(200);
    const lit = await page.locator(".log-map .map-route.on").count();
    await page.locator(ROW, { hasText: "EZY34MH" }).first().locator(".log-status").hover();
    await page.waitForTimeout(200);
    const timesTip = await page.locator("#ofp-tip").innerText();
    lit === 1 && /OUT\s+16:05Z\s+sched 16:00 · \+5m/.test(timesTip) && /IN\s+18:10Z/.test(timesTip) && /Block 2h 05m/.test(timesTip)
      ? pass("logbook: hovering a flight lights its route; its status shows OUT/OFF/ON/IN against the schedule")
      : fail(`logbook: hover lit ${lit}, tip ${timesTip.replace(/\s+/g, " ")}`);
    await page.locator(ROW, { hasText: "EZY34MH" }).first().locator(".log-place").first().hover();
    await page.waitForTimeout(200);
    const apTip = await page.locator("#ofp-tip").innerText();
    /Innsbruck/.test(apTip) && /Austria/.test(apTip) && /ICAO\s+LOWI/.test(apTip) && /IATA\s+INN/.test(apTip) && /1 time/.test(apTip)
      ? pass("logbook: an airport's city shows its name, country, codes and your visits")
      : fail(`logbook: airport tip ${apTip.replace(/\s+/g, " ")}`);
    await page.getByRole("button", { name: "Punctuality" }).click();
    await page.waitForTimeout(200);
    const bars = await page.locator(".log-tbl .log-bar").count();
    const barTip = await page.locator(ROW, { hasText: "EZY34MH" }).first().locator(".log-bar").getAttribute("aria-label");
    await page.getByRole("button", { name: "Airports" }).click();
    bars === 1 && barTip === "scheduled 16:00–17:50Z, flown 16:05–18:10Z" && (await page.locator(".log-tbl .log-place").count()) === 4
      ? pass("logbook: the Punctuality switch shows scheduled vs flown bars (none for a flight without times), and Airports switches back")
      : fail(`logbook: punctuality bars ${bars} ${barTip}`);
    const f = page.locator("#log-form");
    await f.getByRole("combobox", { name: "From" }).fill("EGKK");
    await page.keyboard.press("Enter");
    await f.getByRole("combobox", { name: "To" }).fill("LFPG");
    await page.keyboard.press("Enter");
    await f.getByLabel("Callsign").fill("EZY8011");
    await f.getByLabel("Landing rate (fpm)").fill("-95");
    await f.getByRole("button", { name: "Add to logbook" }).click();
    await page.waitForTimeout(300);
    (await page.locator(ROW).count()) === 3 ? pass("logbook: a flight added by hand joins the list") : fail("logbook: add by hand");
    await page.locator(ROW, { hasText: "U2227" }).first().click();
    await page.locator(".log-detail").getByRole("button", { name: "Edit" }).click();
    await f.getByLabel(/Listed time/).fill("17:35");
    await f.getByRole("button", { name: "Save changes" }).click();
    await page.waitForTimeout(300);
    const edited = (await page.locator(ROW, { hasText: "U2227" }).first().locator(".log-status").getAttribute("data-tip-rows")) ?? "";
    /17:35/.test(edited) && (await page.locator(ROW).count()) === 3 ? pass("logbook: editing a flight's listed time updates it in place") : fail(`logbook: edit listed time ${edited}`);
    await page.locator(ROW, { hasText: "EZY34MH" }).first().click();
    await page.locator(".log-detail").getByRole("button", { name: "Edit" }).click();
    await f.getByLabel("Status").selectOption("delayed");
    await f.getByRole("button", { name: "Save changes" }).click();
    await page.waitForTimeout(300);
    const chosen = await page.locator(ROW, { hasText: "EZY34MH" }).first().innerText();
    /DELAYED/.test(chosen) && !/LATE/.test(chosen) ? pass("logbook: a chosen status overrides the one from the times (late → delayed)") : fail(`logbook: chosen status ${chosen.replace(/\s+/g, " ")}`);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Export/ }).click()]);
    const out = JSON.parse(readFileSync(await dl.path(), "utf8"));
    out.schema === "ofp-planner/logbook" && out.flights.length === 3 ? pass("logbook: export writes the same file format back") : fail(`logbook: export ${out.schema} ${out.flights?.length}`);
    // layout shift is measured on a fresh load with flights in the logbook
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.goto(`${base}/logbook`, { waitUntil: "networkidle" });
    await page.waitForSelector(".log-map .map-route", { timeout: 20000 });
    await checkPage("logbook 1280 light", page, errors);
    await shot(page, "logbook-day");
    // Settings → Display: flight strips
    await page.evaluate(() => localStorage.setItem("ofp-planner:display", JSON.stringify({ logbook: "strips" })));
    await page.goto(`${base}/logbook`, { waitUntil: "networkidle" });
    await page.waitForSelector(".log-strips .strip");
    const strips = await page.locator(".log-strips .strip").count();
    await page.locator(".strip", { hasText: "EZY34MH" }).first().hover();
    await page.waitForTimeout(200);
    const stripLit = await page.locator(".log-map .map-route.on").count();
    await page.locator(".strip", { hasText: "EZY34MH" }).locator(".log-date").click();
    const stripOpen = await page.locator(".strip-detail").getByRole("button", { name: "Edit" }).count();
    strips === 3 && stripLit === 1 && stripOpen === 1 && !(await page.locator(".log-tbl").count())
      ? pass("logbook: flight strips (Settings) list every flight, light the route on hover and open the details")
      : fail(`logbook: strips ${strips} lit ${stripLit} open ${stripOpen}`);
    await checkPage("logbook strips 1280 light", page, errors);
    await ctx.close();
    const m = await open("/logbook", { width: 390, height: 844, theme: "dark" });
    await m.page.waitForSelector(".log-form");
    await checkPage("logbook 390 dark", m.page, m.errors);
    // Settings → Display → route lines: great circle (straight here) or rhumb line (bends with the grid)
    const bend = async (lines) => {
      await m.page.evaluate((l) => {
        localStorage.setItem("ofp-planner:display", JSON.stringify({ mapLines: l }));
        localStorage.setItem("ofp-planner:logbook", JSON.stringify([{ id: "b", date: "2026-10-05", from: "EGKK", to: "LTAI", callsign: "EZY1", landingFpm: -100 }]));
      }, lines);
      await m.page.goto(`${base}/logbook`, { waitUntil: "networkidle" });
      await m.page.waitForSelector(".log-map .map-line");
      await m.page.waitForTimeout(1600);
      // furthest the drawn line strays from the straight chord between its ends, in px
      return m.page.locator(".log-map .map-line").first().evaluate((el) => {
        const n = el.getTotalLength();
        const a = el.getPointAtLength(0);
        const b = el.getPointAtLength(n);
        let max = 0;
        for (let i = 1; i < 20; i++) {
          const p = el.getPointAtLength((n * i) / 20);
          max = Math.max(max, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y));
        }
        return Math.round(max * 10) / 10;
      });
    };
    const great = await bend("great");
    const rhumb = await bend("rhumb");
    great < 1.5 && rhumb > 4
      ? pass(`map lines: shortest way is straight (${great} px off the chord), along the grid bends (${rhumb} px) — Gatwick → Antalya`)
      : fail(`map lines: great ${great} px, rhumb ${rhumb} px`);
    for (const style of ["table", "strips"]) {
      await m.page.evaluate((s) => {
        localStorage.setItem("ofp-planner:display", JSON.stringify({ logbook: s }));
        localStorage.setItem("ofp-planner:logbook", JSON.stringify([{ id: "a", date: "2026-10-05", from: "LOWI", to: "EGBB", callsign: "EZY34MH", flight: "U2234", type: "A20N", std: "16:00", sta: "17:50", out: "16:05", in: "18:10", landingFpm: -180 }]));
      }, style);
      await m.page.goto(`${base}/logbook`, { waitUntil: "networkidle" });
      await m.page.waitForSelector(".log-wrap");
      const w = await m.page.locator(".log-wrap").evaluate((el) => [el.scrollWidth, el.clientWidth]);
      w[0] <= w[1] ? pass(`logbook: ${style} fits a 390 px phone without sideways scrolling`) : fail(`logbook: ${style} at 390 is ${w[0]} in ${w[1]}`);
      await checkPage(`logbook ${style} 390 dark`, m.page, m.errors);
    }
    await m.ctx.close();
  });

  /* ---------- night screenshots ---------- */
  if (SHOTS) {
    const { ctx, page } = await open("/?al=EZY&dep=EGKK", { theme: "dark" });
    await page.waitForSelector("table.flights tbody tr");
    await page.locator("table.flights tbody tr").nth(2).click();
    await page.waitForTimeout(1600);
    await shot(page, "finder-night");
    await page.getByRole("tab", { name: /Destinations/ }).click();
    await page.waitForTimeout(800);
    await shot(page, "destinations-night");
    await ctx.close();
    const m = await open("/?al=EZY&dep=EGKK", { width: 390, height: 844 });
    await m.page.waitForSelector("table.flights tbody tr");
    await m.page.locator("table.flights tbody tr").first().click();
    await m.page.waitForTimeout(1600);
    await shot(m.page, "finder-phone-day");
    await m.ctx.close();
  }

  await browser.close();
  server.close();
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed${SHOTS ? ` · screenshots in ${SHOT_DIR}` : ""}`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
