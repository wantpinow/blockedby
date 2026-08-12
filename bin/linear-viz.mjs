#!/usr/bin/env node
/**
 * linear-viz — open a Linear project as a dependency graph.
 *
 *   linear-viz                    open the project picker
 *   linear-viz <ref>              open one project (UUID, slugId, full slug,
 *                                 pasted Linear URL, or a name fragment)
 *   linear-viz --stop             stop the background server
 *   linear-viz --no-open          start/ensure the server, print the URL only
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(here, '..')
const PORT = Number(process.env.LINEAR_VIZ_PORT || 4720)
const BASE = `http://localhost:${PORT}`

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const ref = args.find((a) => !a.startsWith('--')) ?? null

if (flags.has('--help') || flags.has('-h')) {
  console.log(`linear-viz — Linear project dependency graphs

usage:
  linear-viz                 open the project picker
  linear-viz <project>       UUID, slugId, full slug, Linear URL, or name fragment
  linear-viz --stop          stop the background server
  linear-viz --no-open       ensure server, print URL instead of opening`)
  process.exit(0)
}

async function health(timeoutMs = 400) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(`${BASE}/api/health`, { signal: ctl.signal })
    clearTimeout(t)
    const j = await r.json()
    return j?.app === 'linear-viz'
  } catch {
    return false
  }
}

if (flags.has('--stop')) {
  if (await health()) {
    await fetch(`${BASE}/api/shutdown`, { method: 'POST' }).catch(() => {})
    console.log('linear-viz: server stopped')
  } else {
    console.log('linear-viz: no server running')
  }
  process.exit(0)
}

// first run convenience: build the app if dist/ is missing
if (!fs.existsSync(path.join(APP_ROOT, 'dist', 'index.html'))) {
  console.log('linear-viz: first run — building the app…')
  const r = spawnSync('npm', ['run', 'build'], { cwd: APP_ROOT, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('linear-viz: build failed')
    process.exit(1)
  }
}

if (!(await health())) {
  const child = spawn(process.execPath, [path.join(APP_ROOT, 'server', 'server.mjs')], {
    cwd: APP_ROOT,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  const deadline = Date.now() + 5000
  let up = false
  while (Date.now() < deadline) {
    if (await health(300)) {
      up = true
      break
    }
    await new Promise((r) => setTimeout(r, 120))
  }
  if (!up) {
    console.error(`linear-viz: server did not come up on :${PORT}`)
    process.exit(1)
  }
}

// a pasted Linear URL collapses to its project slug; a full slug to its hex id
function cleanRef(r) {
  let out = r.trim()
  const fromUrl = /linear\.app\/[^/]+\/project\/([^/?#]+)/.exec(out)
  if (fromUrl) out = fromUrl[1]
  const fromSlug = /-([0-9a-f]{8,})$/.exec(out)
  if (fromSlug) out = fromSlug[1]
  return out
}

const target = ref ? cleanRef(ref) : null
const url = target ? `${BASE}/p/${encodeURIComponent(target)}` : BASE

// warm the cache for this ref in the background so the page's fresh pass is quick
if (target) fetch(`${BASE}/api/project/${encodeURIComponent(target)}`).catch(() => {})

if (flags.has('--no-open')) {
  console.log(url)
} else {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref()
  console.log(`linear-viz → ${url}`)
}
