/**
 * Screenshot a replay page at desktop, small-desktop, and phone sizes, paused
 * and while autoplaying.
 *
 *   node scripts/review-screenshots.mjs [url] [move] [outDir] [mode]
 *
 * `mode` is the board mode (analysis, guess, off). In guess mode each size
 * also gets a `-rating` shot, taken while the last move's rating shows; the
 * plain shot is taken after it has faded. The game's last viewed move is put
 * back afterwards (LAN app only).
 *
 * Playwright is not a dependency of this project; it is loaded from this
 * project if installed, otherwise from ~/proj/voice-wei/node_modules.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    return require(path.join(os.homedir(), "proj/voice-wei/node_modules/playwright"));
  }
}
const { chromium } = loadPlaywright();

const url = process.argv[2] ?? "http://127.0.0.1:4517/game?id=404";
const move = Number(process.argv[3] ?? 60);
const outDir = process.argv[4] ?? "/tmp/cursor/screenshots";
const mode = process.argv[5] ?? "analysis";

const page0 = new URL(url);
const gameId = page0.searchParams.get("id") ?? page0.pathname.split("/").pop();
const saved = await fetch(`${page0.origin}/data/games/${gameId}.json`)
  .then((r) => r.json())
  .then((d) => d.game.lastViewedMove)
  .catch(() => null);

const sizes = [
  { name: "desktop-1920", viewport: { width: 1920, height: 1080 }, scale: 1 },
  { name: "desktop-1024", viewport: { width: 1024, height: 728 }, scale: 1 },
  { name: "phone-390", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
];

const browser = await chromium.launch();
for (const size of sizes) {
  const context = await browser.newContext({
    viewport: size.viewport,
    deviceScaleFactor: size.scale,
    isMobile: !!size.mobile,
    hasTouch: !!size.mobile,
  });
  await context.addInitScript((m) => window.localStorage.setItem("replay.mode", m), mode);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.click('[title="First move (Home)"]');
  for (let i = 0; i < move; i++) await page.click('[title="Next move (→)"]');
  if (mode === "guess") {
    // reveal-in: 200ms wait + 250ms fade; the default reveal lasts 3 s more.
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${outDir}/${size.name}-rating.png`, fullPage: !!size.mobile });
    await page.waitForTimeout(3600);
  } else {
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${outDir}/${size.name}.png`, fullPage: !!size.mobile });
  await page.click('[title="Play / pause (space)"]');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${outDir}/${size.name}-playing.png` });
  await page.click('[title="Play / pause (space)"]');
  const layout = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
    };
    const canvases = [...document.querySelectorAll("canvas")];
    return {
      scrollWidth: document.documentElement.scrollWidth,
      board: box(canvases[0]),
      charts: canvases.slice(2).map(box),
    };
  });
  console.log(size.name, JSON.stringify(layout), errors.length ? `ERRORS ${errors.join(" | ")}` : "no errors");
  await context.close();
}
await browser.close();

if (saved !== null) {
  await fetch(`${page0.origin}/api/games/${gameId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lastViewedMove: saved }),
  }).catch(() => {});
}
