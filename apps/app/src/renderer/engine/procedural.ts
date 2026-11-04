import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export type AssetGroup = 'alpha' | 'pattern' | 'noise';

export interface Asset {
  id: string;
  label: string;
  group: AssetGroup;
  /** Case in the shader. */
  n: number;
}

const A = (group: AssetGroup, n: number, id: string, label: string): Asset => ({ id, label, group, n });

/** The built-in library: made on the graphics card when first used. Patterns and noises tile. */
export const ASSETS: Asset[] = [
  A('noise', 0, 'clouds', 'Clouds'),
  A('noise', 1, 'perlin', 'Perlin'),
  A('noise', 2, 'cells', 'Cells'),
  A('noise', 3, 'cell-edges', 'Cell edges'),
  A('noise', 4, 'ridged', 'Ridged'),
  A('noise', 5, 'turbulence', 'Turbulence'),
  A('noise', 6, 'marble', 'Marble'),
  A('noise', 7, 'wood', 'Wood grain'),
  A('noise', 8, 'grain', 'Grain'),
  A('noise', 9, 'scratches', 'Scratches'),
  A('noise', 10, 'dirt', 'Dirt'),
  A('noise', 11, 'rust', 'Rust'),
  A('noise', 12, 'spots', 'Spots'),
  A('noise', 13, 'crystals', 'Crystals'),
  A('noise', 14, 'fibers', 'Fibres'),
  A('noise', 15, 'cracks', 'Cracks'),
  A('noise', 16, 'warp', 'Warped'),
  A('noise', 17, 'blotches', 'Blotches'),
  A('noise', 18, 'streaks', 'Streaks'),
  A('noise', 19, 'speckle', 'Speckle'),
  A('noise', 60, 'leather', 'Leather'),
  A('noise', 61, 'concrete', 'Concrete'),
  A('noise', 62, 'brushed', 'Brushed metal'),
  A('noise', 63, 'fingerprints', 'Smudges'),
  A('pattern', 20, 'checker', 'Checker'),
  A('pattern', 21, 'stripes', 'Stripes'),
  A('pattern', 22, 'bricks', 'Bricks'),
  A('pattern', 23, 'tiles', 'Tiles'),
  A('pattern', 24, 'hexagons', 'Hexagons'),
  A('pattern', 25, 'dots', 'Dots'),
  A('pattern', 26, 'grid', 'Grid'),
  A('pattern', 27, 'weave', 'Weave'),
  A('pattern', 28, 'basket', 'Basket weave'),
  A('pattern', 29, 'tread', 'Tread plate'),
  A('pattern', 30, 'scales', 'Scales'),
  A('pattern', 31, 'chevron', 'Chevron'),
  A('pattern', 32, 'zigzag', 'Zigzag'),
  A('pattern', 33, 'triangles', 'Triangles'),
  A('pattern', 34, 'rings', 'Rings'),
  A('pattern', 35, 'knurl', 'Knurling'),
  A('pattern', 36, 'planks', 'Planks'),
  A('pattern', 37, 'waves', 'Waves'),
  A('pattern', 38, 'perforated', 'Perforated'),
  A('pattern', 39, 'stitches', 'Stitches'),
  A('alpha', 40, 'soft', 'Soft round'),
  A('alpha', 41, 'hard', 'Hard round'),
  A('alpha', 42, 'square', 'Square'),
  A('alpha', 43, 'ring', 'Ring'),
  A('alpha', 44, 'star', 'Star'),
  A('alpha', 45, 'splatter', 'Splatter'),
  A('alpha', 46, 'spray', 'Spray'),
  A('alpha', 47, 'grunge', 'Grunge'),
  A('alpha', 48, 'chalk', 'Chalk'),
  A('alpha', 49, 'crack', 'Crack'),
  A('alpha', 50, 'scratch', 'Scratch'),
  A('alpha', 51, 'bubbles', 'Bubbles'),
  A('alpha', 52, 'leaf', 'Leaf'),
  A('alpha', 53, 'hatch', 'Hatching'),
  A('alpha', 54, 'drips', 'Drips'),
  A('alpha', 55, 'bristles', 'Bristles'),
  A('alpha', 56, 'sponge', 'Sponge'),
  A('alpha', 57, 'puff', 'Puff'),
  A('alpha', 58, 'triangle', 'Triangle'),
  A('alpha', 59, 'chip', 'Chip'),
  A('alpha', 64, 'rivet', 'Rivet'),
  A('alpha', 65, 'screw', 'Screw'),
  A('alpha', 66, 'bolt', 'Hex bolt'),
  A('alpha', 67, 'stitch', 'Stitch'),
  A('alpha', 68, 'dent', 'Dent'),
  A('alpha', 69, 'bullet', 'Impact'),
];

