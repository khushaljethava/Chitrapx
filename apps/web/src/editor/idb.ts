/** Minimal IndexedDB key-value store for unsaved editor documents (survives reloads and offline). */
const DB = "chitrapx-editor";
const STORE = "drafts";

let conn: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  conn ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { conn = null; reject(req.error); };
  });
  return conn;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idbGet = <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key)).catch(() => undefined);
export const idbSet = (key: string, value: unknown) => run("readwrite", (s) => s.put(value, key)).catch(() => undefined);
export const idbDel = (key: string) => run("readwrite", (s) => s.delete(key)).catch(() => undefined);
/** Keys starting with `prefix`. */
export const idbKeys = (prefix: string) =>
  run<IDBValidKey[]>("readonly", (s) => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)))
    .then((keys) => keys.map(String)).catch(() => [] as string[]);
