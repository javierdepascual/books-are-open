/* ============================================================
   The Oath
   Static front end. State lives in a Cloudflare Durable Object.
   With no API configured it falls back to this browser only,
   which is enough to look at the thing but not to share it.
   ============================================================ */

const API = window.POTLUCK_API || "";
/* ?book=<name> points every call at a scratch book, for rehearsals. */
const BOOK = new URLSearchParams(location.search).get("book") || "";
const api = (path) => `${API}${path}` + (BOOK ? `?book=${encodeURIComponent(BOOK)}` : "");

/* Marks the write-in radio. Never stored: it is swapped for the typed dish. */
const OTHER = "__other__";

const PARTY = {
  host:    "By invitation",
  name:    "An Italian potluck. Eight courses, one table.",
  when:    "Monday, August 17",
  time:    "7:30 pm",
  where:   "Sandra's place, Gardena",
  signoff: "",
};

const TOTAL_SEATS = COURSES.reduce((n, c) => n + sizeOf(c), 0);

// Who has already spoken for each line of a list course.
function bringers(course) {
  return (state.claims[course.id] || []).filter((c) => c.mode !== "money");
}
function payers(course) {
  return (state.claims[course.id] || []).filter((c) => c.mode === "money");
}
function ownerOf(course, option) {
  return bringers(course).find((c) => (c.items || []).includes(option)) || null;
}
const takenCount = (course) =>
  course.pick === "list"
    ? course.options.filter((o) => ownerOf(course, o)).length
    : (state.claims[course.id] || []).length;

let state = { claims: {} };   // { [courseId]: [ {id, name, dish, note, mode} ] }
let openForm = null;          // courseId whose form is expanded
let sealed = new Set();       // courses already stamped, so we only animate new ones
let lit = new Set();          // courses already on paper, same reason
let lastTaken = null;         // so the tally only reacts when it actually moves
let firstPaint = true;

/* ---------------------------------------------------------- transport */

async function fetchState() {
  if (!API) return local.read();
  const res = await fetch(api("/state"), { cache: "no-store" });
  if (!res.ok) throw new Error("state");
  return res.json();
}

async function postClaim(payload) {
  if (!API) return local.claim(payload);
  const res = await fetch(api("/claim"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "failed");
  return body;
}

async function postRelease(payload) {
  if (!API) return local.release(payload);
  const res = await fetch(api("/release"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "failed");
  return body;
}

/* Browser-only fallback so the page is never dead. */
const local = {
  key: "the-oath",
  read() {
    try { return JSON.parse(localStorage.getItem(this.key)) || { claims: {} }; }
    catch { return { claims: {} }; }
  },
  write(s) { localStorage.setItem(this.key, JSON.stringify(s)); return s; },
  claim({ courseId, name, dish, items, note, mode }) {
    const s = this.read();
    const course = BY_ID[courseId];
    const list = s.claims[courseId] || (s.claims[courseId] = []);
    if (course.pick === "list") {
      const spoken = new Set(list.flatMap((c) => c.items || []));
      if ((items || []).some((i) => spoken.has(i))) throw new Error("taken");
    } else if (list.length >= course.seats) {
      throw new Error("taken");
    }
    list.push({ id: String(list.length) + name, name, dish, items: items || [], note, mode });
    return this.write(s);
  },
  release({ courseId, claimId }) {
    const s = this.read();
    s.claims[courseId] = (s.claims[courseId] || []).filter((c) => c.id !== claimId);
    return this.write(s);
  },
};

/* ---------------------------------------------------------- render */

const $courses = document.getElementById("courses");

function seatsTaken() {
  return COURSES.reduce((n, c) => n + Math.min(takenCount(c), sizeOf(c)), 0);
}

function statusFor(course) {
  const taken = takenCount(course);
  const size = sizeOf(course);
  const left = size - taken;
  if (taken === 0) {
    if (course.pick === "list") return { state: "open", label: `${size} to bring` };
    return { state: "open", label: course.seats > 1 ? "Two seats" : "Open" };
  }
  if (left > 0) {
    return { state: "partial", label: left === 1 ? "One left" : `${left} left` };
  }
  return { state: "full", label: "Made" };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]
  ));
}

