import { BAKE_DEFAULTS, type BakeSettings, type MeshMap, type TextureSet } from '@cocoasurface/project';
import * as THREE from 'three';
import { autoCage, cageDirections, bakeSet, bakeSource, disposeSource, partName, stem, type BakeSource, type BakeSources } from './engine/bake';
import { engine } from './engine/engine';
import { loadModel } from './engine/model';
import { host, MODEL_FILTER } from './host';
import { get, set, toast } from './store';

let cache: { of: unknown[]; map: Map<string, BakeSource | null> } = { of: [], map: new Map() };

function sourcesFor(useHigh: boolean, match: boolean, exclude: string[] = []): BakeSources {
  if (cache.of[0] !== engine.model || cache.of[1] !== engine.high) {
    for (const s of cache.map.values()) if (s) disposeSource(s);
    cache = { of: [engine.model, engine.high], map: new Map() };
  }
  const low = engine.model!, from = useHigh ? engine.high! : low;
  const get = (key: string, f: () => BakeSource | null) => {
    if (!cache.map.has(key)) cache.map.set(key, f());
    return cache.map.get(key) ?? null;
  };
  const all = get(`${useHigh}:all`, () => bakeSource(from))!;
  const ex = exclude.filter((n) => from.parts.some((_, i) => partName(from, i) === n)).sort();
  const occ = ex.length && ex.length < from.parts.length ? get(`${useHigh}:occ:${ex.join('|')}`, () => bakeSource(from, (i) => !ex.includes(partName(from, i))))! : all;
  return {
    all,
    occ,
    own: (part) => {
      if (!useHigh || !match) return all;
      const k = stem(partName(low, part));
      return get(`high:${k}`, () => (from.parts.some((_, i) => stem(partName(from, i)) === k) ? bakeSource(from, (i) => stem(partName(from, i)) === k) : null)) ?? all;
    },
  };
}

/** Low-poly meshes of a set, with their names. */
export function meshesOf(setId: string): { part: number; name: string }[] {
  const g = engine.sets.get(setId);
  return g && engine.model ? g.parts.map((part) => ({ part, name: partName(engine.model!, part) })) : [];
}

/** Which high-poly meshes a low-poly mesh pairs with by name. */
export function pairsOf(name: string): string[] {
  const h = engine.high;
  return h ? h.parts.map((_, i) => partName(h, i)).filter((n) => stem(n) === stem(name)) : [];
}

/** Cages for the set's meshes from the high-poly surface (shares of the model's size). */
export function measureCages(setId: string, st: BakeSettings): BakeSettings['cages'] {
  if (!engine.model || !engine.high) return st.cages;
  const src = sourcesFor(true, st.matchByName);
  const diag = new THREE.Box3().setFromObject(engine.model.root).union(src.all.geometry.boundingBox!).getSize(new THREE.Vector3()).length() || 1;
  const out = { ...st.cages };
  for (const { part, name } of meshesOf(setId)) out[name] = autoCage(engine.model, part, src.own(part), diag, st.averageNormals !== false);
  return out;
}

export const settingsOf = (t: TextureSet): BakeSettings => ({ ...BAKE_DEFAULTS, size: t.size, ...t.bake?.settings });

/** Load a detailed model to bake from, placed exactly like the low-poly one. */
export async function loadHighPoly(): Promise<void> {
  const low = engine.model;
  if (!low) return;
  const [f] = await host.open([MODEL_FILTER]);
  if (!f) return;
  set({ busy: 'Opening the high-poly model' });
  try {
    engine.high = await loadModel(f.name, f.bytes, low.fit);
    engine.highBytes = f.bytes;
    set((s) => ({ project: s.project && { ...s.project, highPoly: { file: `highpoly/${f.name}`, name: f.name } }, dirty: true }));
    toast(`${f.name}: ${Math.round(engine.high.triangles).toLocaleString()} triangles`);
  } catch (e) {
    toast((e as Error).message);
  } finally {
    set({ busy: null });
  }
}

