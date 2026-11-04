export const QUAD_VS = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const BLEND = /* glsl */ `
vec3 blendOf(vec3 b, vec3 s) {
  if (u_blend == 1) return b * s;
  if (u_blend == 2) return 1. - (1. - b) * (1. - s);
  if (u_blend == 3) return mix(2. * b * s, 1. - 2. * (1. - b) * (1. - s), step(.5, b));
  if (u_blend == 4) return min(b + s, 1.);
  if (u_blend == 5) return max(b - s, 0.);
  if (u_blend == 6) return min(b, s);
  if (u_blend == 7) return max(b, s);
  return s;
}

// Straight colour with coverage in alpha, so groups and effects can start from nothing.
vec4 over(vec4 B, vec3 s, float a) {
  vec3 b = B.rgb;
  float ba = B.a, oa = a + ba * (1. - a);
  if (u_kind == 2) {
    vec3 nb = b * 2. - 1., ns = s * 2. - 1.;
    vec3 t = u_blend == 8 ? ns : normalize(vec3(nb.xy + ns.xy, nb.z * ns.z));
    return vec4(normalize(mix(nb, t, a)) * .5 + .5, oa);
  }
  vec3 bl = mix(s, blendOf(b, s), ba);
  return vec4(oa > 0. ? (bl * a + b * ba * (1. - a)) / oa : b, oa);
}`;

const BLUR = /* glsl */ `
vec4 blurred(sampler2D t, vec2 uv, float r) {
  vec4 sum = vec4(0.);
  float w = 0.;
  for (int i = 0; i < 32; i++) {
    float f = (float(i) + .5) / 32., ang = float(i) * 2.39996;
    float k = exp(-3. * f);
    vec4 c = texture(t, uv + vec2(cos(ang), sin(ang)) * sqrt(f) * r);
    sum += vec4(c.rgb * c.a, c.a) * k;
    w += k;
  }
  return sum.a > 0. ? vec4(sum.rgb / sum.a, sum.a / w) : vec4(texture(t, uv).rgb, 0.);
}`;

/** One layer over what's below it, for one channel. 8 is an internal blend: replace (groups passing through). */
export const LAYER_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_below;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform int u_src;      // 0 flat, 1 painted (premultiplied), 2 material map, 3 straight with coverage
uniform int u_kind;     // 0 colour, 1 grey, 2 normal
uniform int u_blend;
uniform int u_hasMask;
uniform int u_vUp;
uniform int u_flipG;
uniform vec3 u_value;
uniform float u_scale;
uniform float u_opacity;
${BLEND}