function seal(course) {
  const ringId = `ring-${course.id}`;
  return `
  <svg class="seal" viewBox="0 0 120 120" aria-hidden="true">
    <defs><path id="${ringId}" d="M60,60 m-42,0 a42,42 0 1,1 84,0 a42,42 0 1,1 -84,0"/></defs>
    <circle cx="60" cy="60" r="55.5" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" stroke-width="0.9"/>
    <circle cx="60" cy="60" r="33" fill="none" stroke="currentColor" stroke-width="0.9"/>
    <text class="seal-ring">
      <textPath href="#${ringId}" startOffset="25%" text-anchor="middle">SWORN IN</textPath>
    </text>
    <text class="seal-ring">
      <textPath href="#${ringId}" startOffset="75%" text-anchor="middle">THE OATH</textPath>
    </text>
    <text class="seal-numeral" x="60" y="71" text-anchor="middle">${course.numeral}</text>
  </svg>`;
}

function optionLines(course) {
  if (course.pick === "one") {
    // Once the seats are taken and the dish is chosen, the alternatives
    // are just noise.
    if (takenCount(course) >= course.seats) return "";
    const lines = course.options.map((o) => `
      <li class="option">
        <span class="option-mark">&#8226;</span>
        <span>${esc(o)}</span>
        <span class="option-rule"></span>
      </li>`).join("");
    return `<ul class="options">${lines}</ul>`;
  }

  // A list course is a ledger: every line shows who is bringing it.
  const lines = course.options.map((o) => {
    const owner = ownerOf(course, o);
    return `
      <li class="option${owner ? " is-taken" : ""}">
        <span class="option-mark">${owner ? "&#10003;" : "&#8226;"}</span>
        <span>${esc(o)}</span>
        <span class="option-rule"></span>
        <span class="option-owner">${owner ? esc(owner.name) : "open"}</span>
      </li>`;
  }).join("");
  return `<ul class="options">${lines}</ul>`;
}

function seatRows(course) {
  const claims = state.claims[course.id] || [];
  const rows = [];

  // On a list course the names already sit against their lines, so the
  // record only has to carry the note, the mode, and a way out.
  if (course.pick === "list") {
    if (!claims.length) return "";
    return `<div class="record">${claims.map((c) => {
      const mode = MODES.find((m) => m.id === c.mode);
      return `
        <div class="seat">
          <p class="seat-name">${esc(c.name)}</p>
          ${c.mode === "money" ? `<p class="seat-dish">$${esc(c.amount || 0)} toward it</p>` : ""}
          ${c.note ? `<p class="seat-note">${esc(c.note)}</p>` : ""}
          ${c.mode === "money" ? `<span class="seat-mode">Jacky brings it</span>`
             : mode && mode.id !== "cooking" ? `<span class="seat-mode">${esc(mode.label)}</span>` : ""}
          <button class="seat-strike" data-strike="${esc(course.id)}" data-claim="${esc(c.id)}">break the oath</button>
        </div>`;
    }).join("")}</div>`;
  }

  claims.forEach((c) => {
    const mode = MODES.find((m) => m.id === c.mode);
    const paid = c.mode === "money";
    rows.push(`
      <div class="seat">
        <p class="seat-name">${esc(c.name)}</p>
        ${paid ? `<p class="seat-dish">$${esc(c.amount || 0)} toward it</p>` : ""}
        ${c.dish ? `<p class="seat-dish">${esc(c.dish)}</p>` : ""}
        ${c.note ? `<p class="seat-note">${esc(c.note)}</p>` : ""}
        ${paid ? `<span class="seat-mode">Jacky brings it</span>`
               : mode && mode.id !== "cooking" ? `<span class="seat-mode">${esc(mode.label)}</span>` : ""}
        <button class="seat-strike" data-strike="${esc(course.id)}" data-claim="${esc(c.id)}">break the oath</button>
      </div>`);
  });

  for (let i = claims.length; i < course.seats; i++) {
    rows.push(`<div class="seat"><p class="seat-empty">Seat still open</p></div>`);
  }

  // Nothing claimed yet: no ledger, keep the card quiet.
  return claims.length ? `<div class="record">${rows.join("")}</div>` : "";
}

