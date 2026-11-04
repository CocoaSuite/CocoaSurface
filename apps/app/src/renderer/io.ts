import { encodePng, evaluable, writeCocoaMat, type OutputRole } from '@cocoasurface/materials';
import {
  allLayers, bakedPath, channelInfo, MESH_MAPS, newProject, newTextureSet, pixelPath, PROJECT_EXT, readProject, setMaterial, uid, writeProject, writeSetMaterial,
  type Channel, type FillLayer, type Project, type TextureSet,
} from '@cocoasurface/project';
import { engine } from './engine/engine';
import { BAKE_LAYER, rt, type Key } from './engine/gpu';
import { evaluateMaps, forgetMaterial, parseMaterial, type LoadedMaterial } from './engine/library';
import { loadModel } from './engine/model';
import { host, isDesktop, MATERIAL_FILTER, MODEL_FILTER, PROJECT_FILTER } from './host';
import { clearHistory, edit, get, set, toast } from './store';

export const APP = 'CocoaSurface 0.1.0';
let view: { showModel(): void } | null = null;
export const setView = (v: { showModel(): void } | null) => (view = v);

const busy = async <T>(label: string, f: () => Promise<T>): Promise<T | undefined> => {
  set({ busy: label });
  try {
    return await f();
  } catch (e) {
    toast((e as Error).message);
    return undefined;
  } finally {
    set({ busy: null });
  }
};

function title(): void {
  const s = get();
  void host.title(s.project ? `${s.project.name}${s.dirty ? ' •' : ''} - CocoaSurface` : 'CocoaSurface');
}

export function confirmDiscard(): boolean {
  return !get().dirty || window.confirm('The project has unsaved changes. Discard them?');
}

function start(project: Project, path: string | null, materials: Record<string, LoadedMaterial>, warnings: string[]): void {
  clearHistory();
  for (const id of Object.keys(get().materials)) forgetMaterial(id);
  set({ project, path, dirty: false, materials, warnings, setId: project.textureSets[0]?.id ?? null, layerId: project.textureSets[0]?.layers[0]?.id ?? null, maskItem: null });
  engine.syncSets(project);
  view?.showModel();
  title();
}

/** A new project around a model: one texture set per material slot. */
export async function newFromModel(size: TextureSet['size'] = 2048, channels?: Channel[]): Promise<void> {
  if (!confirmDiscard()) return;
  const [f] = await host.open([MODEL_FILTER]);
  if (!f) return;
  await busy('Opening the model', async () => {
    const m = await loadModel(f.name, f.bytes);
    const p = newProject(f.name.replace(/\.[^.]+$/, ''));
    p.model = { file: `model/${f.name}`, name: f.name };
    p.textureSets = m.slots.map((s) => {
      const t = newTextureSet(s, [s], size);
      if (channels) t.channels = channels;
      return t;
    });
    engine.setModel(m, f.bytes);
    start(p, null, {}, m.warnings);
    toast(`${f.name}: ${Math.round(m.triangles).toLocaleString()} triangles, ${m.slots.length} texture set${m.slots.length === 1 ? '' : 's'}`);
  });
}

