/* ============================================================
   Property-based testing with shrinking.

   soak.mjs tells you "something broke somewhere in 300 operations",
   which is barely better than "it broke". This generates the same kind
   of sequences, and when one fails it cuts the sequence down — dropping
   operations, then simplifying the ones that are left — until every
   remaining step is load-bearing. What it prints is the smallest
   sequence that still breaks.

   Usage: node shrink.mjs <api> [runs] [len]
   ============================================================ */

const API = process.argv[2] || "https://the-oath.javierdepascual.workers.dev";
const RUNS = Number(process.argv[3] || 25);
const LEN = Number(process.argv[4] || 24);
const ORIGIN = "https://javierdepascual.github.io";

let book = "shrink0";
const call = async (path, body) => {
  const res = await fetch(`${API}${path}?book=${book}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const COURSES = {
  pane: { seats: 1 }, primo: { seats: 2 }, secondo: { seats: 2 },
  insalata: { seats: 1 }, dolce: { seats: 1 },
  antipasto: { items: ["Salami, prosciutto, cheeses, mozzarella",
                       "Olives, roasted peppers, artichokes", "Crackers and bread"] },
  vino: { items: ["Three bottles of red", "One bottle of white, rosé or Prosecco"] },
  bibite: { items: ["Sparkling water", "Italian sodas, regular sodas", "Ice", "Lemons and oranges"] },
};
const IDS = Object.keys(COURSES);

let seed = 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

/* ---- the property every state must satisfy -------------------------- */
function violations(state) {
  const out = [];
  for (const [id, list] of Object.entries((state && state.claims) || {})) {
    const c = COURSES[id];
    if (!c) { out.push(`unknown course ${id}`); continue; }
    if (c.seats && list.length > c.seats) out.push(`${id} oversold ${list.length}/${c.seats}`);
    if (c.items) {
      const seen = new Set();
      for (const cl of list) for (const it of cl.items || []) {
        if (cl.mode === "money") continue;
        if (seen.has(it)) out.push(`${id} line twice: ${it}`);
        seen.add(it);
        if (!c.items.includes(it)) out.push(`${id} unknown line: ${it}`);
      }
    }
    for (const cl of list) {
      if (!cl.name || !String(cl.name).trim()) out.push(`${id} nameless claim`);
      if (cl.mode === "money" && !(cl.amount >= 1 && cl.amount <= 999)) out.push(`${id} amount ${cl.amount}`);
      if (cl.mode !== "money" && cl.amount) out.push(`${id} amount on a non-money claim`);
      if (cl.key && list.filter((o) => o.key === cl.key).length > 1) out.push(`${id} key used twice`);
    }
  }
  return out;
}

/* ---- one step of a sequence ----------------------------------------- */
function randomStep(i) {
  const id = pick(IDS);
  const c = COURSES[id];
  const mode = pick(["cooking", "buying", "money"]);
  const step = { kind: "claim", courseId: id, name: pick(["A", "B", "C", "D"]), mode, key: "k" + i };
  if (mode === "money") step.amount = pick([20, 25, 1, 999]);
  else if (c.items) step.items = [pick(c.items)];
  else step.dish = "d";
  if (rnd() < 0.15) return { kind: "repeat", of: Math.max(0, i - 1) };  // same key again
  if (rnd() < 0.12) return { kind: "release", nth: Math.floor(rnd() * 3) };
  return step;
}

/* ---- run a sequence, return the first violation it produces ---------- */
async function run(seq) {
  await call("/wipe", {});
  const made = [];
  let last = { claims: {} };
  for (let i = 0; i < seq.length; i++) {
    const s = seq[i];
    if (s.kind === "release") {
      if (!made.length) continue;
      const v = made[Math.min(s.nth, made.length - 1)];
      const r = await call("/release", { courseId: v.courseId, claimId: v.id });
      last = r.body || last;
    } else if (s.kind === "repeat") {
      const prev = seq[s.of];
      if (!prev || prev.kind !== "claim") continue;
      const r = await call("/claim", prev);
      last = r.body || last;
    } else {
      const r = await call("/claim", s);
      if (r.status === 200) {
        last = r.body;
        const list = last.claims[s.courseId] || [];
        const mine = list[list.length - 1];
        if (mine) made.push({ courseId: s.courseId, id: mine.id });
      }
    }
    const v = violations(last);
    if (v.length) return { at: i, why: v[0] };
  }
  return null;
}

/* ---- shrinking: drop steps, then simplify what is left --------------- */
async function shrink(seq) {
  let best = seq;
  let changed = true;
  while (changed) {
    changed = false;
    // try removing each step
    for (let i = 0; i < best.length; i++) {
      const candidate = best.filter((_, k) => k !== i);
      if (!candidate.length) continue;
      if (await run(candidate)) { best = candidate; changed = true; break; }
    }
    // try emptying optional fields
    if (!changed) {
      for (let i = 0; i < best.length; i++) {
        if (best[i].kind !== "claim" || !best[i].note) continue;
        const candidate = best.map((s, k) => (k === i ? { ...s, note: undefined } : s));
        if (await run(candidate)) { best = candidate; changed = true; break; }
      }
    }
  }
  return best;
}

/* ---- the search ------------------------------------------------------ */
let found = null;
for (let r = 0; r < RUNS && !found; r++) {
  book = `shrink${r}`;
  seed = (r + 1) * 7919;
  const seq = Array.from({ length: LEN }, (_, i) => randomStep(i));
  const bug = await run(seq);
  if (bug) {
    process.stdout.write(`\nrun ${r}: broke at step ${bug.at} — ${bug.why}\n  shrinking…`);
    const small = await shrink(seq);
    found = { bug, small };
  } else {
    process.stdout.write(".");
  }
}
await call("/wipe", {});

console.log("");
if (!found) {
  console.log(`\nPASS — ${RUNS} sequences of ${LEN} steps, no property violated.`);
  console.log(`(${RUNS * LEN} operations, including repeated keys and releases.)`);
} else {
  console.log(`\nsmallest failing sequence (${found.small.length} steps):`);
  found.small.forEach((s, i) => console.log(`  ${i}. ${JSON.stringify(s)}`));
  console.log(`\nviolates: ${found.bug.why}`);
  process.exit(1);
}