void main() {
  vec3 s = u_value;
  float cov = 1.;
  if (u_src == 1) {
    vec4 p = texture(u_tex, vUv);
    cov = p.a;
    s = p.a > 0. ? p.rgb / p.a : vec3(0.);
  } else if (u_src == 2) {
    vec2 st = vUv * u_scale;
    if (u_vUp == 1) st.y = -st.y;
    s = texture(u_tex, st).rgb;
    if (u_flipG == 1) s.g = 1. - s.g;
  } else if (u_src == 3) {
    vec4 p = texture(u_tex, vUv);
    s = p.rgb;
    cov = p.a;
  }
  if (u_hasMask == 1) cov *= texture(u_mask, vUv).r;
  o = over(texture(u_below, vUv), s, clamp(cov * u_opacity, 0., 1.));
}`;

/** One effect of a layer over what's below it, for one channel. */
export const EFFECT_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_below;
uniform sampler2D u_tex;
uniform int u_src;      // 0 flat, 1 painted, 2 material map, 3 mesh map, 4 image; 10 levels, 11 invert, 12 hue and saturation, 13 blur
uniform int u_kind;
uniform int u_blend;
uniform int u_vUp;
uniform int u_flipG;
uniform int u_ch;
uniform int u_invert;
uniform vec3 u_value;
uniform vec3 u_levels;
uniform vec3 u_hsl;
uniform float u_scale;
uniform float u_opacity;
uniform float u_level;
uniform float u_spread;
uniform float u_radius;
${BLEND}
${BLUR}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0., -1. / 3., 2. / 3., -1.);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6. * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1., 2. / 3., 1. / 3.)) * 6. - 3.);
  return c.z * mix(vec3(1.), clamp(p - 1., 0., 1.), c.y);
}

void main() {
  vec4 B = texture(u_below, vUv);
  if (u_src >= 10) {
    vec4 f = B;
    if (u_src == 13) f = blurred(u_below, vUv, u_radius);
    else if (u_kind != 2) {
      if (u_src == 10) f.rgb = pow(clamp((B.rgb - u_levels.x) / max(u_levels.y - u_levels.x, 1e-4), 0., 1.), vec3(1. / max(u_levels.z, .01)));
      else if (u_src == 11) f.rgb = 1. - B.rgb;
      else if (u_kind == 0) {
        vec3 h = rgb2hsv(B.rgb);
        h.x = fract(h.x + u_hsl.x);
        h.y = clamp(h.y * (1. + u_hsl.y), 0., 1.);
        f.rgb = clamp(hsv2rgb(h) + u_hsl.z, 0., 1.);
      } else f.rgb = clamp(B.rgb + u_hsl.z, 0., 1.);
    }
    o = mix(B, f, u_opacity);
    if (u_kind == 2) o.rgb = normalize(o.rgb * 2. - 1.) * .5 + .5;
    return;
  }
  vec3 s = u_value;
  float cov = 1.;
  if (u_src == 1) {
    vec4 p = texture(u_tex, vUv);
    cov = p.a;
    s = p.a > 0. ? p.rgb / p.a : vec3(0.);
  } else if (u_src == 2) {
    vec2 st = vUv * u_scale;
    if (u_vUp == 1) st.y = -st.y;
    s = texture(u_tex, st).rgb;
    if (u_flipG == 1) s.g = 1. - s.g;
  } else if (u_src == 3) {
    vec4 g = texture(u_tex, vUv);
    float v = u_ch == 1 ? g.g : g.r;
    if (u_invert == 1) v = 1. - v;
    s = vec3(smoothstep(u_level - u_spread, u_level + u_spread + 1e-4, v));
  } else if (u_src == 4) {
    vec2 st = vUv * u_scale;
    if (u_vUp == 1) st.y = -st.y;
    s = texture(u_tex, st).rgb;
    if (u_kind == 1) s = vec3(dot(s, vec3(.299, .587, .114)));
    if (u_invert == 1) s = 1. - s;
  }
  o = over(B, s, clamp(cov * u_opacity, 0., 1.));
}`;

/** The finished channel: grey copied to RGB, normals with the height's bumps, and colour spread past UV edges. */
export const FINAL_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_island;
uniform sampler2D u_height;
uniform sampler2D u_ao;
uniform int u_hasAo;
uniform int u_kind;
uniform int u_hasHeight;
uniform float u_size;
uniform float u_bump;

vec3 value(vec2 uv) {
  vec3 c = texture(u_src, uv).rgb;
  if (u_kind == 1) return vec3(u_hasAo == 1 ? c.r * texture(u_ao, uv).r : c.r);
  if (u_kind == 2 && u_hasHeight == 1) {
    float px = 1. / u_size;
    float du = texture(u_height, uv + vec2(px, 0.)).r - texture(u_height, uv - vec2(px, 0.)).r;
    float dv = texture(u_height, uv + vec2(0., px)).r - texture(u_height, uv - vec2(0., px)).r;
    vec3 h = normalize(vec3(-du * u_bump, -dv * u_bump, 1.));
    vec3 n = c * 2. - 1.;
    return normalize(vec3(n.xy + h.xy, n.z * h.z)) * .5 + .5;
  }
  return c;
}

