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
    const deps = await page.$$eval("table.flights tbody tr td:nth-child(4)", (tds) => tds.map((t) => t.textContent.trim()));
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
    defs === 14 ? pass("journeys: 'What the options mean' lists all 14 options") : fail(`journeys: guide has ${defs}`);
    await page.goto(page.url().split("/journeys")[0] + "/journeys", { waitUntil: "networkidle" });
    const cards = await page.locator(".jr-ex-card").count();
    const chips = await page.locator(".jr-example").count();
    cards === chips && cards >= 9 && (await page.locator(".jr-intro .jr-defs dt").count()) === 14 ? pass(`journeys: intro shows ${cards} examples and the option guide`) : fail(`journeys: intro ${cards}/${chips}`);
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
    errors.length ? fail(`settings: console errors ${JSON.stringify(errors)}`) : pass("settings: 0 console errors");
    await ctx.close();
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
