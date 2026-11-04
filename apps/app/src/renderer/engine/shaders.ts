export const QUAD_VS = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

/** One layer over what's below it, for one channel. */
export const LAYER_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_below;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform int u_src;      // 0 flat, 1 painted (premultiplied), 2 material map
uniform int u_kind;     // 0 colour, 1 grey, 2 normal
uniform int u_blend;
uniform int u_hasMask;
uniform int u_vUp;
uniform int u_flipG;
uniform vec3 u_value;
uniform float u_scale;
uniform float u_opacity;

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
  }
  if (u_hasMask == 1) cov *= texture(u_mask, vUv).r;
  float a = clamp(cov * u_opacity, 0., 1.);
  vec3 b = texture(u_below, vUv).rgb;
  vec3 r;
  if (u_kind == 2) r = normalize(mix(b * 2. - 1., s * 2. - 1., a)) * .5 + .5;
  else r = mix(b, blendOf(b, s), a);
  o = vec4(r, 1.);
}`;

/** The finished channel: grey copied to RGB, normals with the height's bumps, and colour spread past UV edges. */
export const FINAL_FS = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_island;
uniform sampler2D u_height;
uniform int u_kind;
uniform int u_hasHeight;
uniform float u_size;
uniform float u_bump;

vec3 value(vec2 uv) {
  vec3 c = texture(u_src, uv).rgb;
  if (u_kind == 1) return vec3(c.r);
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
uniform vec3 u_dabs[${MAX_DABS}];
uniform int u_count;
uniform float u_hardness;
uniform float u_flow;

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
    float d = length(px - u_dabs[i].xy) / u_dabs[i].z;
    if (d < 1.) keep *= 1. - (1. - smoothstep(u_hardness, 1., d)) * u_flow;
  }
  float a = (1. - keep) * smoothstep(0., .15, facing);
  if (a <= 0.) discard;
  o = vec4(a);
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