void main() {
  if (texture(u_island, vUv).r > .5) { o = vec4(value(vUv), 1.); return; }
  float px = 1. / u_size;
  for (int r = 1; r <= 8; r++)
    for (int i = 0; i < 8; i++) {
      float a = float(i) * .7853982;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * float(r) * px;
      if (texture(u_island, uv).r > .5) { o = vec4(value(uv), 1.); return; }
    }
  o = vec4(value(vUv), 1.);
}`;

/** Meshes drawn flat in texture space: where the model has texture. */
export const UV_VS = /* glsl */ `
out vec3 vWorld;
out vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  gl_Position = vec4(uv * 2. - 1., 0., 1.);
}`;

export const ISLAND_FS = /* glsl */ `
precision highp float;
out vec4 o;
void main() { o = vec4(1.); }`;

export const MAX_DABS = 64;

/** Brush dabs, projected from the screen onto the surface and written in texture space as coverage. */
export const DAB_FS = /* glsl */ `
precision highp float;
in vec3 vWorld;
in vec3 vN;
out vec4 o;
uniform mat4 u_viewProj;
uniform vec3 u_camPos;
uniform vec3 u_camDir;
uniform int u_ortho;
uniform vec2 u_screen;
uniform sampler2D u_depth;
uniform vec4 u_dabs[${MAX_DABS}];   // x, y, radius, flow
uniform int u_count;
uniform float u_hardness;
uniform float u_flow;
uniform int u_shape;     // 0 round, 1 square, 2 picture
uniform float u_angle;
uniform sampler2D u_alpha;
uniform int u_hasStencil;
uniform sampler2D u_stencil;
uniform vec4 u_stencilAt;  // centre x, y, width (screen pixels), angle
uniform float u_stencilAspect;

float tip(vec2 d) {
  float c = cos(u_angle), s = sin(u_angle);
  d = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  if (u_shape == 1) { float m = max(abs(d.x), abs(d.y)); return m < 1. ? 1. - smoothstep(u_hardness, 1., m) : 0.; }
  if (u_shape == 2) { if (max(abs(d.x), abs(d.y)) >= 1.) return 0.; return texture(u_alpha, d * .5 + .5).r; }
  float l = length(d);
  return l < 1. ? 1. - smoothstep(u_hardness, 1., l) : 0.;
}

void main() {
  vec4 clip = u_viewProj * vec4(vWorld, 1.);
  if (clip.w <= 0.) discard;
  vec3 ndc = clip.xyz / clip.w;
  vec2 sc = (ndc.xy * .5 + .5);
  if (any(lessThan(sc, vec2(0.))) || any(greaterThan(sc, vec2(1.)))) discard;
  vec3 view = u_ortho == 1 ? -u_camDir : normalize(u_camPos - vWorld);
  float facing = abs(dot(normalize(vN), view));
  float dist = u_ortho == 1 ? dot(vWorld - u_camPos, u_camDir) : length(vWorld - u_camPos);
  float scene = texture(u_depth, sc).r;
  if (dist > scene * 1.003 + .004) discard;
  vec2 px = sc * u_screen;
  float keep = 1.;
  for (int i = 0; i < ${MAX_DABS}; i++) {
    if (i >= u_count) break;
    keep *= 1. - tip((px - u_dabs[i].xy) / u_dabs[i].z) * u_flow * u_dabs[i].w;
  }
  float a = (1. - keep) * smoothstep(0., .15, facing);
  if (u_hasStencil == 1) {
    vec2 d = px - u_stencilAt.xy;
    float c = cos(u_stencilAt.w), s = sin(u_stencilAt.w);
    vec2 st = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / vec2(u_stencilAt.z, u_stencilAt.z * u_stencilAspect) + .5;
    a *= dot(texture(u_stencil, vec2(st.x, 1. - st.y)).rgb, vec3(.299, .587, .114));
  }
  if (a <= 0.) discard;
  o = vec4(a);
}`;

/** Smudge and blur: what this frame's dabs cover is pulled along the stroke or softened. */
export const SMEAR_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_dst;
uniform sampler2D u_stroke;
uniform int u_mode;     // 0 blur, 1 smudge
uniform float u_radius;
uniform vec2 u_offset;
uniform float u_opacity;
void main() {
  vec4 d = texture(u_dst, vUv);
  float a = texture(u_stroke, vUv).r * u_opacity;
  vec4 s;
  if (u_mode == 1) s = texture(u_dst, vUv + u_offset);
  else {
    s = vec4(0.);
    float w = 0.;
    for (int i = 0; i < 24; i++) {
      float f = (float(i) + .5) / 24., ang = float(i) * 2.39996;
      float k = exp(-3. * f);
      s += texture(u_dst, vUv + vec2(cos(ang), sin(ang)) * sqrt(f) * u_radius) * k;
      w += k;
    }
    s /= w;
  }
  o = mix(d, s, clamp(a, 0., 1.));
}`;