export function dropHighPoly(): void {
  engine.high = null;
  engine.highBytes = null;
  set((s) => ({ project: s.project && { ...s.project, highPoly: null }, dirty: true }));
}

/** Bake the sets with these settings, one after another, with progress and Stop. */
export async function bake(ids: string[], st: BakeSettings): Promise<void> {
  if (!engine.model || get().job) return;
  let stop = false;
  const useHigh = st.useHigh && !!engine.high;
  if (st.useHigh && !engine.high) toast('No high-poly model: baking from the mesh itself');
  set({ job: { label: 'Preparing', share: 0, cancel: () => (stop = true) } });
  const mode = get().view.mode;
  let showing: string | null = null;
  const shown = (m: MeshMap) => {
    if (showing !== m) set((s) => ({ view: { ...s.view, mode: `mesh:${m}` } }));
    else engine.onChange?.();
    showing = m;
  };
  await new Promise((r) => setTimeout(r, 30));
  let finished = 0;
  try {
    const src = sourcesFor(useHigh, st.matchByName, st.aoExclude);
    const bevel = get().project?.bevel ?? null;
    const lights = get().project?.bakeLights ?? [];
    for (const [i, id] of ids.entries()) {
      const g = engine.sets.get(id);
      const t = get().project?.textureSets.find((x) => x.id === id);
      if (!g || !t) continue;
      g.ensure();
      const run = { ...st, cages: useHigh && st.autoCage ? measureCages(id, st) : st.cages };
      const ok = await bakeSet(g, engine.model, src, useHigh, run, bevel, lights, (p) => set((s) => ({ job: s.job && { ...s.job, label: `Baking ${t.name}`, share: (i + p.done / p.total) / ids.length } })), () => stop, shown);
      if (!ok) break;
      finished++;
      set((s) => ({
        dirty: true,
        project: s.project && { ...s.project, textureSets: s.project.textureSets.map((x) => (x.id === id ? { ...x, bake: { settings: { ...run }, done: [...st.maps] } } : x)) },
      }));
      engine.request(id);
    }
  } catch (e) {
    toast(`Baking failed: ${(e as Error).message}`);
  } finally {
    set((s) => ({ job: null, view: { ...s.view, mode } }));
  }
  if (stop) toast(finished ? `Stopped after ${finished} texture set(s)` : 'Baking stopped');
  else if (finished) toast(`Baked ${finished} texture set${finished === 1 ? '' : 's'}`);
}

/** The cage of a set's meshes as geometry: each mesh pushed out along its cast directions by its front distance. */
export function cageGeometry(setId: string, st: BakeSettings): THREE.BufferGeometry[] {
  const low = engine.model;
  if (!low) return [];
  const box = new THREE.Box3().setFromObject(low.root);
  if (engine.high) box.union(new THREE.Box3().setFromObject(engine.high.root));
  const diag = box.getSize(new THREE.Vector3()).length() || 1;
  const useHigh = st.useHigh && !!engine.high;
  return meshesOf(setId).map(({ part, name }) => {
    const src = low.parts[part]!.mesh.geometry;
    const c = useHigh ? (st.cages[name] ?? { front: st.front, rear: st.rear }) : { front: 0.0005, rear: 0.0005 };
    const dir = cageDirections(src, useHigh && st.averageNormals !== false);
    const p = src.getAttribute('position');
    const out = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      out[i * 3] = p.getX(i) + dir[i * 3]! * c.front * diag;
      out[i * 3 + 1] = p.getY(i) + dir[i * 3 + 1]! * c.front * diag;
      out[i * 3 + 2] = p.getZ(i) + dir[i * 3 + 2]! * c.front * diag;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    if (src.index) g.setIndex(src.index);
    return g;
  });
}

/** Names of the meshes occlusion is cast against: the high-poly's when baking from it, else the model's. */
export function occluderNames(useHigh: boolean): string[] {
  const from = useHigh && engine.high ? engine.high : engine.model;
  return from ? from.parts.map((_, i) => partName(from, i)) : [];
}
