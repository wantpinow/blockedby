/** tiny IndexedDB key-value store — snapshots, aliases, and the key vault */
const DB_NAME = 'linear-viz'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
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
