import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BLEND_MODES, blendIn, GENERATOR_SOURCES, proceduralRef, MASK_BLENDS, NOISE_TYPES, type Effect, type FlatValues, type Mask, channelInfo, type Channel, type FillLayer, type Layer, type TextureSet } from '@cocoasurface/project';
import type { Part } from './model';
import type { RoleTextures } from './library';
import { COMMIT_FS, COPY_FS, DAB_FS, DIST_FS, DIST_VS, EFFECT_FS, FILL_FS, FINAL_FS, ISLAND_FS, ISLAND_VS, LAYER_FS, MASK_FS, MAX_DABS, PICK_FS, QUAD_VS, SMEAR_FS, UV_VS } from './shaders';

export type Key = Channel | 'grey' | 'skew' | 'offset';
/** Pixels painted for baking (skew and offset) live under this layer id. */
export const BAKE_LAYER = '#bake';

const shader = (fs: string, uniforms: Record<string, THREE.IUniform>, vs = QUAD_VS, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
  new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vs, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });

export function rt(size: number, display = false): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    magFilter: THREE.LinearFilter,
    minFilter: display ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    generateMipmaps: display,
    depthBuffer: false,
  });
  if (display) t.texture.anisotropy = 8;
  return t;
}

export const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

const NEUTRAL: Record<Channel, [number, number, number]> = {
  color: [0, 0, 0],
  roughness: [1, 1, 1],
  metalness: [0, 0, 0],
  normal: [0.5, 0.5, 1],
  height: [0.5, 0.5, 0.5],
  occlusion: [1, 1, 1],
  glow: [0, 0, 0],
  opacity: [1, 1, 1],
};

const KIND = { color: 0, grey: 1, normal: 2 } as const;

/** Passes shared by every texture set (one renderer). */
export class Passes {
  readonly quad = new FullScreenQuad();
  readonly layer = shader(LAYER_FS, {
    u_below: { value: null }, u_tex: { value: null }, u_mask: { value: null }, u_src: { value: 0 }, u_kind: { value: 0 }, u_blend: { value: 0 },
    u_hasMask: { value: 0 }, u_vUp: { value: 0 }, u_flipG: { value: 0 }, u_value: { value: new THREE.Vector3() }, u_scale: { value: 1 }, u_opacity: { value: 1 },
  });
  readonly final = shader(FINAL_FS, { u_src: { value: null }, u_island: { value: null }, u_height: { value: null }, u_ao: { value: null }, u_hasAo: { value: 0 }, u_kind: { value: 0 }, u_hasHeight: { value: 0 }, u_size: { value: 1 }, u_bump: { value: 8 } });
  readonly commit = shader(COMMIT_FS, { u_dst: { value: null }, u_stroke: { value: null }, u_value: { value: new THREE.Vector4() }, u_opacity: { value: 1 }, u_erase: { value: 0 } });
  readonly mask = shader(MASK_FS, {
    u_below: { value: null }, u_tex: { value: null }, u_src: { value: 0 }, u_blend: { value: 0 }, u_ch: { value: 0 }, u_invert: { value: 0 }, u_vUp: { value: 0 },
    u_value: { value: 1 }, u_opacity: { value: 1 }, u_level: { value: 0.5 }, u_spread: { value: 0.1 }, u_scale: { value: 1 }, u_radius: { value: 0 }, u_noise: { value: 0 }, u_noiseScale: { value: 1 }, u_seed: { value: 0 }, u_pos: { value: null }, u_hasPos: { value: 0 }, u_noiseType: { value: 0 }, u_noiseTex: { value: null }, u_nrm: { value: null }, u_hasNrm: { value: 0 }, u_levels: { value: new THREE.Vector3(0, 1, 1) },
  });
  readonly effect = shader(EFFECT_FS, {
    u_below: { value: null }, u_tex: { value: null }, u_src: { value: 0 }, u_kind: { value: 0 }, u_blend: { value: 0 }, u_vUp: { value: 0 }, u_flipG: { value: 0 }, u_ch: { value: 0 }, u_invert: { value: 0 },
    u_value: { value: new THREE.Vector3() }, u_value2: { value: new THREE.Vector3() }, u_levels: { value: new THREE.Vector3(0, 1, 1) }, u_hsl: { value: new THREE.Vector3() }, u_scale: { value: 1 }, u_opacity: { value: 1 }, u_level: { value: 0.5 }, u_spread: { value: 0.1 }, u_radius: { value: 0 }, u_noise: { value: 0 }, u_noiseScale: { value: 1 }, u_seed: { value: 0 }, u_pos: { value: null }, u_hasPos: { value: 0 }, u_noiseType: { value: 0 }, u_noiseTex: { value: null }, u_nrm: { value: null }, u_hasNrm: { value: 0 },
  });
  readonly smear = shader(SMEAR_FS, { u_dst: { value: null }, u_stroke: { value: null }, u_mode: { value: 0 }, u_radius: { value: 0 }, u_offset: { value: new THREE.Vector2() }, u_opacity: { value: 1 } });
  readonly pick = shader(PICK_FS, { u_island: { value: -1 } }, ISLAND_VS, { side: THREE.DoubleSide });
  readonly copy = shader(COPY_FS, { u_src: { value: null } });
  readonly fill = shader(FILL_FS, { u_value: { value: new THREE.Vector4() } });
  readonly island = shader(ISLAND_FS, {}, UV_VS, { side: THREE.DoubleSide });
  readonly dab = shader(
    DAB_FS,
    {
      u_viewProj: { value: new THREE.Matrix4() }, u_camPos: { value: new THREE.Vector3() }, u_camDir: { value: new THREE.Vector3() }, u_ortho: { value: 0 },
      u_screen: { value: new THREE.Vector2() }, u_depth: { value: null }, u_dabs: { value: Array.from({ length: MAX_DABS }, () => new THREE.Vector4()) },
      u_count: { value: 0 }, u_hardness: { value: 0.5 }, u_flow: { value: 1 }, u_shape: { value: 0 }, u_angle: { value: 0 }, u_alpha: { value: null },
      u_hasStencil: { value: 0 }, u_stencil: { value: null }, u_stencilAt: { value: new THREE.Vector4() }, u_stencilAspect: { value: 1 },
    },
    UV_VS,
    { side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcColorFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor },
  );
  readonly dist = shader(DIST_FS, { u_camPos: { value: new THREE.Vector3() }, u_camDir: { value: new THREE.Vector3() }, u_ortho: { value: 0 } }, DIST_VS, { depthTest: true, depthWrite: true, side: THREE.DoubleSide });
  readonly hidden = new THREE.MeshBasicMaterial({ visible: false });
  depth: THREE.WebGLRenderTarget | null = null;
  readonly depthScene = new THREE.Scene();

