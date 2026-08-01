/* ============================================================
   The party is on phones, in a house, on somebody's wifi. This drives
   the page under the conditions a soak test over clean HTTP can never
   reach: slow requests, dropped requests, and a nervous finger.

   Usage: node flaky.mjs <url> [book]
   ============================================================ */

import { webkit, devices } from "playwright";

const BASE = process.argv[2] || "https://javierdepascual.github.io/la-cosa-nostra/";
const BOOK = process.argv[3] || "flakytest";
const API = "https://the-oath.javierdepascual.workers.dev";
const ORIGIN = "https://javierdepascual.github.io";

const problems = [];
const note = [];
const bad = (w, d) => problems.push(`${w}: ${d}`);

const wipe = () => fetch(`${API}/wipe?book=${BOOK}`, {
  method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" });
const readBook = async () => (await fetch(`${API}/state?book=${BOOK}`,
  { headers: { origin: ORIGIN } })).json();

const browser = await webkit.launch();

async function freshPage({ delayMs = 0, failClaims = 0 } = {}) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  let claimCalls = 0;
  await page.route("**/claim*", async (route) => {
    claimCalls++;
    if (failClaims && claimCalls <= failClaims) return route.abort("connectionfailed");
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return route.continue();
  });
  await page.goto(`${BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}`,
    { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".course");
  return { ctx, page, calls: () => claimCalls };
}

/* ---- A. a nervous finger: submit twice before the first replies ------ */
{
  await wipe();
  const { ctx, page } = await freshPage({ delayMs: 2500 });
  await page.locator('[data-open="primo"]').tap();     // two seats, so a double would fit
  await page.waitForTimeout(400);
  await page.locator('[data-form="primo"] input[name="name"]').fill("Nervous Nick");

  // fire the form twice in quick succession, the way Enter-Enter does
  await page.evaluate(() => {
    const f = document.querySelector('[data-form="primo"]');
    f.requestSubmit();
    f.requestSubmit();
  });
  await page.waitForTimeout(6000);

  const book = await readBook();
  const mine = (book.claims.primo || []).filter((c) => c.name === "Nervous Nick");
  note.push(`double submit -> ${mine.length} claim(s) stored`);
  if (mine.length > 1) bad("double submit", `${mine.length} claims from one person, one tap apart`);
  await ctx.close();
}

/* ---- B. the button must be unusable while it is saving --------------- */
{
  await wipe();
  const { ctx, page } = await freshPage({ delayMs: 3000 });
  await page.locator('[data-open="dolce"]').tap();
  await page.waitForTimeout(400);
  await page.locator('[data-form="dolce"] input[name="name"]').fill("Slow Sal");
  await page.locator('[data-form="dolce"] .commit').tap();
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
    const b = document.querySelector('[data-form="dolce"] .commit');
    return { disabled: b.disabled, label: b.textContent.trim() };
  });
  note.push(`while saving: disabled=${state.disabled} label="${state.label}"`);
  if (!state.disabled) bad("no guard while saving", "commit button still clickable");
  await page.waitForTimeout(4000);
  await ctx.close();
}

/* ---- C. the request dies: does the page tell the truth? -------------- */
{
  await wipe();
  const { ctx, page } = await freshPage({ failClaims: 1 });
  await page.locator('[data-open="insalata"]').tap();
  await page.waitForTimeout(400);
  await page.locator('[data-form="insalata"] input[name="name"]').fill("Dropped Dan");
  await page.locator('[data-form="insalata"] .commit').tap();
  await page.waitForTimeout(3000);

  const shown = await page.evaluate(() => {
    const f = document.querySelector('[data-form="insalata"]');
    const err = f && f.querySelector("[data-error]");
    const btn = f && f.querySelector(".commit");
    return {
      errorVisible: err ? !err.hidden : false,
      errorText: err ? err.textContent.trim() : "",
      buttonUsableAgain: btn ? !btn.disabled : false,
      buttonLabel: btn ? btn.textContent.trim() : "",
    };
  });
  note.push(`after a dropped request: ${JSON.stringify(shown)}`);
  if (!shown.errorVisible) bad("silent failure", "request died and the page said nothing");
  if (!shown.buttonUsableAgain) bad("dead end", "button stayed disabled after a failure");

  const book = await readBook();
  const stored = (book.claims.insalata || []).length;
  note.push(`book after dropped request: ${stored} claim(s)`);
  if (stored !== 0) bad("phantom claim", `${stored} stored despite the failure`);
  await ctx.close();
}

/* ---- D. the reply is lost after the server accepted it ---------------
   The claim lands, the answer never gets back, the guest tries again.
   For a two-seat course a retry can quietly take the second seat. */
{
  await wipe();
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  let n = 0;
  await page.route("**/claim*", async (route) => {
    n++;
    if (n === 1) {
      // let it reach the server, then throw the answer away
      await fetch(route.request().url(), {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: route.request().postData() || "{}",
      });
      return route.abort("connectionfailed");
    }
    return route.continue();
  });
  await page.goto(`${BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".course");
  await page.locator('[data-open="secondo"]').tap();
  await page.waitForTimeout(400);
  await page.locator('[data-form="secondo"] input[name="name"]').fill("Echo Eddie");
  await page.locator('[data-form="secondo"] .commit').tap();
  await page.waitForTimeout(2500);
  // the guest, seeing an error, tries once more
  await page.locator('[data-form="secondo"] .commit').tap().catch(() => {});
  await page.waitForTimeout(3000);

  const book = await readBook();
  const mine = (book.claims.secondo || []).filter((c) => c.name === "Echo Eddie");
  note.push(`lost reply then retry -> ${mine.length} claim(s) for one person`);
  if (mine.length > 1) bad("retry duplicates", `${mine.length} seats taken by one guest`);
  await ctx.close();
}

/* ---- E. reading the book fails: keep what we had --------------------- */
{
  await wipe();
  await fetch(`${API}/claim?book=${BOOK}`, {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ courseId: "dolce", name: "Already There", dish: "Tiramisu", mode: "cooking" }) });

  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".course");
  await page.route("**/state*", (route) => route.abort("connectionfailed"));
  await page.waitForTimeout(7000);   // a poll or two will fail
  const stillThere = await page.locator('.course:has-text("Il Dolce")').first().textContent();
  note.push(`after the book went unreachable: shows "Already There" = ${/already there/i.test(stillThere)}`);
  if (!/already there/i.test(stillThere)) bad("lost on poll failure", "the page emptied when a poll failed");
  await ctx.close();
}

await browser.close();
await wipe();

console.log("— bad network and nervous fingers —");
note.forEach((n) => console.log("  " + n));
console.log("");
if (problems.length) {
  problems.forEach((p) => console.log("  ✗ " + p));
  console.log(`\nFAILED: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("PASS — nothing duplicated, nothing lost, nothing lied about.");
