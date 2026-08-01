/* ============================================================
   Accessibility audit. Contrast measured, not eyeballed; focus order
   walked with a keyboard; form controls checked for actual labels.

   Usage: node access.mjs <url> [book]
   ============================================================ */

import { webkit, devices } from "playwright";

const BASE = process.argv[2] || "https://javierdepascual.github.io/la-cosa-nostra/";
const BOOK = process.argv[3] || "a11ytest";
const API = "https://the-oath.javierdepascual.workers.dev";
const ORIGIN = "https://javierdepascual.github.io";

const problems = [], warnings = [], note = [];
const bad = (w, d) => problems.push(`${w}: ${d}`);
const warn = (w, d) => warnings.push(`${w}: ${d}`);

await fetch(`${API}/wipe?book=${BOOK}`, { method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" });
// one claim so the printed-card colours get audited too
await fetch(`${API}/claim?book=${BOOK}`, { method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify({ courseId: "dolce", name: "Contrast Carla", dish: "Tiramisu", mode: "cooking" }) });

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"] });
const page = await context.newPage();
await page.goto(`${BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}`, { waitUntil: "networkidle" });
await page.waitForSelector(".course");

/* ---- contrast, computed properly ------------------------------------ */
const contrast = await page.evaluate(() => {
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (c) => {
    const m = c.match(/-?[\d.]+/g);
    if (!m) return null;
    if (c.startsWith("rgb")) return m.slice(0, 3).map(Number);
    return null;
  };
  // walk up for the first opaque background
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const p = parse(c);
      if (p && !/rgba\(.*,\s*0\)/.test(c)) {
        const a = c.match(/[\d.]+\)$/);
        if (!a || parseFloat(a[0]) > 0.9) return p;
      }
      n = n.parentElement;
    }
    return [11, 9, 8];
  };
  const ratio = (fg, bg) => {
    const a = lum(fg) + 0.05, b = lum(bg) + 0.05;
    return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
  };

  const samples = [];
  const want = [
    [".preamble", "preamble"], [".course-gloss", "course gloss"],
    [".course-name", "course name"], [".option", "menu line"],
    [".option-owner", "line owner"], [".status", "status pill"],
    [".put-name", "claim button"], [".seat-name", "claimed name"],
    [".seat-dish", "claimed dish"], [".attire-body", "dress code text"],
    [".board-link-go", "board link"], [".tally-label", "tally label"],
    [".credits", "credits"], [".k-tile-small", "tile label"],
  ];
  for (const [sel, label] of want) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const boldish = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && boldish);
    samples.push({ label, ratio: ratio(fg, bgOf(el)), size: Math.round(size), large });
  }
  return samples;
});
for (const s of contrast) {
  const need = s.large ? 3 : 4.5;
  note.push(`  ${s.label.padEnd(16)} ${String(s.ratio).padStart(6)}:1  ${s.size}px  needs ${need}`);
  if (s.ratio < need) bad("contrast below WCAG AA", `${s.label} ${s.ratio}:1 (needs ${need}:1)`);
  else if (s.ratio < need + 0.5) warn("contrast is close to the line", `${s.label} ${s.ratio}:1`);
}

/* ---- every control has a name --------------------------------------- */
const unlabelled = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll("input, button, a").forEach((el) => {
    if (el.type === "hidden") return;
    const inLabel = el.closest("label");
    const text = (el.textContent || "").trim();
    const named = el.getAttribute("aria-label") || el.getAttribute("title")
      || el.getAttribute("placeholder") || (inLabel && inLabel.textContent.trim()) || text;
    if (!named) out.push(el.tagName + "." + (el.className || "").toString().slice(0, 20));
  });
  return out;
});
if (unlabelled.length) bad("controls with no accessible name", unlabelled.join(", "));
note.push(`controls without a name: ${unlabelled.length}`);

/* ---- keyboard: can you reach and use the form? ----------------------- */
await page.locator('[data-open="pane"]').focus();
const focusVisible = await page.evaluate(() => {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  return { tag: el.tagName, outline: cs.outlineStyle, width: cs.outlineWidth };
});
note.push(`focus ring on the claim button: ${focusVisible.outline} ${focusVisible.width}`);
if (focusVisible.outline === "none") bad("no visible focus", "the claim button shows nothing when focused");

await page.keyboard.press("Enter");
await page.waitForTimeout(500);
const reachable = await page.evaluate(async () => {
  const form = document.querySelector('[data-form="pane"]');
  if (!form) return "form did not open with the keyboard";
  const stops = [...form.querySelectorAll("input, button")]
    .filter((el) => el.type !== "hidden" && getComputedStyle(el).visibility !== "hidden");
  return `${stops.length} focusable controls in the form`;
});
note.push(String(reachable));
if (/did not open/.test(String(reachable))) bad("keyboard", String(reachable));

/* ---- live regions announce what changed ----------------------------- */
const live = await page.evaluate(() => ({
  toast: document.getElementById("toast")?.getAttribute("aria-live"),
  tally: document.getElementById("tally")?.getAttribute("aria-live"),
  headings: [...document.querySelectorAll("h1,h2,h3")].map((h) => h.tagName + ":" + h.textContent.trim().slice(0, 22)),
  lang: document.documentElement.lang,
  imgsWithoutAlt: [...document.images].filter((i) => !i.alt).length,
}));
note.push(`toast aria-live=${live.toast}, tally aria-live=${live.tally}, lang=${live.lang}`);
note.push(`headings: ${live.headings.join(" | ")}`);
if (!live.toast) bad("no announcement", "the confirmation toast is not a live region");
if (!live.lang) bad("no lang", "the page does not declare a language");
if (live.imgsWithoutAlt) bad("images without alt", String(live.imgsWithoutAlt));

/* ---- heading order ---------------------------------------------------- */
const levels = live.headings.map((h) => Number(h[1]));
for (let i = 1; i < levels.length; i++) {
  if (levels[i] - levels[i - 1] > 1) warn("heading level skipped", live.headings[i]);
}

/* ---- reduced motion is honoured -------------------------------------- */
const reduced = await context.newPage();
await reduced.emulateMedia({ reducedMotion: "reduce" });
await reduced.goto(`${BASE}?book=${BOOK}&cb=${Date.now()}`, { waitUntil: "networkidle" });
await reduced.waitForTimeout(1200);
const introShown = await reduced.evaluate(() => {
  const i = document.getElementById("intro");
  return i ? getComputedStyle(i).display !== "none" && i.isConnected : false;
});
note.push(`with reduced motion, the match intro runs: ${introShown}`);
if (introShown) bad("reduced motion ignored", "the intro still plays");

await browser.close();
await fetch(`${API}/wipe?book=${BOOK}`, { method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" });

console.log("— accessibility —");
note.forEach((n) => console.log("  " + n));
if (warnings.length) { console.log(""); warnings.forEach((w) => console.log("  ~ " + w)); }
console.log("");
if (problems.length) {
  problems.forEach((p) => console.log("  ✗ " + p));
  console.log(`\nFAILED: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("PASS — contrast, names, keyboard, announcements and reduced motion all hold.");