/** The fill tool: a whole UV island (or the whole part when u_island < 0) as coverage. */
export const ISLAND_VS = /* glsl */ `
in float a_island;
out float vIsland;
void main() {
  vIsland = a_island;
  gl_Position = vec4(uv * 2. - 1., 0., 1.);
}`;

export const PICK_FS = /* glsl */ `
precision highp float;
in float vIsland;
out vec4 o;
uniform float u_island;
void main() {
  if (u_island >= 0. && abs(vIsland - u_island) > .5) discard;
  o = vec4(1.);
}`;

export const DIST_VS = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const DIST_FS = /* glsl */ `
precision highp float;
in vec3 vWorld;
out vec4 o;
uniform vec3 u_camPos;
uniform vec3 u_camDir;
uniform int u_ortho;
void main() { o = vec4(u_ortho == 1 ? dot(vWorld - u_camPos, u_camDir) : length(vWorld - u_camPos)); }`;

/** A stroke written into a layer: premultiplied over (or taken away when erasing). */
export const COMMIT_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_dst;
uniform sampler2D u_stroke;
uniform vec4 u_value;
uniform float u_opacity;
uniform int u_erase;
void main() {
  vec4 d = texture(u_dst, vUv);
  float a = min(texture(u_stroke, vUv).r, u_opacity);
  o = u_erase == 1 ? d * (1. - a) : u_value * a + d * (1. - a);
}`;

export const COPY_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_src;
void main() { o = texture(u_src, vUv); }`;

export const FILL_FS = /* glsl */ `
precision highp float;
out vec4 o;
uniform vec4 u_value;
void main() { o = u_value; }`;

/** One step of a mask over what's below it (grey). */
export const MASK_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_below;
uniform sampler2D u_tex;
uniform int u_src;      // 0 value, 1 painted (premultiplied), 2 mesh map, 3 image; 10 levels, 11 invert, 13 blur
uniform int u_blend;
uniform int u_ch;
uniform int u_invert;
uniform int u_vUp;
uniform float u_value;
uniform float u_opacity;
uniform float u_level;
uniform float u_spread;
uniform float u_scale;
uniform float u_radius;
uniform vec3 u_levels;
${BLUR}
void main() {
  float b = texture(u_below, vUv).r;
  if (u_src >= 10) {
    float f = b;
    if (u_src == 10) f = pow(clamp((b - u_levels.x) / max(u_levels.y - u_levels.x, 1e-4), 0., 1.), 1. / max(u_levels.z, .01));
    else if (u_src == 11) f = 1. - b;
    else if (u_src == 13) f = blurred(u_below, vUv, u_radius).r;
    o = vec4(vec3(mix(b, f, u_opacity)), 1.);
    return;
  }
  float s = u_value, cov = 1.;
  if (u_src == 1) {
    vec4 p = texture(u_tex, vUv);
    cov = p.a;
    s = p.a > 0. ? p.r / p.a : 0.;
  } else if (u_src == 2) {
    vec4 g = texture(u_tex, vUv);
    float v = u_ch == 1 ? g.g : g.r;
    if (u_invert == 1) v = 1. - v;
    s = smoothstep(u_level - u_spread, u_level + u_spread + 1e-4, v);
  } else if (u_src == 3) {
    vec2 st = vUv * u_scale;
    if (u_vUp == 1) st.y = -st.y;
    s = dot(texture(u_tex, st).rgb, vec3(.299, .587, .114));
    if (u_invert == 1) s = 1. - s;
  }
  float r = s;
  if (u_blend == 1) r = b * s;
  else if (u_blend == 2) r = min(b + s, 1.);
  else if (u_blend == 3) r = max(b - s, 0.);
  else if (u_blend == 4) r = max(b, s);
  else if (u_blend == 5) r = min(b, s);
  r = mix(b, r, clamp(cov * u_opacity, 0., 1.));
  o = vec4(vec3(r), 1.);
}`;