export const assetOf = (ref: string) => (ref.startsWith('lib:') ? ASSETS.find((a) => a.id === ref.slice(4)) : undefined);

const FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform int u_n;
uniform float u_seed;
#define TAU 6.2831853

float h1(vec2 p) { p = fract(p * vec2(123.34, 456.21) + u_seed * .1731); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h2(vec2 p) { float a = h1(p); return vec2(a, h1(p + a + 17.7)); }
vec2 wrap(vec2 i, vec2 per) { return mod(i, per); }

// Gradient noise that repeats every per cells.
float pn(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  float r = 0.;
  vec2 g00 = h2(wrap(i, per)) * 2. - 1., g10 = h2(wrap(i + vec2(1, 0), per)) * 2. - 1.;
  vec2 g01 = h2(wrap(i + vec2(0, 1), per)) * 2. - 1., g11 = h2(wrap(i + vec2(1, 1), per)) * 2. - 1.;
  r = mix(mix(dot(g00, f), dot(g10, f - vec2(1, 0)), u.x), mix(dot(g01, f - vec2(0, 1)), dot(g11, f - vec2(1, 1)), u.x), u.y);
  return r * 1.4;
}
float fbm(vec2 uv, float f, int oct) {
  float n = 0., a = .5, t = 0.;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; n += pn(uv * f, vec2(f)) * a; t += a; f *= 2.; a *= .5; }
  return n / t * .5 + .5;
}
float ridged(vec2 uv, float f) {
  float n = 0., a = .5, t = 0.;
  for (int i = 0; i < 6; i++) { float r = 1. - abs(pn(uv * f, vec2(f))); n += r * r * a; t += a; f *= 2.; a *= .5; }
  return n / t;
}
float turb(vec2 uv, float f) {
  float n = 0., a = .5, t = 0.;
  for (int i = 0; i < 6; i++) { n += abs(pn(uv * f, vec2(f))) * a; t += a; f *= 2.; a *= .5; }
  return clamp(n / t * 1.6, 0., 1.);
}
// Voronoi that repeats every per cells: x nearest, y second nearest, z id of the nearest.
vec3 vor(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 9., d2 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y), c = wrap(i + o, vec2(per));
    vec2 r = o + h2(c) - f;
    float d = length(r);
    if (d < d1) { d2 = d1; d1 = d; id = h1(c + 3.1); } else if (d < d2) d2 = d;
  }
  return vec3(d1, d2, id);
}
float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
float aa(float d, float w) { return 1. - smoothstep(-w, w, d); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float noise(int n, vec2 uv) {
  if (n == 0) return fbm(uv, 4., 7);
  if (n == 1) return pn(uv * 8., vec2(8.)) * .5 + .5;
  if (n == 2) return clamp(vor(uv * 8., 8.).x, 0., 1.);
  if (n == 3) { vec3 v = vor(uv * 8., 8.); return 1. - smoothstep(0., .08, v.y - v.x); }
  if (n == 4) return ridged(uv, 4.);
  if (n == 5) return turb(uv, 4.);
  if (n == 6) return sin((uv.x * 3. + fbm(uv, 4., 6) * 2.5) * TAU) * .5 + .5;
  if (n == 7) { float w = fbm(uv * vec2(1., 1.), 2., 4); float r = fract(uv.x * 12. + w * 4. + pn(uv * vec2(4., 32.), vec2(4., 32.)) * .15); return pow(r, 3.) * .8 + fbm(uv * vec2(1, 1), 16., 3) * .2; }
  if (n == 8) return h1(floor(uv * 512.));
  if (n == 9) {
    float s = 0.;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      vec2 d = k == 0 ? vec2(1, 0) : k == 1 ? vec2(1, 1) : k == 2 ? vec2(1, -1) : vec2(2, 1);
      vec2 q = vec2(dot(uv, d), dot(uv, vec2(-d.y, d.x)));
      float l = pn(vec2(q.x * 3., q.y * 40.) + fk * 7.3, vec2(3. * (abs(d.x) + abs(d.y)), 40. * (abs(d.x) + abs(d.y))));
      float line = 1. - smoothstep(0., .04, abs(l));
      float pat = smoothstep(.5, .65, fbm(uv + fk * .37, 3., 4));
      s = max(s, line * pat * (.5 + .5 * h1(vec2(fk, floor(q.y * 40.)))));
    }
    return s;
  }
  if (n == 10) return clamp(smoothstep(.45, .7, fbm(uv, 4., 7)) * .8 + h1(floor(uv * 512.)) * .2, 0., 1.);
  if (n == 11) { vec2 w = vec2(fbm(uv, 4., 5), fbm(uv + .5, 4., 5)); float r = fbm(fract(uv + w * .25), 4., 7); return smoothstep(.35, .75, r); }
  if (n == 12) { vec3 v = vor(uv * 10., 10.); return 1. - smoothstep(.05, .1 + v.z * .25, v.x); }
  if (n == 13) return vor(uv * 10., 10.).z;
  if (n == 14) return fbm(uv * vec2(1., 1.), 4., 3) * .3 + (pn(vec2(uv.x * 128., uv.y * 4.), vec2(128., 4.)) * .5 + .5) * .7;
  if (n == 15) { vec2 w = (vec2(fbm(uv, 4., 4), fbm(uv + .3, 4., 4)) - .5) * .06; vec3 v = vor(fract(uv + w) * 6., 6.); return 1. - smoothstep(0., .04, v.y - v.x); }
  if (n == 16) { vec2 w = vec2(fbm(uv, 2., 5), fbm(uv + .4, 2., 5)); return fbm(fract(uv + w * .5), 4., 6); }
  if (n == 17) return smoothstep(.5, .55, fbm(uv, 3., 6));
  if (n == 18) return fbm(vec2(uv.x * 1., uv.y * 1.), 4., 2) * .3 + (pn(vec2(uv.x * 32., uv.y * 2.), vec2(32., 2.)) * .5 + .5) * .7;
  if (n == 19) return step(.97, h1(floor(uv * 256.)));
  if (n == 60) { vec3 v = vor(uv * 24., 24.); return smoothstep(0., .25, v.y - v.x) * .8 + fbm(uv, 32., 3) * .2; }
  if (n == 61) return clamp(fbm(uv, 4., 8) * .7 + (1. - smoothstep(0., .06, vor(uv * 32., 32.).x)) * -.3 + h1(floor(uv * 512.)) * .15 + .1, 0., 1.);
  if (n == 62) return pn(vec2(uv.x * 512., uv.y * 2.), vec2(512., 2.)) * .25 + pn(vec2(uv.x * 128., uv.y * 1.), vec2(128., 1.)) * .25 + .5;
  if (n == 63) { float pat = smoothstep(.45, .6, fbm(uv, 3., 5)); float ridges = sin(fbm(uv, 4., 3) * 120.) * .5 + .5; return pat * (.35 + .65 * ridges) * (.7 + .3 * fbm(uv, 16., 3)); }
  return 0.;
}