  constructor(readonly r: THREE.WebGLRenderer) {}

  run(m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = m;
    const prev = this.r.getRenderTarget();
    this.r.setRenderTarget(target);
    this.quad.render(this.r);
    this.r.setRenderTarget(prev);
  }

  clear(target: THREE.WebGLRenderTarget, v: [number, number, number, number]): void {
    (this.fill.uniforms.u_value!.value as THREE.Vector4).set(...v);
    this.run(this.fill, target);
  }

  copyTo(src: THREE.Texture, dst: THREE.WebGLRenderTarget): void {
    this.copy.uniforms.u_src!.value = src;
    this.run(this.copy, dst);
  }

  setParts(parts: Part[]): void {
    this.depthScene.clear();
    for (const p of parts) {
      const m = new THREE.Mesh(p.mesh.geometry, this.dist);
      m.frustumCulled = false;
      this.depthScene.add(m);
    }
  }

  /** Distance from the camera to the nearest surface, per screen pixel: what a brush can reach. */
  measure(camera: THREE.Camera, w: number, h: number): void {
    if (!this.depth || this.depth.width !== w || this.depth.height !== h) {
      this.depth?.dispose();
      this.depth = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RedFormat, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true });
    }
    const u = this.dist.uniforms;
    camera.getWorldPosition(u.u_camPos!.value);
    camera.getWorldDirection(u.u_camDir!.value);
    u.u_ortho!.value = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    const prev = this.r.getRenderTarget();
    const cc = this.r.getClearColor(new THREE.Color()), ca = this.r.getClearAlpha();
    this.r.setRenderTarget(this.depth);
    this.r.setClearColor(new THREE.Color(1e9, 1e9, 1e9), 1);
    this.r.clear();
    this.r.render(this.depthScene, camera);
    this.r.setRenderTarget(prev);
    this.r.setClearColor(cc, ca);
  }

  read(target: THREE.WebGLRenderTarget): Uint8Array {
    const px = new Uint8Array(target.width * target.height * 4);
    this.r.readRenderTargetPixels(target, 0, 0, target.width, target.height, px);
    return px;
  }

  /** Pixels (row 0 at v = 0) into a render target. */
  write(target: THREE.WebGLRenderTarget, img: ImageBitmap | Uint8Array, w = target.width, h = target.height): void {
    const t = img instanceof Uint8Array ? new THREE.DataTexture(img, w, h) : new THREE.Texture(img);
    t.flipY = false;
    t.premultiplyAlpha = false;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    this.copyTo(t, target);
    t.dispose();
  }
}

