/* ============================================================
   The gaps the other harnesses never touched:
     - the browser inside WhatsApp and Instagram, where the link
       will actually be opened
     - Android, since every mobile test so far has been WebKit
     - releasing a claim, which uses a native prompt() and may be
       refused or ignored in an in-app browser
     - the page with nothing left to claim
     - whether a chat app can actually read the share card

   Usage: node lastpass.mjs <url>
   ============================================================ */

import { webkit, chromium, devices } from "playwright";

const BASE = process.argv[2] || "https://javierdepascual.github.io/la-cosa-nostra/";
const API = "https://the-oath.javierdepascual.workers.dev";
const ORIGIN = "https://javierdepascual.github.io";
const BOOK = "lastpass";

const problems = [], note = [];
const bad = (w, d) => problems.push(`${w}: ${d}`);

const api = (path, body) => fetch(`${API}${path}?book=${BOOK}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { "content-type": "application/json", origin: ORIGIN },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const wipe = () => api("/wipe", {});
const book = async () => (await api("/state")).json();

/* In-app browsers identify themselves in the user agent; that is what
   sites key off, and it is what we can honestly reproduce here. */
const WHATSAPP_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/WhatsApp;FBAV/24.10.0]";
const INSTAGRAM_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 331.0.0.35.90";

async function claimsThrough(browser, label, contextOpts) {
  await wipe();
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".course", { timeout: 30000 })
    .catch(() => bad(label, "the courses never rendered"));

  await page.locator('[data-open="dolce"]').tap();
  await page.waitForSelector('[data-form="dolce"]', { timeout: 10000 });
  await page.locator('[data-form="dolce"] input[name="name"]').fill(`${label} guest`);
  await page.locator('[data-form="dolce"] .commit').tap();
  await page.waitForTimeout(2800);

  const stored = ((await book()).claims.dolce || []).some((c) => c.name === `${label} guest`);
  note.push(`${label}: claim stored = ${stored}`);
  if (!stored) bad(label, "a claim made in this browser never reached the book");
  if (errors.length) bad(label, "JS error: " + errors[0]);

  // and can they read it back after a reload?
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".course", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const visible = await page.locator('.course:has-text("Il Dolce")').first().textContent();
  if (!visible.includes(`${label} guest`)) bad(label, "the claim is in the book but not shown after reload");

  await ctx.close();
}

const wk = await webkit.launch();
const cr = await chromium.launch();

/* ---- 1. the browser inside WhatsApp --------------------------------- */
await claimsThrough(wk, "WhatsApp", { ...devices["iPhone 13"], userAgent: WHATSAPP_UA });

/* ---- 2. the browser inside Instagram -------------------------------- */
await claimsThrough(wk, "Instagram", { ...devices["iPhone 13"], userAgent: INSTAGRAM_UA });

/* ---- 3. Android -------------------------------------------------------- */
await claimsThrough(cr, "Android", { ...devices["Pixel 7"] });

/* ---- 4. releasing a claim, which leans on a native prompt() --------- */
{
  await wipe();
  await api("/claim", { courseId: "dolce", name: "Regretful Rita", dish: "Tiramisu", mode: "cooking" });

  const ctx = await wk.newContext({ ...devices["iPhone 13"], userAgent: WHATSAPP_UA });
  const page = await ctx.newPage();
  let dialogSeen = false;
  page.on("dialog", async (d) => {
    dialogSeen = true;
    note.push(`  release dialog type=${d.type()} message="${d.message().split("\\n")[0]}"`);
    await d.accept("Regretful Rita");
  });
  await page.goto(`${BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".course");
  await page.waitForTimeout(1200);

  const strike = page.locator('.seat-strike').first();
  const strikeCount = await strike.count();
  note.push(`release control present: ${strikeCount > 0}`);
  if (strikeCount) {
    await strike.tap();
    await page.waitForSelector('.strike-confirm', { timeout: 8000 })
      .catch(() => bad("release", "the in-page confirmation never appeared"));

    // a wrong name must change nothing, and must say so
    await page.locator('.strike-input').fill("Somebody Else");
    await page.locator('.strike-go').tap();
    await page.waitForTimeout(1500);
    const afterWrong = ((await book()).claims.dolce || []).length;
    const warned = await page.locator('[data-strike-error]').isVisible().catch(() => false);
    note.push(`wrong name: ${afterWrong} claim(s) left, warned = ${warned}`);
    if (afterWrong !== 1) bad("release", "a wrong name still removed the claim");
    if (!warned) bad("release", "a wrong name was rejected silently");

    // the right name releases it
    await page.locator('.strike-input').fill("Regretful Rita");
    await page.locator('.strike-go').tap();
    await page.waitForTimeout(2500);
    const left = ((await book()).claims.dolce || []).length;
    note.push(`right name: ${left} claim(s) left, native dialog used = ${dialogSeen}`);
    if (left !== 0) bad("release", `the claim survived a confirmed release (${left} left)`);
    if (dialogSeen) bad("release", "still depends on a native dialog");
  }
  await ctx.close();
}

