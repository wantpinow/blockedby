# linear-viz

**Live at [blockedby.dev](https://blockedby.dev).**

A Linear project as a dependency graph — issues laid out left→right by their
`blocks` relations, in a crisp near-monochrome UI where the only color is your
workspace's own state colors.

```
linear-viz                    # project picker
linear-viz Workbench          # name fragment
linear-viz cbba11b10f16       # slugId (or full UUID / full slug)
linear-viz https://linear.app/alaro/project/workbench-...-cbba11b10f16
linear-viz --stop             # stop the background server
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

## Instant loads

`linear-viz <ref>` starts (or reuses) a tiny local daemon on `:4720` that
keeps a disk cache in `~/.cache/linear-viz`. Page HTML ships with the cached
snapshot inlined, so the graph is interactive in ~40ms; fresh data
revalidates from Linear in the background (and again on focus / every 90s).
First-ever visit to a project fetches live (~1s) and caches.

## Setup

```
npm install
npm run build
npm link        # puts `linear-viz` on your PATH
```

Auth: put a personal API key in `.env` (gitignored) as
`LINEAR_API_KEY=lin_api_…`. The server binds 127.0.0.1 only; the key never
leaves the machine.

Dev: `npm run dev` (vite on :5210 with the same API mounted).
