import * as THREE from 'three';
import { BVHShaderGLSL, FloatVertexAttributeTexture, MeshBVH, MeshBVHUniformStruct } from 'three-mesh-bvh';
import type { BakeSettings, Bevel, MeshMap } from '@cocoasurface/project';
import { BAKE_LAYER, type SetGPU } from './gpu';
import type { LoadedModel } from './model';

export const partName = (m: LoadedModel, i: number) => m.parts[i]!.mesh.name || `Mesh ${i + 1}`;

/** A mesh name without its low/high suffix: `Body_low` and `body_high` both give `body`. */
export const stem = (name: string) => name.toLowerCase().replace(/[\s_.-]*(low|high|lowpoly|highpoly|lp|hp|lo|hi)(\.\d+)?$/, '').replace(/\.\d+$/, '');

/** Meshes of a model in one geometry, for ray casting, with a colour per mesh and per material slot. */
export function traceGeometry(m: LoadedModel, include: (i: number) => boolean = () => true): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], byMesh: number[] = [], bySlot: number[] = [], index: number[] = [];
  const colour = (i: number) => new THREE.Color().setHSL((i * 0.618034) % 1, 0.75, 0.55);
  let base = 0;
  m.parts.forEach((part, pi) => {
    if (!include(pi)) return;
    const g = part.mesh.geometry;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const mc = colour(pi);
    const slotOfVertex = new Int32Array(p.count);
    const idx = g.index;
    for (const grp of g.groups) {
      const slot = Math.max(0, m.slots.indexOf(part.slots[grp.materialIndex ?? 0] ?? ''));
      for (let i = grp.start; i < grp.start + grp.count; i++) {
        const v = idx ? idx.getX(i) : i;
        slotOfVertex[v] = slot;
        index.push(base + v);
      }
    }
    for (let v = 0; v < p.count; v++) {
      pos.push(p.getX(v), p.getY(v), p.getZ(v));
      nor.push(n.getX(v), n.getY(v), n.getZ(v));
      const sc = colour(slotOfVertex[v]! + 7);
      byMesh.push(mc.r, mc.g, mc.b, 1);
      bySlot.push(sc.r, sc.g, sc.b, 1);
    }
    base += p.count;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('idMesh', new THREE.Float32BufferAttribute(byMesh, 4));
  g.setAttribute('idSlot', new THREE.Float32BufferAttribute(bySlot, 4));
  g.setIndex(index);
  g.computeBoundingBox();
  return g;
}

export interface BakeSource {
  geometry: THREE.BufferGeometry;
  cpu: MeshBVH;
  bvh: MeshBVHUniformStruct;
  normals: FloatVertexAttributeTexture;
  idMesh: FloatVertexAttributeTexture;
  idSlot: FloatVertexAttributeTexture;
}

export function bakeSource(m: LoadedModel, include?: (i: number) => boolean): BakeSource | null {
  const geometry = traceGeometry(m, include);
  if (!geometry.index!.count) return null;
  const cpu = new MeshBVH(geometry);
  const bvh = new MeshBVHUniformStruct();
  bvh.updateFrom(cpu);
  const tex = (name: string) => {
    const t = new FloatVertexAttributeTexture();
    t.updateFrom(geometry.getAttribute(name) as THREE.BufferAttribute);
    return t;
  };
  return { geometry, cpu, bvh, normals: tex('normal'), idMesh: tex('idMesh'), idSlot: tex('idSlot') };
}

export function disposeSource(s: BakeSource): void {
  s.geometry.dispose();
  s.bvh.dispose();
  s.normals.dispose();
  s.idMesh.dispose();
  s.idSlot.dispose();
}

/** A cage for one low-poly mesh: how far in front of and behind it its high-poly surface lies (share of `diag`). */
export function autoCage(low: LoadedModel, part: number, src: BakeSource, diag: number): { front: number; rear: number } {
  const g = low.parts[part]!.mesh.geometry;
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const far = 0.15 * diag;
  const step = Math.max(1, Math.floor(p.count / 4000));
  const ray = new THREE.Ray();
  const fronts: number[] = [], rears: number[] = [];
  const o = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < p.count; i += step) {
    d.set(n.getX(i), n.getY(i), n.getZ(i)).normalize();
    o.set(p.getX(i), p.getY(i), p.getZ(i)).addScaledVector(d, far);
    ray.set(o, d.clone().negate());
    const hit = src.cpu.raycastFirst(ray, THREE.DoubleSide, 0, far * 2);
    if (!hit) continue;
    const x = hit.distance - far;
    if (x < 0) fronts.push(-x);
    else rears.push(x);
  }
  const pick = (v: number[]) => {
    if (!v.length) return 0;
    v.sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(v.length * 0.98))]!;
  };
  const min = 0.002 * diag;
  return { front: Math.max(min, pick(fronts) * 1.25 + min) / diag, rear: Math.max(min, pick(rears) * 1.25 + min) / diag };
}