float pattern(int n, vec2 uv) {
  float N = 8.;
  vec2 p = uv * N, f = fract(p), i = floor(p);
  if (n == 20) return mod(i.x + i.y, 2.);
  if (n == 21) return step(.5, f.x);
  if (n == 22) { vec2 q = vec2(uv.x * 4., uv.y * 8.); q.x += step(1., mod(floor(q.y), 2.)) * .5; vec2 g = fract(q); return aa(box(g - .5, vec2(.47, .42)), .01) * (.85 + h1(floor(q)) * .15); }
  if (n == 23) return aa(box(f - .5, vec2(.45)), .02) * (1. - box(f - .5, vec2(.45)) * -2.);
  if (n == 24) {
    // 7 by 4 cells is close to true hexagons and still repeats.
    vec2 s = vec2(1., 1.7320508), q = vec2(uv.x * 7., uv.y * 4. * 1.7320508);
    vec2 a = mod(q, s) - s * .5, b = mod(q - s * .5, s) - s * .5;
    vec2 h = abs(dot(a, a) < dot(b, b) ? a : b);
    return aa(max(dot(h, normalize(s)), h.x) - .45, .02);
  }
  if (n == 25) return aa(length(f - .5) - .3, .02);
  if (n == 26) return 1. - aa(min(abs(f.x - .5), abs(f.y - .5)) - .03, .01);
  if (n == 27) { float a = step(.5, mod(i.x + i.y, 2.)); float t = a > .5 ? f.x : f.y; return aa(abs(t - .5) - .38, .02) * (.6 + .4 * sin((a > .5 ? f.y : f.x) * 3.1416)); }
  if (n == 28) { vec2 q = uv * 8.; float c = floor(q.x) + floor(q.y); float k = mod(c, 2.); vec2 g = fract(q); float t = k > .5 ? g.x : g.y; return aa(abs(t - .5) - .42, .02); }
  if (n == 29) { vec2 q = f - .5; float a = mod(i.x + i.y, 2.) > .5 ? .785 : -.785; q = rot(a) * q; return aa(box(q, vec2(.32, .07)) - .03, .02); }
  if (n == 30) { vec2 q = vec2(uv.x * 8., uv.y * 8.); q.x += step(1., mod(floor(q.y), 2.)) * .5; vec2 g = fract(q); float d = length(g - vec2(.5, 0.)); return smoothstep(.0, .75, d) * aa(d - .72, .02) + 0.; }
  if (n == 31) return step(.5, fract(uv.y * 8. + abs(fract(uv.x * 8.) - .5)));
  if (n == 32) return aa(abs(fract(uv.y * 8. + abs(fract(uv.x * 8.) - .5)) - .5) - .12, .02);
  if (n == 33) return step(f.x, f.y);
  if (n == 34) return sin(length(f - .5) * 40.) * .5 + .5;
  if (n == 35) { float a = abs(fract((uv.x + uv.y) * 16.) - .5), b = abs(fract((uv.x - uv.y) * 16.) - .5); return min(a, b) * 2.; }
  if (n == 36) { vec2 q = vec2(uv.x * 2., uv.y * 8.); q.x += h1(vec2(0., floor(q.y))) ; vec2 g = fract(q); float edge = aa(abs(g.y - .5) - .46, .01) * aa(abs(g.x - .5) - .495, .002); return edge * (.75 + .25 * fbm(vec2(fract(q.x / 2.), uv.y), 8., 3)); }
  if (n == 37) return sin((uv.y * 8. + sin(uv.x * TAU * 4.) * .25) * TAU) * .5 + .5;
  if (n == 38) { vec2 q = uv * 16.; q.x += step(1., mod(floor(q.y), 2.)) * .5; return 1. - aa(length(fract(q) - .5) - .25, .02); }
  if (n == 39) { float y = fract(uv.y * 4.); float x = fract(uv.x * 16.); return aa(abs(y - .5) - .03, .01) * aa(abs(x - .5) - .3, .02); }
  return 0.;
}

