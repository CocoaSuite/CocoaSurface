// Pictures and materials the user brings in: kept in the project file, and in a personal library shared by every project.
import { create } from 'zustand';
import { uid, type ProjectAsset } from '@cocoasurface/project';
import { engine } from './engine/engine';
import { host } from './host';
import { addMaterials } from './io';
import { edit, get, toast } from './store';

export interface Stored {
  id: string;
  name: string;
  kind: ProjectAsset['kind'] | 'material';
  ext: string;
  bytes: Uint8Array;
}

export const useLibrary = create<{ items: Stored[] }>(() => ({ items: [] }));

function db<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('cocoasurface-library', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const q = f(r.result.transaction('items', mode).objectStore('items'));
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    };
  });
}

export async function loadLibrary(): Promise<void> {
  try {
    useLibrary.setState({ items: await db<Stored[]>('readonly', (s) => s.getAll() as IDBRequest<Stored[]>) });
  } catch {}
}

export async function keepInLibrary(x: Stored): Promise<void> {
  try {
    await db('readwrite', (s) => s.put(x));
    useLibrary.setState((l) => ({ items: [...l.items.filter((y) => y.id !== x.id), x] }));
  } catch {
    toast('Your library could not be saved.');
  }
}

export async function dropFromLibrary(id: string): Promise<void> {
  await db('readwrite', (s) => s.delete(id)).catch(() => {});
  useLibrary.setState((l) => ({ items: l.items.filter((y) => y.id !== id) }));
}

const IMAGES = { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] };
const fileOf = (id: string, ext: string) => `assets/${id}.${ext}`;

async function addToProject(a: { id: string; name: string; kind: ProjectAsset['kind']; ext: string; bytes: Uint8Array }): Promise<string> {
  const file = fileOf(a.id, a.ext);
  await engine.addImage(file, a.bytes);
  edit(`Import ${a.name}`, (p) => ({ ...p, assets: [...(p.assets ?? []).filter((x) => x.id !== a.id), { id: a.id, file, name: a.name, kind: a.kind }] }));
  return file;
}

/** Pictures from files into the project and the personal library; their paths in the project. */
export async function importPictures(kind: ProjectAsset['kind']): Promise<{ file: string; name: string; aspect: number }[]> {
  const files = await host.open([IMAGES], true);
  const out: { file: string; name: string; aspect: number }[] = [];
  for (const f of files) {
    const x = { id: uid(), name: f.name.replace(/\.[^.]+$/, ''), kind, ext: f.name.split('.').pop()!.toLowerCase(), bytes: f.bytes };
    try {
      const file = await addToProject(x);
      void keepInLibrary(x);
      out.push({ file, name: x.name, aspect: engine.images.get(file)?.aspect ?? 1 });
    } catch {
      toast(`${f.name} could not be read.`);
    }
  }
  return out;
}

/** An imported item by id, brought into the project if it's only in the library. Pictures give their path, materials their id. */
export async function inProject(id: string): Promise<string | null> {
  const p = get().project;
  if (!p) return null;
  const pa = p.assets?.find((x) => x.id === id);
  if (pa) return pa.file;
  if (p.library.some((m) => m.id === id)) return id;
  const s = useLibrary.getState().items.find((x) => x.id === id);
  if (!s) return null;
  if (s.kind === 'material') return (await addMaterials([{ id: s.id, name: s.name, bytes: s.bytes }])).length ? id : null;
  return addToProject({ ...s, kind: s.kind });
}

/** Imported pictures of a kind: the project's, then the library's that the project doesn't have. */
export function imported(kind: ProjectAsset['kind']): { id: string; name: string; thumb?: string; saved: boolean }[] {
  const p = get().project;
  const lib = useLibrary.getState().items;
  const own = (p?.assets ?? []).filter((a) => a.kind === kind).map((a) => ({ id: a.id, name: a.name, thumb: engine.imageUrl(a.file), saved: lib.some((x) => x.id === a.id) }));
  return [...own, ...lib.filter((x) => x.kind === kind && !own.some((o) => o.id === x.id)).map((x) => ({ id: x.id, name: x.name, thumb: urlOf(x), saved: true }))];
}

const urls = new Map<string, string>();
export function urlOf(x: Stored): string {
  let u = urls.get(x.id);
  if (!u) urls.set(x.id, (u = URL.createObjectURL(new Blob([x.bytes as BlobPart]))));
  return u;
}

/** Puts a project picture or material into the personal library. */
export async function saveToLibrary(id: string): Promise<void> {
  const p = get().project!;
  const a = p.assets?.find((x) => x.id === id);
  if (a) {
    const img = engine.images.get(a.file);
    if (img) return keepInLibrary({ id, name: a.name, kind: a.kind, ext: a.file.split('.').pop()!, bytes: img.bytes });
  }
  const m = get().materials[id];
  if (m) return keepInLibrary({ id, name: m.file.manifest.name, kind: 'material', ext: 'cocoamat', bytes: m.bytes });
}
