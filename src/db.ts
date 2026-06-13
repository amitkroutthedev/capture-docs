import type { RecordingRecord } from "./types";

const DB_NAME = "capturedocs";
const STORE = "recordings";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function saveRecording(rec: RecordingRecord): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(rec));
}

export function getRecording(id: string): Promise<RecordingRecord | undefined> {
  return tx("readonly", (s) => s.get(id) as IDBRequest<RecordingRecord>);
}

export function listRecordings(): Promise<RecordingRecord[]> {
  return tx(
    "readonly",
    (s) => s.getAll() as IDBRequest<RecordingRecord[]>,
  ).then((all) => all.sort((a, b) => b.createdAt - a.createdAt));
}

export function deleteRecording(id: string): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

export async function updateRecording(
  id: string,
  patch: Partial<RecordingRecord>,
): Promise<RecordingRecord | undefined> {
  const rec = await getRecording(id);
  if (!rec) return undefined;
  const next = { ...rec, ...patch };
  await saveRecording(next);
  return next;
}