export interface StrokeOptions {
  key: Key;
  layer: string;
  /** Per channel, straight RGBA. */
  values: Map<Key, [number, number, number, number]>;
  opacity: number;
  erase: boolean;
}

/** How a brush dab looks: its tip and the stencil it paints through. */
export interface Tip {
  hardness: number;
  flow: number;
  shape: 0 | 1 | 2;
  angle: number;
  alpha: THREE.Texture | null;
  stencil: { tex: THREE.Texture; at: THREE.Vector4; aspect: number } | null;
}

/** One texture set on the graphics card: painted pixels, the composited channels and their finished maps. */
export class SetGPU {
  size = 0;
  readonly display = new Map<Channel, THREE.WebGLRenderTarget>();
  /** Painted pixels by layer, then channel or mask. */
  readonly pixels = new Map<string, Map<Key, THREE.WebGLRenderTarget>>();
  /** Material maps used by fill layers. */
  readonly fills = new Map<string, RoleTextures>();
  private work: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private island: THREE.WebGLRenderTarget | null = null;
  private stroke: THREE.WebGLRenderTarget | null = null;
  /** While a stroke is drawn: the layer's pixels with the stroke in them. */
  readonly live = new Map<Key, THREE.WebGLRenderTarget>();
  readonly scene = new THREE.Scene();
  private proxies: { mesh: THREE.Mesh; inSet: boolean[]; part: number }[] = [];

  constructor(
    readonly p: Passes,
    public set: TextureSet,
    public vUp: boolean,
  ) {}

  setParts(parts: Part[]): void {
    this.scene.clear();
    this.proxies = [];
    for (const [i, part] of parts.entries()) {
      const inSet = part.slots.map((s) => this.set.slots.includes(s));
      if (!inSet.some(Boolean)) continue;
      const mesh = new THREE.Mesh(part.mesh.geometry, []);
      mesh.frustumCulled = false;
      this.proxies.push({ mesh, inSet, part: i });
      this.scene.add(mesh);
    }
    this.island?.dispose();
    this.island = null;
    for (const t of this.islandsBySize.values()) t.dispose();
    this.islandsBySize.clear();
  }

  /** Mesh maps by name, padded. */
  readonly baked = new Map<import('@cocoasurface/project').MeshMap, THREE.WebGLRenderTarget>();
  private islandsBySize = new Map<number, THREE.WebGLRenderTarget>();

  islandAt(size: number): THREE.WebGLRenderTarget {
    if (size === this.size) return this.islands();
    let t = this.islandsBySize.get(size);
    if (!t) {
      t = rt(size);
      this.p.clear(t, [0, 0, 0, 1]);
      this.draw(this.p.island, t);
      this.islandsBySize.set(size, t);
    }
    return t;
  }

  /** Model parts this set paints. */
  get parts(): number[] {
    return this.proxies.map((x) => x.part);
  }

  /** Draws a part with another geometry until `restore` is called. */
  useGeometry(part: number, geo: THREE.BufferGeometry): () => void {
    const x = this.proxies.find((y) => y.part === part);
    if (!x) return () => {};
    const old = x.mesh.geometry;
    x.mesh.geometry = geo;
    return () => void (x.mesh.geometry = old);
  }

  drawWith(m: THREE.Material, target: THREE.WebGLRenderTarget, part?: number): void {
    this.draw(m, target, part);
  }

  setBaked(m: import('@cocoasurface/project').MeshMap, fill: (t: THREE.WebGLRenderTarget) => void, size: number): void {
    let t = this.baked.get(m);
    if (!t || t.width !== size) {
      t?.dispose();
      t = rt(size, true);
      this.baked.set(m, t);
    }
    fill(t);
  }

  dropBaked(m: import('@cocoasurface/project').MeshMap): void {
    this.baked.get(m)?.dispose();
    this.baked.delete(m);
  }

  private draw(m: THREE.Material, target: THREE.WebGLRenderTarget, part?: number): void {
    for (const x of this.proxies) x.mesh.material = x.inSet.map((b) => (b && (part === undefined || part === x.part) ? m : this.p.hidden));
    const r = this.p.r, prev = r.getRenderTarget(), auto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(target);
    r.render(this.scene, CAM);
    r.setRenderTarget(prev);
    r.autoClear = auto;
  }

  /** Make sure targets exist at the set's size; resizing resamples painted pixels. */
  ensure(): void {
    const n = this.set.size;
    if (n === this.size) return;
    for (const m of this.pixels.values())
      for (const [k, t] of m) {
        const next = rt(n);
        this.p.copyTo(t.texture, next);
        t.dispose();
        m.set(k, next);
      }
    for (const t of this.display.values()) t.dispose();
    this.display.clear();
    this.work?.forEach((t) => t.dispose());
    this.work = [rt(n), rt(n)];
    this.island?.dispose();
    this.island = null;
    this.stroke?.dispose();
    this.stroke = null;
    this.size = n;
  }

