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
    const errs = errors.filter((e) => !/Failed to load resource.*(open-meteo|vatsim)/.test(e));
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
      ? pass("finder: preferred airframe G-ABCD used for A320 family")
      : fail(`finder: expected G-ABCD airframe, got type=${u.searchParams.get("type")}`);
    await shot(page, "finder-day");

    // destinations tab
    await page.getByRole("tab", { name: /Destinations/ }).click();
    await page.waitForSelector(".place-list li");
    const dn = await page.locator(".place-list li").count();
    dn > 3 ? pass(`finder: ${dn} destinations from EGKK`) : fail(`finder: only ${dn} destinations`);
    await shot(page, "destinations-day");
    await page.locator(".place-list .place").first().click();
    const arr = new URL(page.url()).searchParams.get("arr");
    arr ? pass(`finder: picking a destination sets To=${arr}`) : fail("finder: destination pick didn't set To");

    // next leg
    await page.locator("table.flights tbody tr").first().click();
    const firstDest = (await page.locator(".fcard-end.arr .flap").getAttribute("aria-label"))?.slice(0, 4);
    await page.getByRole("button", { name: /^Next leg from/ }).click();
    await page.waitForTimeout(300);
    const dep2 = new URL(page.url()).searchParams.get("dep");
    dep2 === firstDest ? pass(`finder: next leg continues from ${dep2}`) : fail(`finder: next leg from ${dep2}, expected ${firstDest}`);

    // aircraft badge tooltip: maker chip + full name
    const tb = page.locator("table.flights tbody .tbadge").first();
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

    // close the flight card → back to the empty state
    await page.getByRole("button", { name: "Close this flight" }).click();
    (await page.locator(".detail-empty").count()) === 1 && !new URL(page.url()).searchParams.get("f")
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

  /* ---------- every page × width × theme ---------- */
  const pages = ["/?al=EZY&dep=EGKK", "/?al=EZY&dep=EGKK&view=places", "/brief", "/settings"];
  for (const theme of ["light", "dark"])
    for (const width of [1280, 390])
      for (const path of pages) {
        const { ctx, page, errors } = await open(path, { width, height: width < 500 ? 844 : 900, theme });
        if (path.startsWith("/?")) await page.waitForSelector(path.includes("places") ? ".place-list li" : "table.flights tbody tr", { timeout: 20000 });
        if (path === "/brief") await page.waitForTimeout(300);
        await checkPage(`${path} ${width}px ${theme}`, page, errors);
        await ctx.close();
      }

  /* ---------- brief with a flight: weather ---------- */
  await section("brief", async () => {
    const { ctx, page, errors } = await open("/?al=EZY&dep=EGKK");
    await page.waitForSelector("table.flights tbody tr");
    await page.locator("table.flights tbody tr").first().click();
    await page.getByRole("link", { name: /Ready to sim/ }).click();
    await page.waitForURL(/\/brief/);
    await page.waitForSelector(".fcard");
    await page.waitForTimeout(4000);
    const wx = await page.locator("#weather").innerText();
    /kt|KT/.test(wx) ? pass("brief: weather rendered") : fail(`brief: no weather values (${wx.slice(0, 120)})`);
    await checkPage("brief with flight 1280 light", page, errors);
    await shot(page, "brief-day");
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
    await page.getByRole("radio", { name: /Coloured edge/ }).check();
    await page.goto(page.url().replace(/\/settings.*$/, "/?al=EZY&dep=EGKK"), { waitUntil: "networkidle" });
    await page.waitForSelector("table.flights tbody tr");
    const split = await page.locator("table.flights tbody tr").first().locator(".split-pill > *").first().getAttribute("class");
    const side = await page.locator("table.flights tbody .tbadge.tb-side").count();
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
