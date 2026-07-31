/* ============================================================
   Soak test for The Oath's book.

   Hammers a scratch book with random and adversarial claims and
   checks every invariant after every operation. Nothing here touches
   the real book: everything runs on ?book=<run-id>.

   Success measure — "how sure are we that nothing breaks":
   With zero failures observed in N independent trials, the upper bound
   on the per-operation failure rate at 98% confidence is

       p_max = 1 - 0.02^(1/N)          (≈ 3.91 / N for large N)

   So 400 clean operations means: at 98% confidence, fewer than 1 in 100
   operations can break. 800 gets that under 0.5%. The run prints the
   bound it actually earned, rather than claiming a round number.

   Usage: node soak.mjs <api> <ops> [seed]
   ============================================================ */

const API = process.argv[2] || "https://the-oath.javierdepascual.workers.dev";
const OPS = Number(process.argv[3] || 400);
const SEED = Number(process.argv[4] || 1);
const BOOK = `soak${SEED}`;
const ORIGIN = "https://javierdepascual.github.io";

/* Deterministic PRNG so a failing run can be replayed exactly. */
let seed = SEED >>> 0 || 1;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return seed / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/* The rules, restated independently of the implementation. If these
   disagree with the worker, one of the two is wrong and that is the point. */
const COURSES = {
  pane:     { seats: 1 },
  primo:    { seats: 2 },
  secondo:  { seats: 2 },
  insalata: { seats: 1 },
  dolce:    { seats: 1 },
  antipasto: { items: ["Salami, prosciutto, cheeses, mozzarella",
                       "Olives, roasted peppers, artichokes",
                       "Crackers and bread"] },
  vino: { items: ["Three bottles of red",
                  "One bottle of white, rosé or Prosecco"] },
  bibite: { items: ["Sparkling water", "Italian sodas, regular sodas",
                    "Ice", "Lemons and oranges"] },
};
const IDS = Object.keys(COURSES);
const NAMES = ["Javi", "Jacky", "Sandra", "Nick", "Marco & Elena", "Tony",
               "Carmela", "Paulie", "Silvio", "Adriana & Chris", "O'Neill",
               "Zoë", "李雷", "  padded  ", "A".repeat(80)];

const call = async (path, body, qs = "") => {
  const url = `${API}${path}?book=${BOOK}${qs}`;
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body: json };
};

const failures = [];
let ops = 0;
const fail = (what, detail) => failures.push({ op: ops, what, detail });

/* ---------------------------------------------------------- invariants */

function check(state, label) {
  const claims = (state && state.claims) || {};

  for (const [id, list] of Object.entries(claims)) {
    const course = COURSES[id];
    if (!course) { fail("unknown course in state", id); continue; }
    if (!Array.isArray(list)) { fail("course is not a list", id); continue; }

    // 1. seats are never oversold
    if (course.seats && list.length > course.seats) {
      fail("oversold seats", `${id}: ${list.length} > ${course.seats}`);
    }

    // 2. no line is claimed twice
    if (course.items) {
      const seen = new Set();
      for (const c of list) {
        for (const item of c.items || []) {
          if (c.mode === "money") continue;
          if (seen.has(item)) fail("item claimed twice", `${id}: ${item}`);
          seen.add(item);
          // 3. only real lines exist
          if (!course.items.includes(item)) fail("unknown item", `${id}: ${item}`);
        }
      }
    }

    for (const c of list) {
      // 4. every claim carries a usable name
      if (typeof c.name !== "string" || !c.name.trim()) fail("empty name", id);
      if (c.name && c.name.length > 60) fail("name over 60 chars", `${id}: ${c.name.length}`);

      // 5. no angle brackets or control characters survive
      if (/[<>]/.test(c.name + (c.dish || "") + (c.note || ""))) {
        fail("angle bracket stored", `${id}: ${c.name}`);
      }
      if (/[\u0000-\u001F]/.test(c.name + (c.dish || "") + (c.note || ""))) {
        fail("control character stored", `${id}: ${JSON.stringify(c.name)}`);
      }

      // 6. money means an amount and no dish
      if (c.mode === "money") {
        if (!(c.amount >= 1 && c.amount <= 999)) fail("bad amount", `${id}: ${c.amount}`);
        if (c.dish) fail("money claim has a dish", `${id}: ${c.dish}`);
      } else if (c.amount) {
        fail("non-money claim has an amount", `${id}: ${c.amount}`);
      }

      // 7. mode is always one of the three
      if (!["cooking", "buying", "money"].includes(c.mode)) fail("bad mode", `${id}: ${c.mode}`);

      // 8. ids are unique within a course
      if (list.filter((o) => o.id === c.id).length > 1) fail("duplicate claim id", `${id}: ${c.id}`);

      // 9. items never appear on a seat course
      if (course.seats && (c.items || []).length) fail("items on a cooked course", id);
    }
  }
  if (failures.length && failures[failures.length - 1].op === ops) {
    console.error(`  ✗ after ${label}`);
  }
}

