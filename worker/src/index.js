/* ============================================================
   The Book — state for "The Oath"
   One Durable Object holds every claim. Because a DO is
   single-threaded, two people hitting the last seat at the same
   moment can't both win: one gets it, one gets told.

   Two kinds of course:
     seats  — a dish somebody cooks. N parties, first come first served.
     items  — a spread built from parts. Each line is claimed separately,
              so four people can each bring one thing, and one person can
              bring three. The name shows against the line.
   ============================================================ */

// The rules live here as well as in the browser. The browser can't be trusted.
const COURSES = {
  pane:     { seats: 1 },
  primo:    { seats: 2 },
  secondo:  { seats: 2 },
  insalata: { seats: 1 },
  dolce:    { seats: 1 },

  antipasto: { items: [
    "Salami, prosciutto, cheeses, mozzarella",
    "Olives, roasted peppers, artichokes",
    "Crackers and bread",
  ] },
  vino: { items: [
    "Three bottles of red",
    "One bottle of white, rosé or Prosecco",
  ] },
  bibite: { items: [
    "Sparkling water",
    "Italian sodas, regular sodas",
    "Ice",
    "Lemons and oranges",
  ] },
};

const ALLOWED = [
  /^https:\/\/[a-z0-9-]+\.github\.io$/i,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

function corsHeaders(origin) {
  const ok = origin && ALLOWED.some((re) => re.test(origin));
  return {
    "access-control-allow-origin": ok ? origin : "null",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

// Drop control characters and angle brackets. The front end escapes on
// render too; this is belt and braces.
const clean = (v, max) =>
  String(v == null ? "" : v).replace(/[\u0000-\u001F<>]/g, "").trim().slice(0, max);

export class Book {
  constructor(ctx) { this.ctx = ctx; }

  async claims() {
    return (await this.ctx.storage.get("claims")) || {};
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/state") {
      return new Response(JSON.stringify({ claims: await this.claims() }), {
        headers: { "content-type": "application/json" },
      });
    }

    /* Only scratch books ever get here; the router refuses to forward
       /wipe for the real one. */
    if (url.pathname === "/wipe") {
      await this.ctx.storage.deleteAll();
      return new Response(JSON.stringify({ claims: {} }), {
        headers: { "content-type": "application/json" },
      });
    }

    const body = await request.json().catch(() => ({}));
    const claims = await this.claims();
    const courseId = clean(body.courseId, 24);

    const course = COURSES[courseId];
    if (!course) {
      return new Response(JSON.stringify({ error: "no such course" }), { status: 400 });
    }
    const list = claims[courseId] || [];

    if (url.pathname === "/claim") {
      /* One attempt carries one key. If the answer to it was lost and the
         guest tries again, or a nervous finger fires the form twice, the
         key is the same and the claim must not happen twice. */
      const key = clean(body.key, 40);
      if (key && list.some((c) => c.key === key)) {
        return new Response(JSON.stringify({ claims }), {
          headers: { "content-type": "application/json" },
        });
      }

      const name = clean(body.name, 60);
      if (!name) {
        return new Response(JSON.stringify({ error: "no name" }), { status: 400 });
      }

      const mode = ["cooking", "buying", "money"].includes(body.mode)
        ? body.mode : "cooking";

      /* Chipping in means Jacky buys and makes it, so on a cooked course
         the money fills the seat: it really will be on the table. On a list
         course you don't pick lines, so it can't hold any. */
      const paying = mode === "money";
      let items = [];
      let amount = 0;

      if (paying) {
        amount = Math.round(Number(body.amount));
        if (!Number.isFinite(amount) || amount < 1 || amount > 999) {
          return new Response(JSON.stringify({ error: "bad amount" }), { status: 400 });
        }
        // Paying for a cooked course still takes the seat, so it still has
        // to queue for one. Only list courses let money in without a limit.
        if (course.seats && list.length >= course.seats) {
          return new Response(JSON.stringify({ error: "taken" }), { status: 409 });
        }
      } else if (course.items) {
        items = Array.isArray(body.items)
          ? body.items.map((i) => clean(i, 80)).filter(Boolean)
          : [];
        if (!items.length) {
          return new Response(JSON.stringify({ error: "no items" }), { status: 400 });
        }
        if (items.some((i) => !course.items.includes(i))) {
          return new Response(JSON.stringify({ error: "unknown item" }), { status: 400 });
        }
        // Whoever got here first owns the line.
        const spoken = new Set(list.filter((c) => c.mode !== "money")
                                   .flatMap((c) => c.items || []));
        if (items.some((i) => spoken.has(i))) {
          return new Response(JSON.stringify({ error: "taken" }), { status: 409 });
        }
      } else if (list.length >= course.seats) {
        // Money on a cooked course means Jacky makes it, so it fills the seat.
        return new Response(JSON.stringify({ error: "taken" }), { status: 409 });
      }

      list.push({
        id: crypto.randomUUID().slice(0, 8),
        key,
        name,
        dish: paying ? "" : clean(body.dish, 60),
        items,
        amount,
        note: clean(body.note, 120),
        mode,
        at: Date.now(),
      });
      claims[courseId] = list;
      await this.ctx.storage.put("claims", claims);
      return new Response(JSON.stringify({ claims }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/release") {
      const claimId = clean(body.claimId, 40);
      claims[courseId] = list.filter((c) => c.id !== claimId);
      await this.ctx.storage.put("claims", claims);
      return new Response(JSON.stringify({ claims }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    /* Scratch books for the soak tests. ?book=foo works on "scratch:foo",
       which can never collide with the real one, and only a scratch book
       will answer /wipe. The party's book is not erasable over HTTP. */
    const scratch = (url.searchParams.get("book") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 24);
    const bookName = scratch ? `scratch:${scratch}` : "the-book";

    if (url.pathname === "/wipe" && !scratch) {
      return json({ error: "the real book cannot be wiped" }, 403, origin);
    }

    if (!["/state", "/claim", "/release", "/wipe"].includes(url.pathname)) {
      return json({ error: "not found" }, 404, origin);
    }

    const id = env.BOOK.idFromName(bookName);
    const res = await env.BOOK.get(id).fetch(request);
    const body = await res.json();
    return json(body, res.status, origin);
  },
};
