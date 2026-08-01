/* ============================================================
   The night itself: eleven guests on eleven iPhones, opening the link
   at their own pace and claiming whatever is still free — which is how
   the collisions will really happen, rather than in a synthetic burst.

   Then it checks what everyone ends up seeing, because the whole point
   of the thing is that they all see the same book.

   Usage: node party.mjs <url> [book]
   ============================================================ */

import { webkit, devices } from "playwright";

const BASE = process.argv[2] || "https://javierdepascual.github.io/la-cosa-nostra/";
const BOOK = process.argv[3] || "partynight";
const API = "https://the-oath.javierdepascual.workers.dev";
const ORIGIN = "https://javierdepascual.github.io";

const GUESTS = ["Javi & Jacky", "Sandra", "Nick", "Marco & Elena", "Tony",
                "Carmela", "Paulie", "Silvio", "Adriana & Chris", "Furio", "Zoë"];
const COURSES = ["antipasto", "pane", "primo", "secondo", "insalata", "dolce", "vino", "bibite"];

const problems = [];
const bad = (w, d) => problems.push(`${w}: ${d}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

await fetch(`${API}/wipe?book=${BOOK}`, { method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" });

const browser = await webkit.launch();
const log = [];

async function guest(name, i) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await sleep(rint(0, 2500));                       // people don't arrive together
  try {
    await page.goto(`${BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}${i}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".course", { timeout: 30000 });
    await sleep(rint(500, 2000));                   // reading the page

    /* A guest tries something; if it fills up under their thumb they try
       something else, up to a few times, rather than standing there. */
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      const open = await page.evaluate(() =>
        [...document.querySelectorAll("[data-open]")].map((b) => b.dataset.open));
      if (!open.length) { log.push(`${name}: nothing left to claim`); break; }
      const target = open[Math.floor(Math.random() * open.length)];

      try {
        await page.locator(`[data-open="${target}"]`).tap({ timeout: 5000 });
        await page.waitForSelector(`[data-form="${target}"]`, { timeout: 8000 });
        await sleep(rint(400, 1500));
        await page.locator(`[data-form="${target}"] input[name="name"]`).fill(name, { timeout: 5000 });
        /* Tick a line by tapping its label. The input itself is invisible and
           has pointer-events:none, which is right for people and fatal for a
           robot aiming at the input — it silently never claimed a list course. */
        const ticks = await page.locator(`[data-form="${target}"] .pick`).count();
        if (ticks) await page.locator(`[data-form="${target}"] .pick`).first().tap({ timeout: 5000 });
        await page.locator(`[data-form="${target}"] .commit`).tap({ timeout: 5000 });
        await sleep(2500);

        /* Ask the book whether the name is in it. Reading the form is a
           trap: losing the race redraws the card and removes the form, so
           "no error element" looks identical to success. */
        const stored = await (await fetch(`${API}/state?book=${BOOK}`,
          { headers: { origin: ORIGIN } })).json();
        const inBook = (stored.claims[target] || []).some((c) => c.name === name);
        const outcome = inBook ? "accepted" : "lost the race";
        log.push(`${name} -> ${target}: ${outcome}`);
        if (outcome === "accepted") done = true;
        else await page.reload({ waitUntil: "domcontentloaded" }).then(() => page.waitForSelector(".course"));
      } catch (e) {
        // it filled up while they were looking at it; move on like a person
        log.push(`${name} -> ${target}: gone before they could take it`);
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForSelector(".course", { timeout: 20000 }).catch(() => {});
      }
    }

    if (errors.length) bad(`${name} hit a JS error`, errors[0]);
  } catch (e) {
    bad(`${name} could not finish`, e.message.split("\n")[0]);
  }
  await ctx.close();
}

await Promise.all(GUESTS.map((g, i) => guest(g, i)));

/* ---- what the book ended up holding --------------------------------- */
const book = await (await fetch(`${API}/state?book=${BOOK}`, { headers: { origin: ORIGIN } })).json();
const SEATS = { pane: 1, primo: 2, secondo: 2, insalata: 1, dolce: 1 };
const LINES = { antipasto: 3, vino: 2, bibite: 4 };

let claims = 0;
for (const [id, list] of Object.entries(book.claims)) {
  claims += list.length;
  if (SEATS[id] && list.length > SEATS[id]) bad("oversold", `${id} ${list.length}/${SEATS[id]}`);
  if (LINES[id]) {
    const seen = new Set();
    for (const c of list) for (const it of c.items || []) {
      if (seen.has(it)) bad("same line twice", `${id}: ${it}`);
      seen.add(it);
    }
  }
  const keys = list.map((c) => c.key).filter(Boolean);
  if (new Set(keys).size !== keys.length) bad("duplicate attempt key", id);
}

/* ---- and does everyone see the same thing? -------------------------- */
const check = await browser.newContext({ ...devices["iPhone 13"] });
const p1 = await check.newPage();
await p1.goto(`${BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}`, { waitUntil: "networkidle" });
await p1.waitForSelector(".course");
await p1.waitForTimeout(1500);
const tally = (await p1.locator(".tally-count").textContent()).trim();

const k = await check.newPage();
await k.goto(`${BASE}kitchen.html?book=${BOOK}&cb=${Date.now()}`, { waitUntil: "networkidle" });
await k.waitForTimeout(2500);
const kitchenCovered = (await k.locator(".k-tile-big").first().textContent()).trim();

if (tally.replace(/\s+/g, " ") !== kitchenCovered.replace(/\s+/g, " ")) {
  bad("invitation and kitchen disagree", `page says "${tally}", kitchen says "${kitchenCovered}"`);
}

await browser.close();
await fetch(`${API}/wipe?book=${BOOK}`, { method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" });

console.log("— eleven guests, eleven phones —");
log.sort().forEach((l) => console.log("  " + l));
console.log(`\n  claims stored: ${claims}`);
console.log(`  invitation tally: ${tally}`);
console.log(`  kitchen covered : ${kitchenCovered}`);
console.log("");
if (problems.length) {
  problems.forEach((p) => console.log("  ✗ " + p));
  console.log(`\nFAILED: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("PASS — no double bookings, no errors, and both pages agree.");