  private islands(): THREE.WebGLRenderTarget {
    if (!this.island) {
      this.island = rt(this.size);
      this.p.clear(this.island, [0, 0, 0, 1]);
      this.draw(this.p.island, this.island);
    }
    return this.island;
  }

  target(layer: string, key: Key, create = true): THREE.WebGLRenderTarget | null {
    let m = this.pixels.get(layer);
    if (!m) {
      if (!create) return null;
      m = new Map();
      this.pixels.set(layer, m);
    }
    let t = m.get(key);
    if (!t && create) {
      t = rt(this.size);
      this.p.clear(t, key === 'skew' ? [0, 0, 0, 1] : key === 'offset' ? [0.5, 0.5, 0.5, 1] : [0, 0, 0, 0]);
      m.set(key, t);
    }
    return t ?? null;
  }

  /** Put pixels in place of a layer's (for undo); returns the ones taken out. */
  swap(layer: string, key: Key, next: THREE.WebGLRenderTarget | null): THREE.WebGLRenderTarget | null {
    let m = this.pixels.get(layer);
    if (!m) this.pixels.set(layer, (m = new Map()));
    const old = m.get(key) ?? null;
    if (next) m.set(key, next);
    else m.delete(key);
    return old;
  }

  dropLayer(layer: string): void {
    for (const t of this.pixels.get(layer)?.values() ?? []) t.dispose();
    this.pixels.delete(layer);
  }

  // Strokes

  beginStroke(): void {
    if (!this.stroke) this.stroke = rt(this.size);
    this.p.clear(this.stroke, [0, 0, 0, 0]);
  }

