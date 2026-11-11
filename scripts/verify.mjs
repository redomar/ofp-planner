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
import { gunzipSync, gzipSync } from "node:zlib";
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
    // a busy machine can miss the 30 s window once; a second, longer wait still fails a page that never settles
    try {
      await page.goto(base + path, { waitUntil: "networkidle" });
    } catch (e) {
      if (e?.name !== "TimeoutError") throw e;
      console.log(`note: ${path} slow to settle, retrying once`);
      await page.goto(base + path, { waitUntil: "networkidle", timeout: 90000 });
    }
    return { ctx, page, errors };
  };

  /** For contexts made outside open(): the example airframe (never a real one in a screenshot) and the layout-shift counter. */
  const SEED = () => {
    if (!localStorage.getItem("ofp-planner:airframes"))
      localStorage.setItem("ofp-planner:airframes", JSON.stringify({ list: [{ id: "ex", name: "G-ABCD", icao: "A20N", sbType: "123456_1700000000000", note: "example" }], preferred: "ex" }));
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
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
  /** Opens a folded section of the flight panel (Full layout) if it's closed. */
  const openFold = async (page, sec) => {
    const d = page.locator(`.drawer .fc-fold[data-sec="${sec}"]:not([open]) > summary`);
    if (await d.count()) await d.click();
  };
  const shot = async (page, name) => {
    if (!SHOTS) return;
    shotNo++;
    await page.screenshot({ path: join(SHOT_DIR, `${String(shotNo).padStart(2, "0")}-${name}.png`), fullPage: false });
  };

  // VERIFY_ONLY=name runs just the sections whose name contains it (while working on one)
  const section = async (name, fn) => {
    if (process.env.VERIFY_ONLY && !name.includes(process.env.VERIFY_ONLY)) return;
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
    // (Full keeps Details folded until opened, 1.8)
    await openFold(page, "details");
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
    const grp = (await page.locator(".fav-group-chip.on").allTextContents()).map((t) => t.replace(/^✓\s*/, "")).join();
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

  /* ---------- flight card: the boarding pass, three styles × theme × width ---------- */
  await section("boarding pass styles", async () => {
    for (const style of ["track", "side", "city"])
      for (const theme of ["light", "dark"])
        for (const width of [1280, 390]) {
          const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, deviceScaleFactor: SHOTS ? 2 : 1 });
          await ctx.addInitScript(SEED);
          await ctx.addInitScript((s) => localStorage.setItem("ofp-planner:display", JSON.stringify({ pass: s })), style);
          const page = await ctx.newPage();
          const errors = [];
          page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
          page.on("pageerror", (e) => errors.push(String(e)));
          // PC1528 LEBL→LTBJ: departure tracked, arrival not → estimated with an EST. badge
          await page.goto(`${base}/?al=PGT&dep=LEBL&arr=LTBJ`, { waitUntil: "networkidle" });
          await page.waitForSelector("table.flights tbody tr");
          await page.locator(width < 640 ? "table.flights tbody .row-btn" : "table.flights tbody tr").first().click();
          await page.waitForSelector(".drawer .fcard");
          await page.waitForTimeout(700);
          const ok = (await page.locator(`.drawer .fcard.bp-${style} .bp-front.bp-f-${style}`).count()) === 1;
          const est = await page.locator(".drawer .rh .est-badge").count();
          const wavy = await page.locator(".drawer .rh").evaluate((el) => el.textContent.includes("≈"));
          ok && est > 0 && !wavy ? pass(`pass ${style} ${theme} ${width}px: shown, ${est} EST. badge(s), no ≈`) : fail(`pass ${style} ${theme} ${width}px: ok ${ok} est ${est} wavy ${wavy}`);
          // nothing in the pass is cut off or spills out of it, and SimBrief is on the first screen above the map
          const fit = await page.evaluate(() => {
            const bp = document.querySelector(".drawer .bp").getBoundingClientRect();
            const spill = [...document.querySelectorAll(".drawer .bp-stub .btn, .drawer .bp-stub select, .drawer .bp-face-front .code-flap, .drawer .bp-face-front .rh-big, .drawer .bp-face-front .bp-ltime")]
              .filter((e) => {
                const r = e.getBoundingClientRect();
                // (a select clips its own text by design, so only its box is checked)
                return r.width > 0 && (r.left < bp.left - 0.5 || r.right > bp.right + 0.5 || (e.tagName !== "SELECT" && e.scrollWidth > e.clientWidth + 1));
              })
              .map((e) => (e.textContent || e.className).trim().slice(0, 20));
            const sb = document.querySelector(".drawer .bp-stub a.btn-primary").getBoundingClientRect().bottom;
            const map = document.querySelector(".drawer .map")?.getBoundingClientRect().top ?? Infinity;
            return { spill, sb: Math.round(sb), above: sb < map };
          });
          fit.spill.length === 0 && fit.above && fit.sb < 900 ? pass(`pass ${style} ${theme} ${width}px: nothing spills, Open in SimBrief at ${fit.sb}px above the map`) : fail(`pass ${style} ${theme} ${width}px: ${JSON.stringify(fit)}`);
          const bad = await page.evaluate(CONTRAST);
          bad.length ? fail(`pass ${style} ${theme} ${width}px: contrast ${JSON.stringify(bad.slice(0, 4))}`) : pass(`pass ${style} ${theme} ${width}px: text contrast AA`);
          const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          sw > 0 ? fail(`pass ${style} ${width}px: sideways scroll ${sw}`) : null;
          errors.length ? fail(`pass ${style}: console errors ${JSON.stringify(errors.slice(0, 2))}`) : null;
          if (width === 1280) await shot(page, `pass-${style}-${theme === "light" ? "day" : "night"}`);
          await ctx.close();
        }
  });

  /* ---------- flight card: band, flip, stamp, tickets, the choice saved before 1.8 ---------- */
  /* ---------- 1.9 feed A: live readings and the phase detector ---------- */
  await section("gate feed", async () => {
    // the detector, straight from the source file, fed the owner's recorded flight (KCLT → KJFK,
    // Fenix A321, recorder v1: starts in cruise, ends parked at the gate)
    const REC = "public/recordings/kclt-kjfk.jsonl";
    if (!existsSync(REC)) console.log(`note gate feed: ${REC} isn't here yet, detector checks NOT run`);
    else {
      const core = await import(join(process.cwd(), "src/lib/feed/core.ts"));
      const rec = core.parseRecording(readFileSync(REC, "utf8"));
      const jfk = { lat: 40.6398, lon: -73.7789, elev: 13 };
      const clt = { lat: 35.214, lon: -80.9431, elev: 748 };
      const states = core.detectAll(rec.samples, { from: clt, to: jfk });
      const seen = [...new Set(states.map((x) => x.phase))];
      const end = states.at(-1);
      const order = ["cruise", "descent", "approach", "landed", "taxiIn", "gate"];
      order.every((p, i) => seen.includes(p) && (i === 0 || seen.indexOf(order[i - 1]) < seen.indexOf(p)))
        ? pass(`gate feed: phases in order (${seen.join(" → ")})`)
        : fail(`gate feed: phases ${seen.join(" → ")}`);
      // 1.11: the grid's stages, approaching cut out of flying (below FL100 on the way down, on approach, landing)
      const vstages = [...new Set(states.map((x) => core.viewStage(x)))];
      vstages.join(" → ") === "flying → approaching → arrived"
        ? pass(`gate feed: grid stages ${vstages.join(" → ")}`)
        : fail(`gate feed: grid stages ${vstages.join(" → ")}`);
      // 1.10.3: flight levels from pressure altitude; level at the FMS's cruise level = cruising after 20 s
      const lvl = (ctx, press) => {
        let st = core.startState();
        for (let i = 0; i <= 200; i++) {
          const climbing = i < 160;
          const p = climbing ? 30000 + i * 25 : 34000;
          const r = { lat: 52, lon: i * 0.002, alt: p - 921, gs: 460, hdg: 90, vs: climbing ? 1500 : -80, onGround: false, ...(press ? { pressAlt: p, indAlt: p } : {}) };
          st = core.step(st, core.toSample(r, 1e12 + i * 1000), ctx);
        }
        return st.phase;
      };
      lvl({ cruiseFt: 34000 }, true) === "cruise" && lvl({ cruiseFt: 32000 }, true) === "climb" && lvl({}, false) === "climb"
        ? pass("gate feed: level at the FMS cruise level is cruising after 20 s (else the 2-minute hold)")
        : fail(`gate feed: level-off ${lvl({ cruiseFt: 34000 }, true)} ${lvl({ cruiseFt: 32000 }, true)} ${lvl({}, false)}`);
      const sm = core.toSample({ lat: 50, lon: 6, alt: 33079, pressAlt: 34000, wind: [254, 15], fobKg: 5138, ffKgH: 2102, hdgMag: 287.1 }, 1);
      core.levelFt(sm) === 34000 && sm.wind?.[1] === 15 && sm.fobKg === 5138 && core.levelFt(core.toSample({ lat: 50, lon: 6, alt: 33079 }, 1)) === 33079
        ? pass("gate feed: OFP Tower's pressure altitude, wind and fuel read in; alt without them")
        : fail(`gate feed: sample ${JSON.stringify(sm)}`);
      const pl = core.toPlan({ origin: "EDDM", destination: "EGBB", active: { from: 0, to: 1 }, vSpeeds: { v1: 152, vr: 156, v2: 156 }, legs: [{ id: "LENDO", lat: 50.1, lon: 6.6 }, { id: "DENUT", lat: 50.48, lon: 5.6, eta: "15:09", wind: [250, 40] }] });
      pl?.active?.to === 1 && pl.legs[1].eta === "15:09" && pl.legs[1].wind?.[0] === 250 && pl.vSpeeds?.v1 === 152 && core.toPlan({ origin: "EDDM", destination: "EGBB", active: { from: 0, to: 5 }, legs: [] })?.active === null
        ? pass("gate feed: the FMS plan's active legs, times over the fixes and V-speeds read in (an impossible active is dropped)")
        : fail(`gate feed: plan ${JSON.stringify(pl)}`);
      // 1.11.1: the landing is the first contact, even when a bounce has the aircraft back in the air on
      // that reading (EDDM → EGBB: −776 fpm, then a 2 s bounce, on the ground at −117)
      {
        const egbb = { lat: 52.4539, lon: -1.748, elev: 325 };
        const at = (i, r) => core.toSample({ lat: 52.45, lon: -1.70 + i * 0.0006, alt: 340, gs: 115, hdg: 330, vs: -200, onGround: false, engines: [true, true], seatbelts: true, ...r }, 1e12 + i * 1000);
        const seq = [at(0, { alt: 900, vs: -700 }), at(1, { alt: 345 }), at(2, { landingRate: -776, tdSim: -1156 }), at(3, { vs: -77 }), at(4, { onGround: true, landingRate: -117, tdSim: -220 }), at(5, { onGround: true, gs: 100 })];
        const end = core.detectAll(seq, { to: egbb }).at(-1).stamps;
        end.on === seq[2].t && end.landingRate === -776 && end.bounces === 1 && core.landingText(end) === "-776 fpm · 1 bounce"
          ? pass("gate feed: the landing is the first contact (-776 fpm), the second contact a bounce")
          : fail(`gate feed: landing ${JSON.stringify(end)}`);
        const desc = (belts) => core.viewStage({ ...core.startState(), phase: "descent", stage: "flying", airborne: true, last: at(0, { alt: 8000, vs: -1500, seatbelts: belts }) });
        desc(true) === "approaching" && desc(false) === "flying" && desc(null) === "approaching"
          ? pass("gate feed: approaching below FL100 on the way down only with the seatbelt sign on (unknown counts as on)")
          : fail(`gate feed: approaching with belts ${desc(true)} ${desc(false)} ${desc(null)}`);
      }
      // 1.11.2: no 0,0 points (the sim loading, an FMS entry not resolved yet); the equator and the prime meridian stay
      {
        const pl = core.toPlan({ origin: "EDDM", destination: "EGBB", legs: [{ id: "EDDM", lat: 0, lon: 0 }, { id: "LIM", lat: 0.00001, lon: -0.00002 }, { id: "GRW", lat: 51.48, lon: 0 }, { id: "EQ", lat: 0, lon: 30 }] });
        const s0 = core.toSample({ lat: 0, lon: 0, alt: 0 }, 1);
        pl?.legs.map((l) => l.id).join(",") === "GRW,EQ" && s0 === null && core.toSample({ lat: 51.48, lon: 0, alt: 0 }, 1) !== null
          ? pass("gate feed: plan legs and readings at 0,0 are dropped (real points on 0° kept)")
          : fail(`gate feed: null island ${JSON.stringify(pl?.legs.map((l) => l.id))} ${JSON.stringify(s0)}`);
      }
      const changes = states.filter((x, i) => i && x.phase !== states[i - 1].phase).length;
      changes === seen.length - 1 ? pass(`gate feed: each phase entered once, no flicker in the turbulence (${changes} changes)`) : fail(`gate feed: ${changes} phase changes for ${seen.length} phases`);
      const tdLine = rec.samples.findIndex((x) => x.tdSim != null);
      end.stamps.out == null && end.stamps.off == null ? pass("gate feed: no OUT or OFF for a recording that starts in the air") : fail(`gate feed: stamps ${JSON.stringify(end.stamps)}`);
      end.stamps.on === rec.samples[tdLine]?.t && end.stamps.landingRate === rec.samples[tdLine].tdSim && end.stamps.landingRate < 0
        ? pass(`gate feed: ON stamped at touchdown, ${end.stamps.landingRate} fpm (v1: the sim's latched rate)`)
        : fail(`gate feed: ON ${JSON.stringify(end.stamps)} td line ${tdLine}`);
      end.phase === "gate" && end.stage === "arrived" && end.stamps.in > end.stamps.on ? pass(`gate feed: at the gate, IN ${Math.round((end.stamps.in - end.stamps.on) / 60000)} min after ON`) : fail(`gate feed: end ${end.phase} ${JSON.stringify(end.stamps)}`);
      // a departure: SYNTHETIC (no departure recorded yet), built from the real JFK stand position
      // and heading; for these checks only, never shown in a screenshot. Doors and beacon as the
      // Fenix showed them, a pushback tail first at 3 kt, a stop for the tug, taxi nose first at
      // 15 kt, a take-off roll, wheels off, a climb.
      const dep = [];
      let p0 = { lat: 40.644552, lon: -73.775303 };
      const hdg = 299.8;
      let t = Date.UTC(2026, 10, 10, 21, 0, 0);
      const move = (kt, track) => {
        const nm = kt / 3600;
        p0 = { lat: p0.lat + (nm * Math.cos((track * Math.PI) / 180)) / 60, lon: p0.lon + (nm * Math.sin((track * Math.PI) / 180)) / (60 * Math.cos((p0.lat * Math.PI) / 180)) };
      };
      const add = (n, o) => {
        for (let i = 0; i < n; i++) {
          t += 1000;
          if (o.gs) move(o.gs, o.track ?? o.hdg ?? hdg);
          dep.push({ t, ...p0, alt: o.alt ?? 20, gs: o.gs ?? 0, hdg: o.hdg ?? hdg, vs: o.vs ?? 0, onGround: o.onGround ?? true, parkBrake: o.brake ?? false, engines: o.eng ?? [false, false], beacon: o.beacon ?? false, doors: o.doors ?? [0, 0, 0, 0], seatbelts: true, noSmoking: "auto", landingRate: null, tdSim: null });
        }
      };
      add(10, { doors: [100, 0, 0, 100], brake: true });
      add(10, { brake: true, beacon: true });
      add(30, { gs: 3, track: (hdg + 180) % 360, beacon: true, eng: [true, false] });
      add(20, { beacon: true, eng: [true, true], brake: true });
      add(60, { gs: 15, beacon: true, eng: [true, true] });
      add(25, { gs: 0, beacon: true, eng: [true, true] });
      for (let k = 6; k <= 150; k += 6) add(1, { gs: k, beacon: true, eng: [true, true] });
      add(40, { gs: 160, alt: 20, vs: 2000, onGround: false, beacon: true, eng: [true, true] });
      for (const [i, x] of dep.entries()) if (!x.onGround) x.alt = 20 + (i - dep.findIndex((d) => !d.onGround)) * 33;
      const ds = core.detectAll(dep, { from: { ...jfk } });
      const dseen = [...new Set(ds.map((x) => x.phase))];
      const dend = ds.at(-1).stamps;
      const firstMove = dep.findIndex((x) => x.gs >= 1);
      const firstAir = dep.findIndex((x) => !x.onGround);
      dseen.join(" ") === "boarding doorsClosed pushback taxi takeoff climb" && dend.out === dep[firstMove].t && dend.off === dep[firstAir].t
        ? pass(`gate feed: departure (synthetic) ${dseen.join(" → ")}, OUT at the first push, OFF at wheels off`)
        : fail(`gate feed: departure ${dseen.join(" → ")} ${JSON.stringify(dend)}`);
      const power = core.detectAll(dep.slice(10, 50).map((x) => ({ ...x, gs: x.gs ? 8 : 0, hdg: (hdg + 180) % 360 })));
      power.find((x) => x.stamps.out)?.phase === "taxi" ? pass("gate feed: driving off a stand nose first is taxiing, not a pushback") : fail(`gate feed: power-out ${power.map((x) => x.phase).join(",")}`);

      // rehearsing another route: the recording is laid along that flight's line (VKO → IST here)
      const VKO = { lat: 55.5915, lon: 37.2615 };
      const IST = { lat: 41.2753, lon: 28.7519 };
      const fit = core.fitToRoute(rec.samples, VKO, IST);
      const line = core.distNm(VKO, IST);
      const offLine = Math.max(...fit.map((x) => core.distNm(VKO, x) + core.distNm(x, IST) - line));
      const fitPhases = [...new Set(core.detectAll(fit, { from: VKO, to: IST }).map((x) => x.phase))].join(" ");
      offLine < 0.5 && core.distNm(fit.at(-1), IST) < 0.5 && fitPhases === seen.join(" ") && core.fitToRoute(rec.samples, clt, jfk) === rec.samples
        ? pass("gate feed: a recording rehearsed on another route stays on its line and ends at its destination; on its own route it plays as recorded")
        : fail(`gate feed: fit off-line ${offLine} end ${core.distNm(fit.at(-1), IST)} phases ${fitPhases}`);

      // recorder v2 (Fenix profile), parked at the gate with the doors open: the cabin fields come through
      const v2 = core.parseRecording(readFileSync("public/recordings/kjfk-gate-v2.jsonl", "utf8"));
      const g = v2.samples[0];
      const gs = core.detectAll(v2.samples).at(-1);
      v2.version === 2 && g.parkBrake === false && g.seatbelts === false && g.noSmoking === "off" && g.landingRate === null && gs.phase === "boarding" && gs.stamps.out == null
        ? pass("gate feed: a v2 recording reads the parking brake and cabin signs; parked with doors open is boarding")
        : fail(`gate feed: v2 ${JSON.stringify(g)} ${gs.phase}`);
    }

    // the screen: nothing leaves the machine (VATSIM answered here), and without a feed it is the clock as in 1.8
    const gq = `f=${encodeURIComponent("RYR:RYR658:EBBR-EIDW:1234567")}&in=30&screen=1`;
    const screen = async (extra, vatsim, until) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await ctx.addInitScript(SEED);
      const asked = [];
      await ctx.route(/vatsim\.net/, (r) => (asked.push(r.request().url()), r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ pilots: vatsim ?? [] }) })));
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${base}/board?tab=gate&${gq}${extra}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".gs-status b");
      if (until) await page.waitForFunction((re) => new RegExp(re, "i").test(document.querySelector(".gs-status")?.textContent ?? ""), until, { timeout: 15_000 }).catch(() => {});
      else await page.waitForTimeout(1000);
      const st = (await page.locator(".gs-status").innerText()).replace(/\s+/g, " ");
      const now = await page.locator(".gs-steps li.is-now").count();
      await ctx.close();
      return { st, now, asked, errors };
    };
    const clock = await screen("");
    const junk = await screen("&feed=replay&rec=https://example.com/x.jsonl");
    const noLink = await screen("&feed=link");
    const offline = await screen("&feed=vatsim&who=RYR7FE");
    // (minutes ignored: a minute can tick over between the four pages)
    const same = (x) => x.st.replace(/\d+/g, "#") === clock.st.replace(/\d+/g, "#");
    /BOARDING/i.test(clock.st) && same(junk) && same(noLink) && same(offline)
      ? pass("gate feed: no feed, a bad feed, OFP Tower not running and a pilot not online all leave the clock screen as it was")
      : fail(`gate feed: clock ${clock.st} | junk ${junk.st} | link ${noLink.st} | offline ${offline.st}`);
    clock.asked.length === 0 && offline.asked.every((u) => u === "https://data.vatsim.net/v3/vatsim-data.json") && offline.asked.length >= 1
      ? pass("gate feed: VATSIM is only read (the public data file), and only when asked for")
      : fail(`gate feed: requests ${JSON.stringify([clock.asked, offline.asked])}`);
    // the recorded flight replayed on the screen (240× sim speed: the whole flight in about 21 s)
    if (existsSync(REC)) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await ctx.addInitScript(SEED);
      const page = await ctx.newPage();
      await page.goto(`${base}/board?tab=gate&${gq}&feed=replay&rec=/recordings/kclt-kjfk.jsonl&rate=240`, { waitUntil: "networkidle" });
      await page.waitForSelector(".gs-status b");
      const first = (await page.locator(".gs-status").innerText()).replace(/\s+/g, " ");
      await page.waitForFunction(() => /AT THE GATE/i.test(document.querySelector(".gs-status")?.textContent ?? ""), null, { timeout: 60_000 }).catch(() => {});
      const last = (await page.locator(".gs-status").innerText()).replace(/\s+/g, " ");
      /CLIMBING|CRUISING/i.test(first) && /FL\d{3}/.test(first) && /AT THE GATE/i.test(last) && /−?-?489 fpm/.test(last)
        ? pass(`gate feed: the recorded flight replays on the screen (${first} … ${last})`)
        : fail(`gate feed: replay ${first} … ${last}`);
      await ctx.close();
    }
    // a replay URL on another route (THY2MH VKO → IST, as in the owner's OBS test): the aircraft flies that route
    {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await ctx.addInitScript(SEED);
      const page = await ctx.newPage();
      await page.goto(`${base}/board?tab=gate&f=${encodeURIComponent("THY:THYTHY2MH:UUWW-LTFM:123456")}&screen=1&view=map&feed=replay&rec=/recordings/kclt-kjfk.jsonl&at=20`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => /CRUIS|CLIMB|DESCEND/i.test(document.querySelector(".gv-status")?.textContent ?? ""), null, { timeout: 15_000 }).catch(() => {});
      const toGo = Number(((await page.locator(".gv-tile", { hasText: "To go" }).innerText().catch(() => "")).match(/[\d,]+/)?.[0] ?? "NaN").replace(/,/g, ""));
      const plane = await page.locator(".gm-plane").count();
      toGo > 0 && toGo < 950 && plane === 1 ? pass(`gate feed: a replay URL on another route flies that route (${toGo} nm to go, aircraft on the map)`) : fail(`gate feed: replay on another route ${toGo} nm, plane ${plane}`);
      await ctx.close();
    }
    // a pilot online: the first reading of the recorded flight, as VATSIM would list it
    const pilot = { cid: 1000000, callsign: "RYR7FE", latitude: 34.195541, longitude: -80.70894, altitude: 28404, groundspeed: 463, heading: 346, last_updated: "2026-11-10T18:48:22Z" };
    const online = await screen("&feed=vatsim&who=RYR7FE", [pilot], "CRUISING");
    /CRUISING/i.test(online.st) && online.errors.length === 0
      ? pass(`gate feed: VATSIM pilot online drives the screen, joined at cruise it says cruising (${online.st})`)
      : fail(`gate feed: online ${online.st} ${online.errors.join(" ")}`);
  });

  /* ---------- 1.9 B: the gate screen's views, driven by the recorded flight ---------- */
  await section("gate views", async () => {
    // the flight is the owner's recorded KCLT → KJFK (Fenix A321, HB-IOO); there is no OFP for it,
    // so SimBrief is answered here with its ends, type and registration (schedule illustrative)
    const OFP = {
      fetch: { status: "Success" },
      general: { icao_airline: "", flight_number: "", initial_altitude: "39000", gc_distance: "471" },
      atc: { callsign: "HBIOO" },
      origin: { icao_code: "KCLT", pos_lat: "35.214", pos_long: "-80.943", name: "CHARLOTTE/DOUGLAS INTL", plan_rwy: "36C" },
      destination: { icao_code: "KJFK", pos_lat: "40.640", pos_long: "-73.779", name: "JOHN F KENNEDY INTL" },
      times: { sched_out: "2026-11-10T18:15:00Z", est_out: "2026-11-10T18:15:00Z", sched_block: "01:50:00", taxi_out: "00:15:00" },
      aircraft: { icaocode: "A321", name: "A321-211", reg: "HB-IOO" },
      params: { time_generated: "2026-11-10T17:30:00Z" },
      // the route, fix by fix (illustrative points on the line), for the route panel (G3d)
      navlog: {
        fix: [
          { ident: "TOC", type: "ltlg", pos_lat: "36.0", pos_long: "-79.9" },
          ...[0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((k, i) => ({ ident: `FIX${i + 1}`, type: "wpt", via_airway: i < 3 ? "J75" : "DCT", pos_lat: String(35.214 + (40.64 - 35.214) * k), pos_long: String(-80.943 + (-73.779 + 80.943) * k) })),
          { ident: "KJFK", type: "apt", pos_lat: "40.640", pos_long: "-73.779" },
        ],
      },
    };
    const views = ["full", "map", "route", "frame", "mapwin", "corner", "strip", "card", "pill", "line", "g6a1", "g6a2", "g6a3", "g6b", "g7a1", "g7a2", "g7a3", "g7b"];
    const open1 = async (view, { at = 20, width = 1920, height = 1080, until = "CRUIS" } = {}) => {
      const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      await ctx.addInitScript(SEED);
      await ctx.addInitScript(() => {
        window.__cls = 0;
        window.__shifts = [];
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) (window.__cls += e.value), window.__shifts.push({ v: +e.value.toFixed(3), src: (e.sources ?? []).map((x) => x.node?.className?.baseVal ?? x.node?.className ?? x.node?.nodeName) });
        }).observe({ type: "layout-shift", buffered: true });
      });
      await ctx.route(/simbrief\.com\/api\/xml\.fetcher\.php/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(OFP) }));
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${base}/board?tab=gate&sb=example-pilot&screen=1&feed=replay&rec=/recordings/kclt-kjfk.jsonl&at=${at}&view=${view}`, { waitUntil: "networkidle" });
      await page.waitForFunction((re) => new RegExp(re, "i").test(document.querySelector(".gs-frame")?.textContent ?? ""), until, { timeout: 20_000 }).catch(() => {});
      // the readings keep coming: measure from here (CLS of the screen settling, not of arriving)
      await page.evaluate(() => ((window.__cls = 0), (window.__shifts = [])));
      await page.waitForTimeout(3000);
      return { ctx, page, errors };
    };
    for (const view of views) {
      for (const [w, h] of [
        [1920, 1080],
        [390, 844],
      ]) {
        const o = await open1(view, { width: w, height: h });
        const txt = (await o.page.locator(".gs-frame").innerText()).replace(/\s+/g, " ");
        (view === "pill" ? /KCLT → KJFK · \d+ min to go/ : view === "line" ? /KCLT → KJFK · \d+ min to go Cruising/i : /CRUIS/i).test(txt) ? pass(`gate view ${view} ${w}: shows the recorded flight cruising`) : fail(`gate view ${view} ${w}: ${txt.slice(0, 160)}`);
        await checkPage(`gate view ${view} ${w}`, o.page, o.errors);
        if (view !== "full") {
          const clear = await o.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
          const over = !["map", "route"].includes(view);
          over === (clear === "rgba(0, 0, 0, 0)") ? pass(`gate view ${view} ${w}: ${over ? "transparent around its panels" : "a full screen"}`) : fail(`gate view ${view} ${w}: body ${clear}`);
        }
        if (view === "route" && w === 1920) {
          // the SimBrief route: the fix just passed (no TOC, no airport) and the next three, with distances and times
          const rows = await o.page.locator(".gv-route li").allTextContents();
          const next = rows.filter((r) => /nm/.test(r));
          rows.length === 4 && /^FIX\d/.test(rows[0]) && next.length === 3 && next.every((r) => /^FIX\d.*\d+ nm\d{2}:\d{2}Z$/.test(r)) && !rows.some((r) => /TOC|KJFK/.test(r))
            ? pass(`gate view route: the fix passed and the next three from the OFP (${rows.join(" / ")})`)
            : fail(`gate view route: ${JSON.stringify(rows)}`);
        }
        await shot(o.page, `gate-${view}-${w}`);
        await o.ctx.close();
      }
    }
    // 1.12 looks: a token per look (size, corner, flip back sides, timings), layers with ~
    {
      const lk = await import(join(process.cwd(), "src/lib/board/looks.ts"));
      const g = lk.lookFrom("g6b.l.tl.bnr.e240.h30");
      const two = lk.layersFrom("strip~g6a1.s");
      g && g.size === "l" && g.pos === "tl" && g.backs.join() === "numbers,route" && g.every === 240 && g.hold === 30 && lk.lookTo(g) === "g6b.l.tl.bnr.e240.h30" && lk.lookTo(lk.lookFrom("card")) === "card" && two?.length === 2 && two[1].size === "s" && lk.lookFrom("nope") === null && lk.layersTo(two) === "strip~g6a1.s"
        ? pass("gate views: looks read and write as tokens (G6b large top left, back sides, timings; layers)")
        : fail(`gate views: looks ${JSON.stringify({ g, two })}`);
    }
    // size and corner: a small corner card at the bottom left
    {
      const m = await open1("card");
      const sm = await open1("card.s.bl");
      const rm = await m.page.locator(".gv-card").boundingBox();
      const rs = await sm.page.locator(".gv-card").boundingBox();
      rm && rs && rs.width < rm.width * 0.8 && rs.x < 100 && rs.y + rs.height > 1080 - 100 && rm.x > 1000 && rm.y < 100
        ? pass(`gate views: a look's size and corner (card ${Math.round(rm.width)} px top right; small ${Math.round(rs.width)} px bottom left)`)
        : fail(`gate views: size/corner ${JSON.stringify({ rm, rs })}`);
      await m.ctx.close();
      await sm.ctx.close();
    }
    // full screen in flight: the steps run on to the arrival gate, the live source is named
    const f = await open1("full");
    const steps = await f.page.locator(".gs-steps li b").allTextContents();
    const now = await f.page.locator(".gs-steps li.is-now b").textContent();
    const badge = await f.page.locator(".gs-live").innerText().catch(() => "");
    steps.join(",") === "Pushback,Take-off,Climb,Cruise,Descent,Approach,Landing,At the gate" && now === "Cruise" && /Replay/i.test(badge)
      ? pass("gate view full: in flight the steps run on to the gate (now: Cruise), live source named")
      : fail(`gate view full: steps ${steps} now ${now} badge ${badge}`);
    await f.ctx.close();
    // view=auto: the strip while flying, the full screen at the gate
    const a1 = await open1("auto");
    const a2 = await open1("auto", { at: 80, until: "AT THE GATE" });
    const isStrip = await a1.page.locator(".gv-strip").count();
    const atGate = (await a2.page.locator(".gs-status").innerText().catch(() => "")).replace(/\s+/g, " ");
    isStrip === 1 && /AT THE GATE/i.test(atGate) && /-489 fpm/.test(atGate)
      ? pass(`gate view auto: the strip while flying, the full screen at the gate (${atGate})`)
      : fail(`gate view auto: strip ${isStrip} gate ${atGate}`);
    await shot(a2.page, "gate-auto-arrived");
    await a1.ctx.close();
    await a2.ctx.close();
  });

  /* ---------- 1.9 C: the Stream panel, OBS scene names, rehearse ---------- */
  await section("stream panel", async () => {
    const FR = encodeURIComponent("RYR:RYR658:EBBR-EIDW:1234567");
    const start = async ({ width = 1280, height = 900, theme = "light", obs = null, pilots = [] } = {}) => {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
      await ctx.addInitScript(SEED);
      await ctx.addInitScript(() => {
        window.__cls = 0;
        window.__shifts = [];
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) (window.__cls += e.value), window.__shifts.push({ v: +e.value.toFixed(3), src: (e.sources ?? []).map((x) => x.node?.className?.baseVal ?? x.node?.className ?? x.node?.nodeName) });
        }).observe({ type: "layout-shift", buffered: true });
      });
      // a stand-in for OBS's browser-source API (window.obsstudio), not OBS itself
      if (obs) await ctx.addInitScript((name) => (window.obsstudio = { getCurrentScene: (cb) => setTimeout(() => cb({ name }), 50) }), obs);
      await ctx.route(/vatsim\.net/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ pilots }) }));
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION_REFUSED|WebSocket/.test(m.text()) && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      return { ctx, page, errors };
    };
    // the panel (1.12, the Stream studio): status, tabs, the scenes with each one's flight, the URL
    const a = await start();
    await a.page.goto(`${base}/board?tab=gate&f=${FR}&in=30`, { waitUntil: "networkidle" });
    await a.page.waitForSelector(".st-timeline .st-look");
    const srcs = await a.page.locator(".sp-src b").allTextContents();
    const tabs = await a.page.locator(".st-tabs [role=tab]").allTextContents();
    const sceneList = await a.page.locator(".st-scene b").allTextContents();
    const stageCards = await a.page.locator(".st-timeline .st-look").count();
    const ovOther = await a.page.locator(".st-ov-row:not(.is-head)").first().locator(".st-ov-cell .mono").allTextContents();
    const url = await a.page.locator(".sp-url").inputValue();
    srcs.length === 4 && /Clock only · live/.test(srcs[3]) && tabs.join("|").startsWith("Scenes") && /Rehearse\|Live feed\|OBS setup/.test(tabs.join("|")) && sceneList.join("|") === "Any other scene|BRB|Map|Camera" && stageCards === 5 && ovOther.join("|") === "G1|G1|G4 M|G4 M|G1" && /screen=1/.test(url) && /view=auto/.test(url) && /feed=auto/.test(url)
      ? pass("stream panel: the studio: tabs, the OBS scenes, a scene's five stages, every scene at a glance (any other: G1 G1 G4 G4 G1), one stream URL (view=auto, feed=auto)")
      : fail(`stream panel: ${JSON.stringify({ srcs, tabs, sceneList, stageCards, ovOther, url })}`);
    await checkPage("stream panel 1280 light", a.page, a.errors);
    await shot(a.page, "stream-panel");
    // a preset, a look picked in the editor (a map corner that flips, large, top left), a layer and a renamed scene go into the URL
    await a.page.locator(".st-scene", { hasText: "Any other scene" }).click();
    await a.page.locator(".st-from select").selectOption("Minimal");
    await a.page.locator(".st-look").nth(3).click();
    await a.page.getByRole("button", { name: "+ Add a layer" }).click();
    await a.page.locator(".st-group", { hasText: "Map corners" }).click();
    await a.page.locator(".st-opt", { hasText: "Map corner" }).first().click();
    await a.page.getByRole("radio", { name: "Small" }).click();
    await a.page.getByRole("button", { name: "Use this look" }).click();
    await a.page.locator(".st-scene", { hasText: "BRB" }).click();
    await a.page.locator(".st-look").nth(2).click();
    await a.page.locator(".st-group", { hasText: "Full screens" }).click();
    await a.page.locator(".st-opt", { hasText: "Moving map" }).click();
    await a.page.getByRole("button", { name: "Use this look" }).click();
    await a.page.getByLabel("OBS scene name").fill("Be right back");
    await a.page.locator(".st-scene", { hasText: "Camera" }).click();
    await a.page.locator(".st-look").nth(2).click();
    await a.page.locator(".st-group", { hasText: "Map corners" }).click();
    await a.page.locator(".st-opt", { hasText: "Corner that flips" }).click();
    await a.page.getByRole("radio", { name: "Large" }).click();
    await a.page.getByRole("radio", { name: "top left" }).click();
    const dlgShot = await a.page.locator(".st-dlg").count();
    await shot(a.page, "stream-studio-editor");
    await a.page.getByRole("button", { name: "Use this look" }).click();
    const url2 = decodeURIComponent((await a.page.locator(".sp-url").inputValue()).replace(/\+/g, " "));
    /st=pill,pill,pill,pill~corner\.s,pill(&|$)/.test(url2) && /Be right back:frame,frame,map,frame,frame/.test(url2) && /Camera:card,card,g6b\.l\.tl,card,card/.test(url2) && dlgShot === 1
      ? pass("stream panel: a preset, a layer (pill + small map corner on approach), a look picked in the editor (G6b large, top left) and a renamed scene travel in the stream URL")
      : fail(`stream panel: url ${url2}`);
    // VATSIM: a callsign, then it's the one in use when it's online (answered here)
    await a.ctx.close();
    const pilot = { cid: 1000000, callsign: "RYR7FE", latitude: 34.195541, longitude: -80.70894, altitude: 28404, groundspeed: 463, heading: 346, last_updated: "2026-11-10T18:48:22Z" };
    const v = await start({ pilots: [pilot] });
    await v.page.goto(`${base}/board?tab=gate&f=${FR}&in=30`, { waitUntil: "networkidle" });
    await v.page.getByRole("tab", { name: "Live feed" }).click();
    await v.page.getByLabel("VATSIM callsign or CID").fill("ryr7fe");
    await v.page.getByRole("button", { name: "Use", exact: true }).click();
    await v.page.waitForFunction(() => document.querySelector(".sp-src.is-on b")?.textContent?.includes("VATSIM"), null, { timeout: 15_000 }).catch(() => {});
    const on = await v.page.locator(".sp-src.is-on b").textContent().catch(() => "");
    /VATSIM · live/.test(on) && /who=RYR7FE/.test(v.page.url()) ? pass("stream panel: with a callsign, VATSIM is used while OFP Tower isn't running") : fail(`stream panel: vatsim ${on} ${v.page.url()}`);
    await v.ctx.close();
    // 1.12.1: another pilot on VATSIM with no Finder flight or OFP: the flight is what they filed
    const ewg = { cid: 1000001, callsign: "EWG50T", latitude: 50.3, longitude: 6.1, altitude: 34000, groundspeed: 452, heading: 289, last_updated: new Date().toISOString(), flight_plan: { departure: "EDDM", arrival: "EGBB", altitude: "FL340", aircraft_short: "A320" } };
    const w = await start({ pilots: [ewg] });
    await w.page.goto(`${base}/board?tab=gate`, { waitUntil: "networkidle" });
    await w.page.getByLabel("A pilot on VATSIM").fill("ewg50t");
    await w.page.getByRole("button", { name: "Watch", exact: true }).click();
    await w.page.waitForFunction(() => /Birmingham/.test(document.querySelector("#gs-preview")?.textContent ?? ""), null, { timeout: 20_000 }).catch(() => {});
    const watched = (await w.page.locator("#gs-preview").innerText().catch(() => "")).replace(/\s+/g, " ");
    /Birmingham/.test(watched) && /EWG50T/.test(watched) && /who=EWG50T/.test(w.page.url()) && !/[?&]f=/.test(w.page.url())
      ? pass("stream panel: a VATSIM callsign with no flight loaded: the board shows what they filed (EDDM → EGBB), live from VATSIM")
      : fail(`stream panel: watch VATSIM ${watched.slice(0, 160)} ${w.page.url()}`);
    await checkPage("watch vatsim", w.page, w.errors);
    await w.ctx.close();

    // OBS scene names (stand-in API): a rule wins over the stage table, case aside; other scenes follow the stage
    const scr = (obs, extra = "") => start({ width: 1920, height: 1080, obs }).then(async (o) => {
      await o.page.goto(`${base}/board?tab=gate&f=${FR}&in=30&screen=1&view=auto&feed=replay&rec=/recordings/kclt-kjfk.jsonl&at=20${extra}`, { waitUntil: "networkidle" });
      await o.page.waitForTimeout(1500);
      const view = await o.page.evaluate(() => (document.querySelector(".gv-frame") ? "frame" : document.querySelector(".gv-strip") ? "strip" : document.querySelector(".gv-map") ? "map" : document.querySelector(".gs") ? "full" : "none"));
      await o.ctx.close();
      return view;
    });
    const inBrb = await scr("brb");
    const inGame = await scr("Gameplay");
    const noObs = await scr(null);
    const held = await scr(null, "&hold=arrived");
    const asBrb = await scr(null, "&as=BRB");
    inBrb === "frame" && inGame === "strip" && noObs === "strip" && held === "full" && asBrb === "frame"
      ? pass("stream panel: OBS scene \"brb\" shows the frame, another scene the stage's view (strip while flying), hold=arrived holds the full screen, a source with as=BRB is the BRB column without OBS (OBS API stood in)")
      : fail(`stream panel: scenes brb ${inBrb} game ${inGame} none ${noObs} held ${held} as=BRB ${asBrb}`);

    // rehearse: play the recorded flight on the preview, drag to hold a stage
    const r = await start();
    await r.page.goto(`${base}/board?tab=gate&f=${FR}&in=30`, { waitUntil: "networkidle" });
    await r.page.getByRole("tab", { name: "Rehearse" }).click();
    await r.page.waitForSelector(".rs-b");
    const blocks = await r.page.locator(".rs-b").allTextContents();
    await r.page.getByRole("button", { name: "▶ Play in 60 s" }).click();
    await r.page.waitForFunction(() => document.querySelector("#gs-preview .gv-strip"), null, { timeout: 15_000 }).catch(() => {});
    const playing = await r.page.locator("#gs-preview .gv-strip").count();
    const marker = await r.page.locator(".rs-at").count();
    await r.page.locator(".rs-b", { hasText: "Arrived" }).click();
    await r.page.waitForTimeout(500);
    const heldView = await r.page.locator("#gs-preview .gs").count();
    const heldUrl = /hold=arrived/.test(r.page.url());
    const say = await r.page.locator(".rs .gt-actions [aria-live]").textContent();
    blocks.length >= 2 && /Flying/.test(blocks[0]) && playing === 1 && marker === 1 && heldView === 1 && heldUrl && /Holding: Arrived/.test(say)
      ? pass(`stream panel: rehearse plays the recorded flight (${blocks.join(" | ")}), a block holds its stage (preview and URL)`)
      : fail(`stream panel: rehearse ${JSON.stringify({ blocks, playing, marker, heldView, heldUrl, say })}`);
    await r.ctx.close();

    // the owner's case: Turkish Airlines VKO → IST with the map at each stage, rehearsed: the
    // aircraft stays on the VKO → IST line instead of the recording's own US position
    const t = await start();
    await t.page.goto(`${base}/board?f=${encodeURIComponent("THY:THYTHY2MH:UUWW-LTFM:123456")}&d=2026-11-11&view=auto&st=map%2Cfull%2Cmap%2Cfull&tab=gate`, { waitUntil: "networkidle" });
    await t.page.getByRole("tab", { name: "Rehearse" }).click();
    await t.page.waitForSelector(".rs-b");
    await t.page.getByRole("button", { name: "▶ Play in 60 s" }).click();
    await t.page.waitForFunction(() => /CLIMBING|CRUISING|DESCENDING/i.test(document.querySelector("#gs-preview .gv-status")?.textContent ?? ""), null, { timeout: 15_000 }).catch(() => {});
    const toGo = Number(((await t.page.locator("#gs-preview .gv-tile", { hasText: "To go" }).innerText().catch(() => "")).match(/[\d,]+/)?.[0] ?? "NaN").replace(/,/g, ""));
    toGo > 0 && toGo < 950 ? pass(`stream panel: rehearsing VKO → IST keeps the aircraft on its route (${toGo} nm to go)`) : fail(`stream panel: rehearse VKO → IST, ${toGo} nm to go`);
    await shot(t.page, "rehearse-vko-ist");
    await t.ctx.close();

    for (const [w, h, theme] of [
      [1280, 900, "dark"],
      [390, 844, "light"],
      [390, 844, "dark"],
    ]) {
      const o = await start({ width: w, height: h, theme });
      await o.page.goto(`${base}/board?tab=gate&f=${FR}&in=30`, { waitUntil: "networkidle" });
      await o.page.waitForSelector(".st-timeline .st-look");
      await checkPage(`stream panel ${w} ${theme}`, o.page, o.errors);
      await shot(o.page, `stream-panel-${w}-${theme}`);
      await o.ctx.close();
    }
  });

  /* ---------- 1.9 D: an arrived flight goes to the Logbook in one click ---------- */
  await section("log arrival", async () => {
    // the recorded KCLT → KJFK replayed to the gate; SimBrief answered here with its ends, type and registration
    const OFP = {
      fetch: { status: "Success" },
      general: { icao_airline: "", flight_number: "", initial_altitude: "39000", gc_distance: "471" },
      atc: { callsign: "HBIOO" },
      origin: { icao_code: "KCLT", pos_lat: "35.214", pos_long: "-80.943", name: "CHARLOTTE/DOUGLAS INTL" },
      destination: { icao_code: "KJFK", pos_lat: "40.640", pos_long: "-73.779", name: "JOHN F KENNEDY INTL" },
      times: { sched_out: "2026-11-10T18:15:00Z", est_out: "2026-11-10T18:15:00Z", sched_block: "01:50:00", taxi_out: "00:15:00" },
      aircraft: { icaocode: "A321", name: "A321-211", reg: "HB-IOO" },
      params: { time_generated: "2026-11-10T17:30:00Z" },
    };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(SEED);
    await ctx.addInitScript(() => {
      window.__cls = 0;
      window.__shifts = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) (window.__cls += e.value), window.__shifts.push({ v: +e.value.toFixed(3), src: (e.sources ?? []).map((x) => x.node?.className?.baseVal ?? x.node?.className ?? x.node?.nodeName) });
      }).observe({ type: "layout-shift", buffered: true });
    });
    await ctx.route(/simbrief\.com\/api\/xml\.fetcher\.php/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(OFP) }));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/board?tab=gate&sb=example-pilot&feed=replay&rec=/recordings/kclt-kjfk.jsonl&at=80`, { waitUntil: "networkidle" });
    await page.waitForSelector(".la", { timeout: 20_000 }).catch(() => {});
    const shown = (await page.locator(".la").innerText().catch(() => "")).replace(/\s+/g, " ");
    /KCLT → KJFK/.test(shown) && /ON 19:56Z/.test(shown) && /IN 19:58Z/.test(shown) && /-489 fpm/.test(shown) && !/OUT/.test(shown) && /joined the flight part-way/.test(shown)
      ? pass(`log arrival: at the gate the screen offers the stamped times (${shown.slice(0, 90)})`)
      : fail(`log arrival: panel "${shown}"`);
    await checkPage("log arrival 1280", page, errors);
    for (const theme of ["light", "dark"]) {
      const p2 = await ctx.newPage();
      await p2.emulateMedia({ colorScheme: theme });
      await p2.setViewportSize({ width: 390, height: 844 });
      await p2.goto(page.url(), { waitUntil: "networkidle" });
      await p2.waitForSelector(".la", { timeout: 20_000 }).catch(() => {});
      await checkPage(`log arrival 390 ${theme}`, p2, []);
      await p2.close();
    }
    await page.getByRole("button", { name: "Write to my Logbook" }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ofp-planner:logbook") ?? "[]"));
    const e = saved.find((x) => x.from === "KCLT" && x.to === "KJFK");
    e && e.on === "19:56" && e.in === "19:58" && e.out == null && e.off == null && e.landingFpm === -489 && e.reg === "HB-IOO" && e.type === "A321" && e.callsign === "HBIOO" && e.source === "recording" && e.date === "2026-11-10"
      ? pass("log arrival: one click writes ON, IN, the landing rate and the flight's details to the Logbook")
      : fail(`log arrival: saved ${JSON.stringify(e ?? saved)}`);
    const again = await page.locator(".la .btn-primary").textContent();
    await page.getByRole("button", { name: "Written to your Logbook" }).click();
    const n = await page.evaluate(() => JSON.parse(localStorage.getItem("ofp-planner:logbook") ?? "[]").filter((x) => x.from === "KCLT").length);
    again === "Written to your Logbook" && n === 1 ? pass("log arrival: writing it again replaces the same entry") : fail(`log arrival: again ${again} n ${n}`);
    await page.getByRole("link", { name: "Open the Logbook" }).click();
    await page.waitForURL(/\/logbook/);
    await page.waitForSelector("text=KJFK", { timeout: 15_000 }).catch(() => {});
    (await page.locator("text=KJFK").count()) > 0 ? pass("log arrival: the flight is in the Logbook") : fail("log arrival: not shown in the Logbook");
    errors.length ? fail(`log arrival: errors ${errors.join(" ")}`) : pass("log arrival: 0 page errors");
    // a rehearsal is not a flight: nothing offered while the preview plays the recording
    await page.goto(`${base}/board?tab=gate&sb=example-pilot`, { waitUntil: "networkidle" });
    await page.waitForSelector(".rs-b");
    await page.locator(".rs-b", { hasText: "Arrived" }).click();
    await page.getByRole("button", { name: "▶ Play in 60 s" }).click();
    await page.waitForTimeout(4000);
    (await page.locator(".la").count()) === 0 ? pass("log arrival: a rehearsal offers nothing for the Logbook") : fail("log arrival: offered during a rehearsal");
    await ctx.close();
  });

  /* ---------- 1.8.1: the track never mixes typical OUT/OFF with a scheduled ON/IN ---------- */
  await section("track estimates", async () => {
    // FR5237 EBBR-GMMX: scheduled, tracked OUT and OFF on every day it flies, never tracked arriving
    // (reported on a Tuesday as 39 min airborne; the brief shows its typical Wednesday, same gap)
    const o = await open(`/brief?f=${encodeURIComponent("RYR:RYR5237:EBBR-GMMX:2367")}`);
    await o.page.waitForSelector(".bp-trk .rh-line");
    const tr = await o.page.evaluate(() => {
      const tick = (sel, i = 0) => {
        const z = document.querySelectorAll(sel)[i]?.querySelector(".rh-z");
        return { t: z?.querySelector(".mono")?.textContent ?? "", est: !!z?.querySelector(".est-badge") };
      };
      const top = ".bp-trk .rh-ticks.top > span";
      return { off: tick(top, 0), on: tick(top, 1), out: tick(".bp-trk .rh-ticks > .l"), in: tick(".bp-trk .rh-ticks > .r") };
    });
    const min = (s) => (/(\d\d):?(\d\d)Z/.test(s) ? +RegExp.$1 * 60 + +RegExp.$2 : NaN);
    const air = (min(tr.on.t) - min(tr.off.t) + 1440) % 1440;
    tr.out.t === "21:42Z" && tr.off.t === "21:55Z" && !tr.out.est && !tr.off.est ? pass("track estimates: OUT and OFF are the typical tracked times") : fail(`track estimates: ${JSON.stringify(tr)}`);
    tr.on.est && tr.in.est ? pass("track estimates: ON and IN carry EST.") : fail(`track estimates: ON/IN not marked EST. ${JSON.stringify(tr)}`);
    air > 120 && air < 240 ? pass(`track estimates: airborne ${air} min, not 39`) : fail(`track estimates: airborne ${air} min ${JSON.stringify(tr)}`);
    (min(tr.in.t) - min(tr.on.t) + 1440) % 1440 === 6 ? pass("track estimates: IN is ON plus taxi-in") : fail(`track estimates: ON→IN ${JSON.stringify(tr)}`);
    await o.ctx.close();
  });

  await section("boarding pass behaviour", async () => {
    const FR658 = encodeURIComponent("RYR:RYR658:EBBR-EIDW:1234567");
    const start = async (display, opts = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: opts.theme ?? "light", reducedMotion: opts.reduce ? "reduce" : "no-preference" });
      await ctx.addInitScript(SEED);
      if (display) await ctx.addInitScript((d) => localStorage.getItem("ofp-planner:display") ?? localStorage.setItem("ofp-planner:display", JSON.stringify(d)), display);
      // SimBrief opens in a new tab: answered here, so nothing leaves the machine
      await ctx.route(/simbrief\.com/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      return { ctx, page, errors };
    };

    // the band is the airline's colour with readable text on it, in both themes, also while a flight number is being added
    for (const theme of ["light", "dark"]) {
      const { ctx, page, errors } = await start(null, { theme });
      await page.goto(`${base}/?al=RYR&dep=EBBR&f=${FR658}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".drawer .bp");
      const band = await page.locator(".drawer .fcard-head").evaluate((h) => ({ bg: getComputedStyle(h).backgroundColor, fg: getComputedStyle(h.querySelector(".fcard-no")).color }));
      band.bg === "rgb(7, 53, 144)" && band.fg === "rgb(255, 255, 255)" ? pass(`pass band ${theme}: Ryanair's blue with white text`) : fail(`pass band ${theme}: ${JSON.stringify(band)}`);
      await page.goto(`${base}/?al=EZY&dep=EGKK`, { waitUntil: "networkidle" });
      await page.waitForSelector("table.flights tbody tr");
      const rows = page.locator("table.flights tbody tr");
      let found = false;
      for (let i = 0; i < Math.min(40, await rows.count()) && !found; i++) {
        await rows.nth(i).click();
        await page.waitForSelector(".drawer .fcard");
        found = (await page.locator(".drawer .fn-add", { hasText: "Add flight number" }).count()) > 0;
      }
      if (found) {
        await page.waitForTimeout(400);
        const a = await page.evaluate(CONTRAST);
        await page.locator(".drawer .fn-add").click();
        await page.locator(".drawer .fn-edit input").fill("x");
        await page.locator(".drawer .fn-edit").getByRole("button", { name: "Save" }).click();
        await page.waitForSelector(".drawer .fn-err");
        const b = await page.evaluate(CONTRAST);
        a.length + b.length === 0 ? pass(`pass band ${theme}: adding a flight number on the band (button, form, error) is AA`) : fail(`pass band ${theme}: contrast ${JSON.stringify([...a, ...b].slice(0, 4))}`);
      } else fail(`pass band ${theme}: no callsign-only easyJet flight found to test the add-number button`);
      errors.length ? fail(`pass band ${theme}: console errors ${JSON.stringify(errors.slice(0, 2))}`) : null;
      await ctx.close();
    }

    // flip: the times table is the back of the pass; the button and F turn it over, only one face is reachable
    {
      const { ctx, page, errors } = await start(null);
      await page.goto(`${base}/?al=RYR&dep=EBBR&f=${FR658}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".drawer .bp");
      const faces = () =>
        page.evaluate(() => {
          const q = (s) => document.querySelector(`.drawer ${s}`);
          return { back: q(".bp").classList.contains("is-back"), frontInert: q(".bp-face-front").inert, backInert: q(".bp-face-back").inert, oooiVisible: getComputedStyle(q(".bp-face-back")).visibility === "visible", h: Math.round(q(".bp").getBoundingClientRect().height), under: !!q(".fcard-rest .oooi:not(.week-tbl)") };
        });
      const f0 = await faces();
      await page.locator(".drawer .bp-flip").click();
      await page.waitForTimeout(700);
      const f1 = await faces();
      const pressed = await page.locator(".drawer .bp-flip").getAttribute("aria-pressed");
      const typical = (await page.locator(".drawer .bp-face-back .oooi tbody tr").nth(1).innerText()).replace(/\s+/g, " ");
      !f0.back && f0.backInert && !f0.frontInert && !f0.oooiVisible && f1.back && f1.frontInert && !f1.backInert && f1.oooiVisible && pressed === "true" && f0.h === f1.h && !f0.under && /Typical/i.test(typical)
        ? pass(`pass flip: Times turns the pass over (same height ${f1.h}px, the other face inert), the table is on the back`)
        : fail(`pass flip: ${JSON.stringify({ f0, f1, pressed, typical: typical.slice(0, 40) })}`);
      await checkPage("pass turned over 1280 light", page, errors);
      await shot(page, "pass-back-day");
      await page.locator(".drawer .bp-flip").focus();
      await page.keyboard.press("f");
      await page.waitForTimeout(600);
      const f2 = await faces();
      await page.locator(".drawer .dispatch-type select").focus();
      await page.keyboard.press("f");
      await page.waitForTimeout(300);
      const f3 = await faces();
      !f2.back && !f3.back ? pass("pass flip: F turns it back; F in the aircraft list doesn't flip") : fail(`pass flip: F ${JSON.stringify({ f2: f2.back, f3: f3.back })}`);

      // the stub: Open in SimBrief stamps it Dispatched, and the stamp is still there after a reload
      const [popup] = await Promise.all([ctx.waitForEvent("page"), page.locator(".drawer .bp-stub a.btn-primary").click()]);
      await popup.close();
      await page.locator(".drawer .bp-stamp").waitFor({ timeout: 3000 });
      const stamp = (await page.locator(".drawer .bp-stamp").innerText()).replace(/\s+/g, " ");
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector(".drawer .bp");
      const kept = await page.locator(".drawer .bp-stamp").count();
      /^DISPATCHED \d\d:\d\dZ$/i.test(stamp) && kept === 1 ? pass(`pass stub: Open in SimBrief stamps it (“${stamp}”), kept after a reload`) : fail(`pass stub: stamp “${stamp}” kept ${kept}`);
      await checkPage("pass stamped 1280 light", page, errors);
      await ctx.close();
    }

    // "Times always open": no flip button, the table under the map as before 1.8
    {
      const { ctx, page } = await start({ passFlip: false });
      await page.goto(`${base}/?al=RYR&dep=EBBR&f=${FR658}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".drawer .bp");
      const r = await page.evaluate(() => ({ flip: document.querySelectorAll(".drawer .bp-flip, .drawer .bp-face-back").length, under: document.querySelectorAll(".drawer .fcard-rest .oooi:not(.week-tbl)").length }));
      r.flip === 0 && r.under === 1 ? pass("pass flip off: the times table stays open under the map, no flip button") : fail(`pass flip off: ${JSON.stringify(r)}`);
      await ctx.close();
    }

    // a choice saved before 1.8 carries over: boarding pass → side stub, timeline and departure board → track
    for (const [old, now] of [["pass", "side"], ["board", "track"], ["timeline", "track"]]) {
      const { ctx, page } = await start({ routeHead: old, airlineTag: "edge" });
      await page.goto(`${base}/?al=RYR&dep=EBBR&f=${FR658}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".drawer .bp");
      const cls = await page.locator(".drawer .fcard").getAttribute("class");
      await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
      const picked = await page.locator('input[name="pass"]:checked').evaluate((i) => i.closest("label").innerText.split("\n")[0]);
      const tag = await page.locator('input[name="airlineTag"]:checked').evaluate((i) => i.closest("label").innerText.split("\n")[0]);
      cls.includes(`bp-${now}`) && /edge/i.test(tag) ? pass(`pass: a saved “${old}” style opens as ${now} (${picked.trim()}), other choices kept`) : fail(`pass migration ${old}: class ${cls}, picked ${picked}, tag ${tag}`);
      await ctx.close();
    }

    // the panel unfolds out of the picked row; with reduced motion nothing animates
    for (const reduce of [false, true]) {
      const { ctx, page } = await start(null, { reduce });
      // the unfold lasts 220 ms, so note it as it starts rather than racing it
      await page.addInitScript(() => {
        const animate = Element.prototype.animate;
        window.__unfold = 0;
        Element.prototype.animate = function (frames, options) {
          if (this.classList.contains("drawer") && JSON.stringify(frames).includes("clipPath")) window.__unfold++;
          return animate.call(this, frames, options);
        };
      });
      await page.goto(`${base}/?al=RYR&dep=EBBR`, { waitUntil: "networkidle" });
      await page.waitForSelector("table.flights tbody tr");
      await page.locator("table.flights tbody tr").nth(2).click();
      await page.waitForSelector(".drawer .bp-trk .rh-line");
      const anim = await page.evaluate(() => {
        const name = (s) => getComputedStyle(document.querySelector(`.drawer ${s}`)).animationName;
        return { unfold: window.__unfold, track: name(".bp-trk .rh-line"), slide: getComputedStyle(document.querySelector(".drawer")).animationName, turn: getComputedStyle(document.querySelector(".drawer .bp-face")).transitionDuration };
      });
      (reduce ? anim.unfold === 0 && anim.track === "none" && anim.slide === "none" && parseFloat(anim.turn) < 0.01 : anim.unfold === 1 && anim.track === "bp-draw" && parseFloat(anim.turn) > 0.2)
        ? pass(reduce ? "pass motion: reduced motion → no unfold, no track draw, no slide, the pass turns at once" : "pass motion: the panel unfolds from the picked row, the track draws")
        : fail(`pass motion (reduce ${reduce}): ${JSON.stringify(anim)}`);
      await ctx.close();
    }

    // favourites and recent as small tickets (airline colour on the spine), or plain rows
    for (const tickets of [true, false]) {
      const { ctx, page, errors } = await start({ tickets });
      await page.goto(`${base}/?al=RYR&dep=EBBR&f=${FR658}`, { waitUntil: "networkidle" });
      await page.locator(".drawer .fav").click();
      await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
      await page.waitForSelector("#favourites .fl-row");
      const t = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("#favourites .fl-row")];
        const cs = getComputedStyle(rows[0]);
        const stub = getComputedStyle(rows[0].querySelector(".fl-actions"));
        return { n: rows.length, lists: document.querySelectorAll("#favourites .fl-list.tickets").length, spine: `${cs.borderLeftWidth} ${cs.borderLeftColor}`, perf: stub.borderLeftStyle };
      });
      (tickets ? t.lists === 2 && t.spine === "8px rgb(7, 53, 144)" && t.perf === "dashed" : t.lists === 0 && t.perf !== "dashed")
        ? pass(tickets ? `tickets: ${t.n} saved flights as tickets, Ryanair's blue on the spine, a perforated stub` : "tickets off: plain rows")
        : fail(`tickets ${tickets}: ${JSON.stringify(t)}`);
      if (tickets) {
        await page.locator("#favourites").scrollIntoViewIfNeeded();
        await checkPage("settings with tickets 1280 light", page, errors);
        await shot(page, "tickets-day");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const bad = await page.evaluate(CONTRAST);
        sw <= 0 && bad.length === 0 ? pass("tickets 390: no sideways scroll, text contrast AA") : fail(`tickets 390: scroll ${sw}, contrast ${JSON.stringify(bad.slice(0, 3))}`);
      }
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
    // pick the first date whose times differ (some weekdays fly the same times, so a fixed row depends on today)
    let out2 = out1;
    for (let i = 1; i < at && out2 === out1; i++) {
      await page.locator(".jr-tim-tbl tbody tr").nth(i).click();
      out2 = await page.locator(".jr-times").first().textContent();
    }
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
  const pages = ["/?al=EZY&dep=EGKK", "/?al=EZY&dep=EGKK&view=places", "/?al=&view=places&cc=GB", "/?al=&dep=EGBB&arr=LOWI", "/?al=&dep=LEMD&arr=C:ES&view=map", "/brief", "/settings", "/journeys", "/journeys?from=EGBB&to=LOWI&legs=5", "/journeys?from=EGBB&via=EHAM&to=LEMD&t=1&sort=quickest", "/board", "/board?ap=EGKK&h=12", "/range"];
  for (const theme of ["light", "dark"])
    for (const width of [1280, 390])
      for (const path of pages) {
        const { ctx, page, errors } = await open(path, { width, height: width < 500 ? 844 : 900, theme });
        if (path.startsWith("/?")) await page.waitForSelector(path.includes("places") ? ".place-list li" : path.includes("LOWI") ? ".empty-note .btn" : path.includes("map") ? ".routes-tbl tbody tr" : "table.flights tbody tr", { timeout: 20000 });
        if (path === "/brief") await page.waitForTimeout(300);
        if (path.startsWith("/journeys?")) await page.waitForSelector(".jr-detail .jr-leg", { timeout: 60000 });
        if (path.startsWith("/board?")) await page.waitForSelector(".fids-tbl tbody tr", { timeout: 30000 });
        if (path === "/range") await page.waitForSelector(".range-ring", { timeout: 20000 });
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
    await page.locator("input[name=typeTheme]").nth(1).check();
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

  /* ---------- 1.8: Settings → Display in groups, Rows | Preview ---------- */
  await section("settings display", async () => {
    const { ctx, page, errors } = await open("/settings");
    await page.waitForSelector(".dp-badges .dp-tr");
    // groups on the left with how many settings each holds
    const groups = await page.locator(".dp-nav-i").evaluateAll((b) => b.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
    groups.join("|").toLowerCase() === "Finder layout 1|Flights list 6|Flight card 4|Maps 2|Logbook 1|What’s listed 2".toLowerCase()
      ? pass(`display: groups with their counts (${groups.join(", ")})`)
      : fail(`display: groups ${JSON.stringify(groups)}`);
    // one row per setting, a segmented control of real radios, "changed · undo", Reset all
    const before = await page.locator(".dp-changed").innerText();
    await page.getByRole("radio", { name: "Tinted" }).check();
    await page.getByRole("radio", { name: "Nothing" }).check();
    const changed = await page.locator(".dp-changed").innerText();
    const undos = await page.locator(".dp-undo").count();
    const plain = await page.locator(".dp-badges .tbadge").evaluateAll((b) => b.every((x) => x.classList.contains("tb-ink")));
    const key = await page.locator(".dp-key").innerText();
    await page.getByRole("button", { name: /Aircraft badge colour changed: undo/ }).click();
    const afterUndo = await page.locator(".dp-changed").innerText();
    const makerKey = await page.locator(".dp-key").innerText();
    await page.getByRole("button", { name: "Reset all" }).click();
    const afterReset = await page.locator(".dp-changed").innerText();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ofp-planner:display")));
    before.startsWith("All") && changed === "2 changed from default" && undos === 2 && plain && /plain/.test(key) && afterUndo === "1 changed from default" && /Airbus/.test(makerKey) && afterReset.startsWith("All") && stored.airlineTag === "solid"
      ? pass("display: a segment changes the setting, “changed · undo” puts one back, Reset all the rest; “Nothing” makes plain badges and the key says so")
      : fail(`display: rows ${JSON.stringify({ before, changed, undos, plain, key, afterUndo, makerKey, afterReset, tag: stored.airlineTag })}`);
    // filled is one recipe: by airline it's a tint of the airline's colour with its edge, text in ink
    await page.getByRole("radio", { name: "Airline", exact: true }).check();
    const tint = await page.locator(".dp-badges .tbadge").first().evaluate((b) => {
      const cs = getComputedStyle(b);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, ink: cs.color === getComputedStyle(document.body).color };
    });
    tint.bg !== tint.border && tint.ink ? pass(`display: filled by airline is a tint with the airline's edge (${tint.bg} / ${tint.border})`) : fail(`display: airline fill ${JSON.stringify(tint)}`);
    await checkPage("settings display rows 1280 light", page, errors);
    await shot(page, "settings-display-rows-day");
    // the pass style is three picture cards
    const cards = await page.locator(".dp-card:has(input[name=pass])").count();
    await page.locator(".dp-card").filter({ hasText: "Ticket, city first" }).click();
    const pass3 = await page.evaluate(() => JSON.parse(localStorage.getItem("ofp-planner:display")).pass);
    cards === 3 && pass3 === "city" ? pass("display: the pass style is three picture cards") : fail(`display: pass cards ${cards} ${pass3}`);
    // Preview: one live preview beside the rows; pointing at a row outlines what it changes; the view is remembered
    await page.getByRole("radio", { name: "Preview" }).check();
    await page.locator(".dp-nav-i", { hasText: "Flight card" }).click();
    await page.waitForSelector(".dp-pv .bp-sample.bp-city");
    await page.locator(".dp-row", { hasText: "Times by day" }).hover();
    const hot = await page.locator(".dp-pv .pv-hot").getAttribute("class");
    await page.getByRole("radio", { name: "Track" }).check();
    const live = await page.locator(".dp-pv .bp-sample").getAttribute("class");
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    const kept = await page.locator("input[name=settingsView]:checked").evaluate((i) => i.closest("label").innerText);
    hot?.includes("dp-pv-week") && live?.includes("bp-track") && kept === "Preview" && (await page.locator(".dp-pv").count()) === 1
      ? pass("display: Preview redraws the pass live, outlines what the pointed-at row changes, and is remembered")
      : fail(`display: preview ${JSON.stringify({ hot, live, kept })}`);
    await page.locator(".dp-nav-i", { hasText: "Flights list" }).click();
    await page.waitForSelector(".dp-pv .dp-tr");
    await checkPage("settings display preview 1280 light", page, errors);
    await shot(page, "settings-display-preview-day");
    await ctx.close();
    // a choice saved before 1.8 (edge badges by airline) shows as Airline + Edge
    {
      const o = await open("/settings");
      await o.page.evaluate(() => localStorage.setItem("ofp-planner:display", JSON.stringify({ typeColour: "airline", typeTheme: "side", settingsView: "nonsense" })));
      await o.page.reload({ waitUntil: "networkidle" });
      const c = await o.page.locator("input[name=typeColour]:checked").evaluate((i) => i.closest("label").innerText);
      const t = await o.page.locator("input[name=typeTheme]:checked").evaluate((i) => i.closest("label").innerText);
      const v = await o.page.locator("input[name=settingsView]:checked").evaluate((i) => i.closest("label").innerText);
      c === "Airline" && t === "Edge" && v === "Rows" ? pass("display: saved badge choices carry over (Airline + Edge); an unknown view falls back to Rows") : fail(`display: carry-over ${c} ${t} ${v}`);
      await o.ctx.close();
    }
    // both views at phone width and at night
    for (const [w, theme, view] of [
      [1280, "dark", "rows"],
      [1280, "dark", "preview"],
      [390, "light", "rows"],
      [390, "dark", "preview"],
    ]) {
      const o = await open("/settings", { width: w, height: 844, theme });
      await o.page.evaluate((v) => localStorage.setItem("ofp-planner:display", JSON.stringify({ settingsView: v })), view);
      await o.page.reload({ waitUntil: "networkidle" });
      await o.page.evaluate(() => (window.__cls = 0));
      await o.page.locator("#display").scrollIntoViewIfNeeded();
      if (view === "preview") {
        await o.page.locator(".dp-nav-i", { hasText: "Flight card" }).click();
        await o.page.waitForSelector(".dp-pv .bp-sample");
      } else await o.page.waitForSelector(".dp-badges .dp-tr");
      await checkPage(`settings display ${view} ${w} ${theme}`, o.page, o.errors);
      if (w === 390) await shot(o.page, `settings-display-${view}-phone-${theme}`);
      await o.ctx.close();
    }
  });

  /* ---------- 1.8: Finder layouts (Full, Calm, Roll first, In place) and the Full tweaks ---------- */
  await section("finder layouts", async () => {
    const at = async (display, path, opts) => {
      const o = await open("/settings", opts);
      await o.page.evaluate((d) => localStorage.setItem("ofp-planner:display", JSON.stringify(d)), display);
      await o.page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      return o;
    };
    // Full (default), T4: the filters you haven't set fold behind More filters on a desktop too; a filter in use shows them
    {
      const o = await at({}, "/?al=RYR&dep=EBBR");
      await o.page.waitForSelector("table.flights tbody tr");
      const folded = await o.page.evaluate(() => ({ days: getComputedStyle(document.querySelector(".filters-grid > .days")).display, more: getComputedStyle(document.querySelector(".more-filters")).display }));
      await o.page.goto(`${base}/?al=RYR&dep=EBBR&days=1`, { waitUntil: "networkidle" });
      const shown = await o.page.evaluate(() => getComputedStyle(document.querySelector(".filters-grid > .days")).display);
      folded.days === "none" && folded.more !== "none" && shown !== "none" ? pass("full: unused filters fold behind More filters at 1280; a filter in use opens them") : fail(`full T4: ${JSON.stringify({ folded, shown })}`);
      // T3: the panel opens with the pass and the map; Times/Week/Details fold, and what was left open is remembered
      await o.page.locator("table.flights tbody tr").first().click();
      await o.page.waitForSelector(".drawer .fc-fold");
      const secs = await o.page.locator(".drawer .fc-fold > summary").allInnerTexts();
      const closed = await o.page.locator(".drawer .fc-fold[open]").count();
      const map = await o.page.locator(".drawer .fcard-rest > .route-map, .drawer .fcard-rest svg").count();
      await o.page.locator(".drawer .fc-fold > summary", { hasText: "Details" }).click();
      await o.page.locator("table.flights tbody tr").nth(1).click();
      await o.page.waitForTimeout(300);
      const kept = await o.page.locator('.drawer .fc-fold[data-sec="details"][open] .facts').count();
      secs.map((x) => x.toLowerCase()).includes("details") && closed === 0 && map > 0 && kept === 1
        ? pass(`full: the panel opens with pass and map, ${secs.join(", ")} folded; Details stays open for the next flight`)
        : fail(`full T3: ${JSON.stringify({ secs, closed, map, kept })}`);
      await checkPage("finder full 1280 light", o.page, o.errors);
      await o.ctx.close();
    }
    // T1 and T2: a dot for times that vary (explained once in the heading); what the filter pins shown short
    {
      const o = await at({ variesMark: "dot", pinShort: true }, "/?al=RYR&dep=EBBR");
      await o.page.waitForSelector("table.flights tbody tr");
      const t = await o.page.evaluate(() => ({
        dots: document.querySelectorAll("table.flights tbody .var-dot").length,
        head: document.querySelectorAll("table.flights thead .th-dot").length,
        tags: document.querySelectorAll("table.flights tbody .var-tag").length,
        sq: document.querySelectorAll("table.flights tbody .al-sq").length,
        names: document.querySelectorAll("table.flights tbody .al-tag, table.flights tbody .split-pill").length,
        fromCity: document.querySelector("table.flights tbody tr td:nth-child(2) small.city"),
        toCity: !!document.querySelector("table.flights tbody tr td:nth-child(3) small.city"),
      }));
      t.dots > 0 && t.head >= 1 && t.tags === 0 && t.sq > 0 && !t.fromCity && t.toCity
        ? pass(`full: VAR as a dot (${t.dots}, heading explains it); one airline as its colour square, the pinned origin as its code`)
        : fail(`full T1/T2: ${JSON.stringify(t)}`);
      await checkPage("finder full dot + short 1280 light", o.page, o.errors);
      await o.ctx.close();
    }
    // Calm: the sentence, short rows, the panel with tabs (the tab is remembered)
    {
      const o = await at({ finder: "calm" }, "/?al=RYR&dep=EBBR");
      await o.page.waitForSelector("table.flights tbody tr");
      const heads = await o.page.locator("table.flights thead th").allInnerTexts();
      const sentence = await o.page.locator(".sf").innerText();
      const day = await o.page.getByLabel("Day", { exact: true }).count();
      await o.page.locator("table.flights tbody tr").first().click();
      await o.page.waitForSelector(".drawer .fc-tabs");
      const tabs = await o.page.locator(".drawer .fc-tab").allInnerTexts();
      await o.page.getByRole("tab", { name: "Details" }).click();
      const facts = await o.page.locator(".drawer .fc-tabpanel .facts").count();
      await o.page.locator("table.flights tbody tr").nth(1).click();
      await o.page.waitForTimeout(300);
      const still = await o.page.locator(".drawer .fc-tab[aria-selected=true]").innerText();
      const h = heads.map((x) => x.trim().toLowerCase());
      !h.includes("from") && !h.includes("dist") && !h.includes("freq") && /flights from/.test(sentence) && day === 1 && tabs.length >= 2 && facts === 1 && /details/i.test(still)
        ? pass(`calm: “${sentence.replace(/\s+/g, " ").trim()}”; short rows (${h.join(", ")}); panel tabs ${tabs.join(" | ")}, the last tab kept`)
        : fail(`calm: ${JSON.stringify({ h, sentence, day, tabs, facts, still })}`);
      await checkPage("finder calm 1280 light", o.page, o.errors);
      await o.ctx.close();
    }
    // Roll first: opens on the question with a rolled flight; Roll again changes it; a row from the list lands in the hero
    {
      const o = await at({ finder: "roll" }, "/?al=RYR&dep=EBBR");
      await o.page.waitForSelector(".roll-hero .rh-card .fcard");
      const q = await o.page.locator("#rh-q").innerText();
      const first = await o.page.locator(".rh-card .fcard-no").innerText();
      let again = first;
      for (let i = 0; i < 5 && again === first; i++) {
        await o.page.getByRole("button", { name: "Roll again" }).click();
        again = await o.page.locator(".rh-card .fcard-no").innerText();
      }
      const row = o.page.locator("table.flights tbody tr").nth(3);
      const ident = (await row.locator(".row-btn").innerText()).replace(/\s+/g, "");
      await row.click();
      await o.page.waitForTimeout(300);
      const inHero = (await o.page.locator(".rh-card .fcard-no").innerText()).replace(/\s+/g, "");
      const drawers = await o.page.locator(".drawer").count();
      /where are you flying from/i.test(q) && again !== first && inHero.includes(ident.replace(/^[A-Z]{2,3}(?=\d)/, "")) && drawers === 0
        ? pass(`roll first: opens on “${q}” with ${first.replace(/\s+/g, " ")} rolled; Roll again → ${again.replace(/\s+/g, " ")}; ${ident} from the list lands in the hero`)
        : fail(`roll: ${JSON.stringify({ q, first, again, ident, inHero, drawers })}`);
      await checkPage("finder roll 1280 light", o.page, o.errors);
      await o.ctx.close();
    }
    // In place: the row opens under itself (pass and map), no floating panel; picking it again closes it
    {
      const o = await at({ finder: "place" }, "/?al=RYR&dep=EBBR");
      await o.page.waitForSelector("table.flights tbody tr");
      await o.page.locator("table.flights tbody tr").nth(2).click();
      await o.page.waitForSelector("tr.row-open .fcard");
      const r = await o.page.evaluate(() => {
        const open = document.querySelector("tr.row-open");
        return { prev: open.previousElementSibling.classList.contains("sel"), drawer: document.querySelectorAll(".drawer").length, map: !!open.querySelector(".fc-tabpanel svg, .fc-tabpanel canvas") };
      });
      await checkPage("finder in place 1280 light", o.page, o.errors);
      await o.page.locator("table.flights tbody tr.sel .row-btn").click();
      const closed = await o.page.locator("tr.row-open").count();
      r.prev && r.drawer === 0 && r.map && closed === 0 ? pass("in place: the picked row opens under itself with the pass and the map, no panel; picking it again closes it") : fail(`place: ${JSON.stringify({ ...r, closed })}`);
      await o.ctx.close();
    }
    // every layout at 1280 and 390, day and night, with a flight open
    for (const layout of ["full", "calm", "roll", "place"])
      for (const [w, theme] of [
        [1280, "dark"],
        [390, "light"],
        [390, "dark"],
      ]) {
        const o = await at({ finder: layout }, "/?al=RYR&dep=EBBR", { width: w, height: 844, theme });
        await o.page.waitForSelector(layout === "roll" ? ".rh-card .fcard" : "table.flights tbody tr");
        await o.page.evaluate(() => (window.__cls = 0));
        if (layout !== "roll") {
          await o.page.locator("table.flights tbody tr .row-btn").nth(1).click();
          await o.page.waitForSelector(layout === "place" ? "tr.row-open .fcard" : ".drawer .fcard");
        }
        await o.page.waitForTimeout(500);
        await checkPage(`finder ${layout} ${w} ${theme}`, o.page, o.errors);
        if (w === 390) await shot(o.page, `finder-${layout}-phone-${theme}`);
        else await shot(o.page, `finder-${layout}-${theme}`);
        await o.ctx.close();
      }
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
    // the brief: the next Monday shows Monday's times and highlights Monday in the week table
    // (a date in the past is ignored by design, so this can't be a fixed date)
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
    await page.goto(`${base}/brief?f=${FR}&d=${monday.toISOString().slice(0, 10)}`, { waitUntil: "networkidle" });
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
      // the day tabs go with the times table, which is the back of the pass: turn it over
      if (week === "tabs") await o.page.locator(".bp-flip").click();
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
    // the optional groups are folded on an empty form; open one to fill it
    const folded = await f.locator("details.log-opt:not([open])").count();
    folded === 2 ? pass("logbook: an empty form folds Times and Landing and more (date, route, save)") : fail(`logbook: ${folded} groups folded`);
    await f.locator("summary", { hasText: "Landing and more" }).click();
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

  /* ---------- 1.5.2: one flight in two favourite groups (a leg two saved journeys share) ---------- */
  await section("shared favourites", async () => {
    const { ctx, page, errors } = await open("/journeys?from=EGBB&via=EHAM&to=LEMD&t=1&sort=quickest");
    await page.waitForFunction(() => document.querySelector(".jr-card") && !document.querySelector(".jr-split.is-stale"), null, { timeout: 60000 });
    // the same journey saved twice: both groups keep both legs
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "Save as a favourites group" }).click();
      await page.waitForFunction((n) => document.querySelector(".jr-acts [role=status]")?.textContent.includes(n ? "via 1 stop 2" : "via 1 stop"), i);
    }
    const said = await page.locator(".jr-acts [role=status]").textContent();
    /Shared/.test(said) && /also in “EGBB → LEMD via 1 stop”/.test(said) ? pass("shared favourites: saving a journey says which legs are already in another group") : fail(`shared favourites: status "${said}"`);
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-fav]");
    const g1 = '[data-fav-group="EGBB → LEMD via 1 stop"]';
    const g2 = '[data-fav-group="EGBB → LEMD via 1 stop 2"]';
    const rows = async (g) => page.locator(`${g} .fl-row`).count();
    const [a, b] = [await rows(g1), await rows(g2)];
    const head = await page.locator(`${g1} .grp-shared`).textContent();
    a === 2 && b === 2 && /2 shared/.test(head) ? pass("shared favourites: both groups keep both legs and say 2 shared") : fail(`shared favourites: rows ${a}/${b} head "${head}"`);
    await page.locator(`${g1} .fl-row`).first().hover();
    const lit = await page.locator(`${g2} .fl-row.is-twin`).count();
    lit === 1 ? pass("shared favourites: hovering a shared leg lights its row in the other group") : fail(`shared favourites: ${lit} twins lit`);
    const id = await page.locator(`${g1} .fl-row`).first().getAttribute("data-fav");
    await page.locator(`${g1} .fl-row`).first().getByRole("button", { name: /stays in/ }).click();
    const after = [await rows(g1), await rows(g2), await page.locator(`${g2} [data-fav="${id}"]`).count()];
    after.join() === "1,2,1" ? pass("shared favourites: removing a shared leg from one group keeps it in the other") : fail(`shared favourites: after remove ${after}`);
    await checkPage("settings shared favourites 1280 light", page, errors);
    // the flight card: ticks for each group, and a note when it's in more than one
    await page.goto(`${base}/brief?f=${encodeURIComponent(id)}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".fav-group-chip");
    const on1 = await page.locator(".fav-group-chip.on").count();
    await page.locator(".fav-group-chip:not(.on)", { hasText: /via 1 stop$/ }).click();
    const on2 = await page.locator(".fav-group-chip.on").count();
    const note = await page.locator(".fav-group .badge").textContent();
    on1 === 1 && on2 === 2 && /shared by 2/.test(note) ? pass("shared favourites: the flight card adds a starred flight to another group as well") : fail(`shared favourites: card ${on1}→${on2} "${note}"`);
    await ctx.close();
    const m = await open("/settings", { width: 390, height: 844, theme: "dark" });
    await m.page.evaluate((fid) => {
      const f = { id: fid, al: "EZY", op: "EZY", fn: null, cs: "EZY1", o: "EGBB", d: "EHAM", std: null, at: 0 };
      localStorage.setItem("ofp-planner:favourites", JSON.stringify([{ ...f, group: "A" }, { ...f, group: "B" }]));
      localStorage.setItem("ofp-planner:fav-groups", JSON.stringify(["A", "B"]));
    }, id);
    await m.page.reload({ waitUntil: "networkidle" });
    await m.page.waitForSelector(".fl-shared");
    await checkPage("settings shared favourites 390 dark", m.page, m.errors);
    await m.ctx.close();
  });

  /* ---------- clicking a route line focuses its flights in the list beside the map ---------- */
  await section("map line clicks", async () => {
    // points along a line to try, middle first (5% steps)
    const SPOTS = Array.from({ length: 19 }, (_, i) => 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.05);
    // click a visible point of a route line (the topmost element there must be that line)
    const clickLine = async (page, sel) => {
      const pt = await page.evaluate(([sel, SPOTS]) => {
        const g = document.querySelector(sel);
        if (!g) return null;
        g.closest(".map").scrollIntoView({ block: "center" });
        const hit = g.querySelector(".map-route-hit");
        const L = hit.getTotalLength();
        const m = hit.getScreenCTM();
        for (const t of SPOTS) {
          const p = hit.getPointAtLength(L * t);
          const x = m.a * p.x + m.c * p.y + m.e;
          const y = m.b * p.x + m.d * p.y + m.f;
          if (document.elementFromPoint(x, y)?.closest(".map-route") === g) return { x, y };
        }
        return null;
      }, [sel, SPOTS]);
      if (!pt) return false;
      await page.mouse.move(pt.x, pt.y);
      await page.waitForTimeout(120);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(250);
      return true;
    };
    // the first of these route keys with a stretch of line not covered by another (fan maps overlap near the hub)
    const freeLine = (page, scope, keys) =>
      page.evaluate(
        ([scope, keys, SPOTS]) =>
          keys.find((k) => {
            const g = document.querySelector(`${scope} .map-route[data-route="${k}"]`);
            if (!g) return false;
            const hit = g.querySelector(".map-route-hit");
            if (!hit.getAttribute("d")) return false; // out of view
            const L = hit.getTotalLength();
            const m = hit.getScreenCTM();
            return SPOTS.some((t) => {
              const p = hit.getPointAtLength(L * t);
              return document.elementFromPoint(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f)?.closest(".map-route") === g;
            });
          }) ?? null,
        [scope, keys, SPOTS],
      );
    const inView = (page, sel) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        let box = el.parentElement;
        while (box && getComputedStyle(box).overflowY === "visible") box = box.parentElement;
        const b = box && box !== document.body && box !== document.documentElement ? box.getBoundingClientRect() : { top: 0, bottom: innerHeight };
        return r.top >= Math.max(0, b.top) - 1 && r.bottom <= Math.min(innerHeight, b.bottom) + 1;
      }, sel);

    // logbook: two flights on one route (all marked, then each in turn, then all again), one on another (open, then let go)
    const { ctx, page, errors } = await open("/logbook");
    await page.evaluate(() => {
      const many = Array.from({ length: 14 }, (_, i) => ({ id: `f${i}`, date: `2026-09-${String(10 + i).padStart(2, "0")}`, from: "EGKK", to: "LFPG", callsign: `EZY${i}` }));
      localStorage.setItem(
        "ofp-planner:logbook",
        JSON.stringify([
          { id: "a", date: "2026-10-03", from: "EGBB", to: "LEMD", callsign: "EZY22N" },
          { id: "b", date: "2026-10-05", from: "LOWI", to: "EGBB", callsign: "EZY34MH" },
          ...many,
          { id: "c", date: "2026-09-01", from: "EGBB", to: "LEMD", callsign: "EZY23N" },
        ]),
      );
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('.log-map .map-route[data-route="EGBB-LEMD"]', { timeout: 20000 });
    const LINE = '.log-map .map-route[data-route="EGBB-LEMD"]';
    const state = () =>
      page.evaluate(() => ({
        mark: [...document.querySelectorAll(".log-tbl tbody tr.mark")].map((r) => r.dataset.log).join(),
        sel: [...document.querySelectorAll(".log-tbl tbody tr.sel")].map((r) => r.dataset.log).join(),
        on: document.querySelector('.log-map .map-route[data-route="EGBB-LEMD"]')?.classList.contains("on"),
      }));
    const steps = [];
    let lowVisible = false;
    for (let i = 0; i < 4; i++) {
      (await clickLine(page, LINE)) || steps.push("missed");
      steps.push(await state());
      // the third click opens the older flight, below the fold of the list's box: it scrolls into view
      if (i === 2) for (let w = 0; w < 15 && !lowVisible; w++) (lowVisible = await inView(page, '.log-tbl tbody tr[data-log="c"]')) || (await page.waitForTimeout(100));
    }
    const want = [
      { mark: "a,c", sel: "", on: true },
      { mark: "", sel: "a", on: true },
      { mark: "", sel: "c", on: true },
      { mark: "a,c", sel: "", on: true },
    ];
    JSON.stringify(steps) === JSON.stringify(want)
      ? pass("map lines: logbook route with 2 flights marks both, then opens each in turn, then marks both again; its line stays lit")
      : fail(`map lines: logbook steps ${JSON.stringify(steps)}`);
    lowVisible ? pass("map lines: the logbook list scrolls to the flight found (the oldest, below the fold of its box)") : fail("map lines: logbook row c not scrolled into view");
    await clickLine(page, '.log-map .map-route[data-route="LOWI-EGBB"]');
    const one = await state();
    await clickLine(page, '.log-map .map-route[data-route="LOWI-EGBB"]');
    const none = await state();
    one.sel === "b" && one.mark === "" && none.sel === "" && none.mark === ""
      ? pass("map lines: a route with one logbook flight opens it, and a second click lets go")
      : fail(`map lines: one-flight route ${JSON.stringify([one, none])}`);
    await checkPage("logbook map line 1280 light", page, errors);

    // favourites: a group's map marks the flights on the clicked route
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      const f = (id, o, d) => ({ id, al: "EZY", op: "EZY", fn: null, cs: id, o, d, std: null, at: 0, group: "Trip" });
      localStorage.setItem("ofp-planner:favourites", JSON.stringify([f("EZY1", "EGBB", "EHAM"), f("EZY2", "EHAM", "LEMD"), f("EZY3", "EGBB", "EHAM")]));
      localStorage.setItem("ofp-planner:fav-groups", JSON.stringify(["Trip"]));
    });
    await page.reload({ waitUntil: "networkidle" });
    const G = '[data-fav-group="Trip"]';
    await page.locator(`${G} .grp-head`).getByRole("button", { name: "Map" }).click();
    await page.waitForSelector(`${G} .map-route[data-route="EGBB-EHAM"]`, { timeout: 20000 });
    const favMarks = () => page.$$eval(`${G} .fl-row.is-mark`, (rs) => rs.map((r) => r.dataset.fav).join());
    await clickLine(page, `${G} .map-route[data-route="EGBB-EHAM"]`);
    const f1 = await favMarks();
    await clickLine(page, `${G} .map-route[data-route="EGBB-EHAM"]`);
    const f2 = await favMarks();
    await clickLine(page, `${G} .map-route[data-route="EHAM-LEMD"]`);
    const f3 = await favMarks();
    f1 === "EZY1,EZY3" && f2 === "EZY1" && f3 === "EZY2"
      ? pass("map lines: a favourites group's map marks both flights on a route, then the first, then another route's")
      : fail(`map lines: favourites ${JSON.stringify([f1, f2, f3])}`);
    await checkPage("favourites map line 1280 light", page, errors);
    await ctx.close();

    // board: an airport with several flights: all of them, then the first. A fan of lines covers itself near the
    // hub (the line on top is the one hovered and clicked), so look for a line with room to click: a quieter airport
    // first, zoomed in if need be.
    const b = await open("/board");
    let other = null;
    for (const ap of ["LPMA", "EGKK"]) {
      await b.page.goto(`${base}/board?ap=${ap}&h=24`, { waitUntil: "networkidle" });
      await b.page.waitForSelector(".bd-map .map-route", { timeout: 30000 });
      await b.page.locator(".bd-map").scrollIntoViewIfNeeded();
      const counts = await b.page.evaluate(() => {
        const n = new Map();
        for (const r of document.querySelectorAll(".fids-tbl tbody tr[data-other]")) n.set(r.dataset.other, (n.get(r.dataset.other) ?? 0) + 1);
        return [...n].filter(([, c]) => c >= 2).sort((x, y) => y[1] - x[1]);
      });
      for (let zoom = 0; zoom < 3 && !other; zoom++) {
        if (zoom) {
          await b.page.locator(".bd-map .map-zbtn[aria-label='Zoom in']").click();
          await b.page.waitForTimeout(400);
        }
        const free = await freeLine(b.page, ".bd-map", counts.map(([k]) => k));
        other = counts.find(([k]) => k === free) ?? null;
      }
      if (other) break;
    }
    if (!other) fail("map lines: no board line with two or more flights has room to click (LPMA, EGKK)");
    else {
      const [k, n] = other;
      await clickLine(b.page, `.bd-map .map-route[data-route="${k}"]`);
      const all = await b.page.locator(`.fids-tbl tbody tr.is-mark[data-other="${k}"]`).count();
      const lit = await b.page.locator(`.bd-map .map-route[data-route="${k}"].on`).count();
      await clickLine(b.page, `.bd-map .map-route[data-route="${k}"]`);
      const first = await b.page.$$eval(".fids-tbl tbody tr.is-mark", (rs) => rs.map((r) => r.dataset.mv));
      const firstOf = await b.page.$eval(`.fids-tbl tbody tr[data-other="${k}"]`, (r) => r.dataset.mv);
      all === Math.min(n, 40) && lit === 1 && first.length === 1 && first[0] === firstOf
        ? pass(`map lines: board marks all ${all} flights to ${k}, then the first of them`)
        : fail(`map lines: board ${k} all ${all}/${n} lit ${lit} then ${first}`);
      await checkPage("board map line 1280 light", b.page, b.errors);
    }
    await b.ctx.close();

    // journeys: a leg's line marks that leg
    const j = await open("/journeys?from=EGBB&via=EHAM&to=LEMD&t=1&sort=quickest");
    await j.page.waitForFunction(() => document.querySelector(".jr-detail .map-route[data-route='1']") && !document.querySelector(".jr-split.is-stale"), null, { timeout: 60000 });
    await clickLine(j.page, ".jr-detail .map-route[data-route='1']");
    const leg = await j.page.$$eval(".jr-legs-list > li.is-mark", (ls) => ls.map((l) => l.dataset.leg).join());
    await clickLine(j.page, ".jr-detail .map-route[data-route='1']");
    const legOff = await j.page.locator(".jr-legs-list > li.is-mark").count();
    leg === "1" && legOff === 0 ? pass("map lines: a journey leg's line marks that leg, and a second click lets go") : fail(`map lines: journeys leg ${leg} then ${legOff}`);
    await j.ctx.close();

    // finder: a destination's line opens its flights, a route's line narrows to that route
    const fd = await open("/?al=&dep=EGKK&view=places");
    await fd.page.waitForSelector(".places .map-route", { timeout: 30000 });
    await fd.page.locator(".places .map").scrollIntoViewIfNeeded();
    const dest = await freeLine(fd.page, ".places", await fd.page.$$eval(".places .map-route", (gs) => gs.map((g) => g.dataset.route)));
    await clickLine(fd.page, `.places .map-route[data-route="${dest}"]`);
    const du = new URL(fd.page.url()).searchParams;
    du.get("arr") === dest && !du.get("view") ? pass(`map lines: a destination's line opens its flights (EGKK → ${dest})`) : fail(`map lines: destination click gave ${du}`);
    await fd.page.goto(`${base}/?al=&dep=LEMD&arr=C:ES&view=map`, { waitUntil: "networkidle" });
    await fd.page.waitForSelector(".routes-view .map-route", { timeout: 30000 });
    const rk = await fd.page.$eval(".routes-view .map-route", (g) => g.dataset.route);
    await clickLine(fd.page, `.routes-view .map-route[data-route="${rk}"]`);
    const ru = new URL(fd.page.url()).searchParams;
    `${ru.get("dep")}-${ru.get("arr")}` === rk && !ru.get("view") ? pass(`map lines: a route's line on the Map tab opens its flights (${rk})`) : fail(`map lines: route click ${rk} gave ${ru}`);
    await fd.ctx.close();
  });

  /* ---------- range rings: origin, payload, your airports ---------- */
  await section("range", async () => {
    const { ctx, page, errors } = await open("/range");
    await page.waitForSelector(".range-ring", { timeout: 20000 });
    const rings = await page.locator(".range-ring").count();
    const mine = await page.locator("#range-mine .range-tbl tbody tr").count();
    rings === 6 && mine === 5 ? pass("range: six base rings and the five seeded airports (LEPA LEMD LSGG ENBR TNCM)") : fail(`range: rings ${rings} airports ${mine}`);
    // terrain is off by default (plain land and sea), and on draws bands across the whole globe
    const bandsOff = await page.locator(".range-map .map-height, .range-map .map-depth").count();
    await page.getByRole("radio", { name: "On", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".range-map .map-height").length >= 8, null, { timeout: 15000 }).catch(() => {});
    const bandsOn = await page.locator(".range-map .map-height").count();
    const contourOn = ((await page.locator(".range-map .map-height .map-contour").first().getAttribute("d")) ?? "").length;
    bandsOff === 0 && bandsOn >= 8 && contourOn > 0
      ? pass(`range: terrain off by default; on draws the site's bands with contour lines (${bandsOn} height layers)`)
      : fail(`range: terrain off ${bandsOff} on ${bandsOn} contour ${contourOn}`);
    // zoom out to the chart's disc (6,000 NM round the origin, not the whole globe): its rim comes into view, centred
    const zout = page.locator(".range-map .map-zbtn[aria-label='Zoom out']");
    for (let i = 0; i < 10 && !(await zout.isDisabled()); i++) await zout.click();
    await page.waitForTimeout(400);
    const rim = await page.evaluate(() => {
      const fig = document.querySelector(".range-map").getBoundingClientRect();
      const hub = document.querySelector(".range-home").getBoundingClientRect();
      return { space: (document.querySelector(".range-map .map-space")?.getAttribute("d") ?? "").split("M").length, dx: hub.x + hub.width / 2 - (fig.x + fig.width / 2) };
    });
    (await zout.isDisabled()) && rim.space > 2 && Math.abs(rim.dx) < 40
      ? pass(`range: zooms out to its 6,000 NM disc, the origin in the middle (${rim.dx.toFixed(0)} px off centre)`)
      : fail(`range: globe zoom ${JSON.stringify(rim)}`);
    await page.locator(".range-map .map-zreset").click();
    await page.getByRole("radio", { name: "Off", exact: true }).click();
    // the model: Fenix A320 CFM at full payload is MTOW-limited to 12.7 t and about 1,840 NM
    await page.getByRole("radio", { name: "Full" }).click();
    const a320 = (await page.locator(".range-fam", { hasText: "Fenix A320" }).locator(".range-row").first().innerText()).replace(/\s+/g, " ");
    /1,840 NM/.test(a320) && /61\.0 \+ 12\.7 t/.test(a320) ? pass(`range: full payload limits the A320 by MTOW (${a320})`) : fail(`range: A320 full ${a320}`);
    // your own ZFW + FOB: each aircraft checks them against its own limits
    await page.getByRole("radio", { name: "Custom" }).click();
    await page.locator("#range-zfw").fill("60");
    await page.locator("#range-fob").fill("15");
    const why319 = await page.locator(".range-fam", { hasText: "Fenix A319" }).locator(".range-row.blocked").count();
    const why320 = await page.locator(".range-fam", { hasText: "Fenix A320" }).locator(".range-why").first().innerText();
    const ok321 = (await page.locator(".range-fam", { hasText: "Fenix A321" }).locator(".range-row").first().innerText()).replace(/\s+/g, " ");
    const customRings = await page.locator(".range-ring").count();
    why319 === 4 && /MTOW/.test(why320) && /60\.0 \+ 15\.0 t/.test(ok321) && customRings === 4
      ? pass(`range: custom 60 t + 15 t greys out the A319 (MZFW) and A320 (MTOW), flies the A321 (${ok321})`)
      : fail(`range: custom 319 ${why319} / 320 ${why320} / 321 ${ok321} / rings ${customRings}`);
    const build = (await page.locator(".range-loads").innerText()).replace(/\s+/g, " ");
    /Full 58\.5 17\.2 75\.5 \d+\.\d The MTOW/.test(build) ? pass("range: the weight panel lists ZFW, FOB, TOW and LW for each payload") : fail(`range: build ${build.slice(0, 160)}`);
    await page.locator(".range-build-pick select").selectOption("fnx-a321-cfm");
    const a321 = (await page.locator(".range-loads").innerText()).replace(/\s+/g, " ");
    /Full 74\.8 18\.6 93\.2 77\.8 Full tanks · payload cut for the MLW/.test(a321)
      ? pass("range: the A321's full payload is cut to 74.8 t so it lands within its 77.8 t MLW")
      : fail(`range: A321 MLW ${a321.slice(0, 200)}`);
    await page.locator("#range-zfw").fill("75");
    await page.locator("#range-fob").fill("18");
    const mlwWhy = await page.locator(".range-fam", { hasText: "Fenix A321" }).locator(".range-row").first().innerText();
    /MLW/.test(mlwWhy) ? pass("range: custom 75 t + 18 t greys out the A321: it would land over its MLW") : fail(`range: custom MLW ${mlwWhy.replace(/\s+/g, " ")}`);
    await page.getByRole("radio", { name: "Full" }).click();
    // origin from the picker
    const origin = page.getByRole("combobox", { name: "Origin" });
    await origin.click();
    await origin.fill("LEMD");
    await page.keyboard.press("Enter");
    const meta = await page.locator("#range-map .sheet-meta").innerText();
    const home = await page.locator(".range-home text").textContent();
    /LEMD/.test(meta) && home === "LEMD" ? pass("range: the origin picker re-centres the map") : fail(`range: origin ${meta} / ${home}`);
    // an airport by position, then hover it for which aircraft reach it
    await page.locator("#range-own-icao").fill("ZZZZ");
    await page.locator("#range-own-lat").fill("28.0");
    await page.locator("#range-own-lon").fill("-15.4");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const added = await page.locator("#range-mine .range-tbl tbody tr", { hasText: "ZZZZ" }).innerText();
    /NM/.test(added) && /6\/6/.test(added) ? pass(`range: an airport added by position is measured and in reach (${added.replace(/\s+/g, " ").slice(0, 40)})`) : fail(`range: added ${added}`);
    await page.locator(".range-map").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.locator('.range-pt[aria-label^="ZZZZ"] .map-hit').hover();
    await page.waitForTimeout(250);
    const tip = await page.locator("#ofp-tip").innerText();
    /from LEMD/.test(tip) && (tip.match(/\bIN\b/g) ?? []).length === 6 ? pass("range: a dot's tooltip lists each aircraft shown as in reach") : fail(`range: tip ${tip.replace(/\s+/g, " ")}`);
    // nothing in the tooltip runs out of its box (long names like "A321 IAE · sharklets · 2 ACT" wrap)
    await page.locator(".range-quick button", { hasText: "All" }).click();
    await page.locator('.range-pt[aria-label^="ZZZZ"] .map-hit').hover();
    await page.waitForTimeout(250);
    const spill = await page.evaluate(() => {
      const tip = document.getElementById("ofp-tip").getBoundingClientRect();
      return [...document.querySelectorAll("#ofp-tip .tip-row > span")].filter((el) => el.getBoundingClientRect().right > tip.right + 0.5 || el.scrollWidth > el.clientWidth + 1).length;
    });
    const rowsAll = await page.locator("#ofp-tip .tip-row").count();
    spill === 0 && rowsAll === 22 ? pass(`range: all ${rowsAll} tooltip rows fit inside the tooltip`) : fail(`range: ${spill} of ${rowsAll} tooltip rows spill out`);
    await page.locator(".range-quick button", { hasText: "Base models" }).click();
    // clicking a dot makes it the origin; everything survives a reload
    await page.locator('.range-pt[aria-label^="ZZZZ"] .map-hit').click();
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".range-ring");
    const after = await page.locator("#range-map .sheet-meta").innerText();
    /ZZZZ · full payload/.test(after) ? pass("range: clicking a dot makes it the origin, kept with the payload after a reload") : fail(`range: after reload ${after}`);
    await shot(page, "range");
    errors.length ? fail(`range: console errors ${JSON.stringify(errors.slice(0, 2))}`) : pass("range: 0 console errors");
    await ctx.close();
  });

  /* ---------- Extra+ airlines listed only when Settings → Display asks for them ---------- */
  await section("extra airlines", async () => {
    const { ctx, page, errors } = await open("/?al=");
    const extras = await page.evaluate(async () => (await fetch("/data/manifest.json").then((r) => r.json())).airlines.filter((a) => a.extra).map((a) => [a.icao, a.name]));
    if (!extras.length) {
      pass("extra airlines: skipped, no Extra+ airlines in this snapshot");
      await ctx.close();
      return;
    }
    const [icao, name] = extras[0];
    const listed = async () => {
      await page.waitForSelector("table.flights tbody tr", { timeout: 30000 });
      await page.locator(".filters .multi-btn").first().click();
      await page.waitForSelector(".multi-pop li");
      const r = await page.evaluate(() => [...document.querySelectorAll(".multi-pop li")].map((l) => [l.querySelector(".multi-label")?.firstChild?.textContent, !!l.querySelector(".multi-tag")]));
      await page.keyboard.press("Escape");
      return r;
    };
    const off = await listed();
    !off.some(([n]) => n === name) ? pass(`extra airlines: hidden from the Finder picker by default (${name})`) : fail(`extra airlines: ${name} listed by default`);
    await page.evaluate(() => localStorage.setItem("ofp-planner:display", JSON.stringify({ airlines: "extra" })));
    await page.reload({ waitUntil: "networkidle" });
    const on = await listed();
    on.some(([n, tag]) => n === name && tag) ? pass(`extra airlines: Common + Extra+ lists ${name} with its tag`) : fail(`extra airlines: ${name} not listed with Extra+ on`);
    // a link naming an Extra+ airline still loads it with the default setting
    await page.evaluate(() => localStorage.removeItem("ofp-planner:display"));
    await page.goto(`${base}/?al=${icao}`, { waitUntil: "networkidle" });
    await page.waitForSelector("table.flights tbody tr", { timeout: 30000 });
    const rows = await page.locator("table.flights tbody tr").count();
    rows > 0 ? pass(`extra airlines: ?al=${icao} still shows its ${rows} flights with Extra+ hidden`) : fail(`extra airlines: ?al=${icao} shows nothing`);
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await page.waitForSelector("#dp-listed .dp-s .mono");
    await checkPage("settings extra airlines 1280 light", page, errors);
    await ctx.close();
  });

  /* ---------- airports guessed from the climb-out (Pristina has no low coverage) ---------- */
  await section("guessed airports", async () => {
    const { ctx, page, errors } = await open("/?al=EWG&dep=BKPR&arr=EDDF");
    const rows = async () => {
      await page.waitForFunction(() => document.querySelector("table.flights tbody tr, .empty-note, .empty"), null, { timeout: 30000 });
      await page.waitForTimeout(300);
      return page.$$eval("table.flights tbody tr", (trs) => trs.map((tr) => tr.textContent));
    };
    const hidden = (await rows()).filter((t) => /EWG18UG|18UG/.test(t)).length;
    await page.evaluate(() => localStorage.setItem("ofp-planner:display", JSON.stringify({ guessed: true })));
    await page.reload({ waitUntil: "networkidle" });
    const shown = await rows();
    const marks = await page.locator("table.flights tbody tr .guess-mark").count();
    hidden === 0 && shown.length >= 1 && marks >= 1
      ? pass(`guessed airports: EW6612 Pristina → Frankfurt (origin guessed) hidden by default, listed with the mark when on (${shown.length} row, ${marks} mark)`)
      : fail(`guessed airports: hidden ${hidden}, shown ${shown.length}, marks ${marks}`);
    await page.locator("table.flights tbody tr").first().click();
    await page.waitForSelector(".fcard .guess-mark:visible");
    const cardMarks = await page.locator(".fcard .guess-mark:visible").count();
    // the panel scrolls into place first, and any scroll closes tooltips
    await page.waitForTimeout(1200);
    await page.mouse.move(5, 5);
    await page.locator(".fcard .guess-mark:visible").first().hover();
    await page.waitForTimeout(250);
    const tip = await page.locator("#ofp-tip").innerText();
    cardMarks === 1 && /Origin guessed/.test(tip) && /Prishtina|Pristina/.test(tip)
      ? pass("guessed airports: the flight card marks the guessed origin and explains it on hover")
      : fail(`guessed airports: ${cardMarks} card marks, tip "${tip.replace(/\s+/g, " ")}"`);
    await checkPage("finder guessed airport 1280 light", page, errors);
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await page.waitForSelector(".guess-sample");
    await checkPage("settings guessed airports 1280 light", page, errors);
    await ctx.close();
  });

  /* ---------- 1.7.2: saving that fails, malformed stored data, load errors, coverage on phones ---------- */
  await section("review fixes", async () => {
    const flight = (o) => ({ date: "2026-10-03", from: "EGBB", to: "LEMD", callsign: "EZY22N", ...o });
    const logFile = (flights) => ({ name: "log.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schema: "ofp-planner/logbook", version: 1, flights })) });
    // storage refused: an import says so and nothing pretends to be saved
    const { ctx, page, errors } = await open("/logbook");
    await page.waitForSelector(".log-form");
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      window.__realSet = real;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith("ofp-planner:logbook")) throw new DOMException("full", "QuotaExceededError");
        return real.call(this, k, v);
      };
    });
    await page.locator(".log-io input[type=file]").setInputFiles(logFile([flight({})]));
    const refused = await page.locator(".log-io [role=status]").innerText();
    const stored = await page.evaluate(() => localStorage.getItem("ofp-planner:logbook"));
    /Couldn’t import/.test(refused) && /Nothing was imported/.test(refused) && stored == null
      ? pass("review: a logbook import the browser refuses to store says so (nothing saved, keep the file)")
      : fail(`review: refused import "${refused}" stored ${stored}`);
    await page.evaluate(() => (Storage.prototype.setItem = window.__realSet));
    // impossible dates and out-of-range numbers are skipped with a reason
    await page.locator(".log-io input[type=file]").setInputFiles(logFile([flight({}), flight({ date: "2026-99-99", callsign: "EZY1" }), flight({ blockMin: -50, callsign: "EZY2" }), flight({ pax: -7, callsign: "EZY3" })]));
    const strict = await page.locator(".log-io [role=status]").innerText();
    /1 new/.test(strict) && /Skipped 3/.test(strict) && /real YYYY-MM-DD/.test(strict) && /blockMin must be 0–1440/.test(strict)
      ? pass("review: import skips an impossible date and negative block time / pax, naming why")
      : fail(`review: strict import "${strict}"`);
    // malformed stored values: a list that isn't a list reads as empty, bad entries are dropped, the page still works
    await page.evaluate(() => localStorage.setItem("ofp-planner:logbook", "{}"));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".log-form");
    await page.evaluate(() => localStorage.setItem("ofp-planner:logbook", JSON.stringify([{ id: "a" }, 7, { id: "b", date: "2026-10-04", from: "EGBB", to: "LOWI" }])));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".log-tbl tbody tr");
    const kept = await page.locator(".log-tbl tbody tr:not(.log-detail):not(.log-month)").count();
    kept === 1 && !errors.length ? pass("review: a malformed stored logbook doesn't break the page (bad entries dropped, 1 kept)") : fail(`review: malformed logbook rows ${kept} errors ${JSON.stringify(errors)}`);
    await checkPage("logbook after malformed data 1280 light", page, errors);
    // a backup with values the app can't read is refused before anything is replaced
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    const before = await page.evaluate(() => localStorage.getItem("ofp-planner:logbook"));
    for (const [k, v, why] of [
      ["ofp-planner:logbook", "{}", /logbook should be a list/],
      ["ofp-planner:airframes", "null", /airframes is empty/],
      ["ofp-planner:favourites", JSON.stringify([{ id: "x" }]), /favourites has a malformed entry \(#1\)/],
    ]) {
      const bad = { schema: "ofp-planner/backup", version: 1, createdAt: "2026-11-09T00:00:00Z", entries: { [k]: v } };
      await page.locator(".backup input[type=file]").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
      // the same element shows each refusal in turn: wait for this one's text
      await page.locator(".backup .form-err", { hasText: why }).waitFor({ timeout: 5000 }).catch(() => undefined);
      const t = await page.locator(".backup .form-err").innerText();
      const after = await page.evaluate(() => localStorage.getItem("ofp-planner:logbook"));
      why.test(t) && /Nothing was restored/.test(t) && after === before ? pass(`review: backup with a bad ${k.slice(12)} is refused, nothing replaced`) : fail(`review: bad backup ${k} "${t}"`);
    }
    await ctx.close();
    // Journeys: each failed file shows an error with Retry, and Retry recovers with the form kept
    for (const [label, url, rx] of [
      ["manifest", "/journeys?from=EGBB&to=LOWI", /\/data\/manifest\.json/],
      ["route index", "/journeys?from=EGBB&to=LOWI", /\/data\/routes\.json/],
      ["airline file", "/journeys?from=EGBB&to=LOWI&t=1", /\/data\/airlines\/EZY\.json/],
    ]) {
      const j = await open("/settings");
      await j.page.route(rx, (r) => r.fulfill({ status: 503, body: "down" }));
      await j.page.goto(base + url, { waitUntil: "networkidle" });
      const err = j.page.getByText(/Couldn’t load the schedule snapshot/);
      await err.waitFor({ timeout: 15000 }).catch(() => undefined);
      const shown = await err.isVisible();
      await j.page.unroute(rx);
      await j.page.getByRole("button", { name: "Retry" }).click().catch(() => undefined);
      await j.page.waitForLoadState("networkidle");
      await j.page.getByText(/Route network|Timed connections/).first().waitFor({ timeout: 30000 }).catch(() => undefined);
      const back = await j.page.getByText(/Route network|Timed connections/).first().isVisible().catch(() => false);
      const kept = new URL(j.page.url()).searchParams.get("from") === "EGBB";
      shown && back && kept ? pass(`review: Journeys shows a failed ${label} with Retry, and recovers with the plan kept`) : fail(`review: Journeys ${label} error ${shown} recovered ${back} kept ${kept}`);
      await j.ctx.close();
    }
    // the Finder names the days the schedules cover, on a phone too
    const man = JSON.parse(readFileSync(join(OUT, "data", "manifest.json"), "utf8"));
    const ph = await open("/?al=EZY", { width: 390, height: 844 });
    await ph.page.waitForSelector(".st-cover");
    const cover = (await ph.page.locator(".st-cover").innerText()).replace(/\s+/g, " ");
    const times = await ph.page.locator(".st-cover > time").evaluateAll((t) => t.map((x) => x.getAttribute("dateTime")));
    times[0] === man.coverage.from && times[1] === man.coverage.to && (await ph.page.locator(".st-cover > time").first().isVisible()) && !/built/.test(cover)
      ? pass(`review: phone Finder shows the schedule coverage, not the build date ("${cover.trim()}")`)
      : fail(`review: phone coverage "${cover}" ${times}`);
    await checkPage("finder coverage 390 light", ph.page, ph.errors);
    await ph.ctx.close();
  });

  /* ---------- 1.7.3: findings from the review of the live site ---------- */
  await section("live review", async () => {
    // gate screen: one step line from the first marker to the last, the done part over it up to the clock
    const b = await open("/board?ap=EGKK");
    await b.page.locator(".fids-tbl tbody tr").first().waitFor({ timeout: 30000 });
    const head = (await b.page.locator(".fids-head").innerText()).replace(/\s+/g, " ");
    /LGW · EGKK/.test(head) && /\d\d:\d\d ?UTC(\+\d+)?/.test(head) ? pass(`live: the board names the airport's codes and its clock's zone ("${head}")`) : fail(`live: board header "${head}"`);
    await b.page.locator(".fids-tbl tbody tr").first().click();
    await b.page.waitForURL(/tab=gate/);
    const gu = new URL(b.page.url());
    await b.ctx.close();
    const gateQ = `f=${encodeURIComponent(gu.searchParams.get("f"))}&d=${gu.searchParams.get("d")}`;
    const LINE = () => {
      const ol = document.querySelector(".gs-steps");
      const r = ol.getBoundingClientRect();
      const px = (pseudo) => {
        const cs = getComputedStyle(ol, pseudo);
        return { l: r.left + parseFloat(cs.left), w: parseFloat(cs.width), y: r.top + parseFloat(cs.top) + parseFloat(cs.height) / 2 };
      };
      const marks = [...ol.querySelectorAll("i")].map((i) => {
        const m = i.getBoundingClientRect();
        return { x: m.left + m.width / 2, y: m.top + m.height / 2, z: Number(getComputedStyle(i).zIndex) };
      });
      return { track: px("::before"), done: px("::after"), marks, now: [...ol.children].findIndex((li) => li.classList.contains("is-now")), lastDone: [...ol.children].findLastIndex((li) => li.classList.contains("is-done")) };
    };
    for (const [w, h, extra] of [
      [1920, 1080, "&screen=1"],
      [390, 844, ""],
    ]) {
      const g = await open(`/board?tab=gate&${gateQ}&in=90${extra}`, { width: w, height: h });
      const bad = [];
      for (const [name, q] of [
        ["before the gate opens", "in=90"],
        ["boarding", "in=35"],
        ["between boarding and final call", "in=31"],
        ["final call", "in=20"],
        ["ready", "in=4"],
        ["pushback", "in=0"],
        ["pinned boarding", "in=90&pin=boarding"],
        ["cancelled", "in=30&cx=1"],
      ]) {
        await g.page.goto(`${base}/board?tab=gate&${gateQ}&${q}${extra}`, { waitUntil: "networkidle" });
        await g.page.locator(".gs-steps").waitFor();
        await g.page.waitForTimeout(1200); // the done part eases over 1 s
        const l = await g.page.evaluate(LINE);
        const first = l.marks[0].x;
        const end = l.marks.at(-1).x;
        const doneEnd = l.done.l + l.done.w;
        const ok =
          Math.abs(l.track.l - first) < 1 &&
          Math.abs(l.track.l + l.track.w - end) < 1 &&
          l.marks.every((m) => Math.abs(m.y - l.track.y) < 1 && m.z > 0) &&
          Math.abs(l.done.l - l.track.l) < 0.5 &&
          (l.now >= 0 ? doneEnd >= l.marks[l.now].x - 0.5 && doneEnd <= l.marks[l.now + 1]?.x + 0.5 : l.lastDone < 0 ? l.done.w < 0.5 : Math.abs(doneEnd - end) < 1);
        if (!ok) bad.push(`${name}: ${JSON.stringify({ track: l.track, done: l.done, first, end, now: l.now })}`);
      }
      !bad.length ? pass(`live: gate screen ${w}px, one step line from gate open to take-off, the done part ends between the right markers (8 states)`) : fail(`live: gate line ${w}px ${bad.join(" | ")}`);
      // every time on the screen says its zone
      const zones = (await g.page.locator(".gs-times small, .gs-clock small").allInnerTexts()).join(" | ");
      (zones.match(/UTC/g) ?? []).length >= 2 ? pass(`live: gate screen ${w}px labels its times' zones ("${zones.replace(/\s+/g, " ")}")`) : fail(`live: gate zones "${zones}"`);
      await g.ctx.close();
    }

    // failures say they're failures: Board, Brief, weather
    const fid = gu.searchParams.get("f");
    const down = (r) => r.fulfill({ status: 503, body: "down" });
    {
      const o = await open("/settings");
      const rx = /\/data\/routes\.json/;
      await o.page.route(rx, down);
      await o.page.goto(`${base}/board?ap=EGKK`, { waitUntil: "networkidle" });
      await o.page.getByText(/Couldn’t load the schedule snapshot/).waitFor({ timeout: 15000 }).catch(() => undefined);
      const st = await o.page.locator(".statusline").innerText();
      const panel = await o.page.locator(".board-body").innerText();
      await o.page.unroute(rx);
      await o.page.getByRole("button", { name: "Retry" }).first().click();
      await o.page.waitForLoadState("networkidle");
      await o.page.locator(".fids-tbl tbody tr").first().waitFor({ timeout: 30000 }).catch(() => undefined);
      const rows = await o.page.locator(".fids-tbl tbody tr").count();
      /Couldn’t load/.test(st) && !/\b0 flights/.test(st) && /isn’t empty/.test(panel) && rows > 0
        ? pass(`live: Board with a failed route index says so with Retry (no "0 flights"), Retry brings ${rows} rows`)
        : fail(`live: Board routes failure "${st}" | "${panel.slice(0, 160)}" rows ${rows}`);
      await o.ctx.close();
    }
    {
      const o = await open("/settings");
      const rx = /\/data\/manifest\.json/;
      await o.page.route(rx, down);
      await o.page.goto(`${base}/brief?f=${encodeURIComponent(fid)}`, { waitUntil: "networkidle" });
      await o.page.locator(".brief-kicker").waitFor({ timeout: 15000 });
      const kicker = await o.page.locator(".brief-kicker").innerText();
      const st = await o.page.locator(".statusline").innerText();
      await o.page.unroute(rx);
      await o.page.getByRole("button", { name: "Retry" }).first().click();
      await o.page.locator(".fcard").first().waitFor({ timeout: 20000 }).catch(() => undefined);
      const back = await o.page.locator(".fcard").count();
      await o.page.goto(`${base}/brief?f=EZY:EZYNOPE1:EGKK-LEMD:1`, { waitUntil: "networkidle" });
      await o.page.locator(".brief-kicker").waitFor({ timeout: 15000 });
      const miss = await o.page.locator(".brief-kicker").innerText();
      /couldn’t load the flight/i.test(kicker) && !/isn’t in the current snapshot/i.test(kicker) && /Couldn’t load/.test(st) && back > 0 && /isn’t in the current snapshot/i.test(miss)
        ? pass("live: Brief tells a failed download (Retry, in place) from a flight that isn't in the snapshot")
        : fail(`live: Brief failure kicker "${kicker}" status "${st}" back ${back} miss "${miss}"`);
      await o.ctx.close();
    }
    {
      const o = await open("/settings");
      await o.page.route(/open-meteo\.com|vatsim\.net/, down);
      await o.page.goto(`${base}/brief?f=${encodeURIComponent(fid)}`, { waitUntil: "networkidle" });
      await o.page.locator(".wx-err-inline").nth(1).waitFor({ timeout: 20000 }).catch(() => undefined);
      await o.page.waitForFunction(() => !/fetching/.test(document.querySelector(".wx-age")?.textContent ?? "fetching"), null, { timeout: 15000 }).catch(() => undefined);
      const adv = await o.page.locator(".wb-advice").innerText();
      const age = await o.page.locator(".wx-age").innerText();
      !/No significant weather/.test(adv) && /unknown/.test(adv) && /unavailable/.test(age)
        ? pass(`live: weather that didn't load is unknown, not "no significant weather" ("${adv}", "${age.trim()}")`)
        : fail(`live: weather failure advice "${adv}" age "${age}"`);
      await o.ctx.close();
    }

    // forms: a broken %-escape in the airframe id is an inline error on that field, not an exception
    {
      const o = await open("/settings");
      await o.page.getByLabel("Name", { exact: true }).fill("REVIEW");
      await o.page.getByLabel("ICAO type").fill("A320");
      await o.page.getByLabel("SimBrief airframe id or Plan link").fill("%");
      await o.page.getByRole("button", { name: "Add airframe" }).click();
      await o.page.waitForTimeout(200);
      const msg = await o.page.locator(".af-form .form-err").innerText().catch(() => "");
      const focus = await o.page.evaluate(() => [document.activeElement?.getAttribute("name"), document.activeElement?.getAttribute("aria-invalid")]);
      await o.page.getByLabel("SimBrief airframe id or Plan link").fill("https://dispatch.simbrief.com/options/custom?type=654321_1700000000001");
      await o.page.getByRole("button", { name: "Add airframe" }).click();
      const saved = await o.page.evaluate(() => localStorage.getItem("ofp-planner:airframes") ?? "");
      /isn’t a SimBrief airframe id/.test(msg) && focus[0] === "sb" && focus[1] === "true" && saved.includes("654321_1700000000001") && !o.errors.length
        ? pass("live: an airframe id with a broken %-escape is an inline error on that field (focused); a good one then saves")
        : fail(`live: airframe % "${msg}" focus ${focus} saved ${saved.includes("654321")} errors ${JSON.stringify(o.errors)}`);
      await o.ctx.close();
    }
    // logbook: a cancelled flight stays in the list but adds no flying, distance or airports
    {
      const o = await open("/logbook");
      await o.page.waitForSelector(".log-form");
      // an empty submit points at the first missing field, once
      await o.page.getByRole("button", { name: "Add to logbook" }).click();
      await o.page.waitForTimeout(150);
      const focus = await o.page.evaluate(() => [document.activeElement?.getAttribute("name"), document.activeElement?.getAttribute("aria-invalid")]);
      const errs = await o.page.locator(".log-form .form-err").allInnerTexts();
      const hint = await o.page.locator(".log-preview").innerText();
      focus[0] === "from" && focus[1] === "true" && errs.length === 1 && /left from/.test(errs[0]) && !/left from/.test(hint)
        ? pass(`live: an empty logbook form focuses and marks From, with one error ("${errs[0]}")`)
        : fail(`live: logbook submit focus ${focus} errors ${JSON.stringify(errs)} hint "${hint}"`);
      const file = { schema: "ofp-planner/logbook", version: 1, flights: [{ date: "2026-10-03", from: "EGKK", to: "LEMD", callsign: "EZY8001", status: "cancelled" }] };
      await o.page.locator(".log-io input[type=file]").setInputFiles({ name: "log.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
      await o.page.waitForSelector(".log-totals");
      const tot = Object.fromEntries(await o.page.locator(".log-totals > div").evaluateAll((ds) => ds.map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent])));
      const rows = await o.page.locator(".log-tbl tbody tr:not(.log-detail):not(.log-month)").count();
      tot.Flights === "0 + 1 cancelled" && tot.Distance === "0 NM" && tot.Airports === "0" && rows === 1
        ? pass(`live: a cancelled-only logbook flew nothing (${tot.Flights}, ${tot.Distance}, ${tot.Airports} airports) and keeps its row`)
        : fail(`live: cancelled totals ${JSON.stringify(tot)} rows ${rows}`);
      await o.ctx.close();
    }
    // picker: text left without picking says so under the field
    {
      const o = await open("/?al=EZY");
      await o.page.getByLabel("From", { exact: true }).fill("zzqx");
      await o.page.keyboard.press("Tab");
      await o.page.waitForTimeout(400);
      const note = await o.page.locator(".combo-note").first().innerText().catch(() => "");
      const dep = new URL(o.page.url()).searchParams.get("dep");
      /“zzqx” matches no airport or country: nothing selected/.test(note) && !dep
        ? pass(`live: an unmatched airport left by Tab is named under the field ("${note}")`)
        : fail(`live: picker note "${note}" dep ${dep}`);
      await o.ctx.close();
    }

    // keyboard: the flight panel takes the focus when it opens and gives it back; on a phone the list behind it is out of reach
    for (const [w, h] of [
      [1280, 900],
      [390, 844],
    ]) {
      const o = await open("/?al=EZY&dep=EGKK", { width: w, height: h });
      const row = o.page.locator("table.flights tbody .row-btn").first();
      await row.waitFor({ timeout: 20000 });
      await row.focus();
      await o.page.keyboard.press("Enter");
      await o.page.waitForSelector(".drawer");
      await o.page.waitForTimeout(150);
      const inPanel = await o.page.evaluate(() => !!document.querySelector(".drawer")?.contains(document.activeElement));
      const tabs = [];
      for (let i = 0; i < 12; i++) {
        await o.page.keyboard.press("Tab");
        tabs.push(await o.page.evaluate(() => (document.querySelector(".drawer")?.contains(document.activeElement) ? "panel" : document.activeElement?.closest(".topbar") ? "topbar" : document.activeElement?.closest(".finder") ? "list" : "other")));
      }
      const geo = await o.page.evaluate(() => ({ top: document.querySelector(".drawer").getBoundingClientRect().top, bar: document.querySelector(".topbar").getBoundingClientRect().bottom }));
      await o.page.keyboard.press("Escape");
      await o.page.waitForTimeout(150);
      const back = await o.page.evaluate(() => document.activeElement?.classList.contains("row-btn"));
      const listReached = tabs.includes("list");
      inPanel && back && (w > 640 || !listReached) && geo.top >= geo.bar - 0.5
        ? pass(`live: ${w}px flight panel takes the focus on Enter and gives it back on Escape${w <= 640 ? ", the list behind it is out of reach" : ""}, its top under the top bar (${Math.round(geo.top)} ≥ ${Math.round(geo.bar)})`)
        : fail(`live: ${w}px panel focus in ${inPanel} back ${back} tabs ${tabs.join(",")} top ${JSON.stringify(geo)}`);
      await o.ctx.close();
    }
    // Journeys: the card and the detail it opens show the same timing (sorted by duty, and by date)
    for (const sort of ["quickest", "next"]) {
      const o = await open(`/journeys?from=EGBB&via=EHAM&to=LEMD&t=1&sort=${sort}`);
      await o.page.locator(".jr-card").first().waitFor({ timeout: 60000 });
      await o.page.locator(".jr-detail").waitFor({ timeout: 30000 });
      const card = await o.page.locator('.jr-card[aria-pressed="true"]').innerText();
      const detail = await o.page.locator(".jr-detail").innerText();
      const dc = card.match(/duty (\d+h \d+m)/)?.[1];
      const dd = detail.match(/duty (\d+h \d+m)/)?.[1];
      const day = card.match(/next (\w{3} \d+ \w{3})/)?.[1];
      dc && dc === dd && day && detail.includes(day)
        ? pass(`live: Journeys sorted by ${sort === "next" ? "date" : "duty"}: the card and its detail show the same timing (${day}, duty ${dc})`)
        : fail(`live: Journeys ${sort} card duty ${dc} day ${day} vs detail duty ${dd}`);
      await o.ctx.close();
    }
    // phones: the Board's button rows keep their words whole; status lines say the short thing in full
    {
      const o = await open("/board?ap=EGKK", { width: 390, height: 844 });
      await o.page.locator(".bd-form .seg-btn").first().waitFor();
      const clipped = await o.page.locator(".bd-form .seg-btn").evaluateAll((bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getClientRects().length > 1 || b.offsetHeight > 40).map((b) => b.textContent));
      const cut = [];
      for (const path of ["/board?ap=EGKK", "/settings", "/range", "/logbook", "/journeys?from=EGBB&to=LOWI&t=1"]) {
        await o.page.goto(base + path, { waitUntil: "networkidle" });
        await o.page.waitForTimeout(path.includes("t=1") ? 4000 : 800);
        const c = await o.page.evaluate(() => {
          const s = document.querySelector(".statusline-inner > *");
          return s && s.scrollWidth > s.clientWidth + 1 ? s.textContent : null;
        });
        if (c) cut.push(`${path}: ${c}`);
      }
      const jr = await o.page.locator(".statusline").innerText();
      !clipped.length && !cut.length && /\d+ \w+ – \d+ \w+/.test(jr)
        ? pass(`live: 390px Board buttons whole; Board, Settings, Range, Logbook and timed Journeys status lines fit (Journeys: "${jr.trim()}")`)
        : fail(`live: 390px clipped ${JSON.stringify(clipped)} cut ${JSON.stringify(cut)} journeys "${jr}"`);
      await o.ctx.close();
    }
    // a reversed list cut at 240 says it's the 240 kept, the other way round
    {
      const o = await open("/journeys?from=EGKK&legs=u3&sort=distance&dir=desc");
      await o.page.locator(".jr-card").first().waitFor({ timeout: 60000 });
      const count = await o.page.locator(".jr-count").innerText();
      /240\+ journeys/.test(count) && /the 240 shortest found, longest first/.test(count)
        ? pass(`live: a reversed Journeys list cut at 240 says what it is ("${count.trim()}")`)
        : fail(`live: reversed capped list "${count}"`);
      await o.ctx.close();
    }
    // a small file that unzips past 20 MB is refused while it's read, before anything is replaced
    {
      const o = await open("/settings");
      const before = await o.page.evaluate(() => localStorage.getItem("ofp-planner:airframes"));
      const bomb = gzipSync(Buffer.from(`{"schema":"ofp-planner/backup","version":1,"entries":{"x":"${" ".repeat(25 * 1024 * 1024)}"}}`));
      await o.page.locator(".backup input[type=file]").setInputFiles({ name: "big.json.gz", mimeType: "application/gzip", buffer: bomb });
      await o.page.locator(".backup .form-err").waitFor({ timeout: 15000 }).catch(() => undefined);
      const t = await o.page.locator(".backup .form-err").innerText().catch(() => "");
      const after = await o.page.evaluate(() => localStorage.getItem("ofp-planner:airframes"));
      /more than 20 MB/.test(t) && after === before
        ? pass(`live: a ${Math.round(bomb.length / 1024)} KB backup that unzips past 20 MB is refused while reading, nothing replaced`)
        : fail(`live: zip bomb "${t}"`);
      await o.ctx.close();
    }
    // radio groups: one tab stop each, the arrow keys move the choice (Board, Journeys)
    {
      const o = await open("/board?ap=EGKK");
      const dep = o.page.getByRole("radio", { name: "Departures", exact: true });
      await dep.focus();
      await o.page.keyboard.press("ArrowRight");
      await o.page.waitForTimeout(150);
      const board = await o.page.evaluate(() => [document.activeElement?.textContent, new URL(location.href).searchParams.get("side")]);
      await o.page.goto(`${base}/journeys?from=EGBB&to=LOWI`, { waitUntil: "networkidle" });
      const fewest = o.page.getByRole("radio", { name: "Fewest", exact: true });
      await fewest.focus();
      await o.page.keyboard.press("ArrowRight");
      await o.page.waitForTimeout(150);
      const jr = await o.page.evaluate(() => [document.activeElement?.textContent, document.activeElement?.getAttribute("aria-checked")]);
      const stops = await o.page.locator('[role="radiogroup"]').evaluateAll((gs) => gs.map((g) => g.querySelectorAll('[role="radio"]:not([tabindex="-1"])').length));
      board[0] === "Arrivals" && board[1] === "arr" && jr[0] === "Exactly" && jr[1] === "true" && stops.every((n) => n === 1)
        ? pass(`live: radio groups take the arrow keys (Board Departures → Arrivals, Journeys Fewest → Exactly), one tab stop each (${stops.length} groups)`)
        : fail(`live: radio keys board ${board} journeys ${jr} stops ${stops}`);
      await o.ctx.close();
    }
    // structure on every page: one h1 and one main, nothing focusable under aria-hidden, no image with buttons in it,
    // and a box that scrolls can take the focus; and at 320 px nothing runs off the page
    const A11Y = () => {
      const FOC = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']), summary";
      const live = (e) => !e.closest("[inert]") && e.getClientRects().length > 0 && !e.closest("details:not([open]) > :not(summary)");
      const hidden = [...document.querySelectorAll("[aria-hidden='true']")].flatMap((h) => [...h.querySelectorAll(FOC)].filter(live).map((e) => e.tagName));
      const img = [...document.querySelectorAll("[role='img']")].filter((i) => [...i.querySelectorAll(FOC)].some(live)).length;
      const scroll = [...document.querySelectorAll("body *")].filter((e) => {
        const cs = getComputedStyle(e);
        if (!/(auto|scroll)/.test(cs.overflowX + cs.overflowY) || !live(e)) return false;
        if (e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1) return false;
        return !(e.matches(FOC) || e.querySelector(FOC));
      }).map((e) => String(e.className).slice(0, 30));
      return { h1: document.querySelectorAll("h1").length, main: document.querySelectorAll("main").length, hidden, img, scroll };
    };
    const PAGES = ["/", "/?al=EZY&dep=EGKK&view=places", "/journeys?from=EGBB&to=LOWI", "/board?ap=EGKK", "/brief", "/logbook", "/range", "/settings"];
    for (const [w, theme] of [
      [1280, "light"],
      [390, "light"],
      [320, "dark"],
    ]) {
      const o = await open("/settings", { width: w, height: 844, theme });
      const bad = [];
      for (const path of PAGES) {
        await o.page.goto(base + path, { waitUntil: "networkidle" });
        await o.page.waitForTimeout(500);
        const r = await o.page.evaluate(A11Y);
        const sw = await o.page.evaluate(() => document.documentElement.scrollWidth);
        if (r.h1 !== 1 || r.main !== 1 || r.hidden.length || r.img || r.scroll.length || sw > w) bad.push(`${path} ${JSON.stringify({ ...r, sw })}`);
      }
      !bad.length
        ? pass(`live: ${w}px ${theme}, ${PAGES.length} pages: one h1 and main each, no focusable under aria-hidden or in an image, scroll boxes reachable, no sideways scroll`)
        : fail(`live: structure ${w}px ${bad.join(" | ")}`);
      await o.ctx.close();
    }
  });

  /* ---------- phones: the action before the detail (UI review) ---------- */
  await section("phone order", async () => {
    const o = await open("/?al=EZY&dep=EGKK", { width: 390, height: 844 });
    await o.page.locator("table.flights tbody tr").first().waitFor({ timeout: 20000 });
    const f = await o.page.evaluate(() => ({
      roll: document.querySelector(".btn-roll").getBoundingClientRect().bottom,
      row: document.querySelector("table.flights tbody tr").getBoundingClientRect().top,
      typeShown: !!document.querySelector(".filters-grid > .multi:nth-child(5)")?.getClientRects().length,
    }));
    await o.page.getByRole("button", { name: /More filters/ }).click();
    const opened = await o.page.locator(".filters-grid > .multi:nth-child(5)").isVisible();
    f.roll < 844 && f.row < 844 && !f.typeShown && opened
      ? pass(`phone: Finder folds the advanced filters, Random and the first result on the first screen (${Math.round(f.roll)}, ${Math.round(f.row)} px); More filters opens them`)
      : fail(`phone: Finder first screen ${JSON.stringify(f)} opened ${opened}`);
    await o.page.goto(`${base}/?al=EZY&dep=EGKK&type=A320`, { waitUntil: "networkidle" });
    await o.page.locator("table.flights tbody tr").first().waitFor({ timeout: 20000 }).catch(() => undefined);
    const linked = await o.page.locator(".filters-grid > .multi:nth-child(5)").isVisible();
    const badge = await o.page.locator(".more-filters").innerText();
    linked && /1 on/i.test(badge) ? pass(`phone: a link with an advanced filter shows it, counted ("${badge.replace(/\s+/g, " ")}")`) : fail(`phone: linked filter visible ${linked} "${badge}"`);
    // the flight panel: SimBrief right after the route, on the first screen
    await o.page.goto(`${base}/?al=EZY&dep=EGKK`, { waitUntil: "networkidle" });
    await o.page.locator("table.flights tbody .row-btn").first().click();
    await o.page.waitForSelector(".drawer .bp-stub");
    const sb = await o.page.evaluate(() => {
      const a = document.querySelector(".drawer a.btn-primary").getBoundingClientRect().bottom;
      const map = document.querySelector(".drawer .map")?.getBoundingClientRect().top ?? Infinity;
      return { a, map };
    });
    const fid = new URL(o.page.url()).searchParams.get("f");
    sb.a < 844 && sb.a < sb.map ? pass(`phone: the flight panel has Open in SimBrief on its first screen, above the map (${Math.round(sb.a)} px)`) : fail(`phone: panel dispatch ${JSON.stringify(sb)}`);
    await o.ctx.close();
    // Journeys stacked: the choices first, a pick scrolls to the journey, and there's a way back
    const j = await open("/journeys?from=EGBB&to=LOWI", { width: 390, height: 844 });
    await j.page.locator(".jr-card").nth(1).waitFor({ timeout: 60000 });
    const order = await j.page.evaluate(() => document.querySelector(".jr-list").getBoundingClientRect().top < document.querySelector(".jr-detail").getBoundingClientRect().top);
    await j.page.locator(".jr-card").nth(1).click();
    await j.page.waitForTimeout(900);
    const at = await j.page.evaluate(() => ({ top: document.querySelector(".jr-detail").getBoundingClientRect().top, focus: document.activeElement?.classList.contains("jr-detail") }));
    await j.page.getByRole("button", { name: /Back to the list/ }).click();
    await j.page.waitForTimeout(300);
    const back = await j.page.evaluate(() => document.activeElement?.getAttribute("aria-pressed") === "true");
    order && at.top < 300 && at.focus && back
      ? pass("phone: Journeys lists the choices before the picked journey; a pick scrolls to it, Back to the list returns to the card")
      : fail(`phone: Journeys order ${order} pick ${JSON.stringify(at)} back ${back}`);
    await j.ctx.close();
    // Brief: the flight, its date, the weather, then onward legs
    const b = await open(`/brief?f=${encodeURIComponent(fid)}`, { width: 390, height: 844 });
    await b.page.locator("#flight").waitFor({ timeout: 20000 });
    const ids = await b.page.locator("main > section.sheet").evaluateAll((ss) => ss.map((x) => x.id));
    const inCard = await b.page.locator("#flight .nextleg").count();
    ids.join(",") === "flight,when,weather,next" && !inCard ? pass(`phone: Brief reads flight, date, weather, then next leg (${ids.join(" → ")})`) : fail(`phone: Brief order ${ids} next leg in card ${inCard}`);
    await b.ctx.close();
    // Settings: an index straight to each section (Theme & backup opens and shows it)
    const st = await open("/settings", { width: 390, height: 844 });
    await st.page.locator("#device .sheet-head").click(); // fold it first
    await st.page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await st.page.getByRole("link", { name: "Theme & backup" }).click();
    await st.page.waitForTimeout(500);
    const dev = await st.page.evaluate(() => ({ top: document.querySelector("#device").getBoundingClientRect().top, open: !document.querySelector("#device-body").hidden, toggles: document.querySelectorAll(".sheet-toggle").length }));
    dev.top < 400 && dev.open && dev.toggles >= 5 ? pass(`phone: Settings index jumps to Theme & backup and opens it (${Math.round(dev.top)} px); every section shows −/+`) : fail(`phone: settings index ${JSON.stringify(dev)}`);
    await checkPage("settings index 390 light", st.page, st.errors);
    await st.ctx.close();
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