float alpha(int n, vec2 uv) {
  vec2 p = uv * 2. - 1.;
  float r = length(p), a = atan(p.y, p.x);
  float edge = 1. - smoothstep(.85, 1., r);
  if (n == 40) return pow(max(0., 1. - r), 2.) * (3. - 2. * max(0., 1. - r));
  if (n == 41) return aa(r - .9, .01);
  if (n == 42) return aa(box(p, vec2(.85)), .01);
  if (n == 43) return aa(abs(r - .7) - .12, .02);
  if (n == 44) { float k = cos(a * 5.) * .5 + .5; return aa(r - (.4 + .5 * pow(k, 3.)), .02); }
  if (n == 45) {
    float s = aa(r - (.45 + fbm(vec2(a / TAU, 0.), 6., 4) * .3), .02);
    for (int k = 0; k < 14; k++) { vec2 c = (h2(vec2(float(k), 3.)) * 2. - 1.) * .85; float rr = .03 + h1(vec2(float(k), 9.)) * .07; s = max(s, aa(length(p - c) - rr, .01)); }
    return s;
  }
  if (n == 46) return step(1. - (1. - r) * .45, h1(floor(uv * 128.))) * edge;
  if (n == 47) return clamp(smoothstep(.4, .65, fbm(uv, 4., 6)) * (1. - smoothstep(.4, 1., r)) * 1.6, 0., 1.);
  if (n == 48) return aa(r - .75 - (fbm(uv, 8., 4) - .5) * .4, .02) * (.6 + .4 * step(.35, h1(floor(uv * 256.))));
  if (n == 49) { vec3 v = vor(uv * 5. + fbm(uv, 4., 4) * .5, 1e4); return (1. - smoothstep(0., .05, v.y - v.x)) * edge; }
  if (n == 50) { float w = .05 * (1. - abs(p.x)); float y = p.y + (fbm(vec2(uv.x, 0.), 4., 4) - .5) * .3; return aa(abs(y) - w, .01) * (1. - smoothstep(.85, 1., abs(p.x))) * (.7 + .3 * h1(floor(uv * 256.))); }
  if (n == 51) { float s = 0.; for (int k = 0; k < 10; k++) { vec2 c = (h2(vec2(float(k), 5.)) * 2. - 1.) * .6; float rr = .1 + h1(vec2(float(k), 2.)) * .25; float d = length(p - c); s = max(s, aa(abs(d - rr) - .02, .01) + aa(d - rr, .01) * .15); } return s; }
  if (n == 52) { vec2 q = p; q.x *= 1.8; float d = length(vec2(q.x, abs(q.y) * .8 + .0)) - .9 + abs(q.y) * .3; float vein = 1. - aa(abs(p.x) - .015, .01) * step(abs(p.y), .8) * .5; return aa(length(vec2(q.x * 1.0, p.y)) - (.9 - abs(p.y) * .2) - 0., .02) * aa(abs(p.x) - (.55 * (1. - p.y * p.y)), .02) * vein; }
  if (n == 53) { float l = max(aa(abs(fract((uv.x + uv.y) * 10.) - .5) - .08, .02), aa(abs(fract((uv.x - uv.y) * 10.) - .5) - .08, .02)); return l * edge; }
  if (n == 54) { float s = aa(abs(p.y - .6) - .25, .02) * aa(abs(p.x) - .9, .02); for (int k = 0; k < 7; k++) { float x = -.8 + float(k) * .27 + (h1(vec2(float(k), 1.)) - .5) * .1; float len = .3 + h1(vec2(float(k), 4.)) * 1.1; float w = .05 + h1(vec2(float(k), 8.)) * .04; float dy = .6 - p.y; s = max(s, aa(abs(p.x - x) - w * (1. - dy / (len + .2) * .3), .01) * step(dy, len)); s = max(s, aa(length(p - vec2(x, .6 - len)) - w * 1.4, .01)); } return s; }
  if (n == 55) return (pn(vec2(p.x * 40., p.y * 1.), vec2(1e4)) * .5 + .5 > .45 ? 1. : 0.) * (1. - smoothstep(.6, 1., abs(p.y))) * (1. - smoothstep(.85, 1., abs(p.x)));
  if (n == 56) { vec3 v = vor(uv * 8., 1e4); return smoothstep(.15, .3, v.x) * edge; }
  if (n == 57) return clamp(fbm(uv, 3., 6) * 1.6 - r, 0., 1.);
  if (n == 58) { vec2 q = p; q.y += .2; float d = max(abs(q.x) * .866 + q.y * .5, -q.y) - .55; return aa(d, .02); }
  if (n == 59) { float d = r - .6 - (fbm(vec2(a / TAU + .5, 0.), 5., 5) - .5) * .8; return aa(d, .02) * (.7 + .3 * fbm(uv, 8., 3)); }
  if (n == 64) return aa(r - .8, .02) * (.5 + .5 * sqrt(max(0., 1. - r * r / .64)));
  if (n == 65) return aa(r - .8, .02) * (.5 + .5 * sqrt(max(0., 1. - r * r / .64))) * (1. - aa(abs(p.y) - .08, .01) * aa(abs(p.x) - .55, .01) * .8);
  if (n == 66) { vec2 h = abs(p); float hex = max(h.x * .866 + h.y * .5, h.y) - .75; return aa(hex, .02) * (.6 + .4 * (1. - smoothstep(.0, .5, r))) ; }
  if (n == 67) { vec2 q = rot(.5) * p; return aa(box(q, vec2(.7, .1)) - .05, .02) * (.6 + .4 * (1. - abs(q.y) * 6.)); }
  if (n == 68) return (pow(r / .8, 2.) * aa(r - .8, .02) + aa(abs(r - .85) - .07, .03) * (1. - step(r, .8)) ) * .9;
  if (n == 69) { float c = 1. - smoothstep(0., .35, r); float cr = (1. - smoothstep(0., .05, abs(fract(a / TAU * 9. + fbm(uv, 4., 3) * .5) - .5) - .45 + r * .1)) * (1. - smoothstep(.2, .9, r)); return max(c, cr * .8); }
  return 0.;
}

void main() {
  float v = u_n >= 40 && u_n < 60 || u_n >= 64 ? alpha(u_n, vUv) : u_n >= 20 && u_n < 40 ? pattern(u_n, vUv) : noise(u_n, vUv);
  o = vec4(vec3(clamp(v, 0., 1.)), 1.);
}`;

const VS = /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

let mat: THREE.ShaderMaterial | null = null;
const quad = new FullScreenQuad();

/** Draws an asset into a new render target. */
export function drawAsset(r: THREE.WebGLRenderer, a: Asset, size: number, seed = 0): THREE.WebGLRenderTarget {
  mat ??= new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, uniforms: { u_n: { value: 0 }, u_seed: { value: 0 } }, depthTest: false, depthWrite: false });
  mat.uniforms.u_n!.value = a.n;
  mat.uniforms.u_seed!.value = seed;
  const t = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, depthBuffer: false });
  t.texture.wrapS = t.texture.wrapT = THREE.RepeatWrapping;
  const prev = r.getRenderTarget();
  r.setRenderTarget(t);
  quad.material = mat;
  quad.render(r);
  r.setRenderTarget(prev);
  return t;
}
