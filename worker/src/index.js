/* ============================================================
   The Book — state for "A Seat at the Table"
   One Durable Object holds every claim. Because a DO is
   single-threaded, two people hitting the last seat at the same
   moment can't both win: one gets the seat, one gets told.
   ============================================================ */

// Seat counts live here too. The browser can't be trusted with them.
const SEATS = {
  antipasto: 1, pane: 1, primo: 2, secondo: 2,
  insalata: 1, dolce: 1, vino: 1, bibite: 1,
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

    const body = await request.json().catch(() => ({}));
    const claims = await this.claims();
    const courseId = clean(body.courseId, 24);

    if (!SEATS[courseId]) {
      return new Response(JSON.stringify({ error: "no such course" }), { status: 400 });
    }
    const list = claims[courseId] || [];

    if (url.pathname === "/claim") {
      if (list.length >= SEATS[courseId]) {
        return new Response(JSON.stringify({ error: "taken" }), { status: 409 });
      }
      const name = clean(body.name, 60);
      if (!name) {
        return new Response(JSON.stringify({ error: "no name" }), { status: 400 });
      }
      list.push({
        id: crypto.randomUUID().slice(0, 8),
        name,
        dish: clean(body.dish, 60),
        note: clean(body.note, 120),
        mode: ["cooking", "buying", "money"].includes(body.mode) ? body.mode : "cooking",
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
    if (!["/state", "/claim", "/release"].includes(url.pathname)) {
      return json({ error: "not found" }, 404, origin);
    }

    // Everyone shares one book.
    const id = env.BOOK.idFromName("the-book");
    const res = await env.BOOK.get(id).fetch(request);
    const body = await res.json();
    return json(body, res.status, origin);
  },
};
