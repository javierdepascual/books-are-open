/* ============================================================
   The Kitchen — a read-only view of the book for whoever is running
   the night. It answers three questions and nothing else:
   what is still missing, what has been paid for, and who owes what.

   It shares courses.js with the invitation, so the two cannot disagree
   about what a course is or how big it is.
   ============================================================ */

const API = window.POTLUCK_API || "";
/* ?book=<name> reads a scratch book instead of the party's. Used to
   rehearse this page against made-up data without touching the real one. */
const BOOK = new URLSearchParams(location.search).get("book") || "";
const stateUrl = () => `${API}/state` + (BOOK ? `?book=${encodeURIComponent(BOOK)}` : "");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US");

const esc = (s) => String(s).replace(/[&<>"']/g, (m) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]
));

let state = { claims: {} };

const claimsFor = (c) => state.claims[c.id] || [];
const bringers  = (c) => claimsFor(c).filter((x) => x.mode !== "money");
const payers    = (c) => claimsFor(c).filter((x) => x.mode === "money");
const ownerOf   = (c, option) =>
  bringers(c).find((x) => (x.items || []).includes(option)) || null;

const takenCount = (c) =>
  c.pick === "list"
    ? c.options.filter((o) => ownerOf(c, o)).length
    : claimsFor(c).length;

/* What is not yet spoken for, expressed the way you'd chase it. */
function missingIn(course) {
  if (course.pick === "list") {
    return course.options.filter((o) => !ownerOf(course, o));
  }
  const free = course.seats - claimsFor(course).length;
  return free > 0 ? [free === 1 ? "one to cook it" : `${free} to cook it`] : [];
}

/* ---------------------------------------------------------- render */

function tiles() {
  const total = COURSES.reduce((n, c) => n + sizeOf(c), 0);
  const done = COURSES.reduce((n, c) => n + Math.min(takenCount(c), sizeOf(c)), 0);
  const cash = COURSES.reduce((n, c) =>
    n + payers(c).reduce((m, p) => m + (p.amount || 0), 0), 0);
  const people = new Set(
    COURSES.flatMap((c) => claimsFor(c).map((x) => x.name.trim().toLowerCase()))).size;
  const paidCourses = COURSES.filter((c) => payers(c).length).length;

  const cells = [
    [done + " of " + total, "things covered"],
    [total - done, (total - done) === 1 ? "still missing" : "still missing"],
    [money(cash), "chipped in"],
    [people, people === 1 ? "person on the list" : "people on the list"],
    [paidCourses, paidCourses === 1 ? "course on you" : "courses on you"],
  ];
  document.getElementById("k-tiles").innerHTML = cells.map(([big, small]) => `
    <div class="k-tile">
      <p class="k-tile-big">${esc(big)}</p>
      <p class="k-tile-small">${esc(small)}</p>
    </div>`).join("");
}

function missing() {
  const rows = COURSES
    .map((c) => ({ c, gaps: missingIn(c) }))
    .filter(({ gaps }) => gaps.length);

  const el = document.getElementById("k-missing");
  if (!rows.length) {
    el.innerHTML = `<p class="k-empty k-good">Nothing missing. The table is full.</p>`;
    return;
  }
  el.innerHTML = rows.map(({ c, gaps }) => `
    <div class="k-row">
      <p class="k-row-name">${esc(c.name)} <span class="k-row-gloss">${esc(c.gloss)}</span></p>
      <ul class="k-gaps">${gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
    </div>`).join("");
}

function moneyIn() {
  const rows = [];
  COURSES.forEach((c) => payers(c).forEach((p) => rows.push({ c, p })));
  rows.sort((a, b) => (b.p.amount || 0) - (a.p.amount || 0));

  const el = document.getElementById("k-money");
  if (!rows.length) {
    el.innerHTML = `<p class="k-empty">Nobody has chipped in yet.</p>`;
    return;
  }
  const total = rows.reduce((n, r) => n + (r.p.amount || 0), 0);
  el.innerHTML = `
    <table class="k-table">
      <thead><tr><th>Who</th><th>Toward</th><th class="k-num">Amount</th></tr></thead>
      <tbody>
        ${rows.map(({ c, p }) => `
          <tr>
            <td>${esc(p.name)}</td>
            <td>${esc(c.name)}</td>
            <td class="k-num">${esc(money(p.amount))}</td>
          </tr>`).join("")}
      </tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="k-num">${esc(money(total))}</td></tr></tfoot>
    </table>`;
}

