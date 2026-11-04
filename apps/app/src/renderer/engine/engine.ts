import * as THREE from 'three';
import { allLayers, type Channel, type FillLayer, type MeshMap, type Project, type TextureSet } from '@cocoasurface/project';
import { get, useApp } from '../store';
import { Passes, SetGPU, type Key } from './gpu';
import { evaluateMaps, toTextures, type RoleTextures } from './library';
import type { LoadedModel } from './model';

const decode = (m: THREE.Material, maps: string[]) => {
  m.onBeforeCompile = (s) => {
    if (maps.includes('map'))
      s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor *= sRGBTransferEOTF(texture2D(map, vMapUv));\n#endif');
    if (maps.includes('emissive'))
      s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#ifdef USE_EMISSIVEMAP\n totalEmissiveRadiance *= sRGBTransferEOTF(texture2D(emissiveMap, vEmissiveMapUv)).rgb;\n#endif');
  };
  m.customProgramCacheKey = () => `cs-${maps.join()}`;
};

interface FillEntry {
  key: string;
  tex: RoleTextures | null;
  surface: Record<string, unknown>;
  running: string | null;
}

class Engine {
  r: THREE.WebGLRenderer | null = null;
  p: Passes | null = null;
  model: LoadedModel | null = null;
  modelBytes: Uint8Array | null = null;
  high: LoadedModel | null = null;
  highBytes: Uint8Array | null = null;
  readonly sets = new Map<string, SetGPU>();
  private lit = new Map<string, THREE.MeshStandardMaterial>();
  private flat = new Map<string, THREE.MeshBasicMaterial>();
  private fills = new Map<string, FillEntry>();
  private pending = new Map<string, Set<Channel> | 'all'>();
  /** Something on screen changed: draw again. */
  onChange: () => void = () => {};
  /** The layer whose stroke is in progress. */
  active: { set: string; layer: string; keys: Key[] } | null = null;

  private waiting: (() => void)[] = [];

  /** Resolves once the viewport has given the engine its renderer. */
  ready(): Promise<void> {
    return this.p ? Promise.resolve() : new Promise((res) => this.waiting.push(res));
  }

  attach(r: THREE.WebGLRenderer): void {
    this.r = r;
    this.p = new Passes(r);
    for (const w of this.waiting.splice(0)) setTimeout(w, 0);
    if (this.model) this.p.setParts(this.model.parts);
    this.syncSets(get().project);
  }

  setModel(m: LoadedModel | null, bytes: Uint8Array | null): void {
    for (const s of this.sets.values()) s.dispose();
    this.sets.clear();
    this.fills.clear();
    this.model = m;
    this.modelBytes = bytes;
    this.high = null;
    this.highBytes = null;
    if (m) this.p?.setParts(m.parts);
  }

  /** Follow the project: one SetGPU per texture set. Painted pixels stay while undo may need them. */
  syncSets(p: Project | null): void {
    if (!this.p || !this.model) return;
    const live = new Set(p?.textureSets.map((t) => t.id) ?? []);
    for (const [id, g] of this.sets)
      if (!live.has(id) && !p) {
        g.dispose();
        this.sets.delete(id);
      }
    for (const t of p?.textureSets ?? []) {
      let g = this.sets.get(t.id);
      if (!g) {
        g = new SetGPU(this.p, t, this.model.vUp);
        g.setParts(this.model.parts);
        this.sets.set(t.id, g);
        this.pending.set(t.id, 'all');
      } else if (g.set !== t) {
        const slots = g.set.slots.join() !== t.slots.join();
        g.set = t;
        if (slots) g.setParts(this.model.parts);
        this.pending.set(t.id, 'all');
      }
    }
    this.onChange();
  }

  request(set: string, channels?: Channel[]): void {
    const cur = this.pending.get(set);
    if (cur === 'all') return;
    if (!channels) this.pending.set(set, 'all');
    else this.pending.set(set, new Set([...(cur ?? []), ...channels]));
    this.onChange();
  }