/* ---- 5. a full book: nothing left to claim -------------------------- */
{
  await wipe();
  const fill = [
    ["antipasto", ["Salami, prosciutto, cheeses, mozzarella"]],
    ["antipasto", ["Olives, roasted peppers, artichokes"]],
    ["antipasto", ["Crackers and bread"]],
    ["vino", ["Three bottles of red"]],
    ["vino", ["One bottle of white, rosé or Prosecco"]],
    ["bibite", ["Sparkling water"]], ["bibite", ["Italian sodas, regular sodas"]],
    ["bibite", ["Ice"]], ["bibite", ["Lemons and oranges"]],
  ];
  for (const [id, items] of fill) await api("/claim", { courseId: id, name: "Filler", items, mode: "buying" });
  for (const [id, n] of [["pane", 1], ["primo", 2], ["secondo", 2], ["insalata", 1], ["dolce", 1]]) {
    for (let i = 0; i < n; i++) await api("/claim", { courseId: id, name: `Filler ${i}`, dish: "x", mode: "cooking" });
  }

  const ctx = await wk.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => bad("full book", "JS error: " + e.message));
  await page.goto(`${BASE}?nointro=1&book=${BOOK}&cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".course");
  await page.waitForTimeout(1500);
  const full = await page.evaluate(() => ({
    tally: document.querySelector(".tally-count").textContent.trim(),
    buttonsLeft: document.querySelectorAll("[data-open]").length,
    statuses: [...document.querySelectorAll(".status")].map((s) => s.textContent.trim()),
  }));
  note.push(`full book: tally "${full.tally}", ${full.buttonsLeft} claim buttons left`);
  if (full.buttonsLeft !== 0) bad("full book", `${full.buttonsLeft} claim buttons still offered`);
  if (!/16 of 16/.test(full.tally)) bad("full book", `tally reads "${full.tally}"`);
  if (full.statuses.some((s) => !/made/i.test(s))) bad("full book", "a course is not marked Made: " + full.statuses.join(","));

  const k = await ctx.newPage();
  await k.goto(`${BASE}kitchen.html?book=${BOOK}&cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await k.waitForTimeout(2500);
  const missing = (await k.locator("#k-missing").textContent()).trim();
  note.push(`kitchen with a full book: "${missing.slice(0, 60)}"`);
  if (!/nothing missing/i.test(missing)) bad("kitchen", `still lists gaps on a full book: ${missing.slice(0, 80)}`);
  await ctx.close();
}

await wk.close();
await cr.close();
await wipe();

/* ---- 6. can a chat app actually read the card? ---------------------- */
{
  const res = await fetch(BASE, { headers: { "user-agent": "WhatsApp/2.23.20" } });
  const html = await res.text();
  const img = html.match(/property="og:image" content="([^"]+)"/);
  note.push(`og:image advertised: ${img ? img[1] : "MISSING"}`);
  if (!img) bad("share card", "no og:image in the HTML a chat app receives");
  else {
    const head = await fetch(img[1], { method: "GET" });
    const type = head.headers.get("content-type");
    const size = (await head.arrayBuffer()).byteLength;
    note.push(`card fetched: ${res.status}/${head.status}, ${type}, ${Math.round(size / 1024)} KB`);
    if (!/image\/png/.test(type || "")) bad("share card", `served as ${type}`);
    if (size > 5 * 1024 * 1024) bad("share card", "over 5 MB, chat apps will skip it");
  }
}

console.log("— the gaps —");
note.forEach((n) => console.log("  " + n));
console.log("");
if (problems.length) {
  problems.forEach((p) => console.log("  ✗ " + p));
  console.log(`\nFAILED: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("PASS — in-app browsers, Android, releasing, a full book and the share card.");
