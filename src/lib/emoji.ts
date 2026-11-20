import { useEffect, useState } from 'react'

/**
 * Linear project icons come in two shapes:
 *  - an emoji shortcode, `:broom:`
 *  - a name from Linear's own icon set, `Rocket`
 * Both are drawn as an emoji. Anything we can't resolve draws nothing rather
 * than raw text (`:mantelpiece_clock:` in front of a project name).
 */

/** Linear's built-in project icons, as their nearest emoji */
const LINEAR_ICONS: Record<string, string> = {
  Agent: '🤖',
  Book: '📖',
  Bug: '🐛',
  Calendar: '📅',
  Chart: '📊',
  Chat: '💬',
  Cloud: '☁️',
  Code: '💻',
  Cube: '🧊',
  Database: '🗄️',
  Email: '✉️',
  Flag: '🚩',
  Folder: '📁',
  Gift: '🎁',
  Globe: '🌐',
  Heart: '❤️',
  Inbox: '📥',
  Key: '🔑',
  Lightbulb: '💡',
  Lock: '🔒',
  Megaphone: '📣',
  Mobile: '📱',
  Paint: '🎨',
  People: '👥',
  Rocket: '🚀',
  Scissors: '✂️',
  Search: '🔍',
  Settings: '⚙️',
  Shield: '🛡️',
  Star: '⭐',
  Target: '🎯',
  Tree: '🌳',
  Trophy: '🏆',
  Users: '👥',
  Video: '🎥',
  Wrench: '🔧',
}

/** shortcodes Linear spells differently from GitHub's gemoji list */
const ALIASES: Record<string, string> = {
  scales: '⚖️',
}

const SHORTCODE = /^:([\w+-]+):$/

export function isShortcode(icon: string | null): boolean {
  return !!icon && SHORTCODE.test(icon)
}

let table: Record<string, string> | null = null
let loading: Promise<Record<string, string>> | null = null

/** the shortcode → emoji table, fetched as its own chunk the first time it's needed */
function loadShortcodes(): Promise<Record<string, string>> {
  loading ??= import('gemoji').then(({ gemoji }) => {
    const t: Record<string, string> = {}
    for (const e of gemoji) for (const n of e.names) t[n] = e.emoji
    table = { ...t, ...ALIASES }
    return table
  })
  return loading
}

/** the shortcode table once loaded; only loads when `needed` */
export function useShortcodes(needed: boolean): Record<string, string> | null {
  const [t, setT] = useState(table)
  useEffect(() => {
    if (!needed || t) return
    let alive = true
    loadShortcodes()
      .then((loaded) => alive && setT(loaded))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [needed, t])
  return t
}

export function projectIcon(icon: string | null, shortcodes: Record<string, string> | null): string | null {
  if (!icon) return null
  const code = SHORTCODE.exec(icon)?.[1]
  if (code) return shortcodes?.[code] ?? null
  if (LINEAR_ICONS[icon]) return LINEAR_ICONS[icon]
  if (/\p{Extended_Pictographic}/u.test(icon)) return icon // already an emoji
  return null
}