  dabs(camera: THREE.Camera, screen: THREE.Vector2, dabs: THREE.Vector4[], tip: Tip): void {
    const u = this.p.dab.uniforms;
    (u.u_viewProj!.value as THREE.Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.getWorldPosition(u.u_camPos!.value);
    camera.getWorldDirection(u.u_camDir!.value);
    u.u_ortho!.value = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    (u.u_screen!.value as THREE.Vector2).copy(screen);
    u.u_depth!.value = this.p.depth!.texture;
    u.u_hardness!.value = Math.min(0.999, tip.hardness);
    u.u_flow!.value = tip.flow;
    u.u_shape!.value = tip.alpha ? tip.shape : Math.min(tip.shape, 1);
    u.u_angle!.value = tip.angle;
    u.u_alpha!.value = tip.alpha;
    u.u_hasStencil!.value = tip.stencil ? 1 : 0;
    u.u_stencil!.value = tip.stencil?.tex ?? null;
    if (tip.stencil) {
      (u.u_stencilAt!.value as THREE.Vector4).copy(tip.stencil.at);
      u.u_stencilAspect!.value = tip.stencil.aspect;
    }
    for (let i = 0; i < dabs.length; i += MAX_DABS) {
      const batch = dabs.slice(i, i + MAX_DABS);
      batch.forEach((d, j) => (u.u_dabs!.value as THREE.Vector4[])[j]!.copy(d));
      u.u_count!.value = batch.length;
      this.draw(this.p.dab, this.stroke!);
    }
  }

  /** The fill tool: a whole UV island of a part (or the whole part) becomes the stroke. */
  fillPart(part: number, island: number): void {
    this.p.pick.uniforms.u_island!.value = island;
    this.draw(this.p.pick, this.stroke!, part);
  }

  /** Smudge or blur what this frame's dabs cover, into `live`, then start the next frame's dabs afresh. */
  smearStroke(o: StrokeOptions, mode: 0 | 1, radius: number, offset: THREE.Vector2): void {
    const u = this.p.smear.uniforms;
    for (const key of o.values.keys()) {
      const prev = this.live.get(key);
      const src = prev ?? this.target(o.layer, key)!;
      const out = rt(this.size);
      u.u_dst!.value = src.texture;
      u.u_stroke!.value = this.stroke!.texture;
      u.u_mode!.value = mode;
      u.u_radius!.value = radius;
      (u.u_offset!.value as THREE.Vector2).copy(offset);
      u.u_opacity!.value = o.opacity;
      this.p.run(this.p.smear, out);
      prev?.dispose();
      this.live.set(key, out);
    }
    this.p.clear(this.stroke!, [0, 0, 0, 0]);
  }

  /** The stroke so far, on top of the layer's pixels, into `live` (shown while drawing). */
  preview(o: StrokeOptions): void {
    for (const [key, v] of o.values) {
      const dst = this.target(o.layer, key)!;
      let out = this.live.get(key);
      if (!out) this.live.set(key, (out = rt(this.size)));
      const u = this.p.commit.uniforms;
      u.u_dst!.value = dst.texture;
      u.u_stroke!.value = this.stroke!.texture;
      (u.u_value!.value as THREE.Vector4).set(v[0] * v[3], v[1] * v[3], v[2] * v[3], v[3]);
      u.u_opacity!.value = o.opacity;
      u.u_erase!.value = o.erase && key !== 'skew' && key !== 'offset' ? 1 : 0;
      this.p.run(this.p.commit, out);
    }
  }

  /** The stroke becomes part of the layer. Returns the pixels it replaced (for undo). */
  endStroke(o: StrokeOptions): Map<Key, THREE.WebGLRenderTarget> {
    const old = new Map<Key, THREE.WebGLRenderTarget>();
    for (const key of o.values.keys()) {
      const next = this.live.get(key);
      if (!next) continue;
      this.live.delete(key);
      const prev = this.swap(o.layer, key, next);
      if (prev) old.set(key, prev);
    }
    return old;
  }

  // Masks

  private maskRts = new Map<string, THREE.WebGLRenderTarget>();
  private maskWork: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;

  /** A layer's mask as last built, if it has one. */
  maskTexture(layer: string): THREE.Texture | null {
    return this.maskRts.get(layer)?.texture ?? null;
  }

  /** A layer's mask, built from its items. */
  maskOf(layer: string, m: Mask, active: { layer: string; keys: Key[] } | null, image: (file: string) => THREE.Texture | null): THREE.WebGLRenderTarget {
    if (!this.maskWork || this.maskWork[0].width !== this.size) {
      this.maskWork?.forEach((t) => t.dispose());
      this.maskWork = [rt(this.size), rt(this.size)];
    }
    let [a, b] = this.maskWork;
    this.p.clear(a, [m.base, m.base, m.base, 1]);
    const u = this.p.mask.uniforms;
    for (const it of [...m.items].reverse()) {
      if (!it.visible || it.opacity <= 0) continue;
      u.u_below!.value = a.texture;
      u.u_tex!.value = null;
      u.u_blend!.value = Math.max(0, MASK_BLENDS.findIndex((x) => x.value === it.blend));
      u.u_opacity!.value = it.opacity;
      u.u_invert!.value = 0;
      u.u_vUp!.value = this.vUp ? 1 : 0;
      if (it.kind === 'paint') {
        const t = (active?.layer === it.id ? this.live.get('grey') : null) ?? this.target(it.id, 'grey', false);
        if (!t) continue;
        u.u_src!.value = 1;
        u.u_tex!.value = t.texture;
      } else if (it.kind === 'generator' && it.generator) {
        const g = it.generator;
        const src = GENERATOR_SOURCES.find((x) => x.value === g.source)!;
        const t = this.baked.get(src.map);
        if (!t) continue;
        u.u_src!.value = 2;
        u.u_tex!.value = t.texture;
        u.u_ch!.value = src.map === 'position' || src.map === 'worldNormal' ? 1 : 0;
        u.u_level!.value = g.level;
        u.u_spread!.value = g.spread;
        this.noiseOf(u, g, image);
        u.u_invert!.value = (g.invert ? 1 : 0) ^ (g.source === 'occlusion' ? 1 : 0);
      } else if (it.kind === 'image' && it.image) {
        const t = image(it.image.file);
        if (!t) continue;
        u.u_src!.value = 3;
        u.u_tex!.value = t;
        u.u_scale!.value = it.image.scale;
        u.u_invert!.value = it.image.invert ? 1 : 0;
      } else if (it.kind === 'procedural' && it.procedural) {
        const t = image(proceduralRef(it.procedural));
        if (!t) continue;
        u.u_src!.value = 3;
        u.u_tex!.value = t;
        u.u_scale!.value = it.procedural.scale;
        u.u_invert!.value = it.procedural.invert ? 1 : 0;
      } else if (it.kind === 'levels' && it.levels) {
        u.u_src!.value = 10;
        (u.u_levels!.value as THREE.Vector3).set(it.levels.low, it.levels.high, it.levels.gamma);
      } else if (it.kind === 'invert') u.u_src!.value = 11;
      else if (it.kind === 'blur') {
        u.u_src!.value = 13;
        u.u_radius!.value = it.radius ?? 0.005;
      } else if (it.kind === 'fill') {
        u.u_src!.value = 0;
        u.u_value!.value = it.value ?? 1;
      } else continue;
      this.p.run(this.p.mask, b);
      [a, b] = [b, a];
    }
    let out = this.maskRts.get(layer);
    if (!out || out.width !== this.size) {
      out?.dispose();
      this.maskRts.set(layer, (out = rt(this.size)));
    }
    this.p.copyTo(a.texture, out);
    return out;
  }

  private noiseOf(u: Record<string, THREE.IUniform>, g: import('@cocoasurface/project').Generator, image: (file: string) => THREE.Texture | null): void {
    const pos = this.baked.get('position'), nrm = this.baked.get('worldNormal');
    const pic = g.noiseType === 'image' && g.noiseImage ? image(g.noiseImage.file) : null;
    u.u_noiseType!.value = pic ? 4 : Math.max(0, NOISE_TYPES.indexOf(g.noiseType ?? 'clouds'));
    u.u_noiseTex!.value = pic;
    u.u_nrm!.value = nrm?.texture ?? null;
    u.u_hasNrm!.value = nrm ? 1 : 0;
    u.u_noise!.value = g.noise ?? 0;
    u.u_noiseScale!.value = g.noiseScale ?? 1;
    u.u_seed!.value = g.seed ?? 0;
    u.u_pos!.value = pos?.texture ?? null;
    u.u_hasPos!.value = pos ? 1 : 0;
  }

  // Compositing

  private levels: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget][] = [];
  private fxWork: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;