function claimForm(course) {
  if (takenCount(course) >= sizeOf(course)) return "";

  const isOpen = openForm === course.id;

  // On a list course you tick whatever you're bringing, and you can tick
  // more than one. Lines somebody else already took aren't offered.
  const free = course.pick === "list"
    ? course.options.filter((o) => !ownerOf(course, o))
    : [];

  const ticks = course.pick === "list" ? `
    <div class="field">
      <span class="field-label">What you'll bring</span>
      <div class="picks">
        ${free.map((o) => `
          <label class="pick">
            <input type="checkbox" name="item-${course.id}" value="${esc(o)}">
            <span class="pick-box"></span>
            <span>${esc(o)}</span>
          </label>`).join("")}
      </div>
      <p class="hint">Tick everything you're bringing</p>
    </div>` : "";

  const picks = course.pick === "one" ? `
    <div class="field">
      <span class="field-label">What you'll bring</span>
      <div class="picks">
        ${course.options.map((o, i) => `
          <label class="pick">
            <input type="radio" name="dish-${course.id}" value="${esc(o)}"${i === 0 ? " checked" : ""}>
            <span class="pick-box"></span>
            <span>${esc(o)}</span>
          </label>`).join("")}
        <label class="pick">
          <input type="radio" name="dish-${course.id}" value="${OTHER}">
          <span class="pick-box"></span>
          <span>Something else</span>
        </label>
      </div>
      <div class="other" data-other hidden>
        <input type="text" name="other" maxlength="60" placeholder="What are you bringing?">
        <p class="hint">Keep it Italian.</p>
      </div>
    </div>` : "";

  return `
    <div class="course-action">
      <button class="put-name" data-open="${esc(course.id)}"${isOpen ? " hidden" : ""}>
        Take the oath
      </button>

      <form class="claim-form" data-form="${esc(course.id)}"${isOpen ? "" : " hidden"}>
        <div class="field">
          <span class="field-label">Who's bringing it</span>
          <input type="text" name="name" maxlength="60" required
                 placeholder="Your name, or both names" autocomplete="name">
        </div>

        ${picks}
        ${ticks}

        <div class="field money" data-money hidden>
          <span class="field-label">How much</span>
          <div class="amounts">
            ${[20, 25, 30].map((v, i) => `
              <label class="amount">
                <input type="radio" name="amount-${course.id}" value="${v}"${i === 0 ? " checked" : ""}>
                <span>$${v}</span>
              </label>`).join("")}
            <label class="amount amount-other">
              <input type="radio" name="amount-${course.id}" value="other">
              <span>Other</span>
            </label>
          </div>
          <input type="number" name="amountOther" min="1" max="999" step="1"
                 placeholder="$" class="amount-input" hidden>
          <p class="hint">$20 is the going rate. Jacky buys and makes it.</p>
        </div>

        <div class="field">
          <span class="field-label">How</span>
          <div class="modes">
            ${MODES.map((m, i) => `
              <label class="mode">
                <input type="radio" name="mode-${course.id}" value="${m.id}"${i === 0 ? " checked" : ""}>
                <span>${esc(m.label)}</span>
              </label>`).join("")}
          </div>
        </div>

        <div class="field">
          <span class="field-label">Anything else</span>
          <input type="text" name="note" maxlength="120"
                 placeholder="Optional. Bringing plates, going gluten free, whatever.">
        </div>

        <p class="form-error" data-error hidden></p>

        <div class="form-actions">
          <button type="submit" class="commit">Swear to it</button>
          <button type="button" class="never-mind" data-close>Never mind</button>
        </div>
      </form>
    </div>`;
}