function jackysList() {
  const el = document.getElementById("k-jacky");
  const rows = COURSES.filter((c) => payers(c).length);
  if (!rows.length) {
    el.innerHTML = `<p class="k-empty">Nothing on you so far.</p>`;
    return;
  }
  el.innerHTML = rows.map((c) => {
    const paid = payers(c);
    const sum = paid.reduce((n, p) => n + (p.amount || 0), 0);
    const names = paid.map((p) => esc(p.name)).join(", ");
    const choices = c.pick === "one"
      ? c.options.slice(0, 4).join(" &middot; ")
      : c.options.join(" &middot; ");
    return `
      <div class="k-row">
        <p class="k-row-name">${esc(c.name)}
          <span class="k-row-gloss">${esc(c.gloss)}</span>
          <span class="k-badge">${esc(money(sum))}</span>
        </p>
        <p class="k-row-sub">Paid by ${names}</p>
        <p class="k-row-sub k-dim">${choices}</p>
      </div>`;
  }).join("");
}

function people() {
  const by = new Map();
  COURSES.forEach((c) => claimsFor(c).forEach((x) => {
    const key = x.name.trim();
    if (!by.has(key)) by.set(key, { bringing: [], paid: 0, notes: [] });
    const rec = by.get(key);
    if (x.mode === "money") {
      rec.paid += x.amount || 0;
      rec.bringing.push({ text: `${c.name} (paid)`, paid: true });
    } else if ((x.items || []).length) {
      x.items.forEach((i) => rec.bringing.push({ text: i, paid: false }));
    } else {
      rec.bringing.push({ text: x.dish || c.name, paid: false });
    }
    if (x.note) rec.notes.push(x.note);
  }));

  const el = document.getElementById("k-people");
  if (!by.size) {
    el.innerHTML = `<p class="k-empty">Nobody has sworn to anything yet.</p>`;
    return;
  }
  el.innerHTML = [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, rec]) => `
      <div class="k-person">
        <p class="k-person-name">${esc(name)}
          ${rec.paid ? `<span class="k-badge">${esc(money(rec.paid))}</span>` : ""}
        </p>
        <ul class="k-brings">
          ${rec.bringing.map((b) =>
            `<li${b.paid ? ' class="k-dim"' : ""}>${esc(b.text)}</li>`).join("")}
        </ul>
        ${rec.notes.length
          ? `<p class="k-row-sub k-dim">${rec.notes.map(esc).join(" &middot; ")}</p>` : ""}
      </div>`).join("");
}

function courses() {
  document.getElementById("k-courses").innerHTML = COURSES.map((c) => {
    const size = sizeOf(c);
    const taken = Math.min(takenCount(c), size);
    const full = taken >= size;

    const lines = c.pick === "list"
      ? c.options.map((o) => {
          const who = ownerOf(c, o);
          return `<li><span>${esc(o)}</span><span class="${who ? "k-who" : "k-open"}">${
            who ? esc(who.name) : "open"}</span></li>`;
        }).join("")
      : claimsFor(c).map((x) => `
          <li><span>${esc(x.mode === "money" ? "paid for" : (x.dish || c.name))}</span>
              <span class="k-who">${esc(x.name)}</span></li>`).join("")
        + Array.from({ length: Math.max(0, c.seats - claimsFor(c).length) },
            () => `<li><span class="k-dim">seat open</span><span class="k-open">&mdash;</span></li>`).join("");

    return `
      <div class="k-course${full ? " is-full" : ""}">
        <p class="k-course-head">
          <span class="k-course-name">${esc(c.name)}</span>
          <span class="k-course-count">${taken}/${size}</span>
        </p>
        <ul class="k-lines">${lines}</ul>
      </div>`;
  }).join("");
}

function paint() {
  tiles(); missing(); moneyIn(); jackysList(); people(); courses();
}

/* ---------------------------------------------------------- data */

async function load() {
  const stamp = document.getElementById("k-when");
  try {
    const res = await fetch(stateUrl(), { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    state = await res.json();
    if (!state || typeof state !== "object" || !state.claims) state = { claims: {} };
    paint();
    stamp.textContent = "Read just now. Refreshes on its own every 20 seconds.";
    stamp.classList.remove("k-stale");
  } catch (e) {
    stamp.textContent = "Couldn't reach the book. Showing whatever was last read.";
    stamp.classList.add("k-stale");
  }
}

load();
setInterval(() => { if (!document.hidden) load(); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