/* ---------------------------------------------------------- generators */

function randomClaim() {
  const id = pick(IDS);
  const course = COURSES[id];
  const mode = pick(["cooking", "cooking", "buying", "money"]);
  const claim = { courseId: id, name: pick(NAMES), mode };
  if (mode === "money") {
    claim.amount = pick([20, 25, 30, int(1, 999), 20]);
  } else if (course.items) {
    const n = int(1, course.items.length);
    const shuffled = [...course.items].sort(() => rnd() - 0.5);
    claim.items = shuffled.slice(0, n);
  } else {
    claim.dish = pick(["Lasagna", "Baked ziti", "Tiramisu", "Something home made"]);
  }
  if (rnd() < 0.3) claim.note = pick(["no nuts", "gluten free", "bringing plates", ""]);
  return claim;
}

/* Bad input. Some of it must be refused outright; some of it is merely
   dirty and should come back cleaned. Conflating the two hides real bugs
   in both directions, so each case says which it expects. */
const REJECT = "reject", CLEAN = "clean";
function nastyClaim() {
  const kinds = [
    [CLEAN,  () => ({ courseId: "antipasto", name: "<script>alert(1)</script>", items: ["Crackers and bread"], mode: "cooking" })],
    [CLEAN,  () => ({ courseId: "pane", name: "Bad\u0007Bell\u0000Null", dish: "x", mode: "cooking" })],
    [CLEAN,  () => ({ courseId: "pane", name: "LongName" + "x".repeat(500), dish: "y", mode: "cooking" })],
    [CLEAN,  () => ({ courseId: "pane", name: "ModeCheat", dish: "y", mode: "freeloading" })],
    [CLEAN,  () => ({ courseId: "pane", name: "NoMode", dish: "y" })],
    [REJECT, () => ({ courseId: "pane", name: "", dish: "x", mode: "cooking" })],
    [REJECT, () => ({ courseId: "pane", name: "   ", dish: "x", mode: "cooking" })],
    [REJECT, () => ({ courseId: "nope", name: "Ghost", mode: "cooking" })],
    [REJECT, () => ({ courseId: "antipasto", name: "Sneak", items: ["Caviar"], mode: "cooking" })],
    [REJECT, () => ({ courseId: "antipasto", name: "Empty", items: [], mode: "cooking" })],
    [REJECT, () => ({ courseId: "antipasto", name: "NotArray", items: "Ice", mode: "cooking" })],
    [REJECT, () => ({ courseId: "dolce", name: "Free", mode: "money", amount: 0 })],
    [REJECT, () => ({ courseId: "dolce", name: "Rich", mode: "money", amount: 100000 })],
    [REJECT, () => ({ courseId: "dolce", name: "NaN", mode: "money", amount: "twenty" })],
    [REJECT, () => ({ courseId: "dolce", name: "Neg", mode: "money", amount: -50 })],
    [REJECT, () => ({})],
  ];
  const [expect, make] = pick(kinds);
  return { expect, payload: make() };
}

/* ---------------------------------------------------------- the run */

console.log(`soak: ${OPS} ops against ${API} on book "${BOOK}" (seed ${SEED})`);
const w0 = await call("/wipe", {});
if (w0.status !== 200) { console.error("wipe failed:", JSON.stringify(w0)); process.exit(1); }
let state = (await call("/state")).body;
check(state, "wipe");

