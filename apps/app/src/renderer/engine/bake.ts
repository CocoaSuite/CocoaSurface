import * as THREE from 'three';
import { BVHShaderGLSL, FloatVertexAttributeTexture, MeshBVH, MeshBVHUniformStruct } from 'three-mesh-bvh';
import type { BakeSettings, MeshMap } from '@cocoasurface/project';
import type { SetGPU } from './gpu';
import type { LoadedModel } from './model';

/** Every mesh of a model in one geometry, for ray casting, with a colour per mesh and per material slot. */
export function traceGeometry(m: LoadedModel): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], byMesh: number[] = [], bySlot: number[] = [], index: number[] = [];
  const colour = (i: number) => new THREE.Color().setHSL((i * 0.618034) % 1, 0.75, 0.55);
  let base = 0;
  m.parts.forEach((part, pi) => {
    const g = part.mesh.geometry;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const mc = colour(pi);
    const slotOfVertex = new Int32Array(p.count).fill(0);
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

const VS = /* glsl */ `
out vec3 vWorld;
out vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
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
out vec4 o;
uniform BVH bvh;
uniform sampler2D u_normals;
uniform sampler2D u_ids;
uniform int u_mode;       // 1 normal, 2 world normal, 3 position, 4 id, 5 occlusion, 6 thickness
uniform int u_high;
uniform float u_front;
uniform float u_rear;
uniform float u_dist;
uniform int u_samples;
uniform float u_seed;
uniform vec3 u_min;
uniform vec3 u_size;

uint seed;
float rnd() {
  seed = seed * 747796405u + 2891336453u;
  uint w = ((seed >> ((seed >> 28u) + 4u)) ^ seed) * 277803737u;
  return float((w >> 22u) ^ w) / 4294967295.;
}

vec3 hemi(vec3 n) {
  float a = rnd() * 6.2831853, r = sqrt(rnd());
  vec3 t = normalize(abs(n.y) < .99 ? cross(n, vec3(0., 1., 0.)) : cross(n, vec3(1., 0., 0.)));
  vec3 b = cross(n, t);
  return normalize(t * cos(a) * r + b * sin(a) * r + n * sqrt(max(0., 1. - r * r)));
}

bool trace(vec3 ro, vec3 rd, out vec3 n, out vec4 id, out float dist) {
  uvec4 f = uvec4(0u); vec3 fn = vec3(0.), bc = vec3(0.); float side = 1.;
  dist = 0.;
  bool hit = bvhIntersectFirstHit(bvh, ro, rd, f, fn, bc, side, dist);
  if (hit) {
    n = normalize(textureSampleBarycoord(u_normals, bc, f.xyz).xyz);
    id = texelFetch1D(u_ids, f.x);
  }
  return hit;
}

void main() {
  vec3 N = normalize(vN);
  vec3 P = vWorld;
  // The surface seen from here: the high-poly model under the cage, or the mesh itself.
  vec3 sn = N, sp = P;
  vec4 sid = vec4(0.);
  bool found = false;
  {
    vec3 hn; vec4 hid; float d;
    vec3 ro = P + N * u_front;
    if (trace(ro, -N, hn, hid, d) && d <= u_front + u_rear) {
      found = true;
      sp = ro - N * d;
      sid = hid;
      if (u_high == 1) sn = hn;
    }
  }
  if (u_high == 0) sp = P;

  seed = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(u_seed) * 26699u | 1u;

  if (u_mode == 1) {
    // Tangent space as the viewer builds it from the texture coordinates (cotangent frame).
    vec3 q0 = dFdx(P), q1 = dFdy(P);
    vec3 T = cross(q1, N), B = cross(N, q0);
    float s = inversesqrt(max(dot(T, T), dot(B, B)));
    mat3 tbn = mat3(T * s, B * s, N);
    vec3 t = (u_high == 1 && found) ? normalize(inverse(tbn) * sn) : vec3(0., 0., 1.);
    o = vec4(t * .5 + .5, 1.);
  } else if (u_mode == 2) {
    o = vec4(sn * .5 + .5, 1.);
  } else if (u_mode == 3) {
    o = vec4((sp - u_min) / u_size, 1.);
  } else if (u_mode == 4) {
    o = found ? vec4(sid.rgb, 1.) : vec4(0., 0., 0., 1.);
  } else {
    float sum = 0.;
    float eps = .0015;
    for (int i = 0; i < 64; i++) {
      if (i >= u_samples) break;
      vec3 hn; vec4 hid; float d;
      if (u_mode == 5) {
        vec3 dir = hemi(sn);
        bool hit = trace(sp + sn * eps, dir, hn, hid, d) && d < u_dist;
        sum += hit ? d / u_dist * d / u_dist : 1.;
      } else {
        vec3 dir = hemi(-sn);
        bool hit = trace(sp - sn * eps, dir, hn, hid, d);
        sum += hit ? min(d / u_dist, 1.) : 1.;
      }
    }
    o = vec4(vec3(sum), 1.);
  }
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
uniform vec3 u_bsize;
float k(vec2 d) {
  vec2 a = vUv - d, b = vUv + d;
  if (texture(u_island, a).r < .5 || texture(u_island, b).r < .5) return 0.;
  vec3 dn = (texture(u_n, b).xyz - texture(u_n, a).xyz) * 2.;
  vec3 dp = (texture(u_p, b).xyz - texture(u_p, a).xyz) * u_bsize;
  float l = dot(dp, dp);
  return l > 1e-12 ? dot(dn, dp) / l : 0.;
}
void main() {
  float c = .5 * (k(vec2(u_px * 1.5, 0.)) + k(vec2(0., u_px * 1.5)));
  o = vec4(vec3(.5 + .5 * tanh(c * u_scale)), 1.);
}`;

const ENCODE_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_island;
uniform float u_px;
uniform float u_div;
uniform int u_kind;      // 0 as is, 1 world normal, 2 position (already 0-1)
vec3 val(vec2 uv) {
  vec3 c = texture(u_src, uv).rgb / u_div;
  if (u_kind == 1) c = normalize(c * 2. - 1.) * .5 + .5;
  return clamp(c, 0., 1.);
}
void main() {
  if (texture(u_island, vUv).r > .5) { o = vec4(val(vUv), 1.); return; }
  for (int r = 1; r <= 16; r++)
    for (int i = 0; i < 8; i++) {
      float a = float(i) * .7853982;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * float(r) * u_px;
      if (texture(u_island, uv).r > .5) { o = vec4(val(uv), 1.); return; }
    }
  o = vec4(val(vUv), 1.);
}`;

const QUAD = /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

export interface BakeSource {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVHUniformStruct;
  normals: FloatVertexAttributeTexture;
  idMesh: FloatVertexAttributeTexture;
  idSlot: FloatVertexAttributeTexture;
}

export function bakeSource(m: LoadedModel): BakeSource {
  const geometry = traceGeometry(m);
  const bvh = new MeshBVHUniformStruct();
  bvh.updateFrom(new MeshBVH(geometry));
  const tex = (name: string) => {
    const t = new FloatVertexAttributeTexture();
    t.updateFrom(geometry.getAttribute(name) as THREE.BufferAttribute);
    return t;
  };
  return { geometry, bvh, normals: tex('normal'), idMesh: tex('idMesh'), idSlot: tex('idSlot') };
}

export function disposeSource(s: BakeSource): void {
  s.geometry.dispose();
  s.bvh.dispose();
  s.normals.dispose();
  s.idMesh.dispose();
  s.idSlot.dispose();
}

const MODE: Record<string, number> = { normal: 1, worldNormal: 2, position: 3, id: 4, occlusion: 5, thickness: 6 };
const PER_PASS = 8;
const TILE = 256;

export interface BakeProgress {
  done: number;
  total: number;
}

/** Bake mesh maps for one texture set. The maps land in `g.baked`, padded past the UV edges. */
export async function bakeSet(g: SetGPU, low: LoadedModel, src: BakeSource, high: boolean, st: BakeSettings, progress: (p: BakeProgress) => void, cancelled: () => boolean): Promise<boolean> {
  const r = g.p.r;
  const size = st.size;
  const box = src.geometry.boundingBox!.clone().union(new THREE.Box3().setFromObject(low.root));
  const bsize = box.getSize(new THREE.Vector3());
  const diag = bsize.length() || 1;
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VS,
    fragmentShader: FS,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      bvh: { value: src.bvh },
      u_normals: { value: src.normals },
      u_ids: { value: st.idFrom === 'mesh' ? src.idMesh : src.idSlot },
      u_mode: { value: 1 },
      u_high: { value: high ? 1 : 0 },
      u_front: { value: high ? st.front * diag : 0.0005 * diag },
      u_rear: { value: high ? st.rear * diag : 0.0005 * diag },
      u_dist: { value: st.aoDistance * diag },
      u_samples: { value: PER_PASS },
      u_seed: { value: 0 },
      u_min: { value: box.min.clone() },
      u_size: { value: bsize.clone().max(new THREE.Vector3(1e-6, 1e-6, 1e-6)) },
    },
  });
  const float = (precise = false) => new THREE.WebGLRenderTarget(size, size, { type: precise ? THREE.FloatType : THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false });
  const island = g.islandAt(size);
  const raw = new Map<MeshMap, THREE.WebGLRenderTarget>();
  const passes: { map: MeshMap; seed: number }[] = [];
  const geo = st.maps.filter((m) => m !== 'occlusion' && m !== 'thickness' && m !== 'curvature');
  if (st.maps.includes('curvature')) for (const m of ['worldNormal', 'position'] as const) if (!geo.includes(m)) geo.push(m);
  for (const m of geo) passes.push({ map: m, seed: 0 });
  for (const m of ['occlusion', 'thickness'] as const) if (st.maps.includes(m)) for (let i = 0; i < Math.ceil(st.aoSamples / PER_PASS); i++) passes.push({ map: m, seed: i + 1 });
  const total = passes.length + 1;
  const sync = new Uint16Array(4), syncF = new Float32Array(4);
  let last = performance.now();
  const auto = r.autoClear, prev = r.getRenderTarget();
  try {
    for (let i = 0; i < passes.length; i++) {
      if (cancelled()) return false;
      const { map, seed } = passes[i]!;
      let t = raw.get(map);
      if (!t) {
        raw.set(map, (t = float(seed === 0)));
        r.setRenderTarget(t);
        r.setClearColor(0x000000, 0);
        r.clear();
      }
      mat.uniforms.u_mode!.value = MODE[map];
      mat.uniforms.u_seed!.value = seed;
      mat.blending = seed > 0 ? THREE.AdditiveBlending : THREE.NoBlending;
      mat.transparent = seed > 0;
      r.autoClear = false;
      // In tiles, waiting for each to finish: long draws would stall the screen or reset the graphics card.
      for (let y = 0; y < size; y += TILE)
        for (let x = 0; x < size; x += TILE) {
          if (cancelled()) return false;
          t.scissor.set(x, y, Math.min(TILE, size - x), Math.min(TILE, size - y));
          t.scissorTest = true;
          g.drawWith(mat, t);
          r.readRenderTargetPixels(t, x, y, 1, 1, t.texture.type === THREE.FloatType ? syncF : sync);
          if (performance.now() - last > 30) {
            progress({ done: i + (y * size + (x + TILE) * Math.min(TILE, size - y)) / (size * size), total });
            await new Promise((res) => requestAnimationFrame(res));
            last = performance.now();
          }
        }
      t.scissorTest = false;
      progress({ done: i + 1, total });
    }
    const quad = (fs: string, u: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: QUAD, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
    if (st.maps.includes('curvature')) {
      const t = float();
      const c = quad(CURVE_FS, { u_n: { value: raw.get('worldNormal')!.texture }, u_p: { value: raw.get('position')!.texture }, u_island: { value: island.texture }, u_px: { value: 1 / size }, u_scale: { value: 0.12 * diag }, u_bsize: { value: bsize.clone() } });
      g.p.run(c, t);
      c.dispose();
      raw.set('curvature', t);
    }
    const enc = quad(ENCODE_FS, { u_src: { value: null }, u_island: { value: island.texture }, u_px: { value: 1 / size }, u_div: { value: 1 }, u_kind: { value: 0 } });
    for (const m of st.maps) {
      const src = raw.get(m);
      if (!src) continue;
      enc.uniforms.u_src!.value = src.texture;
      enc.uniforms.u_div!.value = m === 'occlusion' || m === 'thickness' ? Math.ceil(st.aoSamples / PER_PASS) * PER_PASS : 1;
      enc.uniforms.u_kind!.value = m === 'worldNormal' ? 1 : 0;
      g.setBaked(m, (out) => g.p.run(enc, out), size);
    }
    for (const m of [...g.baked.keys()]) if (!st.maps.includes(m)) g.dropBaked(m);
    enc.dispose();
    progress({ done: total, total });
    return true;
  } finally {
    r.autoClear = auto;
    r.setRenderTarget(prev);
    for (const t of raw.values()) t.dispose();
    mat.dispose();
  }
}