function render() {
  const taken = seatsTaken();
  const counter = document.querySelector(".tally-count");
  document.getElementById("tally-num").textContent = taken;
  document.getElementById("tally-total").textContent = TOTAL_SEATS;
  if (lastTaken !== null && taken > lastTaken && counter) {
    counter.classList.remove("is-ticking");
    void counter.offsetWidth;                  // restart the animation
    counter.classList.add("is-ticking");
  }
  lastTaken = taken;

  $courses.innerHTML = COURSES.map((course, i) => {
    const st = statusFor(course);
    const printed = (state.claims[course.id] || []).length > 0;
    const isFull = st.state === "full";
    const fresh = isFull && !sealed.has(course.id) && !firstPaint;
    const newlyLit = printed && !lit.has(course.id) && !firstPaint;
    if (isFull) sealed.add(course.id); else sealed.delete(course.id);
    if (printed) lit.add(course.id); else lit.delete(course.id);

    return `
      <li class="course${printed ? " is-printed" : ""}${fresh ? " is-stamped" : newlyLit ? " is-lit" : ""}"${firstPaint ? ` style="animation-delay:${i * 55}ms"` : ""}>
        ${isFull ? seal(course).replace("class=\"seal\"", `class="seal${fresh ? " is-fresh" : ""}"`) : ""}
        <div class="course-head">
          <p class="credit">
            <span class="numeral">${course.numeral}</span>
            <span class="course-gloss">${esc(course.gloss)}</span>
          </p>
          <span class="status" data-state="${st.state}">${st.label}</span>
        </div>
        <h2 class="course-name">${esc(course.name)}</h2>
        ${optionLines(course)}
        ${seatRows(course)}
        ${claimForm(course)}
      </li>`;
  }).join("");

  if (openForm) {
    const form = $courses.querySelector(`[data-form="${openForm}"]`);
    if (form) {
      /* Scroll it into view but do NOT focus. A programmatic focus leaves the
         gold :focus-visible ring stuck around the name field, and on a phone
         it throws the keyboard up before anyone asked for it. */
      form.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  firstPaint = false;
}

/* ---------------------------------------------------------- particulars */

function paintParticulars() {
  document.getElementById("host-line").textContent = PARTY.host;
  document.getElementById("party-line").textContent = PARTY.name;
  const sig = document.getElementById("handled-sig");
  sig.textContent = PARTY.signoff;
  sig.hidden = !PARTY.signoff;
  document.getElementById("particulars").innerHTML = [
    ["Day", PARTY.when],
    ["Time", PARTY.time],
    ["Place", PARTY.where],
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

/* ---------------------------------------------------------- events */

let toastTimer;
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("is-up");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-up"), 3600);
}

$courses.addEventListener("click", async (e) => {
  const open = e.target.closest("[data-open]");
  if (open) { openForm = open.dataset.open; render(); return; }

  const close = e.target.closest("[data-close]");
  if (close) { openForm = null; render(); return; }

  const strike = e.target.closest("[data-strike]");
  if (strike) {
    const courseId = strike.dataset.strike;
    const claimId = strike.dataset.claim;
    const claim = (state.claims[courseId] || []).find((c) => c.id === claimId);
    if (!claim) return;
    const typed = prompt(`Type the name exactly as written to break the oath:\n\n${claim.name}`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== claim.name.trim().toLowerCase()) {
      toast("That name doesn't match. Nothing was changed.");
      return;
    }
    try {
      state = await postRelease({ courseId, claimId });
      render();
      toast("The oath is broken. That seat is open again.");
    } catch { toast("Couldn't reach the book. Try again."); }
  }
});

$courses.addEventListener("change", (e) => {
  const dish = e.target.closest('input[type="radio"][name^="dish-"]');
  if (dish) {
    const box = dish.closest(".field").querySelector("[data-other]");
    if (box) {
      box.hidden = dish.value !== OTHER;
      if (!box.hidden) box.querySelector("input").focus();
    }
  }

  // Chipping in means you're not bringing a thing, so stop asking which.
  const mode = e.target.closest('input[type="radio"][name^="mode-"]');
  if (mode) {
    const form = mode.closest("form");
    const paying = mode.value === "money";
    form.querySelectorAll(".picks").forEach((p) => {
      const field = p.closest(".field");
      if (field) field.hidden = paying;
    });
    const money = form.querySelector("[data-money]");
    if (money) money.hidden = !paying;
  }

  const amount = e.target.closest('input[type="radio"][name^="amount-"]');
  if (amount) {
    const box = amount.closest(".field").querySelector(".amount-input");
    if (box) {
      box.hidden = amount.value !== "other";
      if (!box.hidden) box.focus();
    }
  }
});

$courses.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();

  const courseId = form.dataset.form;
  const course = BY_ID[courseId];
  const err = form.querySelector("[data-error]");
  const button = form.querySelector(".commit");

  const name = form.elements.name.value.trim();
  if (!name) {
    err.textContent = "Needs a name. Otherwise nobody knows who's bringing it.";
    err.hidden = false;
    return;
  }

  const dishInput = form.querySelector(`input[name="dish-${courseId}"]:checked`);
  const modeInput = form.querySelector(`input[name="mode-${courseId}"]:checked`);

  const modeInputEarly = form.querySelector(`input[name="mode-${courseId}"]:checked`);
  const paying = modeInputEarly && modeInputEarly.value === "money";

  let amount = 0;
  if (paying) {
    const picked = form.querySelector(`input[name="amount-${courseId}"]:checked`);
    amount = picked && picked.value === "other"
      ? Math.round(Number(form.elements.amountOther.value))
      : Math.round(Number(picked ? picked.value : 20));
    if (!Number.isFinite(amount) || amount < 1 || amount > 999) {
      err.textContent = "Put in an amount between $1 and $999.";
      err.hidden = false;
      return;
    }
  }

  const items = paying ? [] :
    [...form.querySelectorAll(`input[name="item-${courseId}"]:checked`)]
      .map((i) => i.value);
  if (!paying && course.pick === "list" && !items.length) {
    err.textContent = "Tick at least one thing, or nobody knows what you're bringing.";
    err.hidden = false;
    return;
  }

  let dish = paying ? "" : (dishInput ? dishInput.value : "");
  if (dish === OTHER) {
    dish = form.elements.other.value.trim();
    if (!dish) {
      err.textContent = "Say what you're bringing, then we'll write it down.";
      err.hidden = false;
      return;
    }
  }

  const payload = {
    courseId,
    name,
    dish,
    items,
    amount,
    note: form.elements.note.value.trim(),
    mode: modeInput ? modeInput.value : "cooking",
  };

  err.hidden = true;
  button.disabled = true;
  button.textContent = "Swearing you in…";

  try {
    state = await postClaim(payload);
    openForm = null;
    render();
    toast(paying
      ? `${name} — $${amount} toward ${course.name}. A friend of ours.`
      : course.pick === "list"
        ? `${name} — ${items.join(", ")}. A friend of ours.`
        : `${name} — ${course.name}. A friend of ours.`);
  } catch (ex) {
    button.disabled = false;
    button.textContent = "Swear to it";
    err.textContent = ex.message === "taken"
      ? "Somebody swore to that one first. Pick another course."
      : "Couldn't reach the book. Try again in a second.";
    err.hidden = false;
    if (ex.message === "taken") { await refresh(); }
  }
});

/* ---------------------------------------------------------- polling */

async function refresh() {
  try {
    const next = await fetchState();
    // Don't yank a form out from under someone mid-typing.
    if (JSON.stringify(next) !== JSON.stringify(state)) {
      state = next;
      render();
    }
  } catch { /* stay with what we have */ }
}

/* ?demo shows the page half full, for looking at it. Never writes anywhere. */
const DEMO = {
  claims: {
    antipasto: [
      { id: "d1", name: "Marco & Elena", items: ["Salami, prosciutto, cheeses, mozzarella"], note: "Bringing a wooden board too", mode: "buying" },
      { id: "d5", name: "Nick", items: ["Crackers and bread"], note: "", mode: "buying" },
    ],
    vino: [{ id: "d6", name: "Javi & Jacky", items: ["Three bottles of red"], note: "", mode: "buying" }],
    primo: [{ id: "d2", name: "Javi & Jacky", dish: "Lasagna", note: "", mode: "cooking" }],
    dolce: [{ id: "d3", name: "Sandra", dish: "Tiramisu", note: "Made the night before", mode: "cooking" }],
    secondo: [{ id: "d4", name: "Nick", dish: "Chicken Parmesan", note: "", mode: "cooking" }],
  },
};

/* Without the book, claims never leave this browser. Say so loudly:
   a sign-up sheet that silently forgets is worse than none. */
function warnIfNotShared() {
  if (API) return;
  const el = document.createElement("p");
  el.className = "not-shared";
  el.textContent = "Not connected to the book yet. Anything you write here stays on this phone and nobody else can see it.";
  document.querySelector("main").prepend(el);
}

/* The match burns once per visitor, and only if they let it. */
function strikeMatch() {
  const intro = document.getElementById("intro");
  if (!intro) return;
  if (document.documentElement.classList.contains("no-intro")) { intro.remove(); return; }

  document.body.classList.add("intro-running");
  let done = false;
  const snuff = () => {
    if (done) return;
    done = true;
    intro.classList.add("is-done");
    document.body.classList.remove("intro-running");
    setTimeout(() => intro.remove(), 900);
    try { localStorage.setItem("the-oath-intro", "1"); } catch (e) { /* private mode */ }
  };

  setTimeout(snuff, 3600);
  intro.addEventListener("click", snuff);
  addEventListener("keydown", snuff, { once: true });
}

async function boot() {
  strikeMatch();
  paintParticulars();
  warnIfNotShared();
  const params = new URLSearchParams(location.search);
  if (params.has("form")) openForm = params.get("form");   // for eyeballing a form
  if (params.has("demo")) {
    state = DEMO; render(); return;
  }
  try { state = await fetchState(); } catch { state = { claims: {} }; }
  render();
  setInterval(() => { if (!openForm && !document.hidden) refresh(); }, 6000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !openForm) refresh(); });
}

boot();
