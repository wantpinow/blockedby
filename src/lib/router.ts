import { useCallback, useEffect, useState } from 'react'

/**
 * History-based routes: `/` (picker) and `/p/<ref>` (project graph).
 * The selected issue rides in the hash: `/p/<ref>#ALA-123`.
 */
export interface Route {
  ref: string | null
  issue: string | null
}

function parse(): Route {
  const m = /^\/p\/([^/]+)/.exec(window.location.pathname)
  const hash = window.location.hash.replace(/^#/, '')
  return { ref: m ? decodeURIComponent(m[1]) : null, issue: hash || null }
}

export function useRoute(): {
  route: Route
  openProject: (ref: string) => void
  openPicker: () => void
  selectIssue: (identifier: string | null) => void
} {
  const [route, setRoute] = useState<Route>(parse)

  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener('popstate', on)
    window.addEventListener('hashchange', on)
    return () => {
      window.removeEventListener('popstate', on)
      window.removeEventListener('hashchange', on)
    }
  }, [])

  const go = useCallback((path: string) => {
    history.pushState(null, '', path)
    setRoute(parse())
  }, [])

  return {
    route,
    openProject: useCallback((ref: string) => go(`/p/${encodeURIComponent(ref)}`), [go]),
    openPicker: useCallback(() => go('/'), [go]),
    selectIssue: useCallback(
      (identifier: string | null) => {
        if (identifier) go(`${window.location.pathname}#${identifier}`)
        else go(window.location.pathname)
      },
      [go],
    ),
  }
}