const VS = /* glsl */ `
in vec2 cage;
out vec3 vWorld;
out vec3 vN;
out vec2 vUv;
out vec2 vCage;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  vUv = uv;
  vCage = cage;
  gl_Position = vec4(uv * 2. - 1., 0., 1.);
}`;

const FS = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
${BVHShaderGLSL.bvh_struct_definitions}
${BVHShaderGLSL.common_functions}
${BVHShaderGLSL.bvh_ray_functions}
in vec3 vWorld;
in vec3 vN;
in vec2 vUv;
in vec2 vCage;
out vec4 o;
uniform BVH bvh;
uniform sampler2D u_normals;
uniform sampler2D u_ids;
// Everything, as plain samplers: a second BVH struct uniform breaks some shader compilers.
uniform sampler2D u_allPos;
uniform usampler2D u_allIdx;
uniform sampler2D u_allBounds;
uniform usampler2D u_allContents;
uniform sampler2D u_normalsAll;
uniform sampler2D u_skew;
uniform sampler2D u_offset;
uniform sampler2D u_sp;
uniform sampler2D u_sn;
uniform sampler2D u_prev;
uniform int u_mode;       // 1 normal, 3 position, 4 id, 5 occlusion, 6 thickness, 7 surface point, 8 surface normal
uniform int u_high;
uniform float u_dist;
uniform int u_samples;
uniform float u_seed;
uniform vec3 u_min;
uniform vec3 u_size;
uniform int u_bevel;
uniform float u_bevelR;
uniform int u_bevelN;
uniform int u_bevelEdges; // 0 both, 1 convex, 2 concave

uint seed;
float rnd() {
  seed = seed * 747796405u + 2891336453u;
  uint w = ((seed >> ((seed >> 28u) + 4u)) ^ seed) * 277803737u;
  return float((w >> 22u) ^ w) / 4294967295.;
}

void frame(vec3 n, out vec3 t, out vec3 b) {
  t = normalize(abs(n.y) < .99 ? cross(n, vec3(0., 1., 0.)) : cross(n, vec3(1., 0., 0.)));
  b = cross(n, t);
}

vec3 hemi(vec3 n) {
  vec3 t, b;
  frame(n, t, b);
  float a = rnd() * 6.2831853, r = sqrt(rnd());
  return normalize(t * cos(a) * r + b * sin(a) * r + n * sqrt(max(0., 1. - r * r)));
}

#if STAGE == 1 || STAGE == 3
// The pair's own high-poly surface (projection), and everything (occlusion, bevel).
bool traceOwn(vec3 ro, vec3 rd, out vec3 n, out vec4 id, out float dist) {
  uvec4 f = uvec4(0u); vec3 fn = vec3(0.), bc = vec3(0.); float side = 1.;
  dist = 0.;
  bool hit = bvhIntersectFirstHit(bvh, ro, rd, f, fn, bc, side, dist);
  if (hit) { n = normalize(textureSampleBarycoord(u_normals, bc, f.xyz).xyz); id = texelFetch1D(u_ids, f.x); }
  return hit;
}
#endif

#if STAGE >= 3
bool traceAll(vec3 ro, vec3 rd, out vec3 n, out float dist) {
  uvec4 f = uvec4(0u); vec3 fn = vec3(0.), bc = vec3(0.); float side = 1.;
  dist = 0.;
  bool hit = _bvhIntersectFirstHit(u_allPos, u_allIdx, u_allBounds, u_allContents, ro, rd, f, fn, bc, side, dist);
  if (hit) n = normalize(textureSampleBarycoord(u_normalsAll, bc, f.xyz).xyz);
  return hit;
}
#endif

