import * as THREE from 'three';
import { BVHShaderGLSL, FloatVertexAttributeTexture, MeshBVH, MeshBVHUniformStruct } from 'three-mesh-bvh';
import type { BakeLight, BakeSettings, Bevel, MeshMap } from '@cocoasurface/project';
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

/**
 * Normals averaged over vertices at the same place, ignoring hard edges and UV splits: the directions rays are cast
 * along, so the two sides of a hard edge meet without a gap or a seam.
 */
export function averagedNormals(g: THREE.BufferGeometry): Float32Array {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const box = g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox!);
  const q = 1e5 / (box.getSize(new THREE.Vector3()).length() || 1);
  const key = (i: number) => `${Math.round(p.getX(i) * q)},${Math.round(p.getY(i) * q)},${Math.round(p.getZ(i) * q)}`;
  const sums = new Map<string, THREE.Vector3>();
  const keys: string[] = [];
  // Weighted by the area and corner angle of each face, so a split cube corner points out evenly.
  const idx = g.index;
  const count = idx ? idx.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  const faceSum = new Float32Array(p.count * 3);
  for (let t = 0; t < count; t += 3) {
    const v = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
    a.fromBufferAttribute(p, v[0]!);
    b.fromBufferAttribute(p, v[1]!);
    c.fromBufferAttribute(p, v[2]!);
    fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    if (fn.lengthSq() === 0) continue;
    fn.normalize();
    // Wound the wrong way for its own normals: turn it round.
    let along = 0;
    for (const vi of v) along += fn.x * n.getX(vi) + fn.y * n.getY(vi) + fn.z * n.getZ(vi);
    if (along < 0) fn.negate();
    const pts = [a.clone(), b.clone(), c.clone()];
    for (let k = 0; k < 3; k++) {
      const o = pts[k]!, u = pts[(k + 1) % 3]!.clone().sub(o), w = pts[(k + 2) % 3]!.clone().sub(o);
      const ang = u.angleTo(w);
      const vi = v[k]!;
      faceSum[vi * 3] = faceSum[vi * 3]! + fn.x * ang;
      faceSum[vi * 3 + 1] = faceSum[vi * 3 + 1]! + fn.y * ang;
      faceSum[vi * 3 + 2] = faceSum[vi * 3 + 2]! + fn.z * ang;
    }
  }
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    keys.push(k);
    let s = sums.get(k);
    if (!s) sums.set(k, (s = new THREE.Vector3()));
    s.x += faceSum[i * 3]!;
    s.y += faceSum[i * 3 + 1]!;
    s.z += faceSum[i * 3 + 2]!;
  }
  const out = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.copy(sums.get(keys[i]!)!);
    // Faces wound inconsistently can cancel out: fall back to the vertex normal.
    if (v.lengthSq() < 1e-12) v.set(n.getX(i), n.getY(i), n.getZ(i));
    if (v.dot(new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i))) < 0) v.negate();
    v.normalize();
    out.set([v.x, v.y, v.z], i * 3);
  }
  return out;
}

/**
 * A copy of `g` with one vertex per face corner, carrying its face's corners (`triA`, `triB`, `triC`) and which of its
 * edges (`splitE`, the edge opposite each corner) and corners (`splitV`) lie on split edges: edges whose faces have
 * different normals there.
 */
