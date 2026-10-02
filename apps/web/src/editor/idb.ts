/** Minimal IndexedDB key-value store for unsaved editor documents (survives reloads and offline). */
const DB = "chitrapx-editor";
const STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