#if STAGE == 3
// Blend in the normals of surfaces within the radius, picked on discs around the point along three axes.
vec3 bevel(vec3 p, vec3 n) {
  vec3 t, b;
  frame(n, t, b);
  vec3 sum = n * .5;
  vec3 ax = n, dp = p;
  for (int i = 0; i < 128; i++) {
    if (i >= u_bevelN * 2) break;
    if (i % 2 == 0) {
      // The same spiral of points around every texel, so the rounding is smooth rather than grainy.
      int k = i / 2, a = k % 4;
      vec3 a1 = t, a2 = b;
      ax = n;
      if (a == 2) { ax = t; a1 = b; a2 = n; } else if (a == 3) { ax = b; a1 = n; a2 = t; }
      float ang = float(k) * 2.3999632, rr = u_bevelR * sqrt((float(k) + .5) / float(u_bevelN));
      dp = p + (a1 * cos(ang) + a2 * sin(ang)) * rr;
    }
    vec3 dir = i % 2 == 0 ? -ax : ax;
    vec3 ro = dp - dir * u_bevelR;
    vec3 hn; float d;
    if (!traceAll(ro, dir, hn, d) || d > 2. * u_bevelR) continue;
    vec3 hp = ro + dir * d;
    float dist = length(hp - p);
    if (dist >= u_bevelR || dot(hn, n) < -.2) continue;
    float above = dot(hp - p, n);
    if ((u_bevelEdges == 1 && above > u_bevelR * .05) || (u_bevelEdges == 2 && above < -u_bevelR * .05)) continue;
    sum += hn * (1. - dist / u_bevelR);
  }
  return normalize(sum);
}
#endif

void main() {
  vec3 N = normalize(vN);
  vec3 q0 = dFdx(vWorld), q1 = dFdy(vWorld);
  vec3 Nf = cross(q0, q1);
  Nf = length(Nf) > 0. ? normalize(Nf) : N;
  if (dot(Nf, N) < 0.) Nf = -Nf;
  seed = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(u_seed) * 26699u | 1u;

#if STAGE == 2
  if (u_mode == 1) {
    // Tangent space as the viewer builds it from the texture coordinates (cotangent frame).
    vec3 T = cross(q1, N), B = cross(N, q0);
    float s = inversesqrt(max(dot(T, T), dot(B, B)));
    mat3 tbn = mat3(T * s, B * s, N);
    vec3 sn = texelFetch(u_sn, ivec2(gl_FragCoord.xy), 0).xyz;
    o = vec4(normalize(inverse(tbn) * sn) * .5 + .5, 1.);
    return;
  }
  if (u_mode == 3) {
    o = vec4((texelFetch(u_sp, ivec2(gl_FragCoord.xy), 0).xyz - u_min) / u_size, 1.);
    return;
  }
#elif STAGE == 4
  {
    vec3 sp = texelFetch(u_sp, ivec2(gl_FragCoord.xy), 0).xyz;
    vec3 sn = texelFetch(u_sn, ivec2(gl_FragCoord.xy), 0).xyz;
    float sum = texelFetch(u_prev, ivec2(gl_FragCoord.xy), 0).r;
    float eps = .0015;
    bool ao = u_mode == 5;
    vec3 side = ao ? sn : -sn;
    for (int i = 0; i < 64; i++) {
      if (i >= u_samples) break;
      vec3 hn; float d;
      bool hit = traceAll(sp + side * eps, hemi(side), hn, d);
      if (ao) sum += hit && d < u_dist ? (d / u_dist) * (d / u_dist) : 1.;
      else sum += hit ? min(d / u_dist, 1.) : 1.;
    }
    o = vec4(vec3(sum), 1.);
    return;
  }
#else
  // Find the surface: from the cage (painted offset scales it) along the normal (painted skew turns it to the face normal).
  float skew = texture(u_skew, vUv).r;
  float off = texture(u_offset, vUv).r * 2.;
  vec3 dir = normalize(mix(N, Nf, skew));
  float front = vCage.x * off, rear = vCage.y * off;
  vec3 ro = vWorld + dir * front;
  vec3 hn; vec4 hid; float d;
  bool found = traceOwn(ro, -dir, hn, hid, d) && d <= front + rear;
  vec3 sp = (found && u_high == 1) ? ro - dir * d : vWorld;
  vec3 sn = (found && u_high == 1) ? hn : N;

  if (u_mode == 4) o = found ? vec4(hid.rgb, 1.) : vec4(0., 0., 0., 1.);
  else if (u_mode == 7) o = vec4(sp, found ? 1. : 0.);
#if STAGE == 3
  else o = vec4(bevel(sp, sn), 1.);
#else
  else o = vec4(sn, 1.);
#endif
#endif
}`;

const CURVE_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_n;
uniform sampler2D u_p;
uniform sampler2D u_island;
uniform float u_px;
uniform float u_scale;
float k(vec2 d) {
  vec2 a = vUv - d, b = vUv + d;
  if (texture(u_island, a).r < .5 || texture(u_island, b).r < .5) return 0.;
  vec3 dn = texture(u_n, b).xyz - texture(u_n, a).xyz;
  vec3 dp = texture(u_p, b).xyz - texture(u_p, a).xyz;
  float l = dot(dp, dp);
  return l > 1e-14 ? dot(dn, dp) / l : 0.;
}
void main() {
  float c = .5 * (k(vec2(u_px * 1.5, 0.)) + k(vec2(0., u_px * 1.5)));
  o = vec4(vec3(.5 + .5 * tanh(c * u_scale)), 1.);
}`;

