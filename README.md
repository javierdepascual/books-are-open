# The Oath

**Live:** https://javierdepascual.github.io/the-oath/
**Short link:** https://tinyurl.com/the-oath-party

A potluck sign-up for an Italian dinner on Monday 17 August, 7:30 pm.
Eight courses, ten seats. Anyone with the link can swear to one; nobody
can take the same seat twice.

- `docs/` — the page itself. Static, served by GitHub Pages.
- `worker/` — the book. A Cloudflare Worker with one Durable Object holding
  every claim. Single-threaded, so two people racing for the last seat can't
  both win.
- `docs/kitchen.html` — read-only dashboard for whoever runs the night.
- `tools/` — the harnesses. Everything writes to scratch books via
  `?book=<name>`; the real book has no wipe endpoint and is never touched.

## Checking it still works

    node tools/soak.mjs    <api> 300 <seed>   # invariants under random load
    node tools/model.mjs   <api> 200 <seed>   # differential vs a second implementation
    node tools/shrink.mjs  <api> 25 24        # property-based, shrinks a failure
    node tools/safari.mjs                     # WebKit on an iPhone
    node tools/flaky.mjs                      # slow, dropped and lost-reply requests
    node tools/access.mjs                     # contrast, keyboard, announcements
    node tools/party.mjs                      # eleven guests on eleven phones

`soak` prints the confidence it earned: with zero failures in N
operations, the upper bound on the per-operation failure rate at 98%
confidence is `1 - 0.02^(1/N)`.

Faults these found, none of which were visible by using the page:
paying for a cooked course skipped the seat check, so single-seat
courses were oversold; a retry after a lost reply took a second seat;
a double submit stored two claims; losing a race removed the form and
the error message with it; and the browser was running a new script
against an old stylesheet because the assets were unversioned.

- `tools/measure.html` — opens the page in a true 430px frame and reports
  layout overflow. Full-page headless screenshots lie about width; this
  doesn't. Point its iframe at `?demo`, `?intro`, or `?form=<course>` to
  inspect a filled page, the match, or an open form.
- `tools/freeze.html` — pins the intro at an exact moment. Neither
  virtual-time budgets nor rewritten animation-delays can do this.

## Deploying the book

```
cd worker
npx wrangler login
npx wrangler deploy
```

Put the resulting URL into `window.POTLUCK_API` in `docs/index.html`.
With that left empty the page still runs, but each claim stays in that one
browser, which is no use for sharing.

## Looking at it

```
cd docs && python3 -m http.server 8123
```

`?demo` fills the page in with fake claims so the printed cards and the
stamp are visible. `?intro` replays the match.
