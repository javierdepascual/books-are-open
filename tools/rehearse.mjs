/* Fills a scratch book with a plausible night, then checks the numbers the
   kitchen page will show against numbers worked out here independently.
   Usage: node rehearse.mjs <api> <book> */

const API = process.argv[2] || "https://the-oath.javierdepascual.workers.dev";
const BOOK = process.argv[3] || "rehearsal";
const ORIGIN = "https://javierdepascual.github.io";

const call = async (path, body) => {
  const res = await fetch(`${API}${path}?book=${BOOK}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const SCRIPT = [
  // antipasto: three people, one line each
  { courseId: "antipasto", name: "Marco & Elena", items: ["Salami, prosciutto, cheeses, mozzarella"], mode: "buying", note: "bringing a wooden board too" },
  { courseId: "antipasto", name: "Nick", items: ["Olives, roasted peppers, artichokes"], mode: "buying" },
  { courseId: "antipasto", name: "Zoë", items: ["Crackers and bread"], mode: "buying" },
  // one person taking two drinks lines
  { courseId: "bibite", name: "Paulie", items: ["Ice", "Lemons and oranges"], mode: "buying" },
  { courseId: "bibite", name: "Silvio", items: ["Sparkling water"], mode: "buying" },
  // wine split
  { courseId: "vino", name: "Javi & Jacky", items: ["Three bottles of red"], mode: "buying" },
  // cooked courses
  { courseId: "primo", name: "Carmela", dish: "Lasagna", mode: "cooking" },
  { courseId: "primo", name: "Tony", dish: "Baked ziti", mode: "cooking" },
  { courseId: "secondo", name: "Sandra", dish: "Chicken Parmesan", mode: "cooking", note: "no nuts" },
  { courseId: "pane", name: "Adriana & Chris", dish: "Focaccia", mode: "cooking" },
  // money: two people chip in on two different courses
  { courseId: "dolce", name: "Furio", mode: "money", amount: 25 },
  { courseId: "insalata", name: "Artie", mode: "money", amount: 20 },
];

await call("/wipe", {});
let last = null;
for (const claim of SCRIPT) {
  const r = await call("/claim", claim);
  if (r.status !== 200) {
    console.error(`REFUSED ${r.status}:`, JSON.stringify(claim));
    console.error("  ->", JSON.stringify(r.body));
    process.exit(1);
  }
  last = r.body;
}

/* Work the totals out here, from the script, not from the app. */
const expected = {
  money: SCRIPT.filter((c) => c.mode === "money").reduce((n, c) => n + c.amount, 0),
  payers: SCRIPT.filter((c) => c.mode === "money").length,
  people: new Set(SCRIPT.map((c) => c.name)).size,
  // covered: 3 antipasto + 3 bibite lines... count them explicitly
  coveredLines: 3 /*antipasto*/ + 3 /*bibite: Ice, Lemons, Sparkling*/ + 1 /*vino red*/,
  coveredSeats: 2 /*primo*/ + 1 /*secondo*/ + 1 /*pane*/ + 1 /*dolce paid*/ + 1 /*insalata paid*/,
};
const TOTAL_THINGS = 3 + 1 + 2 + 2 + 1 + 1 + 2 + 4; // antipasto,pane,primo,secondo,insalata,dolce,vino,bibite

const state = (await call("/state")).body;
const all = Object.values(state.claims).flat();
const actual = {
  money: all.filter((c) => c.mode === "money").reduce((n, c) => n + (c.amount || 0), 0),
  payers: all.filter((c) => c.mode === "money").length,
  people: new Set(all.map((c) => c.name)).size,
  claims: all.length,
};

const covered = expected.coveredLines + expected.coveredSeats;
console.log(`book "${BOOK}" filled with ${SCRIPT.length} claims`);
console.log(`  money       expected ${expected.money}  actual ${actual.money}`);
console.log(`  payers      expected ${expected.payers}  actual ${actual.payers}`);
console.log(`  people      expected ${expected.people}  actual ${actual.people}`);
console.log(`  claims      expected ${SCRIPT.length}  actual ${actual.claims}`);
console.log(`  covered     ${covered} of ${TOTAL_THINGS}  (missing ${TOTAL_THINGS - covered})`);

const bad = [];
if (actual.money !== expected.money) bad.push("money total");
if (actual.payers !== expected.payers) bad.push("payer count");
if (actual.people !== expected.people) bad.push("people count");
if (actual.claims !== SCRIPT.length) bad.push("claim count");
if (bad.length) { console.error("MISMATCH:", bad.join(", ")); process.exit(1); }
console.log("\nnumbers agree. open: kitchen.html?book=" + BOOK);
