import { useCallback, useEffect, useRef, useState } from 'react'
import type { MineSnapshot, ProjectSnapshot, ProjectsSnapshot } from '../types'
import { kvGet } from './idb'
import {
  AuthError,
  cachedMine,
  cachedProject,
  cachedProjects,
  fetchMine,
  fetchProject,
  fetchProjects,
  fetchViewer,
  type Viewer,
} from './linear'

interface Live<T> {
  data: T | null
  syncing: boolean
  error: string | null
  refresh: () => void
}

/**
 * Stale-while-revalidate, fully client-side:
 *  1. paint from the IndexedDB snapshot immediately
 *  2. revalidate against Linear in the background
 *  3. revalidate again on window focus (throttled) and every 90s while visible
 * Auth failures are handled globally (the app flips to the key screen).
 */
function useLive<T>(
  getCached: () => Promise<T | null>,
  getFresh: () => Promise<T>,
  depKey: string,
): Live<T> {
  const [data, setData] = useState<T | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastFresh = useRef(0)
  const alive = useRef(true)

  const refresh = useCallback(() => {
    setSyncing(true)
    lastFresh.current = Date.now()
    getFresh()
      .then((d) => {
        if (!alive.current) return
        setData(d)
        setError(null)
      })
      .catch((e: Error) => {
        if (alive.current && !(e instanceof AuthError)) setError(e.message)
      })
      .finally(() => {
        if (alive.current) setSyncing(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey])

  useEffect(() => {
    alive.current = true
    getCached()
      .then((d) => {
        if (alive.current && d) setData((cur) => cur ?? d)
      })
      .catch(() => {})
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
  }, [depKey])

  return { data, syncing, error, refresh }
}

export function useProject(ref: string): Live<ProjectSnapshot> {
  return useLive<ProjectSnapshot>(
    () => cachedProject(ref),
    () => fetchProject(ref),
    `project:${ref}`,
  )
}

export function useProjects(): Live<ProjectsSnapshot> {
  return useLive<ProjectsSnapshot>(
    () => cachedProjects(),
    () => fetchProjects(),
    'projects',
  )
}

/**
 * The key's owner. Paints from IDB instantly; upgrades/refreshes in the
 * background (older cached viewers predate the id/avatar fields).
 */
export function useViewer(): Viewer | null {
  return useViewerState().viewer
}

/**
 * The viewer plus whether we've finished looking: `settled` turns true once a
 * cached viewer paints or the fetch ends, so callers can tell "still loading"
 * from "there is no viewer".
 */
export function useViewerState(): { viewer: Viewer | null; settled: boolean } {
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    let alive = true
    kvGet<Partial<Viewer>>('viewer').then((stored) => {
      if (alive && stored?.id) {
        setViewer(stored as Viewer)
        setSettled(true)
      }
      fetchViewer()
        .then((fresh) => {
          if (alive) setViewer(fresh)
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setSettled(true)
        })
    })
    return () => {
      alive = false
    }
  }, [])
  return { viewer, settled }
}

const EMPTY_MINE: MineSnapshot = { fetchedAt: '', userId: '', projectIds: [] }

/** projects containing issues assigned to `userId`; inert when no user picked */
export function useMine(userId: string | null): Live<MineSnapshot> {
  const live = useLive<MineSnapshot>(
    () => (userId ? cachedMine(userId) : Promise.resolve(null)),
    () => (userId ? fetchMine(userId) : Promise.resolve(EMPTY_MINE)),
    `mine:${userId ?? 'none'}`,
  )
  return userId ? live : { ...live, data: null }
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
