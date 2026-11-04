// File access: the desktop app's main process, or the browser when run with `npm run web`.
export type Filter = { name: string; extensions: string[] };
export interface OpenedFile { path: string; name: string; bytes: Uint8Array }

interface Desktop {
  open(filters: Filter[], multi?: boolean): Promise<OpenedFile[]>;
  save(name: string, filters: Filter[]): Promise<string | null>;
  folder(): Promise<string | null>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  writeIn(folder: string, name: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<OpenedFile>;
  recent(): Promise<string[]>;
  recovery: { write(b: Uint8Array): Promise<void>; read(): Promise<Uint8Array | null>; clear(): Promise<void> };
  title(t: string): Promise<void>;
}

declare global {
  interface Window {
    cocoa?: Desktop;
  }
}

function download(name: string, bytes: Uint8Array): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const RECOVERY = 'cocoasurface-recovery';

function idb<T>(f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('cocoasurface', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const q = f(r.result.transaction('kv', 'readwrite').objectStore('kv'));
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    };
  });
}

const browser: Desktop = {
  open: (filters, multi) =>
    new Promise((res) => {
      const i = document.createElement('input');
      i.type = 'file';
      i.multiple = !!multi;
      i.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
      i.onchange = async () => res(await Promise.all([...(i.files ?? [])].map(async (f) => ({ path: f.name, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      i.click();
    }),
  save: async (name) => name,
  folder: async () => 'downloads',
  write: async (path, bytes) => download(path, bytes),
  writeIn: async (_f, name, bytes) => download(name, bytes),
  read: async () => {
    throw new Error('Not available in the browser.');
  },
  recent: async () => [],
  recovery: {
    write: (b) => idb((s) => s.put(b, RECOVERY)).then(() => undefined),
    read: () => idb<Uint8Array | undefined>((s) => s.get(RECOVERY)).then((v) => v ?? null),
    clear: () => idb((s) => s.delete(RECOVERY)).then(() => undefined),
  },
  title: async (t) => void (document.title = t),
};

export const host: Desktop = window.cocoa ?? browser;
export const isDesktop = !!window.cocoa;

export const MODEL_FILTER: Filter = { name: '3D models', extensions: ['fbx', 'obj', 'glb', 'gltf', 'usdz'] };
export const PROJECT_FILTER: Filter = { name: 'CocoaSurface project', extensions: ['cocoasurf'] };
export const MATERIAL_FILTER: Filter = { name: 'CocoaSuite material', extensions: ['cocoamat'] };