  /** Work targets for groups nested `depth` deep. */
  private level(depth: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    if (depth === 0) return this.work!;
    let w = this.levels[depth];
    if (!w || w[0].width !== this.size) {
      w?.forEach((t) => t.dispose());
      this.levels[depth] = w = [rt(this.size), rt(this.size)];
    }
    return w;
  }

  composite(layers: Layer[], channels: Channel[], bump: number, only: Channel[] | null, active: { layer: string; keys: Key[] } | null, fillTextures: (l: FillLayer) => { tex: RoleTextures; surface: Record<string, unknown> } | null, image: (file: string) => THREE.Texture | null = () => null): void {
    this.ensure();
    const island = this.islands();
    const masks = new Map<string, THREE.WebGLRenderTarget>();
    const visit = (ls: Layer[]) => {
      for (const l of ls) {
        if (!l.visible) continue;
        if (l.mask) masks.set(l.id, this.maskOf(l.id, l.mask, active, image));
        if (l.kind === 'group') visit(l.children);
      }
    };
    visit(layers);
    const ch = [...(only ?? channels)].filter((c) => channels.includes(c)).sort((a, b) => (a === 'height' ? -1 : b === 'height' ? 1 : 0));
    for (const c of ch) {
      const info = channelInfo(c);
      const w = this.level(0);
      const base = c === 'normal' ? this.baked.get('normal') : undefined;
      if (base) this.p.copyTo(base.texture, w[0]);
      else this.p.clear(w[0], [...NEUTRAL[c], 1]);
      const a = this.stack(layers, c, KIND[info.kind], w, w[0], 0, { masks, active, fillTextures, image });
      let out = this.display.get(c);
      if (!out) this.display.set(c, (out = rt(this.size, true)));
      const f = this.p.final.uniforms;
      f.u_src!.value = a.texture;
      f.u_island!.value = island.texture;
      f.u_kind!.value = KIND[info.kind];
      f.u_size!.value = this.size;
      f.u_bump!.value = (this.size / 256) * bump;
      const h = this.display.get('height');
      f.u_hasHeight!.value = c === 'normal' && h && channels.includes('height') ? 1 : 0;
      f.u_height!.value = c === 'normal' ? (h?.texture ?? null) : null;
      const ao = c === 'occlusion' ? this.baked.get('occlusion') : undefined;
      f.u_hasAo!.value = ao ? 1 : 0;
      f.u_ao!.value = ao?.texture ?? null;
      this.p.run(this.p.final, out);
    }
    for (const [c, t] of this.display)
      if (!channels.includes(c)) {
        t.dispose();
        this.display.delete(c);
      }
  }