/** Down to the map's size (averaging the samples inside the UV islands), padded past the island edges. */
const ENCODE_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_islandHi;
uniform sampler2D u_island;
uniform float u_px;
uniform float u_div;
uniform int u_ss;
uniform int u_kind;      // 0 as is, 1 raw normal
vec3 one(vec2 uv) {
  vec3 c = texture(u_src, uv).rgb / u_div;
  if (u_kind == 1) c = normalize(c) * .5 + .5;
  return c;
}
vec3 val(vec2 uv) {
  vec3 s = vec3(0.);
  float w = 0.;
  for (int y = 0; y < 4; y++)
    for (int x = 0; x < 4; x++) {
      if (x >= u_ss || y >= u_ss) continue;
      vec2 q = uv + (vec2(float(x), float(y)) + .5 - float(u_ss) * .5) / float(u_ss) * u_px;
      if (texture(u_islandHi, q).r < .5) continue;
      s += one(q);
      w += 1.;
    }
  return clamp(w > 0. ? s / w : one(uv), 0., 1.);
}
void main() {
  vec2 at = vUv;
  bool inside = texture(u_island, vUv).r > .5;
  for (int r = 1; r <= 16 && !inside; r++)
    for (int i = 0; i < 8 && !inside; i++) {
      float a = float(i) * .7853982;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * float(r) * u_px;
      if (texture(u_island, uv).r > .5) { at = uv; inside = true; }
    }
  o = vec4(val(at), 1.);
}`;

const QUAD = /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const PER_PASS = 8;
const TILE = 256;
/** Float targets are this large at most (memory), so anti-aliasing is lowered for big maps. */
const MAX_WORK = 4096;

export interface BakeProgress {
  done: number;
  total: number;
}

export interface BakeSources {
  /** What occlusion, thickness and bevel see. */
  all: BakeSource;
  /** What a low-poly part projects onto. */
  own(part: number): BakeSource;
}

function flat(v: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** Bake mesh maps for one texture set. The maps land in `g.baked`, padded past the UV edges. */
export async function bakeSet(
  g: SetGPU,
  low: LoadedModel,
  src: BakeSources,
  high: boolean,
  st: BakeSettings,
  bevel: Bevel | null,
  progress: (p: BakeProgress) => void,
  cancelled: () => boolean,
): Promise<boolean> {
  const r = g.p.r;
  const size = st.size;
  const ss = Math.max(1, Math.min(st.antialias, Math.floor(MAX_WORK / size)));
  const work = size * ss;
  const box = src.all.geometry.boundingBox!.clone().union(new THREE.Box3().setFromObject(low.root));
  const bsize = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-6, 1e-6, 1e-6));
  const diag = box.getSize(new THREE.Vector3()).length() || 1;
  const parts = g.parts;

  // Cages, per mesh, as a vertex attribute.
  for (const i of parts) {
    const geo = low.parts[i]!.mesh.geometry;
    const c = high ? (st.cages[partName(low, i)] ?? { front: st.front, rear: st.rear }) : { front: 0.0005, rear: 0.0005 };
    const a = new Float32Array(geo.getAttribute('position').count * 2);
    for (let k = 0; k < a.length; k += 2) {
      a[k] = c.front * diag;
      a[k + 1] = c.rear * diag;
    }
    geo.setAttribute('cage', new THREE.BufferAttribute(a, 2));
  }

  const painted = g.pixels.get(BAKE_LAYER);
  const zero = flat(0), half = flat(128);
  const all = src.all.bvh as unknown as Record<'position' | 'index' | 'bvhBounds' | 'bvhContents', THREE.Texture>;
  const uniforms: Record<string, THREE.IUniform> = {
      bvh: { value: src.all.bvh },
      u_normals: { value: src.all.normals },
      u_ids: { value: src.all.idSlot },
      u_allPos: { value: all.position },
      u_allIdx: { value: all.index },
      u_allBounds: { value: all.bvhBounds },
      u_allContents: { value: all.bvhContents },
      u_normalsAll: { value: src.all.normals },
      u_skew: { value: painted?.get('skew')?.texture ?? zero },
      u_offset: { value: painted?.get('offset')?.texture ?? half },
      u_sp: { value: null },
      u_sn: { value: null },
      u_prev: { value: null },
      u_mode: { value: 1 },
      u_high: { value: high ? 1 : 0 },
      u_dist: { value: st.aoDistance * diag },
      u_samples: { value: PER_PASS },
      u_seed: { value: 0 },
      u_min: { value: box.min.clone() },
      u_size: { value: bsize },
      u_bevel: { value: bevel ? 1 : 0 },
      u_bevelR: { value: (bevel?.radius ?? 0) * diag },
      u_bevelN: { value: bevel?.samples ?? 0 },
      u_bevelEdges: { value: bevel ? ['both', 'convex', 'concave'].indexOf(bevel.edges) : 0 },
  };
  // Two programs, so neither needs more texture units than graphics cards have.
  const stage = (n: number) => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide, depthTest: false, depthWrite: false, uniforms, defines: { STAGE: n } });
  const stages = [stage(1), stage(2), stage(3), stage(4)] as const;
  const mat = { uniforms };
  const float = () => new THREE.WebGLRenderTarget(work, work, { type: THREE.FloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false });
  const islandHi = g.islandAt(work);
  const island = g.islandAt(size);
  const raw = new Map<string, THREE.WebGLRenderTarget>();
  const pool: THREE.WebGLRenderTarget[] = [];
  const want = new Set(st.maps);
  const groups = st.matchByName && high ? parts.map((p) => [p]) : [parts];

  type Pass = { out: string; mode: number; seed: number; reads?: string[] };
  const passes: Pass[] = [{ out: 'sp', mode: 7, seed: 0 }, { out: 'sn', mode: 8, seed: 0 }];
  if (want.has('normal')) passes.push({ out: 'normal', mode: 1, seed: 0 });
  if (want.has('position')) passes.push({ out: 'position', mode: 3, seed: 0 });
  if (want.has('id')) passes.push({ out: 'id', mode: 4, seed: 0 });
  for (const [m, mode] of [['occlusion', 5], ['thickness', 6]] as const)
    if (want.has(m)) for (let i = 0; i < Math.ceil(st.aoSamples / PER_PASS); i++) passes.push({ out: m, mode, seed: i + 1 });
  const total = passes.length + 1;
  const sync = new Float32Array(4);
  let last = performance.now();
  const auto = r.autoClear, prev = r.getRenderTarget();
  const clearTo = (t: THREE.WebGLRenderTarget) => {
    r.setRenderTarget(t);
    r.setClearColor(0x000000, 0);
    r.clear();
  };
  const quad = (fs: string, u: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: QUAD, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
  const curve = quad(CURVE_FS, { u_n: { value: null }, u_p: { value: null }, u_island: { value: islandHi.texture }, u_px: { value: 1 / work }, u_scale: { value: 0.12 * diag } });
  const enc = quad(ENCODE_FS, { u_src: { value: null }, u_islandHi: { value: islandHi.texture }, u_island: { value: island.texture }, u_px: { value: 1 / size }, u_div: { value: 1 }, u_ss: { value: ss }, u_kind: { value: 0 } });
  try {
    // Build every program before the heavy drawing starts.
    const warm = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
    for (const m of stages) if (m !== stages[2] || bevel) g.drawWith(m, warm);
    g.p.run(curve, warm);
    g.p.run(enc, warm);
    r.readRenderTargetPixels(warm, 0, 0, 1, 1, new Float32Array(4));
    warm.dispose();
    for (let i = 0; i < passes.length; i++) {
      if (cancelled()) return false;
      const ps = passes[i]!;
      let t = raw.get(ps.out);
      if (ps.seed > 0) {
        // Running sums swap between two targets, so texels shared by mirrored UVs aren't counted twice.
        let before = t;
        if (!before) clearTo((before = pool.pop() ?? float()));
        t = pool.pop() ?? float();
        clearTo(t);
        mat.uniforms.u_prev!.value = before.texture;
        raw.set(ps.out, t);
        pool.push(before);
      } else if (!t) {
        raw.set(ps.out, (t = float()));
        clearTo(t);
      }
      mat.uniforms.u_mode!.value = ps.mode;
      mat.uniforms.u_seed!.value = ps.seed;
      mat.uniforms.u_sp!.value = raw.get('sp')?.texture ?? null;
      mat.uniforms.u_sn!.value = raw.get('sn')?.texture ?? null;
      r.autoClear = false;
      for (let y = 0; y < work; y += TILE)
        for (let x = 0; x < work; x += TILE) {
          if (cancelled()) return false;
          t.scissor.set(x, y, Math.min(TILE, work - x), Math.min(TILE, work - y));
          t.scissorTest = true;
          for (const grp of groups) {
            const own = grp.length === 1 ? src.own(grp[0]!) : src.all;
            mat.uniforms.bvh!.value = own.bvh;
            mat.uniforms.u_normals!.value = own.normals;
            mat.uniforms.u_ids!.value = st.idFrom === 'mesh' ? own.idMesh : own.idSlot;
            g.drawWith(stages[ps.mode === 8 && bevel ? 2 : ps.mode === 4 || ps.mode >= 7 ? 0 : ps.mode >= 5 ? 3 : 1], t, grp.length === 1 ? grp[0] : undefined);
          }
          r.readRenderTargetPixels(t, x, y, 1, 1, sync);
          if (performance.now() - last > 30) {
            progress({ done: i + (y * work + (x + TILE) * Math.min(TILE, work - y)) / (work * work), total });
            await new Promise((res) => requestAnimationFrame(res));
            last = performance.now();
          }
        }
      t.scissorTest = false;
      progress({ done: i + 1, total });
    }
    if (want.has('curvature')) {
      const t = float();
      curve.uniforms.u_n!.value = raw.get('sn')!.texture;
      curve.uniforms.u_p!.value = raw.get('sp')!.texture;
      g.p.run(curve, t);
      raw.set('curvature', t);
    }
    if (want.has('worldNormal')) raw.set('worldNormal', raw.get('sn')!);
    for (const m of st.maps) {
      const s = raw.get(m);
      if (!s) continue;
      enc.uniforms.u_src!.value = s.texture;
      enc.uniforms.u_div!.value = m === 'occlusion' || m === 'thickness' ? Math.ceil(st.aoSamples / PER_PASS) * PER_PASS : 1;
      enc.uniforms.u_kind!.value = m === 'worldNormal' ? 1 : 0;
      g.setBaked(m as MeshMap, (out) => g.p.run(enc, out), size);
    }
    for (const m of [...g.baked.keys()]) if (!want.has(m)) g.dropBaked(m);
    progress({ done: total, total });
    return true;
  } finally {
    r.autoClear = auto;
    r.setRenderTarget(prev);
    for (const t of new Set([...raw.values(), ...pool])) t.dispose();
    stages.forEach((m) => m.dispose());
    curve.dispose();
    enc.dispose();
    zero.dispose();
    half.dispose();
  }
}
