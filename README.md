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
- `tools/measure.html` — opens the page in a true 430px frame and reports
  layout overflow. Full-page headless screenshots lie about width; this
  doesn't. Point its iframe at `?demo`, `?intro`, or `?form=<course>` to
  inspect a filled page, the match, or an open form.

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
