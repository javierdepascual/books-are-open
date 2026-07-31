/* ============================================================
   Runs the invitation through WebKit — the engine Safari and every
   iPhone browser use — at iPhone size, with touch. Chrome passing
   proves nothing about the phones this party will actually be on.

   Usage: node safari.mjs <url> [book]
   ============================================================ */

import { webkit, devices } from "playwright";

const URL_BASE = process.argv[2] || "https://javierdepascual.github.io/the-oath/";
const BOOK = process.argv[3] || "safaritest";
const API = "https://the-oath.javierdepascual.workers.dev";

const problems = [];
const note = [];
const bad = (what, detail) => problems.push(`${what}: ${detail}`);

await fetch(`${API}/wipe?book=${BOOK}`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://javierdepascual.github.io" },
  body: "{}",
});

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"] });
const page = await context.newPage();

page.on("pageerror", (e) => bad("uncaught JS error", e.message));
page.on("console", (m) => { if (m.type() === "error") bad("console error", m.text()); });
page.on("requestfailed", (r) => bad("request failed", `${r.url()} ${r.failure()?.errorText}`));

const url = `${URL_BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}`;
const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
note.push(`page status ${res.status()}`);

/* ---- 1. does anything render at all -------------------------------- */
await page.waitForSelector(".course", { timeout: 15000 }).catch(() => bad("render", "no course cards appeared"));
const cards = await page.locator(".course").count();
note.push(`course cards: ${cards}`);
if (cards !== 8) bad("render", `expected 8 cards, saw ${cards}`);

/* ---- 2. CSS features that are the usual Safari casualties ----------- */
const cssSupport = await page.evaluate(() => ({
  colorMix: CSS.supports("color", "color-mix(in srgb, red 50%, transparent)"),
  has: CSS.supports("selector(:has(a))"),
  clipPath: CSS.supports("clip-path", "inset(0 0 100% 0)"),
  aspectRatio: CSS.supports("aspect-ratio", "2 / 3"),
  vmax: CSS.supports("width", "150vmax"),
  maskImage: CSS.supports("mask-image", "radial-gradient(#000, transparent)")
           || CSS.supports("-webkit-mask-image", "radial-gradient(#000, transparent)"),
  gap: CSS.supports("gap", "1px"),
  textWrap: CSS.supports("text-wrap", "balance"),
}));
for (const [k, v] of Object.entries(cssSupport)) if (!v) bad("CSS unsupported in WebKit", k);
note.push("css: " + JSON.stringify(cssSupport));

/* ---- 3. the gold really is gold (color-mix actually resolved) -------- */
const goldOk = await page.evaluate(() => {
  const el = document.querySelector(".put-name");
  if (!el) return "no button";
  const c = getComputedStyle(el).borderColor;
  return /rgb|oklab|color\(/.test(c) && !c.includes("transparent") ? c : "suspect: " + c;
});
note.push(`button border: ${goldOk}`);

/* ---- 4. claim a course by touch, end to end ------------------------- */
await page.locator('[data-open="pane"]').tap();
await page.waitForSelector('[data-form="pane"]:not([hidden])', { timeout: 8000 })
  .catch(() => bad("form", "claim form never appeared"));
await page.locator('[data-form="pane"] input[name="name"]').fill("Safari Tester");
await page.locator('[data-form="pane"] .commit').tap();
await page.waitForTimeout(2500);

const paneStatus = await page.locator('.course:has-text("Il Pane") .status').first().textContent();
note.push(`pane after claim: ${paneStatus?.trim()}`);
if (!/made/i.test(paneStatus || "")) bad("claim", `status is "${paneStatus?.trim()}" not Made`);

/* ---- 5. selection highlight, measured with transitions off ---------- */
await page.addStyleTag({ content: "* { transition: none !important; animation: none !important; }" });
await page.locator('[data-open="bibite"]').tap();
await page.waitForTimeout(400);
const modeHighlight = await page.evaluate(() => {
  const form = document.querySelector('[data-form="bibite"]');
  if (!form) return "no form";
  const face = (v) => form.querySelector(`input[value="${v}"]`).nextElementSibling;
  form.querySelector('input[value="money"]').closest("label").click();
  const dim = (el) => getComputedStyle(el).borderColor.includes("0.4");
  return `cooking dim=${dim(face("cooking"))} money dim=${dim(face("money"))}`;
});
note.push(`highlight after switching: ${modeHighlight}`);
if (modeHighlight !== "cooking dim=true money dim=false") {
  bad("selection highlight", modeHighlight);
}

/* ---- 6. nothing spills sideways on a phone --------------------------- */
const overflow = await page.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  win: window.innerWidth,
  wide: [...document.querySelectorAll("body *")]
    .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
    .map((el) => el.tagName + "." + (el.className || "").toString().slice(0, 24))
    .slice(0, 6),
}));
note.push(`width ${overflow.doc} vs ${overflow.win}`);
if (overflow.doc > overflow.win + 1) bad("horizontal overflow", JSON.stringify(overflow.wide));

/* ---- 7. the kitchen page too ----------------------------------------- */
const kitchen = await context.newPage();
kitchen.on("pageerror", (e) => bad("kitchen JS error", e.message));
await kitchen.goto(`${URL_BASE}kitchen.html?book=${BOOK}&cb=${Date.now()}`, { waitUntil: "networkidle", timeout: 45000 });
await kitchen.waitForTimeout(2000);
const tiles = await kitchen.locator(".k-tile").count();
note.push(`kitchen tiles: ${tiles}`);
if (tiles < 5) bad("kitchen", `only ${tiles} tiles rendered`);
const stamp = await kitchen.locator("#k-when").textContent();
if (/couldn't reach/i.test(stamp || "")) bad("kitchen", "could not read the book");

await browser.close();
await fetch(`${API}/wipe?book=${BOOK}`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://javierdepascual.github.io" },
  body: "{}",
});

console.log("— WebKit / iPhone 13 —");
note.forEach((n) => console.log("  " + n));
console.log("");
if (problems.length) {
  problems.forEach((p) => console.log("  ✗ " + p));
  console.log(`\nFAILED: ${problems.length} problem(s) in WebKit`);
  process.exit(1);
}
console.log("PASS — the invitation and the kitchen both work in Safari's engine.");