export function withEdgeDistances(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const idx = g.index;
  const count = idx ? idx.count : p.count;
  const box = g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox!);
  const q = 1e5 / (box.getSize(new THREE.Vector3()).length() || 1);
  const at = (i: number) => (idx ? idx.getX(i) : i);
  const pk = (v: number) => `${Math.round(p.getX(v) * q)},${Math.round(p.getY(v) * q)},${Math.round(p.getZ(v) * q)}`;
  const nv = (v: number) => new THREE.Vector3(n.getX(v), n.getY(v), n.getZ(v));
  const edges = new Map<string, { na: THREE.Vector3; nb: THREE.Vector3 }[]>();
  const edgeOf = (t: number, k: number) => {
    const u = at(t + ((k + 1) % 3)), w = at(t + ((k + 2) % 3));
    const ku = pk(u), kw = pk(w);
    return ku < kw ? { key: `${ku}|${kw}`, u, w, ku, kw } : { key: `${kw}|${ku}`, u: w, w: u, ku: kw, kw: ku };
  };
  for (let t = 0; t < count; t += 3)
    for (let k = 0; k < 3; k++) {
      const e = edgeOf(t, k);
      let l = edges.get(e.key);
      if (!l) edges.set(e.key, (l = []));
      l.push({ na: nv(e.u), nb: nv(e.w) });
    }
  const splitPoints = new Set<string>();
  const splitEdges = new Set<string>();
  for (const [key, l] of edges)
    if (l.length > 1 && l.some((x) => x.na.dot(l[0]!.na) < 0.9995 || x.nb.dot(l[0]!.nb) < 0.9995)) {
      splitEdges.add(key);
      for (const k of key.split('|')) splitPoints.add(k);
    }
  const out = idx ? g.toNonIndexed() : g.clone();
  const tri = [new Float32Array(count * 3), new Float32Array(count * 3), new Float32Array(count * 3)];
  const sE = new Float32Array(count * 3), sV = new Float32Array(count * 3);
  for (let t = 0; t < count; t += 3) {
    const e = [0, 1, 2].map((k) => (splitEdges.has(edgeOf(t, k).key) ? 1 : 0));
    const v = [0, 1, 2].map((k) => (splitPoints.has(pk(at(t + k))) ? 1 : 0));
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 3; k++) {
        const vi = at(t + k);
        tri[k]!.set([p.getX(vi), p.getY(vi), p.getZ(vi)], (t + c) * 3);
      }
      sE.set(e, (t + c) * 3);
      sV.set(v, (t + c) * 3);
    }
  }
  out.setAttribute('triA', new THREE.BufferAttribute(tri[0]!, 3));
  out.setAttribute('triB', new THREE.BufferAttribute(tri[1]!, 3));
  out.setAttribute('triC', new THREE.BufferAttribute(tri[2]!, 3));
  out.setAttribute('splitE', new THREE.BufferAttribute(sE, 3));
  out.setAttribute('splitV', new THREE.BufferAttribute(sV, 3));
  return out;
}

const averaged = new WeakMap<THREE.BufferGeometry, Float32Array>();
export function cageDirections(g: THREE.BufferGeometry, average: boolean): Float32Array {
  if (!average) return g.getAttribute('normal').array as Float32Array;
  let a = averaged.get(g);
  if (!a) averaged.set(g, (a = averagedNormals(g)));
  return a;
}

