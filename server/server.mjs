/**
 * blockedBy static server. Everything real happens in the browser — this
 * process only serves the built bundle from dist/ on 127.0.0.1 so the
 * `blockedby` command has a stable local URL to open. It holds no API key
 * and makes no network requests.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = '0.3.0'

const here = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(here, '..')
const DIST = path.join(APP_ROOT, 'dist')
const PORT = Number(process.env.BLOCKEDBY_PORT || process.env.LINEAR_VIZ_PORT || 4720)

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

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://local')
  const p = decodeURIComponent(url.pathname)

  if (p === '/api/health') {
    return send(res, 200, MIME['.json'], JSON.stringify({ ok: true, app: 'blockedby', version: VERSION }))
  }
  if (p === '/api/shutdown' && req.method === 'POST') {
    send(res, 200, MIME['.json'], JSON.stringify({ ok: true }))
    setTimeout(() => {
      server.close()
      process.exit(0)
    }, 50)
    return
  }

  // SPA routes
  if (p === '/' || p === '/index.html' || /^\/p\/[^/]+$/.test(p)) {
    return send(res, 200, MIME['.html'], fs.readFileSync(path.join(DIST, 'index.html')))
  }

  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '')
  const file = path.join(DIST, safe)
  if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'text/plain', 'not found')
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': safe.startsWith('assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`blockedby: port ${PORT} already in use`)
    process.exit(2)
  }
  throw err
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`blockedBy v${VERSION} → http://localhost:${PORT}`)
})
