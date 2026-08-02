/* ============================================================
   config/event.json is the only place a course name is written.
   This copies it into the two places that need it — the browser and
   the worker — so they cannot drift apart. They drifted once, and a
   rule fixed on one side stayed broken on the other.

   Run after editing the config:  node tools/build-config.mjs
   ============================================================ */

import { readFileSync, writeFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));

const q = (s) => JSON.stringify(s);
const stamp = "/* GENERATED from config/event.json — do not edit by hand.\n" +
              "   Change the config and run: node tools/build-config.mjs */\n";

/* ---- the browser -------------------------------------------------- */
const courses = cfg.courses.map((c) => `  {
    id: ${q(c.id)}, numeral: ${q(c.numeral)}, name: ${q(c.name)},
    gloss: ${q(c.gloss)}, seats: ${c.seats}, pick: ${q(c.pick)},
    options: [
${c.options.map((o) => `      ${q(o)},`).join("\n")}
    ],
  },`).join("\n");

writeFileSync(new URL("../docs/courses.js", import.meta.url), `${stamp}
const PARTY = {
  host:    ${q(cfg.event.eyebrow)},
  name:    ${q(cfg.event.dek)},
  when:    ${q(cfg.event.when)},
  time:    ${q(cfg.event.time)},
  where:   ${q(cfg.event.where)},
  signoff: ${q(cfg.event.signoff)},
};

const WORDS = ${JSON.stringify(cfg.words, null, 2).replace(/\n/g, "\n")};

const MONEY = ${JSON.stringify(cfg.money, null, 2).replace(/\n/g, "\n")};

const MODES = [
${cfg.modes.map((m) => `  { id: ${q(m.id)}, label: ${q(m.label)} },`).join("\n")}
];

/* Menu order, because a menu is a real sequence.
   seats: how many parties share a cooked course. A couple counts as one. */
const COURSES = [
${courses}
];

/* A list course is covered line by line, so its size is its number of
   lines. A cooked course is covered by parties. */
const sizeOf = (c) => (c.pick === "list" ? c.options.length : c.seats);
const BY_ID = Object.fromEntries(COURSES.map((c) => [c.id, c]));
`);

/* ---- the worker: only the rules, never the wording ----------------- */
const rules = cfg.courses.map((c) => c.pick === "list"
  ? `  ${c.id}: { items: [\n${c.options.map((o) => `    ${q(o)},`).join("\n")}\n  ] },`
  : `  ${c.id}: { seats: ${c.seats} },`).join("\n");

writeFileSync(new URL("../worker/src/menu.js", import.meta.url), `${stamp}
/* The rules live here as well as in the browser, because the browser is
   not the authority. Both come from the same config, so they agree. */
export const COURSES = {
${rules}
};
`);

console.log(`config → docs/courses.js and worker/src/menu.js`);
console.log(`  ${cfg.courses.length} courses, ` +
  `${cfg.courses.reduce((n, c) => n + (c.pick === "list" ? c.options.length : c.seats), 0)} things to bring`);