/** A cage for one low-poly mesh: how far in front of and behind it its high-poly surface lies (share of `diag`). */
export function autoCage(low: LoadedModel, part: number, src: BakeSource, diag: number, average = true): { front: number; rear: number } {
  const g = low.parts[part]!.mesh.geometry;
  const p = g.getAttribute('position');
  const n = new THREE.BufferAttribute(cageDirections(g, average), 3);
  const far = 0.15 * diag;
  const idx = g.index;
  const tris = (idx ? idx.count : p.count) / 3;
  const step = Math.max(1, Math.floor(tris / 1500));
  const ray = new THREE.Ray();
  const fronts: number[] = [], rears: number[] = [];
  const o = new THREE.Vector3(), d = new THREE.Vector3();
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], N = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  // Corners, edge middles and the centre of each face: low-poly faces can sink into the high-poly surface between corners.
  const W = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3]];
  for (let t = 0; t < tris; t += step) {
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      P[k]!.fromBufferAttribute(p, vi);
      N[k]!.fromBufferAttribute(n, vi);
    }
    for (const w of W) {
      o.set(0, 0, 0);
      d.set(0, 0, 0);
      for (let k = 0; k < 3; k++) (o.addScaledVector(P[k]!, w[k]!), d.addScaledVector(N[k]!, w[k]!));
      if (d.lengthSq() < 1e-12) continue;
      d.normalize();
      o.addScaledVector(d, far);
      ray.set(o, d.clone().negate());
      const hit = src.cpu.raycastFirst(ray, THREE.DoubleSide, 0, far * 2);
      if (!hit) continue;
      const x = hit.distance - far;
      if (x < 0) fronts.push(-x);
      else rears.push(x);
    }
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
in vec3 cageDir;
in vec3 triA;
in vec3 triB;
in vec3 triC;
in vec3 splitE;
in vec3 splitV;
out vec3 vPos;
flat out vec3 vA;
flat out vec3 vB;
flat out vec3 vC;
flat out vec3 vSE;
flat out vec3 vSV;
out vec3 vWorld;
out vec3 vDir;
out vec3 vN;
out vec2 vUv;
out vec2 vCage;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  vUv = uv;
  vCage = cage;
  vPos = position;
  vA = triA; vB = triB; vC = triC; vSE = splitE; vSV = splitV;
  vDir = normalize(transpose(inverse(mat3(modelMatrix))) * cageDir);
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
in vec3 vPos;
flat in vec3 vA;
flat in vec3 vB;
flat in vec3 vC;
flat in vec3 vSE;
flat in vec3 vSV;
float seg(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-20), 0., 1.);
  return length(p - a - ab * t);
}
/** How far this point is from the nearest split edge or corner of its face. */
float splitDistance() {
  float d = 1e9;
  if (vSE.x > .5) d = min(d, seg(vPos, vB, vC));
  if (vSE.y > .5) d = min(d, seg(vPos, vC, vA));
  if (vSE.z > .5) d = min(d, seg(vPos, vA, vB));
  if (vSV.x > .5) d = min(d, length(vPos - vA));
  if (vSV.y > .5) d = min(d, length(vPos - vB));
  if (vSV.z > .5) d = min(d, length(vPos - vC));
  return d;
}
in vec3 vDir;
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
uniform int u_meshFirst;
uniform sampler2D u_offset;
uniform sampler2D u_sp;
uniform sampler2D u_sn;
uniform sampler2D u_prev;
uniform int u_mode;       // 1 normal, 3 position, 4 id, 5 occlusion, 6 thickness, 7 surface point, 8 surface normal, 9 light
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
uniform vec4 u_lights[8]; // position, radius
uniform float u_lightStr[8];
uniform int u_nLights;

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

/** Cosine-weighted direction from a point in the unit square. */
vec3 hemiAt(vec3 n, vec2 xi) {
  vec3 t, b;
  frame(n, t, b);
  float a = xi.x * 6.2831853, r = sqrt(xi.y);
  return normalize(t * cos(a) * r + b * sin(a) * r + n * sqrt(max(0., 1. - r * r)));
}