  /** Layers bottom to top over `a` (one of `pair`); returns the target holding the result. */
  private stack(layers: Layer[], c: Channel, kind: number, pair: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget], a: THREE.WebGLRenderTarget, depth: number, ctx: Ctx): THREE.WebGLRenderTarget {
    const u = this.p.layer.uniforms;
    for (const l of [...layers].reverse()) {
      const own = blendIn(l, c);
      if (!l.visible || own.opacity <= 0) continue;
      const b = a === pair[0] ? pair[1] : pair[0];
      let src: 0 | 1 | 2 | 3, tex: THREE.Texture | null = null, blend = BLEND_MODES.findIndex((m) => m.value === own.blend);
      u.u_flipG!.value = 0;
      if (l.kind === 'group') {
        // Normal groups pass through: their layers blend with what's below, then the mask and opacity mix that in.
        const inner = this.level(depth + 1);
        const through = own.blend === 'normal';
        if (through) this.p.copyTo(a.texture, inner[0]);
        else this.p.clear(inner[0], c === 'normal' ? [0.5, 0.5, 1, 0] : [...NEUTRAL[c], 0]);
        tex = this.stack(l.children, c, kind, inner, inner[0], depth + 1, ctx).texture;
        const fx = l.effects?.filter((e) => e.visible && e.opacity > 0) ?? [];
        if (fx.length) tex = this.content(l, fx, c, kind, ctx, tex)!.texture;
        src = 3;
        if (through) blend = 8;
      } else {
        if (!l.channels.includes(c)) continue;
        const fx = l.effects?.filter((e) => e.visible && e.opacity > 0) ?? [];
        if (fx.length) {
          const t = this.content(l, fx, c, kind, ctx);
          if (!t) continue;
          src = 3;
          tex = t.texture;
        } else if (l.kind === 'paint') {
          const t = this.painted(l.id, c, ctx.active);
          if (!t) continue;
          src = 1;
          tex = t.texture;
        } else {
          const f = l.use ? ctx.fillTextures(l) : null;
          const mt = f?.tex.get(c);
          (u.u_value!.value as THREE.Vector3).set(...flatValue(l.flat, c, f?.surface));
          if (mt) {
            src = 2;
            tex = mt;
            u.u_scale!.value = l.use!.scale;
            u.u_flipG!.value = c === 'normal' && this.vUp ? 1 : 0;
          } else src = 0;
        }
      }
      u.u_below!.value = a.texture;
      u.u_kind!.value = kind;
      u.u_blend!.value = blend;
      u.u_opacity!.value = own.opacity;
      u.u_vUp!.value = this.vUp ? 1 : 0;
      u.u_src!.value = src;
      u.u_tex!.value = tex;
      const mask = ctx.masks.get(l.id);
      u.u_hasMask!.value = mask ? 1 : 0;
      u.u_mask!.value = mask?.texture ?? null;
      this.p.run(this.p.layer, b);
      a = b;
    }
    return a;
  }

  private painted(id: string, c: Key, active: Ctx['active']): THREE.WebGLRenderTarget | null {
    return (active?.layer === id && active.keys.includes(c) ? this.live.get(c) : null) ?? this.target(id, c, false);
  }

  /** What a layer with effects puts in a channel: its own content, then its effects bottom to top. */
  private content(l: Layer, fx: Effect[], c: Channel, kind: number, ctx: Ctx, base?: THREE.Texture): THREE.WebGLRenderTarget | null {
    if (!this.fxWork || this.fxWork[0].width !== this.size) {
      this.fxWork?.forEach((t) => t.dispose());
      this.fxWork = [rt(this.size), rt(this.size)];
    }
    let [a, b] = this.fxWork;
    this.p.clear(a, c === 'normal' ? [0.5, 0.5, 1, 0] : [...NEUTRAL[c], 0]);
    const u = this.p.effect.uniforms;
    const pass = () => {
      u.u_below!.value = a.texture;
      u.u_kind!.value = kind;
      u.u_vUp!.value = this.vUp ? 1 : 0;
      this.p.run(this.p.effect, b);
      [a, b] = [b, a];
    };
    u.u_blend!.value = 0;
    u.u_opacity!.value = 1;
    u.u_flipG!.value = 0;
    u.u_invert!.value = 0;
    if (base) this.p.copyTo(base, a);
    else if (l.kind === 'paint') {
      const t = this.painted(l.id, c, ctx.active);
      if (t) {
        u.u_src!.value = 1;
        u.u_tex!.value = t.texture;
        pass();
      }
    } else if (l.kind === 'fill') {
      const f = l.use ? ctx.fillTextures(l) : null;
      const mt = f?.tex.get(c);
      (u.u_value!.value as THREE.Vector3).set(...flatValue(l.flat, c, f?.surface));
      u.u_src!.value = mt ? 2 : 0;
      u.u_tex!.value = mt ?? null;
      if (mt) {
        u.u_scale!.value = l.use!.scale;
        u.u_flipG!.value = c === 'normal' && this.vUp ? 1 : 0;
      }
      pass();
    }
    for (const e of [...fx].reverse()) {
      u.u_blend!.value = Math.max(0, BLEND_MODES.findIndex((m) => m.value === e.blend));
      u.u_opacity!.value = e.opacity;
      u.u_flipG!.value = 0;
      u.u_invert!.value = 0;
      u.u_tex!.value = null;
      const normal = c === 'normal';
      if (e.kind === 'paint') {
        const t = this.painted(e.id, c, ctx.active);
        if (!t) continue;
        u.u_src!.value = 1;
        u.u_tex!.value = t.texture;
      } else if (e.kind === 'fill') {
        if (normal || !e.flat) continue;
        u.u_src!.value = 0;
        (u.u_value!.value as THREE.Vector3).set(...flatValue(e.flat, c));
      } else if (e.kind === 'generator' && e.generator) {
        const g = e.generator;
        const s = GENERATOR_SOURCES.find((x) => x.value === g.source)!;
        const t = this.baked.get(s.map);
        if (normal || !t) continue;
        u.u_src!.value = 3;
        u.u_tex!.value = t.texture;
        u.u_ch!.value = s.map === 'position' || s.map === 'worldNormal' ? 1 : 0;
        u.u_level!.value = g.level;
        u.u_spread!.value = g.spread;
        this.noiseOf(u, g, ctx.image);
        u.u_invert!.value = (g.invert ? 1 : 0) ^ (g.source === 'occlusion' ? 1 : 0);
      } else if (e.kind === 'image' && e.image) {
        const t = ctx.image(e.image.file);
        if (normal || !t) continue;
        u.u_src!.value = 4;
        u.u_tex!.value = t;
        u.u_scale!.value = e.image.scale;
        u.u_invert!.value = e.image.invert ? 1 : 0;
      } else if (e.kind === 'procedural' && e.procedural) {
        const t = ctx.image(proceduralRef(e.procedural));
        if (normal || !t) continue;
        u.u_src!.value = 5;
        u.u_tex!.value = t;
        u.u_scale!.value = e.procedural.scale;
        u.u_invert!.value = e.procedural.invert ? 1 : 0;
        (u.u_value!.value as THREE.Vector3).set(...hexRgb(e.procedural.colors[0]));
        (u.u_value2!.value as THREE.Vector3).set(...hexRgb(e.procedural.colors[1]));
      } else if (e.kind === 'levels' && e.levels) {
        if (normal) continue;
        u.u_src!.value = 10;
        (u.u_levels!.value as THREE.Vector3).set(e.levels.low, e.levels.high, e.levels.gamma);
      } else if (e.kind === 'invert') {
        if (normal) continue;
        u.u_src!.value = 11;
      } else if (e.kind === 'hsl' && e.hsl) {
        if (normal) continue;
        u.u_src!.value = 12;
        (u.u_hsl!.value as THREE.Vector3).set(e.hsl.hue, e.hsl.saturation, e.hsl.lightness);
      } else if (e.kind === 'blur') {
        u.u_src!.value = 13;
        u.u_radius!.value = e.radius ?? 0.005;
      } else continue;
      pass();
    }
    return a;
  }

  dispose(): void {
    for (const id of [...this.pixels.keys()]) this.dropLayer(id);
    for (const t of [...this.display.values(), ...this.live.values()]) t.dispose();
    this.work?.forEach((t) => t.dispose());
    this.island?.dispose();
    this.stroke?.dispose();
    for (const t of [...this.baked.values(), ...this.islandsBySize.values(), ...this.maskRts.values()]) t.dispose();
    this.maskWork?.forEach((t) => t.dispose());
    this.fxWork?.forEach((t) => t.dispose());
    for (const w of this.levels) w?.forEach((t) => t.dispose());
    for (const m of this.fills.values()) for (const t of m.values()) t.dispose();
  }
}

const CAM = new THREE.Camera();

interface Ctx {
  masks: Map<string, THREE.WebGLRenderTarget>;
  active: { layer: string; keys: Key[] } | null;
  fillTextures: (l: FillLayer) => { tex: RoleTextures; surface: Record<string, unknown> } | null;
  image: (file: string) => THREE.Texture | null;
}

function flatValue(flat: FlatValues, c: Channel, surface?: Record<string, unknown>): [number, number, number] {
  const s = surface as { color?: string; roughness?: number; metalness?: number } | undefined;
  switch (c) {
    case 'color':
      return hexRgb(s?.color ?? flat.color);
    case 'glow':
      return hexRgb(flat.glow);
    case 'roughness': {
      const v = s?.roughness ?? flat.roughness;
      return [v, v, v];
    }
    case 'metalness': {
      const v = s?.metalness ?? flat.metalness;
      return [v, v, v];
    }
    case 'normal':
      return [0.5, 0.5, 1];
    default: {
      const v = flat[c];
      return [v, v, v];
    }
  }
}