const accepted = [];
let rejected = 0, taken409 = 0, cleaned = 0;

for (let i = 0; i < OPS; i++) {
  ops++;
  const roll = rnd();

  if (roll < 0.12 && accepted.length) {
    // release something at random
    const victim = accepted.splice(Math.floor(rnd() * accepted.length), 1)[0];
    const r = await call("/release", { courseId: victim.courseId, claimId: victim.id });
    if (r.status !== 200) fail("release failed", JSON.stringify(r));
    state = r.body;
  } else if (roll < 0.32) {
    // send rubbish
    const { expect, payload } = nastyClaim();
    const r = await call("/claim", payload);
    if (expect === REJECT) {
      if (r.status === 200) fail("bad input accepted", JSON.stringify(payload).slice(0, 120));
      else rejected++;
    } else {
      // a 409 is fine too: the seat may simply be gone
      if (r.status !== 200 && r.status !== 409) {
        fail("clean-able input refused", `${r.status} ${JSON.stringify(payload).slice(0, 100)}`);
      } else if (r.status === 200) {
        cleaned++;
      }
    }
    state = (await call("/state")).body;
  } else {
    const claim = randomClaim();
    const r = await call("/claim", claim);
    if (r.status === 200) {
      state = r.body;
      const list = state.claims[claim.courseId] || [];
      const mine = list[list.length - 1];
      if (mine) accepted.push({ courseId: claim.courseId, id: mine.id });
    } else if (r.status === 409) {
      taken409++;
      state = (await call("/state")).body;
    } else if (r.status === 400) {
      rejected++;
      state = (await call("/state")).body;
    } else {
      fail("unexpected status", `${r.status} ${JSON.stringify(r.body)}`);
      state = (await call("/state")).body;
    }
  }
  check(state, `op ${i}`);
}

/* ---------------------------------------------------------- the race */

console.log("race: 12 clients going for the same last seat, 6 rounds");
for (let round = 0; round < 6; round++) {
  ops++;
  const w = await call("/wipe", {});
  if (w.status !== 200) fail("wipe failed", JSON.stringify(w));
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, k) =>
      call("/claim", { courseId: "dolce", name: `Racer ${k}`, dish: "Tiramisu", mode: "cooking" })));
  const won = results.filter((r) => r.status === 200).length;
  if (won !== 1) fail("race for one seat", `${won} winners, expected 1`);
  const after = (await call("/state")).body;
  check(after, `race ${round}`);
  if ((after.claims.dolce || []).length !== 1) {
    fail("race left wrong count", String((after.claims.dolce || []).length));
  }
}

console.log("race: 8 clients going for the same single line, 6 rounds");
for (let round = 0; round < 6; round++) {
  ops++;
  const w = await call("/wipe", {});
  if (w.status !== 200) fail("wipe failed", JSON.stringify(w));
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, k) =>
      call("/claim", { courseId: "vino", name: `Racer ${k}`,
                       items: ["Three bottles of red"], mode: "buying" })));
  const won = results.filter((r) => r.status === 200).length;
  if (won !== 1) fail("race for one line", `${won} winners, expected 1`);
  check((await call("/state")).body, `line race ${round}`);
}

await call("/wipe", {});

/* ---------------------------------------------------------- verdict */

const bound = (1 - Math.pow(0.02, 1 / ops)) * 100;
console.log("");
console.log(`operations       ${ops}`);
console.log(`rejected junk    ${rejected}`);
console.log(`accepted cleaned ${cleaned}`);
console.log(`409 conflicts    ${taken409}`);
console.log(`invariant breaks ${failures.length}`);
if (failures.length) {
  console.log("");
  for (const f of failures.slice(0, 25)) console.log(`  op ${f.op}: ${f.what} — ${f.detail}`);
  console.log(`\nFAILED (seed ${SEED} replays this run exactly)`);
  process.exit(1);
}
console.log(`\nPASS — 0 breaks in ${ops} operations.`);
console.log(`At 98% confidence the per-operation failure rate is below ${bound.toFixed(2)}%.`);
