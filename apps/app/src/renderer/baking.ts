import { BAKE_DEFAULTS, type BakeSettings, type TextureSet } from '@cocoasurface/project';
import { bakeSet, bakeSource, disposeSource, type BakeSource } from './engine/bake';
import { engine } from './engine/engine';
import { loadModel } from './engine/model';
import { host, MODEL_FILTER } from './host';
import { get, set, toast } from './store';

let sources: { low: BakeSource | null; high: BakeSource | null; of: unknown[] } = { low: null, high: null, of: [] };

function source(kind: 'low' | 'high'): BakeSource {
  const m = kind === 'low' ? engine.model! : engine.high!;
  if (sources.of[0] !== engine.model || sources.of[1] !== engine.high) {
    if (sources.low) disposeSource(sources.low);
    if (sources.high) disposeSource(sources.high);
    sources = { low: null, high: null, of: [engine.model, engine.high] };
  }
  return (sources[kind] ??= bakeSource(m));
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
  await new Promise((r) => setTimeout(r, 30));
  let finished = 0;
  try {
    const src = source(useHigh ? 'high' : 'low');
    for (const [i, id] of ids.entries()) {
      const g = engine.sets.get(id);
      const t = get().project?.textureSets.find((x) => x.id === id);
      if (!g || !t) continue;
      g.ensure();
      const ok = await bakeSet(g, engine.model, src, useHigh, st, (p) => set((s) => ({ job: s.job && { ...s.job, label: `Baking ${t.name}`, share: (i + p.done / p.total) / ids.length } })), () => stop);
      if (!ok) break;
      finished++;
      set((s) => ({
        dirty: true,
        project: s.project && { ...s.project, textureSets: s.project.textureSets.map((x) => (x.id === id ? { ...x, bake: { settings: { ...st }, done: [...st.maps] } } : x)) },
      }));
      engine.request(id);
    }
  } catch (e) {
    toast(`Baking failed: ${(e as Error).message}`);
  } finally {
    set({ job: null });
  }
  if (stop) toast(finished ? `Stopped after ${finished} texture set(s)` : 'Baking stopped');
  else if (finished) toast(`Baked ${finished} texture set${finished === 1 ? '' : 's'}`);
}
