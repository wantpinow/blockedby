# blockedBy

**Live at [blockedby.dev](https://blockedby.dev).**

Linear projects as dependency graphs — issues laid out left→right by their
`blocks` relations, in a crisp near-monochrome UI where the only color is your
workspace's own state colors.

```
blockedby                    # project picker
blockedby Workbench          # name fragment
blockedby cbba11b10f16       # slugId (or full UUID / full slug)
blockedby https://linear.app/alaro/project/workbench-...-cbba11b10f16
blockedby --stop             # stop the background server
```

## What you get

- **The DAG** — layered by longest blocking path, crossing-reduced, with
  arrowed bezier edges. Hover any issue to light up everything it waits on and
  everything it holds up. Issues with no relations sit in a tidy grid below.
- **Ready markers** — unstarted issues whose blockers are all done get a
  dashed green outline: the "you could pick this up right now" set.
- **Linear-native visuals** — workflow state icons in your workspace's own
  colors (dashed backlog ring, progress pies, done checks), assignee avatars,
  priority glyphs, labels.
- **Issue panel** — click a node: state, assignee, priority, estimate, labels,
  blocked-by/blocks chips (click to walk the graph), full markdown
  description, "Open in Linear". `⌘-click` a node to jump straight to Linear.
- **Filters** — state-type chips and `/` search dim everything else.
- Light/dark, `Esc` closes, double-click re-fits, scroll pans, pinch zooms.

## Fully client-side

There is no backend. The browser talks straight to `api.linear.app` (their
CORS allows it), snapshots live in IndexedDB for instant repaint with
background revalidation, and your personal API key is AES-GCM-encrypted under
a non-extractable CryptoKey in this browser's IndexedDB — it is sent to
Linear and nowhere else. First visit shows a welcome screen that asks for a
key; the account menu (key icon) removes it again.

## Local CLI

```
npm install
npm run build
npm link        # puts `blockedby` on your PATH
```

`blockedby <ref>` starts (or reuses) a tiny static server on `:4720` — it
serves the bundle and holds no secrets — then opens the browser.

Deploys: static on Vercel (`npx vercel deploy --prod --yes`), SPA rewrite via
`vercel.json`. Dev: `npm run dev` (vite on :5210).
