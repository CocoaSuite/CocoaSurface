/**
 * Turning a node into a GLSL ES 3.0 fragment program (one program per kind of node: settings are uniforms, and
 * whether an input is linked is a uniform too, so changing a setting never recompiles anything).
 */
import { nodeDef, type NodeDef, type ParamValue, type RampStop } from './nodes';

export const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 vUv;
void main() { vUv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0., 1.); }`;

/** Shared helpers: hashing, tiling noise and cells, curves, colour spaces. */
export const LIBRARY = `
const float PI = 3.14159265;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec2 seedv(float s) { return vec2(s * 17.317 + 3.1, s * 41.913 + 7.7); }
float valueNoise(vec2 p, float per, float s) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f); vec2 o = seedv(s);
  float a = hash12(mod(i, per) + o), b = hash12(mod(i + vec2(1., 0.), per) + o);
  float c = hash12(mod(i + vec2(0., 1.), per) + o), d = hash12(mod(i + vec2(1., 1.), per) + o);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec2 gradAt(vec2 c, float per, vec2 o) { float a = hash12(mod(c, per) + o) * 6.2831853; return vec2(cos(a), sin(a)); }
float gradNoise(vec2 p, float per, float s) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.); vec2 o = seedv(s);
  float a = dot(gradAt(i, per, o), f), b = dot(gradAt(i + vec2(1., 0.), per, o), f - vec2(1., 0.));
  float c = dot(gradAt(i + vec2(0., 1.), per, o), f - vec2(0., 1.)), d = dot(gradAt(i + vec2(1., 1.), per, o), f - vec2(1., 1.));
  return clamp(0.5 + 1.35 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0., 1.);
}
float fbm(vec2 uv, float scale, float oct, float rough, float kind, float s) {
  float sum = 0., amp = 1., norm = 0.;
  for (int k = 0; k < 10; k++) {
    if (float(k) >= oct) break;
    float per = scale * exp2(float(k));
    vec2 p = uv * per;
    float n = kind > 0.5 && kind < 1.5 ? valueNoise(p, per, s + float(k)) : gradNoise(p, per, s + float(k));
    if (kind > 1.5) n = 1. - abs(n * 2. - 1.);
    sum += n * amp; norm += amp; amp *= rough;
  }
  return sum / max(norm, 1e-5);
}
vec3 voronoi(vec2 uv, float scale, float jitter, float s) {
  vec2 p = uv * scale; vec2 i = floor(p); vec2 f = p - i; vec2 o = seedv(s);
  float f1 = 8., f2 = 8., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = vec2(float(x), float(y)); vec2 w = mod(i + c, scale);
    vec2 pt = c + 0.5 + (hash22(w + o) - 0.5) * jitter;
    float d = length(pt - f);
    if (d < f1) { f2 = f1; f1 = d; id = hash12(w + o + 7.7); } else if (d < f2) f2 = d;
  }
  return vec3(f1, f2, id);
}
float curve4(float x, float y0, float y1, float y2, float y3) {
  float t = x * 3.; int k = int(min(floor(t), 2.)); float f = t - float(k);
  float p0, p1, p2, p3;
  if (k == 0) { p0 = y0 - (y1 - y0); p1 = y0; p2 = y1; p3 = y2; }
  else if (k == 1) { p0 = y0; p1 = y1; p2 = y2; p3 = y3; }
  else { p0 = y1; p1 = y2; p2 = y3; p3 = y3 + (y3 - y2); }
  float f2 = f * f, f3 = f2 * f;
  return clamp(0.5 * (2. * p1 + (-p0 + p2) * f + (2. * p0 - 5. * p1 + 4. * p2 - p3) * f2 + (-p0 + 3. * p1 - 3. * p2 + p3) * f3), 0., 1.);
}
vec3 ramp(float x, vec3 cs[8], float ts[8], float n) {
  if (x <= ts[0]) return cs[0];
  vec3 last = cs[0];
  for (int k = 1; k < 8; k++) {
    if (float(k) >= n) break;
    if (x <= ts[k]) return mix(cs[k - 1], cs[k], (x - ts[k - 1]) / max(ts[k] - ts[k - 1], 1e-5));
    last = cs[k];
  }
  return last;
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0., -1. / 3., 2. / 3., -1.);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6. * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1., 2. / 3., 1. / 3.)) * 6. - 3.);
  return c.z * mix(vec3(1.), clamp(p - 1., 0., 1.), c.y);
}
`;

export interface Uniform {
  name: string;
  type: 'float' | 'vec3' | 'float[]' | 'vec3[]' | 'sampler';
  value: number | number[] | string;
}

const decl = (def: NodeDef): string => {
  const out: string[] = ['uniform float u_px;'];
  for (const p of def.params) {
    if (p.kind === 'color') out.push(`uniform vec3 p_${p.id};`);
    else if (p.kind === 'ramp') out.push(`uniform vec3 p_${p.id}_c[8];`, `uniform float p_${p.id}_t[8];`, `uniform float p_${p.id}_n;`);
    else if (p.kind === 'image') out.push(`uniform sampler2D p_${p.id};`, `uniform float p_${p.id}_ok;`);
    else out.push(`uniform float p_${p.id};`);
  }
  for (const i of def.inputs) {
    const fb = (i.fallback ?? [0, 0, 0]).map((v) => v.toFixed(4)).join(', ');
    out.push(
      `uniform sampler2D i_${i.id};`,
      `uniform float h_${i.id};`,
      `vec4 inC_${i.id}(vec2 uv) { return h_${i.id} > 0.5 ? texture(i_${i.id}, uv) : vec4(${fb}, 1.); }`,
      `float inG_${i.id}(vec2 uv) { return dot(inC_${i.id}(uv).rgb, vec3(0.2126, 0.7152, 0.0722)); }`,
    );
  }
  return out.join('\n');
};

/** The fragment program for a kind of node. */
export function fragmentShader(type: string): string {
  const def = nodeDef(type);
  if (!def) throw new Error(`Unknown node “${type}”.`);
  return `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
