const DB_NAME = 'saltlight';
const DB_VERSION = 1;

export interface ProgramRecord {
  id: string;
  name: string;
  source: string;
  updatedAt: number;
}

export interface SettingsRecord {
  speedMultiplier: number;
  zoom: number;
  textScale: number;
  spriteDetail: number;
}

export const DEFAULT_SETTINGS: SettingsRecord = {
  speedMultiplier: 1,
  zoom: 1,
  textScale: 1,
  spriteDetail: 1,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('programs')) db.createObjectStore('programs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('world')) db.createObjectStore('world');
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

export function saveProgram(rec: ProgramRecord): Promise<IDBValidKey> {
  return tx('programs', 'readwrite', (s) => s.put(rec));
}

export function getProgram(id: string): Promise<ProgramRecord | undefined> {
  return tx('programs', 'readonly', (s) => s.get(id));
}

export async function listPrograms(): Promise<ProgramRecord[]> {
  return (await tx('programs', 'readonly', (s) => s.getAll())) as ProgramRecord[];
}

export function deleteProgram(id: string): Promise<undefined> {
  return tx('programs', 'readwrite', (s) => s.delete(id));
}

// A single put is one transaction: an autosave cut off mid-write leaves the
// previous value until the transaction commits, so the old world survives.
export function saveWorld(data: unknown): Promise<IDBValidKey> {
  return tx('world', 'readwrite', (s) => s.put(data, 'current'));
}

export function loadWorld<T = unknown>(): Promise<T | undefined> {
  return tx<T>('world', 'readonly', (s) => s.get('current'));
}

export function saveSettings(settings: SettingsRecord): Promise<IDBValidKey> {
  return tx('settings', 'readwrite', (s) => s.put(settings, 'current'));
}

export async function loadSettings(): Promise<SettingsRecord> {
  const stored = await tx<SettingsRecord | undefined>('settings', 'readonly', (s) => s.get('current'));
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(() => fn(...a), ms);
  };
}