async function decodePng(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

async function load(bytes: Uint8Array, path: string | null): Promise<void> {
  const r = await readProject(bytes);
  if (!r.ok) throw new Error(r.error);
  const { project, files } = r.value;
  const warnings: string[] = [];
  const materials: Record<string, LoadedMaterial> = {};
  for (const m of project.library)
    try {
      materials[m.id] = await parseMaterial(m.id, files.get(m.file)!);
      if (materials[m.id]!.unknown.length) warnings.push(`“${m.name}” uses nodes this version doesn't know: ${materials[m.id]!.unknown.join(', ')}.`);
    } catch (e) {
      warnings.push(`The material “${m.name}” could not be read: ${(e as Error).message}`);
    }
  if (project.model) {
    const mb = files.get(project.model.file)!;
    const m = await loadModel(project.model.name, mb);
    warnings.push(...m.warnings);
    engine.setModel(m, mb);
    engine.high = null;
    engine.highBytes = null;
    if (project.highPoly) {
      const hb = files.get(project.highPoly.file)!;
      try {
        engine.high = await loadModel(project.highPoly.name, hb, m.fit);
        engine.highBytes = hb;
      } catch (e) {
        warnings.push(`The high-poly model could not be read: ${(e as Error).message}`);
      }
    }
  } else engine.setModel(null, null);
  engine.clearImages();
  for (const t of project.textureSets)
    for (const l of allLayers(t.layers))
      for (const m of l.mask?.items ?? [])
        if (m.image && files.has(m.image.file)) await engine.addImage(m.image.file, files.get(m.image.file)!);
  start(project, path, materials, warnings);
  await engine.ready();
  for (const t of project.textureSets) {
    const g = engine.sets.get(t.id);
    if (!g) continue;
    g.ensure();
    for (const l of allLayers(t.layers))
      for (const [id, key] of [...l.channels.map((c) => [l.id, c] as const), ...(l.mask?.items ?? []).filter((m) => m.kind === 'paint').map((m) => [m.id, 'grey'] as const)]) {
        const b = files.get(pixelPath(id, key));
        if (!b) continue;
        g.p.write(g.target(id, key)!, await decodePng(b));
      }
    for (const key of ['skew', 'offset'] as const) {
      const b = files.get(pixelPath(`bake-${t.id}`, key));
      if (b) g.p.write(g.target(BAKE_LAYER, key)!, await decodePng(b));
    }
    for (const m of t.bake?.done ?? []) {
      const b = files.get(bakedPath(t.id, m));
      if (!b) continue;
      const img = await decodePng(b);
      g.setBaked(m, (out) => g.p.write(out, img), img.width);
    }
    engine.request(t.id);
  }
}

export async function openProject(path?: string): Promise<void> {
  if (!confirmDiscard()) return;
  const f = path ? await host.read(path) : (await host.open([PROJECT_FILTER]))[0];
  if (!f) return;
  await busy('Opening the project', () => load(f.bytes, isDesktop ? f.path : null));
}

async function serialise(): Promise<Uint8Array> {
  const s = get();
  const p = { ...s.project!, modified: new Date().toISOString() };
  const files = new Map<string, Uint8Array>();
  if (p.model && engine.modelBytes) files.set(p.model.file, engine.modelBytes);
  if (p.highPoly && engine.highBytes) files.set(p.highPoly.file, engine.highBytes);
  for (const [file, img] of engine.images) files.set(file, img.bytes);
  for (const m of p.library) {
    const lm = s.materials[m.id];
    if (lm) files.set(m.file, lm.bytes);
  }
  const live = new Set([...engine.layerIds(), BAKE_LAYER]);
  for (const t of p.textureSets) {
    const g = engine.sets.get(t.id);
    if (!g) continue;
    for (const [m, target] of g.baked) files.set(bakedPath(t.id, m), await encodePng(target.width, target.height, 4, g.p.read(target)));
    for (const [layer, keys] of g.pixels) {
      if (!live.has(layer)) continue;
      for (const [key, target] of keys) files.set(pixelPath(layer === BAKE_LAYER ? `bake-${t.id}` : layer, key), await encodePng(target.width, target.height, 4, g.p.read(target)));
    }
  }
  return writeProject({ project: p, files });
}

export async function saveProject(as = false): Promise<boolean> {
  const s = get();
  if (!s.project) return false;
  let path = as ? null : s.path;
  if (!path) path = await host.save(`${s.project.name}.${PROJECT_EXT}`, [PROJECT_FILTER]);
  if (!path) return false;
  const ok = await busy('Saving', async () => {
    await host.write(path, await serialise());
    return true;
  });
  if (!ok) return false;
  set({ path: isDesktop ? path : null, dirty: false });
  await host.recovery.clear();
  title();
  toast('Saved');
  return true;
}

export async function autosave(): Promise<void> {
  if (!get().project || !get().dirty || get().busy) return;
  try {
    await host.recovery.write(await serialise());
  } catch {
    /* tried again next time */
  }
}

export async function recover(): Promise<boolean> {
  const b = await host.recovery.read();
  if (!b) return false;
  if (!window.confirm('CocoaSurface closed before the last changes were saved. Open the recovered project?')) {
    await host.recovery.clear();
    return false;
  }
  await busy('Recovering', async () => {
    await load(b, null);
    set({ dirty: true });
    title();
  });
  return true;
}

export async function importMaterials(): Promise<string[]> {
  const files = await host.open([MATERIAL_FILTER], true);
  const added: string[] = [];
  await busy('Importing materials', async () => {
    const lib = { ...get().materials };
    const entries: Project['library'] = [];
    for (const f of files)
      try {
        const id = uid();
        const m = await parseMaterial(id, f.bytes);
        lib[id] = m;
        entries.push({ id, name: m.file.manifest.name, file: `materials/${id}.cocoamat` });
        added.push(id);
        if (m.unknown.length) toast(`“${m.file.manifest.name}” uses nodes this version doesn't know: ${m.unknown.join(', ')}`);
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`);
      }
    if (!entries.length) return;
    set({ materials: lib });
    edit(entries.length === 1 ? `Import ${entries[0]!.name}` : 'Import materials', (p) => ({ ...p, library: [...p.library, ...entries] }));
  });
  return added;
}

// Export

const MAP_NAMES: Record<Channel, string> = { color: 'BaseColor', roughness: 'Roughness', metalness: 'Metallic', normal: 'Normal', height: 'Height', occlusion: 'AO', glow: 'Emissive', opacity: 'Opacity' };

/** A finished channel as image rows (top row first) in standard orientation, normals green up. */
function mapPixels(t: TextureSet, c: Channel, size: number): Uint8Array | null {
  const g = engine.sets.get(t.id);
  const src = g?.display.get(c);
  if (!g || !src) return null;
  let target = src;
  if (size !== src.width) {
    target = rt(size);
    g.p.copyTo(src.texture, target);
  }
  const px = g.p.read(target);
  if (target !== src) target.dispose();
  const n = size * 4;
  const out = new Uint8Array(px.length);
  for (let y = 0; y < size; y++) {
    const from = g.vUp ? size - 1 - y : y;
    out.set(px.subarray(from * n, from * n + n), y * n);
  }
  if (c === 'normal' && !g.vUp) for (let i = 1; i < out.length; i += 4) out[i] = 255 - out[i]!;
  return out;
}

function imageRows(px: Uint8Array, size: number, vUp: boolean): Uint8Array {
  if (!vUp) return px;
  const n = size * 4, out = new Uint8Array(px.length);
  for (let y = 0; y < size; y++) out.set(px.subarray((size - 1 - y) * n, (size - y) * n), y * n);
  return out;
}
const greenUp = (px: Uint8Array, vUp: boolean) => (vUp ? px : flipGreen(px));

const greyOf = (rgba: Uint8Array) => {
  const g = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < g.length; i++) g[i] = rgba[i * 4]!;
  return g;
};
const rgbOf = (rgba: Uint8Array) => {
  const o = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) o.set(rgba.subarray(i, i + 3), j);
  return o;
};
const flipGreen = (rgba: Uint8Array) => {
  const o = rgba.slice();
  for (let i = 1; i < o.length; i += 4) o[i] = 255 - o[i]!;
  return o;
};

async function pngOf(c: Channel, px: Uint8Array, size: number): Promise<Uint8Array> {
  return channelInfo(c).kind === 'grey' ? encodePng(size, size, 1, greyOf(px)) : encodePng(size, size, 3, rgbOf(px));
}

export async function exportTextures(sets: TextureSet[], meshMaps = false): Promise<void> {
  const s = get();
  const ex = s.project!.export;
  const folder = await host.folder();
  if (!folder) return;
  await busy('Exporting textures', async () => {
    engine.update();
    let n = 0;
    for (const t of sets) {
      const size = ex.size || t.size;
      const name = (map: string) => `${ex.naming.replace('{set}', t.name.replace(/[^\w-]+/g, '_')).replace('{map}', map)}.png`;
      const maps = new Map<Channel, Uint8Array>();
      for (const c of t.channels) {
        const px = mapPixels(t, c, size);
        if (px) maps.set(c, c === 'normal' && ex.normalGreen === 'down' ? flipGreen(px) : px);
      }
      if (ex.packOrm && maps.has('roughness') && maps.has('metalness')) {
        const o = maps.get('occlusion'), r = maps.get('roughness')!, m = maps.get('metalness')!;
        const orm = new Uint8Array(size * size * 3);
        for (let i = 0; i < size * size; i++) {
          orm[i * 3] = o ? o[i * 4]! : 255;
          orm[i * 3 + 1] = r[i * 4]!;
          orm[i * 3 + 2] = m[i * 4]!;
        }
        await host.writeIn(folder, name('OcclusionRoughnessMetallic'), await encodePng(size, size, 3, orm));
        n++;
        maps.delete('occlusion');
        maps.delete('roughness');
        maps.delete('metalness');
      }
      for (const [c, px] of maps) {
        await host.writeIn(folder, name(MAP_NAMES[c]), await pngOf(c, px, size));
        n++;
      }
      const g = engine.sets.get(t.id);
      if (meshMaps && g)
        for (const [m, target] of g.baked) {
          const px = imageRows(g.p.read(target), target.width, g.vUp);
          const grey = m === 'occlusion' || m === 'curvature' || m === 'thickness';
          const out = m === 'normal' ? (ex.normalGreen === 'down' ? flipGreen(greenUp(px, g.vUp)) : greenUp(px, g.vUp)) : px;
          const label = MESH_MAPS.find((x) => x.id === m)!.label.replace(/\s+/g, '');
          await host.writeIn(folder, name(`Mesh${label}`), grey ? await encodePng(target.width, target.width, 1, greyOf(out)) : await encodePng(target.width, target.width, 3, rgbOf(out)));
          n++;
        }
    }
    toast(`Exported ${n} image${n === 1 ? '' : 's'}`);
  });
}

/** A texture set as a CocoaSuite material, with its layer stack kept for CocoaSurface. */
export async function exportSetMaterial(t: TextureSet): Promise<void> {
  const path = await host.save(`${t.name}.cocoamat`, [MATERIAL_FILTER]);
  if (!path) return;
  await busy('Exporting the material', async () => {
    engine.update();
    const maps = new Map<Channel, Uint8Array>();
    for (const c of t.channels) {
      const px = mapPixels(t, c, t.size);
      if (px) maps.set(c, await pngOf(c, c === 'normal' ? flipGreen(px) : px, t.size));
    }
    const extra = new Map<string, Uint8Array>();
    const g = engine.sets.get(t.id)!;
    const ids = new Set(allLayers(t.layers).map((l) => l.id));
    for (const [layer, keys] of g.pixels) if (ids.has(layer)) for (const [key, target] of keys) extra.set(pixelPath(layer, key), await encodePng(target.width, target.height, 4, g.p.read(target)));
    const s = get();
    for (const l of allLayers(t.layers)) if (l.kind === 'fill' && l.use && s.materials[l.use.material]) extra.set(`materials/${l.use.material}.cocoamat`, s.materials[l.use.material]!.bytes);
    await host.write(path, await writeSetMaterial(setMaterial({ set: t, maps, generator: APP }), extra));
    toast(`Exported ${t.name}.cocoamat`);
  });
}

/** A library material with a fill layer's values: the same graph, its values changed, its baked maps redone. */
export async function exportFillMaterial(l: FillLayer): Promise<void> {
  const m = l.use && get().materials[l.use.material];
  if (!m) return;
  const f = m.file;
  const path = await host.save(`${f.manifest.name}.cocoamat`, [MATERIAL_FILTER]);
  if (!path) return;
  await busy('Exporting the material', async () => {
    const parameters = f.manifest.parameters.map((p) => (p.id in l.use!.values ? { ...p, value: l.use!.values[p.id] } : p));
    const manifest = { ...f.manifest, parameters, generator: APP };
    const baked = new Map<OutputRole, Uint8Array>();
    if (f.baked.size) {
      const size = f.manifest.baked?.size ?? f.manifest.evaluation.size;
      const maps = await evaluateMaps(m, l.use!.values, size);
      for (const role of f.baked.keys()) {
        const px = maps.get(role);
        if (!px) continue;
        const grey = !['color', 'normal', 'glow', 'wearColor'].includes(role);
        baked.set(role, grey ? await encodePng(size, size, 1, greyOf(px)) : await encodePng(size, size, 3, rgbOf(px)));
      }
      manifest.baked = { size, roles: [...baked.keys()] };
    }
    evaluable({ graph: f.graph, manifest });
    await host.write(path, await writeCocoaMat({ manifest, graph: f.graph, nodes: f.nodes, images: f.images, baked, ...(f.preview ? { preview: f.preview } : {}) }));
    toast(`Exported ${f.manifest.name}.cocoamat`);
  });
}

export async function importModelInto(): Promise<void> {
  const s = get();
  if (!s.project) return newFromModel();
  const [f] = await host.open([MODEL_FILTER]);
  if (!f) return;
  await busy('Replacing the model', async () => {
    const m = await loadModel(f.name, f.bytes);
    const missing = m.slots.filter((x) => !s.project!.textureSets.some((t) => t.slots.includes(x)));
    const kept: { set: string; layer: string; key: Key; px: Uint8Array; size: number }[] = [];
    for (const [id, g] of engine.sets) for (const [layer, keys] of g.pixels) for (const [key, t] of keys) kept.push({ set: id, layer, key, px: g.p.read(t), size: t.width });
    engine.setModel(m, f.bytes);
    clearHistory();
    set({
      project: { ...s.project!, model: { file: `model/${f.name}`, name: f.name }, textureSets: [...s.project!.textureSets, ...missing.map((x) => newTextureSet(x, [x]))] },
      warnings: m.warnings,
      dirty: true,
    });
    engine.syncSets(get().project);
    for (const k of kept) {
      const g = engine.sets.get(k.set);
      if (!g) continue;
      g.ensure();
      g.p.write(g.target(k.layer, k.key)!, k.px, k.size, k.size);
      engine.request(k.set);
    }
    view?.showModel();
    toast(missing.length ? `Added ${missing.length} texture set(s) for new material slots` : 'Model replaced; painting kept');
  });
}

window.addEventListener('beforeunload', (e) => {
  if (get().dirty) e.preventDefault();
});