${LIBRARY}
${decl(def)}
void main() {
  vec2 uv = vUv;
${def.glsl
  .split('\n')
  .map((x) => `  ${x}`)
  .join('\n')}
}`;
}

/** `#rrggbb` as 0–1 RGB. */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A node's settings as uniform values (images by path, for the evaluator to load). */
export function uniformsFor(type: string, params: Record<string, ParamValue>): Uniform[] {
  const def = nodeDef(type);
  if (!def) return [];
  const out: Uniform[] = [];
  for (const p of def.params) {
    const v = params[p.id] ?? p.default;
    switch (p.kind) {
      case 'number':
      case 'int':
      case 'seed':
        out.push({ name: `p_${p.id}`, type: 'float', value: p.kind === 'number' ? Number(v) : Math.round(Number(v)) });
        break;
      case 'choice':
        out.push({ name: `p_${p.id}`, type: 'float', value: Math.max(0, p.options.findIndex((o) => o.value === v)) });
        break;
      case 'bool':
        out.push({ name: `p_${p.id}`, type: 'float', value: v ? 1 : 0 });
        break;
      case 'color':
        out.push({ name: `p_${p.id}`, type: 'vec3', value: rgb(String(v)) });
        break;
      case 'ramp': {
        const stops = [...(v as RampStop[])].sort((a, b) => a.at - b.at).slice(0, 8);
        const c: number[] = [], t: number[] = [];
        for (let k = 0; k < 8; k++) {
          const s = stops[Math.min(k, stops.length - 1)]!;
          c.push(...rgb(s.color));
          t.push(k < stops.length ? s.at : 2);
        }
        out.push({ name: `p_${p.id}_c`, type: 'vec3[]', value: c }, { name: `p_${p.id}_t`, type: 'float[]', value: t }, { name: `p_${p.id}_n`, type: 'float', value: stops.length });
        break;
      }
      case 'image':
        out.push({ name: `p_${p.id}`, type: 'sampler', value: String(v) });
        break;
    }
  }
  return out;
}
