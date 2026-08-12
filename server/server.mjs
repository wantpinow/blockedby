/**
 * linear-viz production server: serves the built app from dist/ and the
 * /api/* endpoints, binding to 127.0.0.1 only (the .env token stays local).
 *
 * Instant loads: for `/` and `/p/<ref>` the cached snapshot is inlined into
 * index.html as window.__SNAPSHOT__, so the graph paints with zero client
 * round-trips while fresh data revalidates in the background.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { APP_ROOT, VERSION, cachedProject, cachedProjects, createApiHandler } from './api.mjs'

const PORT = Number(process.env.LINEAR_VIZ_PORT || 4720)
const DIST = path.join(APP_ROOT, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

let htmlCache = { mtime: 0, text: '' }
function indexHtml() {
  const file = path.join(DIST, 'index.html')
  const mtime = fs.statSync(file).mtimeMs
  if (mtime !== htmlCache.mtime) {
    htmlCache = { mtime, text: fs.readFileSync(file, 'utf8') }
  }
  return htmlCache.text
}

function sendHtml(res, snapshot) {
  let html = indexHtml()
  if (snapshot) {
    const json = JSON.stringify(snapshot).replace(/</g, '\\u003c')
    html = html.replace('</head>', `<script>window.__SNAPSHOT__=${json}</script></head>`)
  }
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
  res.end(html)
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://local')
  const p = decodeURIComponent(url.pathname)

  // SPA routes get index.html with the relevant cached snapshot inlined
  if (p === '/' || p === '/index.html') {
    const cached = cachedProjects()
    return sendHtml(res, cached ? { kind: 'projects', data: cached } : null)
  }
  const proj = /^\/p\/([^/]+)$/.exec(p)
  if (proj) {
    const ref = decodeURIComponent(proj[1])
    const cached = cachedProject(ref)
    return sendHtml(res, cached ? { kind: 'project', ref, data: cached } : null)
  }

  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '')
  const file = path.join(DIST, safe)
  if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('not found')
  }
  const ext = path.extname(file)
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    // vite emits content-hashed filenames under /assets — cache those hard
    'Cache-Control': safe.startsWith('assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
}

const api = createApiHandler({
  onShutdown: () => {
    server.close()
    process.exit(0)
  },
})

const server = http.createServer((req, res) => {
  api(req, res, () => serveStatic(req, res))
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // another linear-viz (or something else) holds the port — the CLI probes
    // /api/health before spawning, so just report and bow out
    console.error(`linear-viz: port ${PORT} already in use`)
    process.exit(2)
  }
  throw err
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`linear-viz v${VERSION} → http://localhost:${PORT}`)
})
