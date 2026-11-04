import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BLEND_MODES, channelInfo, type Channel, type FillLayer, type Layer, type TextureSet } from '@cocoasurface/project';
import type { Part } from './model';
import type { RoleTextures } from './library';
import { COMMIT_FS, COPY_FS, DAB_FS, DIST_FS, DIST_VS, FILL_FS, FINAL_FS, ISLAND_FS, LAYER_FS, MAX_DABS, QUAD_VS, UV_VS } from './shaders';

export type Key = Channel | 'mask';

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
  readonly final = shader(FINAL_FS, { u_src: { value: null }, u_island: { value: null }, u_height: { value: null }, u_kind: { value: 0 }, u_hasHeight: { value: 0 }, u_size: { value: 1 }, u_bump: { value: 8 } });
  readonly commit = shader(COMMIT_FS, { u_dst: { value: null }, u_stroke: { value: null }, u_value: { value: new THREE.Vector4() }, u_opacity: { value: 1 }, u_erase: { value: 0 } });
  readonly copy = shader(COPY_FS, { u_src: { value: null } });
  readonly fill = shader(FILL_FS, { u_value: { value: new THREE.Vector4() } });
  readonly island = shader(ISLAND_FS, {}, UV_VS, { side: THREE.DoubleSide });
  readonly dab = shader(
    DAB_FS,
    {
      u_viewProj: { value: new THREE.Matrix4() }, u_camPos: { value: new THREE.Vector3() }, u_camDir: { value: new THREE.Vector3() }, u_ortho: { value: 0 },
      u_screen: { value: new THREE.Vector2() }, u_depth: { value: null }, u_dabs: { value: Array.from({ length: MAX_DABS }, () => new THREE.Vector3()) },
      u_count: { value: 0 }, u_hardness: { value: 0.5 }, u_flow: { value: 1 },
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
  private proxies: { mesh: THREE.Mesh; inSet: boolean[] }[] = [];

  constructor(
    readonly p: Passes,
    public set: TextureSet,
    public vUp: boolean,
  ) {}

  setParts(parts: Part[]): void {
    this.scene.clear();
    this.proxies = [];
    for (const part of parts) {
      const inSet = part.slots.map((s) => this.set.slots.includes(s));
      if (!inSet.some(Boolean)) continue;
      const mesh = new THREE.Mesh(part.mesh.geometry, []);
      mesh.frustumCulled = false;
      this.proxies.push({ mesh, inSet });
      this.scene.add(mesh);
    }
    this.island?.dispose();
    this.island = null;
  }

  private draw(m: THREE.Material, target: THREE.WebGLRenderTarget): void {
    for (const x of this.proxies) x.mesh.material = x.inSet.map((b) => (b ? m : this.p.hidden));
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
      this.p.clear(t, key === 'mask' ? [1, 1, 1, 1] : [0, 0, 0, 0]);
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

  dabs(camera: THREE.Camera, screen: THREE.Vector2, dabs: THREE.Vector3[], hardness: number, flow: number): void {
    const u = this.p.dab.uniforms;
    (u.u_viewProj!.value as THREE.Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.getWorldPosition(u.u_camPos!.value);
    camera.getWorldDirection(u.u_camDir!.value);
    u.u_ortho!.value = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    (u.u_screen!.value as THREE.Vector2).copy(screen);
    u.u_depth!.value = this.p.depth!.texture;
    u.u_hardness!.value = Math.min(0.999, hardness);
    u.u_flow!.value = flow;
    for (let i = 0; i < dabs.length; i += MAX_DABS) {
      const batch = dabs.slice(i, i + MAX_DABS);
      batch.forEach((d, j) => (u.u_dabs!.value as THREE.Vector3[])[j]!.copy(d));
      u.u_count!.value = batch.length;
      this.draw(this.p.dab, this.stroke!);
    }
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
      u.u_erase!.value = o.erase && key !== 'mask' ? 1 : 0;
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

  // Compositing

  composite(layers: Layer[], channels: Channel[], bump: number, only: Channel[] | null, active: { layer: string; keys: Key[] } | null, fillTextures: (l: FillLayer) => { tex: RoleTextures; surface: Record<string, unknown> } | null): void {
    this.ensure();
    const island = this.islands();
    const order = flatten(layers).reverse();
    const ch = [...(only ?? channels)].filter((c) => channels.includes(c)).sort((a, b) => (a === 'height' ? -1 : b === 'height' ? 1 : 0));
    for (const c of ch) {
      const info = channelInfo(c);
      let [a, b] = this.work!;
      this.p.clear(a, [...NEUTRAL[c], 1]);
      for (const { layer: l, opacity } of order) {
        if (!l.channels.includes(c) || opacity <= 0) continue;
        const u = this.p.layer.uniforms;
        u.u_below!.value = a.texture;
        u.u_kind!.value = KIND[info.kind];
        u.u_blend!.value = BLEND_MODES.findIndex((m) => m.value === l.blend);
        u.u_opacity!.value = opacity;
        u.u_vUp!.value = this.vUp ? 1 : 0;
        u.u_flipG!.value = 0;
        u.u_tex!.value = null;
        const liveMask = active?.layer === l.id && active.keys.includes('mask') ? this.live.get('mask') : null;
        const mask = l.mask ? liveMask ?? this.target(l.id, 'mask', false) : null;
        u.u_hasMask!.value = mask ? 1 : 0;
        u.u_mask!.value = mask?.texture ?? null;
        if (l.kind === 'paint') {
          const t = (active?.layer === l.id && active.keys.includes(c) ? this.live.get(c) : null) ?? this.target(l.id, c, false);
          if (!t) continue;
          u.u_src!.value = 1;
          u.u_tex!.value = t.texture;
        } else if (l.kind === 'fill') {
          const f = l.use ? fillTextures(l) : null;
          const tex = f?.tex.get(c);
          (u.u_value!.value as THREE.Vector3).set(...flatValue(l, c, f?.surface));
          if (tex) {
            u.u_src!.value = 2;
            u.u_tex!.value = tex;
            u.u_scale!.value = l.use!.scale;
            u.u_flipG!.value = c === 'normal' && this.vUp ? 1 : 0;
          } else {
            u.u_src!.value = 0;
            if (c === 'normal') (u.u_value!.value as THREE.Vector3).set(0.5, 0.5, 1);
          }
        } else continue;
        this.p.run(this.p.layer, b);
        [a, b] = [b, a];
      }
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
      this.p.run(this.p.final, out);
    }
    for (const [c, t] of this.display)
      if (!channels.includes(c)) {
        t.dispose();
        this.display.delete(c);
      }
  }

  dispose(): void {
    for (const id of [...this.pixels.keys()]) this.dropLayer(id);
    for (const t of [...this.display.values(), ...this.live.values()]) t.dispose();
    this.work?.forEach((t) => t.dispose());
    this.island?.dispose();
    this.stroke?.dispose();
    for (const m of this.fills.values()) for (const t of m.values()) t.dispose();
  }
}

const CAM = new THREE.Camera();

function flatten(layers: Layer[], opacity = 1): { layer: Layer; opacity: number }[] {
  const out: { layer: Layer; opacity: number }[] = [];
  for (const l of layers) {
    if (!l.visible) continue;
    if (l.kind === 'group') out.push(...flatten(l.children, opacity * l.opacity));
    else out.push({ layer: l, opacity: opacity * l.opacity });
  }
  return out;
}

function flatValue(l: FillLayer, c: Channel, surface?: Record<string, unknown>): [number, number, number] {
  const s = surface as { color?: string; roughness?: number; metalness?: number } | undefined;
  switch (c) {
    case 'color':
      return hexRgb(s?.color ?? l.flat.color);
    case 'glow':
      return hexRgb(l.flat.glow);
    case 'roughness': {
      const v = s?.roughness ?? l.flat.roughness;
      return [v, v, v];
    }
    case 'metalness': {
      const v = s?.metalness ?? l.flat.metalness;
      return [v, v, v];
    }
    case 'normal':
      return [0.5, 0.5, 1];
    default: {
      const v = l.flat[c];
      return [v, v, v];
    }
  }
}