  private fillFor(set: TextureSet, l: FillLayer): { tex: RoleTextures; surface: Record<string, unknown> } | null {
    const use = l.use!;
    const m = get().materials[use.material];
    if (!m) return null;
    const size = Math.min(set.size, 1024);
    const key = `${use.material}|${size}|${JSON.stringify(use.values)}`;
    let e = this.fills.get(l.id);
    if (!e) this.fills.set(l.id, (e = { key: '', tex: null, surface: m.file.manifest.surface, running: null }));
    if (e.key !== key && e.running !== key) {
      e.running = key;
      const entry = e;
      setTimeout(async () => {
        if (entry.running !== key) return;
        try {
          const maps = await evaluateMaps(m, use.values, size);
          if (entry.running !== key) return;
          for (const t of entry.tex?.values() ?? []) t.dispose();
          entry.tex = toTextures(maps, size);
          entry.key = key;
          entry.surface = m.file.manifest.surface;
        } catch (err) {
          useApp.setState({ warnings: [...get().warnings, `“${m.file.manifest.name}” could not be drawn: ${(err as Error).message}`] });
        }
        entry.running = null;
        this.request(set.id);
      }, 30);
    }
    return e.tex ? { tex: e.tex, surface: e.surface } : null;
  }

  /** Run the compositing that's waiting. */
  update(): boolean {
    if (!this.p || !this.pending.size) return false;
    const p = get().project;
    for (const [id, what] of this.pending) {
      const g = this.sets.get(id);
      const t = p?.textureSets.find((x) => x.id === id);
      if (!g || !t) continue;
      const active = this.active?.set === id ? this.active : null;
      const only = what === 'all' ? null : [...what];
      if (only?.includes('height') && !only.includes('normal')) only.push('normal');
      g.composite(t.layers, t.channels, t.bump ?? 1, only, active, (l) => this.fillFor(t, l));
      this.bind(t, g);
    }
    this.pending.clear();
    return true;
  }

  private bind(t: TextureSet, g: SetGPU): void {
    const m = this.litMaterial(t.id);
    const d = (c: Channel) => g.display.get(c)?.texture ?? null;
    const want = { map: d('color'), roughnessMap: d('roughness'), metalnessMap: d('metalness'), normalMap: d('normal'), aoMap: d('occlusion') ?? g.baked.get('occlusion')?.texture ?? null, emissiveMap: d('glow'), alphaMap: d('opacity') };
    let changed = false;
    for (const [k, v] of Object.entries(want))
      if ((m as unknown as Record<string, unknown>)[k] !== v) {
        (m as unknown as Record<string, unknown>)[k] = v;
        changed = true;
      }
    m.color.set(want.map ? 0xffffff : 0x9a9a9a);
    m.roughness = want.roughnessMap ? 1 : 0.7;
    m.metalness = want.metalnessMap ? 1 : 0;
    m.emissive.set(want.emissiveMap ? 0xffffff : 0x000000);
    m.alphaTest = want.alphaMap ? 0.5 : 0;
    if (changed) m.needsUpdate = true;
  }

  litMaterial(set: string): THREE.MeshStandardMaterial {
    let m = this.lit.get(set);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
      decode(m, ['map', 'emissive']);
      this.lit.set(set, m);
    }
    return m;
  }

  channelMaterial(set: string, c: Channel | `mesh:${MeshMap}`): THREE.MeshBasicMaterial {
    let m = this.flat.get(set);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
      decode(m, ['map']);
      this.flat.set(set, m);
    }
    const g = this.sets.get(set);
    const tex = (c.startsWith('mesh:') ? g?.baked.get(c.slice(5) as MeshMap) : g?.display.get(c as Channel))?.texture ?? null;
    if (m.map !== tex) {
      m.map = tex;
      m.needsUpdate = true;
    }
    m.color.set(tex ? 0xffffff : 0x000000);
    return m;
  }

  /** Painted keys of a layer that have pixels. */
  keysOf(set: string, layer: string): Key[] {
    return [...(this.sets.get(set)?.pixels.get(layer)?.keys() ?? [])];
  }

  forgetFills(layerIds: string[]): void {
    for (const id of layerIds) {
      const e = this.fills.get(id);
      for (const t of e?.tex?.values() ?? []) t.dispose();
      this.fills.delete(id);
    }
  }

  layerIds(): string[] {
    return (get().project?.textureSets ?? []).flatMap((t) => allLayers(t.layers).map((l) => l.id));
  }
}

export const engine = new Engine();
if (new URLSearchParams(location.search).has('inspect')) (window as unknown as { surface: unknown }).surface = { engine, get };

useApp.subscribe((s, prev) => {
  if (s.project !== prev.project) engine.syncSets(s.project);
  if (s.materials !== prev.materials) for (const t of s.project?.textureSets ?? []) engine.request(t.id);
});