/** The k-th point of a low-discrepancy (R2) sequence, shifted per texel so neighbours don't share a pattern. */
vec2 r2(int k) {
  uint h = uint(gl_FragCoord.x) * 73856093u ^ uint(gl_FragCoord.y) * 19349663u;
  h = (h ^ (h >> 16)) * 0x45d9f3bu;
  h = (h ^ (h >> 16)) * 0x45d9f3bu;
  vec2 shift = vec2(float(h & 0xffffu), float(h >> 16)) / 65535.;
  return fract(shift + vec2(.7548776662, .5698402910) * float(k));
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
// Rounds hard edges: finds the faces that meet this one within reach (from inside the solid for outer
// edges, from outside for inner corners) and turns the normal toward each, half way right at the edge.
vec3 bendTo(vec3 n, vec3 m, float h, inout vec3 hm[3], inout float hd[3], inout int cnt) {
  float c = clamp(dot(n, m), -1., 1.);
  if (c > .9998 || c < -.5) return n;
  float reach = u_bevelR * tan(.5 * acos(c));
  if (h >= reach) return n;
  for (int j = 0; j < 3; j++) if (j < cnt && dot(hm[j], m) > .995) { if (h < hd[j]) hd[j] = h; return n; }
  if (cnt < 3) { hm[cnt] = m; hd[cnt] = h; cnt++; }
  return n;
}
vec3 bevel(vec3 p, vec3 n) {
  vec3 t, b;
  frame(n, t, b);
  vec3 hm[3]; float hd[3]; int cnt = 0;
  float eps = u_bevelR * .02, far = u_bevelR * 4.;
  int dirs = max(u_bevelN, 8);
  for (int i = 0; i < 64; i++) {
    if (i >= dirs) break;
    float a = 6.2831853 * (float(i) + .5) / float(dirs);
    vec3 d = t * cos(a) + b * sin(a);
    vec3 m; float h;
    if (u_bevelEdges != 2 && traceAll(p - n * eps, d, m, h) && h < far && dot(m, d) > .05) bendTo(n, m, h, hm, hd, cnt);
    if (u_bevelEdges != 1 && traceAll(p + n * eps, d, m, h) && h < far && dot(m, d) < -.05) bendTo(n, m, h, hm, hd, cnt);
  }
  vec3 o = n;
  for (int j = 0; j < 3; j++) {
    if (j >= cnt) break;
    vec3 m = hm[j];
    float th = acos(clamp(dot(n, m), -1., 1.));
    float s = hd[j] / (u_bevelR * tan(.5 * th));
    float w = .5 * (1. - s);
    vec3 ax = normalize(m - n * dot(m, n));
    vec3 r = n * cos(w * th) + ax * sin(w * th);
    o += r - n;
  }
  return normalize(o);
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
    if (u_mode == 9) {
      for (int i = 0; i < 64; i++) {
        if (i >= u_samples) break;
        int k = (i + int(u_seed)) % max(u_nLights, 1);
        vec4 L = u_lights[k];
        vec3 q = L.xyz + normalize(vec3(rnd(), rnd(), rnd()) * 2. - 1. + 1e-4) * L.w * pow(rnd(), 1. / 3.);
        vec3 to = q - sp;
        float dist = length(to);
        vec3 l = to / max(dist, 1e-6);
        float ndl = dot(sn, l);
        if (ndl <= 0.) continue;
        vec3 hn; float d;
        if (traceAll(sp + sn * eps, l, hn, d) && d < dist) continue;
        sum += float(u_nLights) * u_lightStr[k] * ndl;
      }
      o = vec4(vec3(sum), 1.);
      return;
    }
    bool ao = u_mode == 5;
    vec3 side = ao ? sn : -sn;
    for (int i = 0; i < 64; i++) {
      if (i >= u_samples) break;
      vec3 hn; float d;
      bool hit = traceAll(sp + side * eps, hemiAt(side, r2((int(u_seed) - 1) * u_samples + i)), hn, d);
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
  float front = vCage.x * off, rear = vCage.y * off;
  vec3 hn; vec4 hid; float d;
  // Averaged normals at split edges, so both sides meet; the mesh's own normals away from them.
  float edge = splitDistance();
  vec3 own = normalize(mix(normalize(vDir), N, smoothstep(0., max(.4 * (front + rear), 1e-6), edge)));
  vec3 dir = normalize(mix(own, Nf, skew));
  vec3 ro = vWorld + dir * front;
  bool found = u_meshFirst == 1 && dot(N, normalize(vDir)) < .9999 && traceOwn(ro, -dir, hn, hid, d) && d <= front + rear;
  if (!found) {
    dir = normalize(mix(normalize(vDir), Nf, skew));
    ro = vWorld + dir * front;
    found = traceOwn(ro, -dir, hn, hid, d) && d <= front + rear;
  }
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
uniform float u_cos;
uniform float u_reach;
bool inside(vec2 uv) { return texture(u_island, uv).r > .5; }
float k(vec2 d) {
  vec2 a = vUv - d, b = vUv + d;
  if (!inside(a) || !inside(b)) return 0.;
  vec3 dn = texture(u_n, b).xyz - texture(u_n, a).xyz;
  vec3 dp = texture(u_p, b).xyz - texture(u_p, a).xyz;
  float l = dot(dp, dp);
  return l > 1e-14 ? dot(dn, dp) / l : 0.;
}
// Smallest cosine between this texel's normal and the normals a short way off on either side.
float turn(vec3 n, vec2 d) {
  float c = 1.;
  if (inside(vUv + d)) c = min(c, dot(n, normalize(texture(u_n, vUv + d).xyz)));
  if (inside(vUv - d)) c = min(c, dot(n, normalize(texture(u_n, vUv - d).xyz)));
  return c;
}
void main() {
  float cx = k(vec2(u_px * 1.5, 0.)), cy = k(vec2(0., u_px * 1.5));
  if (u_cos < .9999 && inside(vUv)) {
    vec3 n = normalize(texture(u_n, vUv).xyz);
    vec3 p = texture(u_p, vUv).xyz;
    float tx = inside(vUv + vec2(u_px, 0.)) ? length(texture(u_p, vUv + vec2(u_px, 0.)).xyz - p) : 0.;
    float ty = inside(vUv + vec2(0., u_px)) ? length(texture(u_p, vUv + vec2(0., u_px)).xyz - p) : 0.;
    float t = max(max(tx, ty), 1e-9);
    float span = clamp(u_reach / t, 1.5, 48.) * u_px;
    cx *= smoothstep(u_cos + .03, u_cos - .03, turn(n, vec2(span, 0.)));
    cy *= smoothstep(u_cos + .03, u_cos - .03, turn(n, vec2(0., span)));
  }
  o = vec4(vec3(.5 + .5 * tanh(.5 * (cx + cy) * u_scale)), 1.);
}`;

const CURVE_N_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_n;
uniform sampler2D u_island;
uniform float u_px;
uniform float u_scale;
vec2 nrm(vec2 uv, vec2 f) {
  return texture(u_island, uv).r < .5 ? f : texture(u_n, uv).xy * 2. - 1.;
}
void main() {
  vec2 f = nrm(vUv, vec2(0.));
  float c = 0., w = 0.;
  for (int i = 0; i < 5; i++) {
    float d = u_px * exp2(float(i));
    float k = 1. / exp2(float(i) * .5);
    c += k * (nrm(vUv + vec2(d, 0.), f).x - nrm(vUv - vec2(d, 0.), f).x + nrm(vUv + vec2(0., d), f).y - nrm(vUv - vec2(0., d), f).y);
    w += k;
  }
  o = vec4(vec3(.5 + .5 * tanh(c / w * u_scale)), 1.);
}`;

/** Down to the map's size (averaging the samples inside the UV islands), padded past the island edges. */
/** Smooths ray noise: averages nearby texels of the same surface (close in position, facing the same way). */
const DENOISE_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_sp;
uniform sampler2D u_sn;
uniform sampler2D u_island;
uniform float u_div;
uniform float u_px;
uniform float u_step;
uniform float u_sigma;
void main() {
  if (texture(u_island, vUv).r < .5) { o = vec4(texture(u_src, vUv).rgb / u_div, 1.); return; }
  vec3 p = texture(u_sp, vUv).xyz, n = texture(u_sn, vUv).xyz;
  vec3 s = vec3(0.);
  float w = 0.;
  for (int y = -4; y <= 4; y++)
    for (int x = -4; x <= 4; x++) {
      vec2 q = vUv + vec2(float(x), float(y)) * u_px * u_step;
      if (texture(u_island, q).r < .5) continue;
      vec3 dp = texture(u_sp, q).xyz - p;
      float k = exp(-float(x * x + y * y) / 18. - dot(dp, dp) / (u_sigma * u_sigma)) * pow(max(dot(texture(u_sn, q).xyz, n), 0.), 8.);
      s += texture(u_src, q).rgb * k;
      w += k;
    }
  o = vec4(s / max(w, 1e-6) / u_div, 1.);
}`;

/** Occlusion brightened where the bake lights reach. */
const LIGHT_MIX_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_divA;
uniform float u_div;
uniform float u_mix;
void main() {
  float ao = texture(u_a, vUv).r / u_divA, l = clamp(texture(u_b, vUv).r / u_div, 0., 1.);
  o = vec4(vec3(1. - (1. - ao) * (1. - u_mix * l)), 1.);
}`;

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
/** Each draw aims to take about this long: long enough to keep the graphics card busy, short enough not to stall the screen or trip the driver's watchdog. */
const BAND_MS = 60;
/** Float targets are this large at most (memory), so anti-aliasing is lowered for big maps. */
const MAX_WORK = 4096;

export interface BakeProgress {
  done: number;
  total: number;
}

export interface BakeSources {
  /** What thickness and bevel see. */
  all: BakeSource;
  /** What occlusion and bake lights see: everything but the meshes left out of occlusion. */
  occ: BakeSource;
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
  lights: BakeLight[],
  progress: (p: BakeProgress) => void,
  cancelled: () => boolean,
  /** Called each time a map's preview has been updated. */
  shown: (m: MeshMap) => void = () => {},
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
  const restores: (() => void)[] = [];
  for (const i of parts) {
    const geo = low.parts[i]!.mesh.geometry;
    const c = high ? (st.cages[partName(low, i)] ?? { front: st.front, rear: st.rear }) : { front: 0.0005, rear: 0.0005 };
    const a = new Float32Array(geo.getAttribute('position').count * 2);
    for (let k = 0; k < a.length; k += 2) {
      a[k] = c.front * diag;
      a[k + 1] = c.rear * diag;
    }
    geo.setAttribute('cage', new THREE.BufferAttribute(a, 2));
    geo.setAttribute('cageDir', new THREE.BufferAttribute(cageDirections(geo, high && st.averageNormals !== false), 3));
    const bg = withEdgeDistances(geo);
    restores.push(g.useGeometry(i, bg), () => bg.dispose());
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
      u_meshFirst: { value: high && st.averageNormals !== false && st.meshFirst !== false ? 1 : 0 },
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
      u_lights: { value: Array.from({ length: 8 }, (_, i) => (lights[i] ? new THREE.Vector4(...lights[i].position, lights[i].radius * diag) : new THREE.Vector4())) },
      u_lightStr: { value: Array.from({ length: 8 }, (_, i) => lights[i]?.strength ?? 0) },
      u_nLights: { value: Math.min(8, lights.length) },
  };
  const occ = src.occ.bvh as unknown as typeof all;
  const bindAll = (b: typeof all) => {
    uniforms.u_allPos!.value = b.position;
    uniforms.u_allIdx!.value = b.index;
    uniforms.u_allBounds!.value = b.bvhBounds;
    uniforms.u_allContents!.value = b.bvhContents;
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
  const fromNormal = want.has('curvature') && st.curvatureFrom === 'normal';
  if (want.has('normal') || fromNormal) passes.push({ out: 'normal', mode: 1, seed: 0 });
  if (want.has('position')) passes.push({ out: 'position', mode: 3, seed: 0 });
  if (want.has('id')) passes.push({ out: 'id', mode: 4, seed: 0 });
  // Anti-aliasing averages ss² samples per texel, so occlusion and thickness split their rays between them.
  const rayPasses = Math.max(1, Math.ceil(st.aoSamples / (ss * ss) / PER_PASS));
  for (const [m, mode] of [['occlusion', 5], ['thickness', 6]] as const)
    if (want.has(m)) for (let i = 0; i < rayPasses; i++) passes.push({ out: m, mode, seed: i + 1 });
  const mix = want.has('occlusion') && lights.length ? (st.lightMix ?? 0) : 0;
  const lit = lights.length > 0 && (want.has('light') || mix > 0);
  if (lit) for (let i = 0; i < rayPasses; i++) passes.push({ out: 'light', mode: 9, seed: i + 1 });
  const total = passes.length + 1;
  const sync = new Float32Array(4);
  let last = performance.now();
  // Each kind of pass learns its own band height, so a slow pass never starts at a cheap one's size.
  const bands = new Map<number, number>();
  const start = Math.max(8, Math.round(65536 / work));
  const auto = r.autoClear, prev = r.getRenderTarget();
  const clearTo = (t: THREE.WebGLRenderTarget) => {
    r.setRenderTarget(t);
    r.setClearColor(0x000000, 0);
    r.clear();
  };
  const quad = (fs: string, u: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: QUAD, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
  const curve = quad(CURVE_FS, { u_n: { value: null }, u_p: { value: null }, u_island: { value: islandHi.texture }, u_px: { value: 1 / work }, u_scale: { value: 0.12 * diag }, u_cos: { value: Math.cos(((st.curvatureAngle ?? 35) * Math.PI) / 180) }, u_reach: { value: Math.max(0.015, 2.5 * (bevel?.radius ?? 0)) * diag } });
  const curveN = quad(CURVE_N_FS, { u_n: { value: null }, u_island: { value: islandHi.texture }, u_px: { value: ss / work }, u_scale: { value: 2.5 * st.curvatureStrength } });
  const lightMix = quad(LIGHT_MIX_FS, { u_a: { value: null }, u_b: { value: null }, u_divA: { value: 1 }, u_div: { value: 1 }, u_mix: { value: 0 } });
  const denoise = quad(DENOISE_FS, { u_src: { value: null }, u_sp: { value: null }, u_sn: { value: null }, u_island: { value: islandHi.texture }, u_div: { value: 1 }, u_px: { value: 1 / work }, u_step: { value: ss }, u_sigma: { value: 0.006 * diag } });
  const enc = quad(ENCODE_FS, { u_src: { value: null }, u_islandHi: { value: islandHi.texture }, u_island: { value: island.texture }, u_px: { value: 1 / size }, u_div: { value: 1 }, u_ss: { value: ss }, u_kind: { value: 0 } });
  try {
    // Build every program before the heavy drawing starts.
    const warm = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
    for (const m of stages) if (m !== stages[2] || bevel) g.drawWith(m, warm);
    g.p.run(fromNormal ? curveN : curve, warm);
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
      bindAll(ps.mode === 5 || ps.mode === 9 ? occ : all);
      mat.uniforms.u_seed!.value = ps.seed;
      mat.uniforms.u_sp!.value = raw.get('sp')?.texture ?? null;
      mat.uniforms.u_sn!.value = raw.get('sn')?.texture ?? null;
      r.autoClear = false;
      const kind = ps.mode * 2 + (ps.mode === 8 && bevel ? 1 : 0);
      let band = bands.get(kind) ?? start;
      // Full-width bands whose height follows how long the last one took.
      for (let y = 0; y < work; ) {
        if (cancelled()) return false;
        const h = Math.min(band, work - y);
        const t0 = performance.now();
        t.scissor.set(0, y, work, h);
        t.scissorTest = true;
        for (const grp of groups) {
          const own = grp.length === 1 ? src.own(grp[0]!) : src.all;
          mat.uniforms.bvh!.value = own.bvh;
          mat.uniforms.u_normals!.value = own.normals;
          mat.uniforms.u_ids!.value = st.idFrom === 'mesh' ? own.idMesh : own.idSlot;
          g.drawWith(stages[ps.mode === 8 && bevel ? 2 : ps.mode === 9 ? 3 : ps.mode === 4 || ps.mode >= 7 ? 0 : ps.mode >= 5 ? 3 : 1], t, grp.length === 1 ? grp[0] : undefined);
        }
        r.readRenderTargetPixels(t, 0, y, 1, 1, sync);
        const ms = performance.now() - t0;
        y += h;
        if (ms < BAND_MS / 2) band = Math.min(work, band * 2);
        else if (ms > BAND_MS * 2) band = Math.max(8, Math.floor((band * BAND_MS) / ms));
        if (performance.now() - last > 120) {
          progress({ done: i + y / work, total });
          await new Promise((res) => requestAnimationFrame(res));
          last = performance.now();
        }
      }
      t.scissorTest = false;
      bands.set(kind, band);
      progress({ done: i + 1, total });
      // Show the map as it comes along: after each ray pass, or once it's done.
      const m = (ps.out === 'sn' ? 'worldNormal' : ps.out) as MeshMap;
      if (st.maps.includes(m) && (ps.seed > 0 || passes[i + 1]?.out !== ps.out)) {
        enc.uniforms.u_src!.value = t.texture;
        enc.uniforms.u_div!.value = ps.seed > 0 ? ps.seed * PER_PASS : 1;
        enc.uniforms.u_kind!.value = m === 'worldNormal' ? 1 : 0;
        g.setBaked(m, (out) => g.p.run(enc, out), size);
        shown(m);
        await new Promise((res) => requestAnimationFrame(res));
      }
    }
    if (want.has('curvature')) {
      const t = float();
      if (fromNormal) {
        curveN.uniforms.u_n!.value = raw.get('normal')!.texture;
        g.p.run(curveN, t);
      } else {
        curve.uniforms.u_n!.value = raw.get('sn')!.texture;
        curve.uniforms.u_p!.value = raw.get('sp')!.texture;
        g.p.run(curve, t);
      }
      raw.set('curvature', t);
    }
    if (want.has('worldNormal')) raw.set('worldNormal', raw.get('sn')!);
    const div = rayPasses * PER_PASS;
    // Ray maps come out of here as plain values once smoothed.
    const divOf = new Map<string, number>([['occlusion', div], ['thickness', div], ['light', div]]);
    if (st.denoise !== false)
      for (const m of ['occlusion', 'thickness', 'light'])
        if (raw.get(m)) {
          const t = float();
          denoise.uniforms.u_src!.value = raw.get(m)!.texture;
          denoise.uniforms.u_sp!.value = raw.get('sp')!.texture;
          denoise.uniforms.u_sn!.value = raw.get('sn')!.texture;
          denoise.uniforms.u_div!.value = div;
          g.p.run(denoise, t);
          pool.push(raw.get(m)!);
          raw.set(m, t);
          divOf.set(m, 1);
        }
    if (mix > 0 && raw.get('occlusion') && raw.get('light')) {
      const t = float();
      lightMix.uniforms.u_divA!.value = divOf.get('occlusion')!;
      lightMix.uniforms.u_a!.value = raw.get('occlusion')!.texture;
      lightMix.uniforms.u_b!.value = raw.get('light')!.texture;
      lightMix.uniforms.u_div!.value = divOf.get('light')!;
      lightMix.uniforms.u_mix!.value = mix;
      g.p.run(lightMix, t);
      pool.push(raw.get('occlusion')!);
      raw.set('occlusion', t);
      divOf.set('occlusion', 1);
    }
    for (const m of st.maps) {
      const s = raw.get(m);
      if (!s) continue;
      enc.uniforms.u_src!.value = s.texture;
      enc.uniforms.u_div!.value = divOf.get(m) ?? 1;
      enc.uniforms.u_kind!.value = m === 'worldNormal' ? 1 : 0;
      g.setBaked(m as MeshMap, (out) => g.p.run(enc, out), size);
      if (m === 'curvature') shown(m);
    }
    for (const m of [...g.baked.keys()]) if (!want.has(m)) g.dropBaked(m);
    progress({ done: total, total });
    return true;
  } finally {
    restores.forEach((f) => f());
    r.autoClear = auto;
    r.setRenderTarget(prev);
    for (const t of new Set([...raw.values(), ...pool])) t.dispose();
    stages.forEach((m) => m.dispose());
    curve.dispose();
    curveN.dispose();
    lightMix.dispose();
    denoise.dispose();
    enc.dispose();
    zero.dispose();
    half.dispose();
  }
}
