import * as THREE from 'three';
import { allLayers, pixelOwners, type Channel, type FillLayer, type MeshMap, type Project, type TextureSet } from '@cocoasurface/project';
import { get, useApp } from '../store';
import { BAKE_LAYER, Passes, SetGPU, type Key } from './gpu';
import { evaluateMaps, toTextures, type RoleTextures } from './library';
import type { LoadedModel } from './model';
import { ASSETS, assetOf, drawAsset, type Asset } from './procedural';

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
  /** Pictures used by masks, brushes and stencils, by their path in the project. */
  readonly images = new Map<string, { bytes: Uint8Array; tex: THREE.Texture; aspect: number; url?: string }>();

  async addImage(file: string, bytes: Uint8Array): Promise<void> {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const tex = new THREE.Texture(bmp);
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.images.get(file)?.tex.dispose();
    this.images.set(file, { bytes, tex, aspect: bmp.height / bmp.width });
    for (const id of this.sets.keys()) this.request(id);
  }

  /** Brush tips and stencils, kept for the session. */
  readonly toolImages = new Map<string, { tex: THREE.Texture; aspect: number; url: string }>();

  async addToolImage(name: string, bytes: Uint8Array): Promise<number> {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const tex = new THREE.Texture(bmp);
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    const old = this.toolImages.get(name);
    old?.tex.dispose();
    if (old) URL.revokeObjectURL(old.url);
    const aspect = bmp.height / bmp.width;
    this.toolImages.set(name, { tex, aspect, url: URL.createObjectURL(new Blob([bytes as BlobPart])) });
    return aspect;
  }

  private lib = new Map<string, THREE.WebGLRenderTarget>();
  private thumbs = new Map<string, string>();

  /** A library asset (`lib:<id>`) as a texture, made the first time it's asked for. */
  libTexture(ref: string): THREE.Texture | null {
    const a = assetOf(ref);
    if (!a || !this.r) return null;
    let t = this.lib.get(a.id);
    if (!t) this.lib.set(a.id, (t = drawAsset(this.r, a, 1024)));
    return t.texture;
  }

  /** A picture of an asset for the library grid. */
  thumb(a: Asset, size = 72): string {
    const key = `${a.id}@${size}`;
    let url = this.thumbs.get(key);
    if (url || !this.r) return url ?? '';
    const t = drawAsset(this.r, a, size);
    const px = new Uint8Array(size * size * 4);
    this.r.readRenderTargetPixels(t, 0, 0, size, size, px);
    t.dispose();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const img = c.getContext('2d')!.createImageData(size, size);
    for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    c.getContext('2d')!.putImageData(img, 0, 0);
    url = c.toDataURL();
    this.thumbs.set(key, url);
    return url;
  }

  private procs = new Map<string, THREE.WebGLRenderTarget>();

  /** A procedural (`proc:<asset>:<seed>:<contrast>:<balance>`), drawn when first asked for. */
  procTexture(ref: string): THREE.Texture | null {
    let t = this.procs.get(ref);
    if (!t) {
      const [, id, seed, contrast, balance] = ref.split(':');
      const a = assetOf(`lib:${id}`);
      if (!a || !this.r) return null;
      if (this.procs.size > 24) {
        const [k, old] = this.procs.entries().next().value!;
        old.dispose();
        this.procs.delete(k);
      }
      this.procs.set(ref, (t = drawAsset(this.r, a, 1024, Number(seed), Number(contrast), Number(balance))));
    }
    return t.texture;
  }

  /** A picture by its path in the project, a library asset or a procedural. */
  imageTexture(ref: string): THREE.Texture | null {
    return ref.startsWith('proc:') ? this.procTexture(ref) : (this.images.get(ref)?.tex ?? this.libTexture(ref));
  }

  /** A link to a project picture, for thumbnails. */
  imageUrl(file: string): string | undefined {
    const i = this.images.get(file);
    if (i && !i.url) i.url = URL.createObjectURL(new Blob([i.bytes as BlobPart]));
    return i?.url;
  }

  /** A brush tip or stencil picture: one the user chose this session, or a library asset. */
  toolImage(name: string): { tex: THREE.Texture; aspect: number; url: string } | null {
    const own = this.toolImages.get(name);
    if (own) return own;
    const img = this.images.get(name);
    if (img) return { tex: img.tex, aspect: img.aspect, url: this.imageUrl(name)! };
    const a = assetOf(name);
    const tex = a && this.libTexture(name);
    return a && tex ? { tex, aspect: 1, url: this.thumb(a, 256) } : null;
  }

  clearImages(): void {
    for (const i of this.images.values()) (i.tex.dispose(), i.url && URL.revokeObjectURL(i.url));
    this.images.clear();
  }

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
      g.composite(t.layers, t.channels, t.bump ?? 1, only, active, (l) => this.fillFor(t, l), (f) => this.imageTexture(f));
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

  channelMaterial(set: string, c: Channel | `mesh:${MeshMap}` | 'bake:skew' | 'bake:offset'): THREE.MeshBasicMaterial {
    let m = this.flat.get(set);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
      decode(m, ['map']);
      this.flat.set(set, m);
    }
    const g = this.sets.get(set);
    const bk = c.startsWith('bake:') ? (c.slice(5) as 'skew' | 'offset') : null;
    const tex = (bk ? (this.active?.layer === BAKE_LAYER ? g?.live.get(bk) : null) ?? g?.target(BAKE_LAYER, bk) : c.startsWith('mesh:') ? g?.baked.get(c.slice(5) as MeshMap) : g?.display.get(c as Channel))?.texture ?? null;
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
    return (get().project?.textureSets ?? []).flatMap((t) => allLayers(t.layers).flatMap(pixelOwners));
  }
}

export const engine = new Engine();
if (new URLSearchParams(location.search).has('inspect')) (window as unknown as { surface: unknown }).surface = { engine, get, set: useApp.setState, assets: ASSETS };

useApp.subscribe((s, prev) => {
  if (s.project !== prev.project) engine.syncSets(s.project);
  if (s.materials !== prev.materials) for (const t of s.project?.textureSets ?? []) engine.request(t.id);
});
