/** tiny IndexedDB key-value store — snapshots, aliases, and the key vault */
const DB_NAME = 'blockedby'
const LEGACY_DB = 'linear-viz' // pre-rebrand — migrated once, then deleted
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let created = false
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        created = true
        req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => {
        const fresh = req.result
        if (created) {
          migrateLegacy(fresh)
            .catch(() => {})
            .finally(() => resolve(fresh))
        } else {
          resolve(fresh)
        }
      }
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

/** carry the vault + caches over from the pre-rebrand database, then drop it */
async function migrateLegacy(fresh: IDBDatabase): Promise<void> {
  if (!('databases' in indexedDB)) return
  const names = (await indexedDB.databases()).map((d) => d.name)
  if (!names.includes(LEGACY_DB)) return

  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  try {
    if (old.objectStoreNames.contains(STORE)) {
      const entries = await new Promise<[IDBValidKey[], unknown[]]>((resolve, reject) => {
        const t = old.transaction(STORE, 'readonly')
        const s = t.objectStore(STORE)
        const keys = s.getAllKeys()
        const vals = s.getAll()
        t.oncomplete = () => resolve([keys.result, vals.result])
        t.onerror = () => reject(t.error)
      })
      await new Promise((resolve, reject) => {
        const t = fresh.transaction(STORE, 'readwrite')
        const s = t.objectStore(STORE)
        entries[0].forEach((k, i) => s.put(entries[1][i], k))
        t.oncomplete = () => resolve(null)
        t.onerror = () => reject(t.error)
      })
    }
  } finally {
    old.close()
    indexedDB.deleteDatabase(LEGACY_DB)
  }
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export function kvGet<T>(key: string): Promise<T | undefined> {
  return tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>)
}

export function kvSet(key: string, value: unknown): Promise<unknown> {
  return tx('readwrite', (s) => s.put(value, key))
}

export function kvDel(key: string): Promise<unknown> {
  return tx('readwrite', (s) => s.delete(key))
}

export function kvClear(): Promise<unknown> {
  return tx('readwrite', (s) => s.clear())
}
