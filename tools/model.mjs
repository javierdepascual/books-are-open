/* ============================================================
   Differential test against a reference model.

   The invariant checks ask "is this state legal?". This asks the harder
   question: "is this the state it should be?" — by writing the rules a
   second time, from the description rather than from the code, running
   both, and comparing after every single operation. A rule that is
   consistently wrong in the worker passes every invariant and fails here.

   Usage: node model.mjs <api> [ops] [seed]
   ============================================================ */

const API = process.argv[2] || "https://the-oath.javierdepascual.workers.dev";
const OPS = Number(process.argv[3] || 250);
const SEED = Number(process.argv[4] || 42);
const BOOK = `model${SEED}`;
const ORIGIN = "https://javierdepascual.github.io";

const call = async (path, body) => {
  const res = await fetch(`${API}${path}?book=${BOOK}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let seed = SEED >>> 0 || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

/* ---------------------------------------------------------- the model */

const MENU = {
  pane: { seats: 1 }, primo: { seats: 2 }, secondo: { seats: 2 },
  insalata: { seats: 1 }, dolce: { seats: 1 },
  antipasto: { items: ["Salami, prosciutto, cheeses, mozzarella",
                       "Olives, roasted peppers, artichokes", "Crackers and bread"] },
  vino: { items: ["Three bottles of red", "One bottle of white, rosé or Prosecco"] },
  bibite: { items: ["Sparkling water", "Italian sodas, regular sodas", "Ice", "Lemons and oranges"] },
};
const IDS = Object.keys(MENU);
const MODES = ["cooking", "buying", "money"];

// written from the description: strip control characters and angle
// brackets, trim, then cut to length
const tidy = (v, max) =>
  String(v == null ? "" : v).replace(/[\u0000-\u001F<>]/g, "").trim().slice(0, max);

const model = { claims: {} };

/* Returns the status the book ought to answer, and applies the change. */
let added = false;
function modelClaim(body) {
  added = false;
  const courseId = tidy(body.courseId, 24);
  const course = MENU[courseId];
  if (!course) return 400;

  const list = model.claims[courseId] || (model.claims[courseId] = []);

  const key = tidy(body.key, 40);
  if (key && list.some((c) => c.key === key)) return 200;      // already written, nothing added

  const name = tidy(body.name, 60);
  if (!name) return 400;

  const mode = MODES.includes(body.mode) ? body.mode : "cooking";
  const paying = mode === "money";
  let items = [];
  let amount = 0;

  if (paying) {
    amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 1 || amount > 999) return 400;
    if (course.seats && list.length >= course.seats) return 409;
  } else if (course.items) {
    items = Array.isArray(body.items) ? body.items.map((i) => tidy(i, 80)).filter(Boolean) : [];
    if (!items.length) return 400;
    if (items.some((i) => !course.items.includes(i))) return 400;
    const spoken = new Set(list.filter((c) => c.mode !== "money").flatMap((c) => c.items || []));
    if (items.some((i) => spoken.has(i))) return 409;
  } else if (list.length >= course.seats) {
    return 409;
  }

  list.push({
    key, name,
    dish: paying ? "" : tidy(body.dish, 60),
    items, amount,
    note: tidy(body.note, 120),
    mode,
  });
  added = true;
  return 200;
}

function modelRelease(body) {
  const courseId = tidy(body.courseId, 24);
  if (!MENU[courseId]) return 400;
  const id = tidy(body.claimId, 40);
  const list = model.claims[courseId] || (model.claims[courseId] = []);
  const i = list.findIndex((c) => c.__id === id);
  if (i >= 0) list.splice(i, 1);
  return 200;
}

/* Compare ignoring the fields only the server can invent. */
const shape = (state) => {
  const out = {};
  /* Sorted, because JSON.stringify preserves insertion order and the two
     sides create their course entries at different moments. Order within
     a course is real and stays compared; order between courses is not. */
  const ids = Object.keys(state.claims || {}).sort();
  for (const id of ids) {
    const list = state.claims[id];
    if (!list || !list.length) continue;
    out[id] = list.map((c) => ({
      name: c.name, dish: c.dish || "", items: [...(c.items || [])],
      amount: c.amount || 0, note: c.note || "", mode: c.mode, key: c.key || "",
    }));
  }
  return JSON.stringify(out);
};

/* ---------------------------------------------------------- the run */

await call("/wipe", {});
let mismatches = 0;
let statusMismatches = 0;
const made = [];

for (let i = 0; i < OPS; i++) {
  let real, expected, what;

  if (rnd() < 0.12 && made.length) {
    const v = made.splice(Math.floor(rnd() * made.length), 1)[0];
    what = { kind: "release", courseId: v.courseId, claimId: v.id };
    expected = modelRelease({ courseId: v.courseId, claimId: v.modelId });
    // the model tracks its own ids, so mirror the removal by position
    const ml = model.claims[v.courseId] || [];
    const mi = ml.findIndex((c) => c.__id === v.modelId);
    if (mi >= 0) ml.splice(mi, 1);
    real = await call("/release", { courseId: v.courseId, claimId: v.id });
  } else {
    const id = pick(IDS);
    const course = MENU[id];
    const mode = pick(["cooking", "cooking", "buying", "money"]);
    const body = { courseId: id, name: pick(["Ann", "Bob", "Cy", "  Dee  ", "<b>Eve</b>", ""]),
                   mode, key: rnd() < 0.2 ? "reused" : "k" + i };
    if (mode === "money") body.amount = pick([20, 25, 0, 999, 1000, "x"]);
    else if (course.items) body.items = rnd() < 0.15 ? ["Nope"] : [pick(course.items)];
    else body.dish = pick(["Lasagna", ""]);
    if (rnd() < 0.2) body.note = "note";
    if (rnd() < 0.05) body.courseId = "ghost";

    what = { kind: "claim", ...body };
    expected = modelClaim(body);
    real = await call("/claim", body);

    /* Pair the two only when both sides appended. A repeated key answers
       200 while adding nothing, and pairing then would attach the id to an
       older claim — after which every release removes the wrong one. */
    if (real.status === 200 && expected === 200 && added) {
      const list = real.body.claims[body.courseId] || [];
      const mine = list[list.length - 1];
      const ml = model.claims[body.courseId] || [];
      const last = ml[ml.length - 1];
      if (mine && last) {
        last.__id = mine.id;
        made.push({ courseId: body.courseId, id: mine.id, modelId: mine.id });
      }
    }
  }

  if (real.status !== expected) {
    statusMismatches++;
    if (statusMismatches <= 5) {
      console.log(`\nstatus differs at op ${i}: book said ${real.status}, model said ${expected}`);
      console.log("  " + JSON.stringify(what));
    }
  }

  const bookState = real.body && real.body.claims ? real.body : (await call("/state")).body;
  if (shape(bookState) !== shape(model)) {
    mismatches++;
    if (mismatches <= 3) {
      console.log(`\nstate differs at op ${i} after ${JSON.stringify(what)}`);
      console.log("  book : " + shape(bookState).slice(0, 400));
      console.log("  model: " + shape(model).slice(0, 400));
    }
  }
}

await call("/wipe", {});

console.log(`\noperations        ${OPS}`);
console.log(`status mismatches ${statusMismatches}`);
console.log(`state mismatches  ${mismatches}`);
if (statusMismatches || mismatches) {
  console.log("\nFAILED — the book and an independent reading of the rules disagree.");
  process.exit(1);
}
console.log("\nPASS — the book matches a second, independent implementation exactly.");
