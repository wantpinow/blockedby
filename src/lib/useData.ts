import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectSnapshot, ProjectsSnapshot } from '../types'

interface Live<T> {
  data: T | null
  syncing: boolean
  error: string | null
  refresh: () => void
}

/**
 * Stale-while-revalidate over the local API:
 *  1. paint from the server-inlined snapshot (`window.__SNAPSHOT__`) if present
 *  2. else paint from the disk cache endpoint
 *  3. always revalidate against Linear in the background
 *  4. revalidate again on window focus (throttled) and every 90s while visible
 */
function useLive<T>(cachedUrl: string, freshUrl: string, seed: T | null): Live<T> {
  const [data, setData] = useState<T | null>(seed)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastFresh = useRef(0)
  const alive = useRef(true)
  const seeded = useRef(seed !== null)

  const fetchJson = useCallback(async (url: string): Promise<T> => {
    const r = await fetch(url, { cache: 'no-store' })
    const body = await r.json()
    if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`)
    return body as T
  }, [])

  const refresh = useCallback(() => {
    setSyncing(true)
    lastFresh.current = Date.now()
    fetchJson(freshUrl)
      .then((d) => {
        if (!alive.current) return
        setData(d)
        setError(null)
      })
      .catch((e: Error) => {
        if (alive.current) setError(e.message)
      })
      .finally(() => {
        if (alive.current) setSyncing(false)
      })
  }, [fetchJson, freshUrl])

  useEffect(() => {
    alive.current = true
    if (!seeded.current) {
      fetchJson(cachedUrl)
        .then((d) => {
          if (alive.current && d) setData((cur) => cur ?? d)
        })
        .catch((e: Error) => {
          if (alive.current) setError((cur) => cur ?? e.message)
        })
    }
    refresh()
    const onFocus = () => {
      if (Date.now() - lastFresh.current > 15000) refresh()
    }
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastFresh.current > 85000) {
        refresh()
      }
    }, 90000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      alive.current = false
      clearInterval(tick)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedUrl, freshUrl])

  return { data, syncing, error, refresh }
}

export function useProject(ref: string): Live<ProjectSnapshot> {
  const inline = window.__SNAPSHOT__
  const seed = inline?.kind === 'project' && inline.ref === ref ? inline.data : null
  return useLive<ProjectSnapshot>(
    `/api/project/${encodeURIComponent(ref)}`,
    `/api/project/${encodeURIComponent(ref)}?fresh=1`,
    seed,
  )
}

export function useProjects(): Live<ProjectsSnapshot> {
  const inline = window.__SNAPSHOT__
  const seed = inline?.kind === 'projects' ? inline.data : null
  return useLive<ProjectsSnapshot>('/api/projects', '/api/projects?fresh=1', seed)
}

/** re-render every `ms` so relative timestamps stay honest */
export function useNow(ms = 10000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
