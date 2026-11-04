/**
 * The nodes of Cocoa Materials. Each makes one picture (grey or colour) from its settings and its inputs, as a
 * small GLSL program run on the graphics card (decision C1). Everything tiles: generators repeat over their
 * square, so baked maps never show a seam.
 *
 * In the GLSL bodies: `uv` is where in the square (0–1, top-left first), `p_<id>` are the settings, `inC_<id>(uv)`
 * and `inG_<id>(uv)` read an input as colour or grey, `h_<id>` is 1 when the input is linked, `u_px` is one pixel,
 * and the body sets `outColor`.
 */

export type L = { en: string; ru: string };
export type RampStop = { at: number; color: string };
export type ParamValue = number | string | boolean | RampStop[];
export type Kind = 'grey' | 'color';
export type OutputRole = 'color' | 'height' | 'normal' | 'roughness' | 'metalness' | 'occlusion' | 'glow' | 'opacity' | 'wearColor' | 'wearRoughness' | 'wearMetal' | 'wearNoise';
export type Group = 'make' | 'change' | 'combine' | 'colour' | 'surface' | 'output';

export interface Port {
  id: string;
  label: L;
  kind: Kind;
  /** What it reads when nothing is linked (0–1 grey or an RGB colour). */
  fallback?: [number, number, number];
}

export type Param =
  | { id: string; label: L; kind: 'number'; min: number; max: number; step?: number; default: number }
  | { id: string; label: L; kind: 'int'; min: number; max: number; default: number }
  | { id: string; label: L; kind: 'seed'; default: number }
  | { id: string; label: L; kind: 'choice'; options: { value: string; label: L }[]; default: string }
  | { id: string; label: L; kind: 'color'; default: string }
  | { id: string; label: L; kind: 'bool'; default: boolean }
  | { id: string; label: L; kind: 'ramp'; default: RampStop[] }
  | { id: string; label: L; kind: 'image'; default: string };

export interface NodeDef {
  type: string;
  group: Group;
  label: L;
  hint: L;
  inputs: Port[];
  /** What it makes; null for output nodes. */
  output: Kind | null;
  /** For output nodes: the map of the material it makes. */
  role?: OutputRole;
  params: Param[];
  glsl: string;
}

const l = (en: string, ru: string): L => ({ en, ru });
const seed: Param = { id: 'seed', label: l('Seed', 'Зерно'), kind: 'seed', default: 0 };
const IN_GREY = (id = 'in', label = l('In', 'Вход'), fallback: [number, number, number] = [0, 0, 0]): Port => ({ id, label, kind: 'grey', fallback });
const IN_COLOR = (id = 'in', label = l('In', 'Вход'), fallback: [number, number, number] = [0, 0, 0]): Port => ({ id, label, kind: 'color', fallback });
const opt = (value: string, en: string, ru: string) => ({ value, label: l(en, ru) });

/** Output nodes: pass their input through (so it can be shown and baked). */
function output(type: string, role: OutputRole, kind: Kind, en: string, ru: string, hintEn: string, hintRu: string, fallback: [number, number, number]): NodeDef {
  return {
    type,
    group: 'output',
    label: l(en, ru),
    hint: l(hintEn, hintRu),
    inputs: [{ id: 'in', label: l(en, ru), kind, fallback }],
    output: null,
    role,
    params: [],
    glsl: kind === 'grey' ? 'float v = inG_in(uv); outColor = vec4(vec3(v), 1.);' : 'outColor = vec4(inC_in(uv).rgb, 1.);',
  };
}

export const NODES: NodeDef[] = [
  // ── Make ──
  {
    type: 'noise',
    group: 'make',
    label: l('Noise', 'Шум'),
    hint: l('Cloudy random patterns: soft (Perlin), blocky (value) or ridged like veins.', 'Облачные случайные узоры: мягкие (Перлин), пятнистые или с прожилками.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'kind', label: l('Kind', 'Вид'), kind: 'choice', options: [opt('perlin', 'Perlin', 'Перлин'), opt('value', 'Value', 'Пятна'), opt('ridged', 'Ridged', 'Прожилки')], default: 'perlin' },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 64, default: 4 },
      { id: 'octaves', label: l('Detail', 'Детали'), kind: 'int', min: 1, max: 10, default: 5 },
      { id: 'roughness', label: l('Roughness', 'Грубость'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: 'outColor = vec4(vec3(fbm(uv, p_scale, p_octaves, p_roughness, p_kind, p_seed)), 1.);',
  },
  {
    type: 'cells',
    group: 'make',
    label: l('Cells', 'Ячейки'),
    hint: l('Cells around random points (Voronoi): stones, scales, cracked mud.', 'Ячейки вокруг случайных точек (Вороной): камни, чешуя, трещины.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'mode', label: l('Shows', 'Показывает'), kind: 'choice', options: [opt('distance', 'Distance', 'Расстояние'), opt('edges', 'Edges', 'Границы'), opt('random', 'Random per cell', 'Случайно по ячейкам')], default: 'distance' },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 64, default: 6 },
      { id: 'jitter', label: l('Randomness', 'Случайность'), kind: 'number', min: 0, max: 1, default: 1 },
      { id: 'width', label: l('Edge width', 'Ширина границ'), kind: 'number', min: 0.01, max: 0.5, default: 0.08 },
      seed,
    ],
    glsl: `vec3 v = voronoi(uv, p_scale, p_jitter, p_seed);
float r = p_mode < 0.5 ? clamp(v.x, 0., 1.) : p_mode < 1.5 ? smoothstep(0., p_width, v.y - v.x) : v.z;
outColor = vec4(vec3(r), 1.);`,
  },
  {
    type: 'bricks',
    group: 'make',
    label: l('Bricks and tiles', 'Кирпичи и плитка'),
    hint: l('Rows of bricks or tiles with mortar between them; white is brick, black mortar.', 'Ряды кирпичей или плитки со швами; белое — кирпич, чёрное — шов.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'rows', label: l('Rows', 'Рядов'), kind: 'int', min: 1, max: 64, default: 8 },
      { id: 'columns', label: l('Columns', 'Столбцов'), kind: 'int', min: 1, max: 64, default: 4 },
      { id: 'offset', label: l('Offset', 'Сдвиг'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'mortar', label: l('Mortar', 'Шов'), kind: 'number', min: 0, max: 0.5, default: 0.06 },
      { id: 'bevel', label: l('Bevel', 'Скос'), kind: 'number', min: 0, max: 0.5, default: 0.12 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `float y = uv.y * p_rows; float row = floor(y);
float x = uv.x * p_columns + p_offset * mod(row, 2.); float col = floor(x);
vec2 f = vec2(fract(x), fract(y));
// Distance to the brick's edge, in row heights.
float dx = min(f.x, 1. - f.x) * p_rows / p_columns, dy = min(f.y, 1. - f.y);
float d = min(dx, dy) - p_mortar * 0.5;
float r = hash12(vec2(mod(col, p_columns), mod(row, p_rows)) + seedv(p_seed));
float h = d <= 0. ? 0. : (p_bevel > 0. ? smoothstep(0., p_bevel, d) : 1.) * (1. - p_random * r);
outColor = vec4(vec3(h), 1.);`,
  },
  {
    type: 'shape',
    group: 'make',
    label: l('Shape', 'Фигура'),
    hint: l('A circle, square, polygon or star, repeated to tile.', 'Круг, квадрат, многоугольник или звезда, повторённые плиткой.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'kind', label: l('Kind', 'Вид'), kind: 'choice', options: [opt('circle', 'Circle', 'Круг'), opt('square', 'Square', 'Квадрат'), opt('polygon', 'Polygon', 'Многоугольник'), opt('star', 'Star', 'Звезда')], default: 'circle' },
      { id: 'sides', label: l('Sides', 'Сторон'), kind: 'int', min: 3, max: 12, default: 6 },
      { id: 'size', label: l('Size', 'Размер'), kind: 'number', min: 0, max: 1.5, default: 0.7 },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 1, default: 0.05 },
      { id: 'tiles', label: l('Repeat', 'Повторов'), kind: 'int', min: 1, max: 32, default: 1 },
      { id: 'angle', label: l('Turn', 'Поворот'), kind: 'number', min: 0, max: 360, step: 1, default: 0 },
    ],
    glsl: `vec2 p = fract(uv * p_tiles) - 0.5;
float a0 = radians(p_angle); p = mat2(cos(a0), -sin(a0), sin(a0), cos(a0)) * p;
float d;
if (p_kind < 0.5) d = length(p) * 2.;
else if (p_kind < 1.5) d = max(abs(p.x), abs(p.y)) * 2.;
else {
  float a = atan(p.x, -p.y) + PI; float r = 2. * PI / p_sides;
  d = cos(floor(0.5 + a / r) * r - a) * length(p) * 2.;
  if (p_kind > 2.5) { float k = abs(fract(a / r) - 0.5) * 2.; d *= mix(1.6, 0.8, k); }
}
float s = max(p_softness * 0.5, 0.002);
outColor = vec4(vec3(1. - smoothstep(p_size - s, p_size + s, d)), 1.);`,
  },
  {
    type: 'gradient',
    group: 'make',
    label: l('Gradient', 'Градиент'),
    hint: l('Dark to light across the square. Linear doesn’t tile; mirrored and round do.', 'От тёмного к светлому. Линейный не стыкуется плиткой; зеркальный и круглый — да.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'kind', label: l('Kind', 'Вид'), kind: 'choice', options: [opt('linear', 'Linear', 'Линейный'), opt('mirrored', 'Mirrored', 'Зеркальный'), opt('radial', 'Round', 'Круглый')], default: 'mirrored' },
      { id: 'direction', label: l('Direction', 'Направление'), kind: 'choice', options: [opt('across', 'Across', 'Поперёк'), opt('down', 'Down', 'Вниз')], default: 'down' },
      { id: 'tiles', label: l('Repeat', 'Повторов'), kind: 'int', min: 1, max: 32, default: 1 },
    ],
    glsl: `vec2 q = fract(uv * p_tiles); float t = p_direction < 0.5 ? q.x : q.y;
float v = p_kind < 0.5 ? t : p_kind < 1.5 ? 1. - abs(t * 2. - 1.) : 1. - clamp(length(q - 0.5) * 2., 0., 1.);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'checker',
    group: 'make',
    label: l('Checker', 'Шахматы'),
    hint: l('Black and white squares.', 'Чёрные и белые клетки.'),
    inputs: [],
    output: 'grey',
    params: [{ id: 'tiles', label: l('Squares across', 'Клеток в ряд'), kind: 'int', min: 1, max: 64, default: 8 }],
    glsl: 'float v = mod(floor(uv.x * p_tiles) + floor(uv.y * p_tiles), 2.); outColor = vec4(vec3(v), 1.);',
  },
  {
    type: 'scratches',
    group: 'make',
    label: l('Scratches', 'Царапины'),
    hint: l('Thin random lines, mostly one way: scuffed metal, scratched paint.', 'Тонкие случайные линии: потёртый металл, поцарапанная краска.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'density', label: l('How many', 'Сколько'), kind: 'int', min: 1, max: 32, default: 8 },
      { id: 'length', label: l('Length', 'Длина'), kind: 'number', min: 0.05, max: 1.5, default: 0.6 },
      { id: 'width', label: l('Width', 'Толщина'), kind: 'number', min: 0.002, max: 0.1, default: 0.01 },
      { id: 'angle', label: l('Direction', 'Направление'), kind: 'number', min: 0, max: 180, step: 1, default: 30 },
      { id: 'spread', label: l('Spread', 'Разброс'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `vec2 p = uv * p_density; vec2 i = floor(p); float v = 0.;
for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
  vec2 c = i + vec2(x, y); vec2 w = mod(c, p_density) + seedv(p_seed);
  vec2 h = hash22(w);
  vec2 centre = c + h;
  float a = radians(p_angle) + (hash12(w + 3.1) - 0.5) * p_spread * PI;
  // (Half its length in cells, at most what the 5 × 5 cells looked at can hold.)
  vec2 dir = vec2(cos(a), sin(a)) * min(p_length * 0.5 * p_density, 2.2) * (0.5 + 0.5 * hash12(w + 9.2));
  vec2 pa = p - (centre - dir), ba = dir * 2.;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  float d = length(pa - ba * t) / p_density;
  v = max(v, (1. - smoothstep(0., p_width, d)) * (0.4 + 0.6 * hash12(w + 5.7)));
}
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'grunge',
    group: 'make',
    label: l('Grunge', 'Грязь'),
    hint: l('Blotchy dirt and stains (noise warped by noise).', 'Пятна грязи и разводы (шум, искажённый шумом).'),
    inputs: [],
    output: 'grey',
    params: [
      {
        id: 'style',
        label: l('Style', 'Вид'),
        kind: 'choice',
        options: [opt('blotches', 'Blotches', 'Пятна'), opt('streaks', 'Streaks (running down)', 'Потёки'), opt('speckles', 'Speckles', 'Крапинки'), opt('rust', 'Rust', 'Ржавчина')],
        default: 'blotches',
      },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 32, default: 3 },
      { id: 'warp', label: l('Swirl', 'Завихрение'), kind: 'number', min: 0, max: 1, default: 0.4 },
      { id: 'contrast', label: l('Contrast', 'Контраст'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'amount', label: l('Amount', 'Количество'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `vec2 q = uv + p_warp * 0.25 * (vec2(fbm(uv, p_scale, 4., 0.5, 0., p_seed), fbm(uv, p_scale, 4., 0.5, 0., p_seed + 11.)) - 0.5);
float v;
if (p_style < 0.5) v = fbm(q, p_scale * 2., 7., 0.55, 0., p_seed + 23.);
// Streaks: stretched up and down (eight times finer across, still tiling).
else if (p_style < 1.5) v = fbm(vec2(q.x * 8., q.y), p_scale * 2., 6., 0.5, 0., p_seed + 23.) * (0.6 + 0.4 * fbm(q, p_scale, 3., 0.5, 0., p_seed + 5.));
// Speckles: small spots, more where a broad noise says so.
else if (p_style < 2.5) v = valueNoise(q * p_scale * 24., p_scale * 24., p_seed + 31.) * (0.4 + 0.8 * fbm(uv, p_scale, 3., 0.5, 0., p_seed + 7.));
// Rust: veined patches.
else v = fbm(q, p_scale * 2., 6., 0.6, 2., p_seed + 41.) * fbm(uv, p_scale, 4., 0.5, 0., p_seed + 3.) * 1.4;
float c = mix(0.5, 0.02, p_contrast); float m = 1. - p_amount;
outColor = vec4(vec3(smoothstep(m - c, m + c, v)), 1.);`,
  },
  {
    type: 'image',
    group: 'make',
    label: l('Image', 'Картинка'),
    hint: l('A picture from the project’s textures.', 'Картинка из текстур проекта.'),
    inputs: [],
    output: 'color',
    params: [{ id: 'image', label: l('Image', 'Картинка'), kind: 'image', default: '' }],
    glsl: 'outColor = p_image_ok > 0.5 ? vec4(texture(p_image, uv).rgb, 1.) : vec4(mod(floor(uv.x * 8.) + floor(uv.y * 8.), 2.) * vec3(1., 0., 0.86), 1.);',
  },
  {
    type: 'color',
    group: 'make',
    label: l('Colour', 'Цвет'),
    hint: l('One flat colour.', 'Один ровный цвет.'),
    inputs: [],
    output: 'color',
    params: [{ id: 'color', label: l('Colour', 'Цвет'), kind: 'color', default: '#b08c64' }],
    glsl: 'outColor = vec4(p_color, 1.);',
  },
  {
    type: 'value',
    group: 'make',
    label: l('Number', 'Число'),
    hint: l('One flat grey (0 black, 1 white): a roughness, a metal amount.', 'Ровный серый (0 — чёрный, 1 — белый): шероховатость, металличность.'),
    inputs: [],
    output: 'grey',
    params: [{ id: 'value', label: l('Value', 'Значение'), kind: 'number', min: 0, max: 1, default: 0.5 }],
    glsl: 'outColor = vec4(vec3(p_value), 1.);',
  },

  // ── Change ──
  {
    type: 'levels',
    group: 'change',
    label: l('Levels', 'Уровни'),
    hint: l('Stretch, squeeze and shift the tones: more contrast, darker, lighter.', 'Растянуть, сжать и сдвинуть тона: контраст, темнее, светлее.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'inLow', label: l('Black point', 'Точка чёрного'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'inHigh', label: l('White point', 'Точка белого'), kind: 'number', min: 0, max: 1, default: 1 },
      { id: 'gamma', label: l('Midtones', 'Средние тона'), kind: 'number', min: 0.1, max: 4, default: 1 },
      { id: 'outLow', label: l('Darkest', 'Самое тёмное'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'outHigh', label: l('Lightest', 'Самое светлое'), kind: 'number', min: 0, max: 1, default: 1 },
    ],
    glsl: `vec3 c = inC_in(uv).rgb;
vec3 x = clamp((c - p_inLow) / max(p_inHigh - p_inLow, 1e-4), 0., 1.);
x = pow(x, vec3(1. / p_gamma));
outColor = vec4(mix(vec3(p_outLow), vec3(p_outHigh), x), 1.);`,
  },
  {
    type: 'curve',
    group: 'change',
    label: l('Curve', 'Кривая'),
    hint: l('Reshape the tones with four points (black, dark, light, white).', 'Изменить тона четырьмя точками (чёрное, тёмное, светлое, белое).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'y0', label: l('Black becomes', 'Чёрное станет'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'y1', label: l('Dark becomes', 'Тёмное станет'), kind: 'number', min: 0, max: 1, default: 0.333 },
      { id: 'y2', label: l('Light becomes', 'Светлое станет'), kind: 'number', min: 0, max: 1, default: 0.667 },
      { id: 'y3', label: l('White becomes', 'Белое станет'), kind: 'number', min: 0, max: 1, default: 1 },
    ],
    glsl: 'vec3 c = clamp(inC_in(uv).rgb, 0., 1.); outColor = vec4(curve4(c.r, p_y0, p_y1, p_y2, p_y3), curve4(c.g, p_y0, p_y1, p_y2, p_y3), curve4(c.b, p_y0, p_y1, p_y2, p_y3), 1.);',
  },
  {
    type: 'invert',
    group: 'change',
    label: l('Invert', 'Инверсия'),
    hint: l('Black becomes white, and the other way round.', 'Чёрное становится белым, и наоборот.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [],
    glsl: 'outColor = vec4(1. - inC_in(uv).rgb, 1.);',
  },
  {
    type: 'clamp',
    group: 'change',
    label: l('Clamp', 'Ограничить'),
    hint: l('Keep values between a lowest and a highest.', 'Удержать значения между нижним и верхним.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'min', label: l('Lowest', 'Нижнее'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'max', label: l('Highest', 'Верхнее'), kind: 'number', min: 0, max: 1, default: 1 },
    ],
    glsl: 'outColor = vec4(clamp(inC_in(uv).rgb, p_min, p_max), 1.);',
  },
  {
    type: 'blur',
    group: 'change',
    label: l('Blur', 'Размытие'),
    hint: l('Soften: a share of the square to blur across.', 'Смягчить: на какую долю квадрата размывать.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0, max: 0.1, step: 0.001, default: 0.01 }],
    glsl: `vec3 s = vec3(0.); float w = 0.;
for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
  vec2 o = vec2(x, y) / 3.; float k = exp(-dot(o, o) * 2.);
  s += inC_in(uv + o * p_radius).rgb * k; w += k;
}
outColor = vec4(s / w, 1.);`,
  },
  {
    type: 'warp',
    group: 'change',
    label: l('Warp', 'Искажение'),
    hint: l('Push the picture around by another one: along its slopes, or one way by its brightness.', 'Сдвинуть картинку другой: вдоль её склонов или в одну сторону по яркости.'),
    inputs: [IN_COLOR(), IN_GREY('by', l('By', 'Чем'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'mode', label: l('How', 'Как'), kind: 'choice', options: [opt('slope', 'Along slopes', 'Вдоль склонов'), opt('direction', 'One way', 'В одну сторону')], default: 'slope' },
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 1, default: 0.2 },
      { id: 'angle', label: l('Direction', 'Направление'), kind: 'number', min: 0, max: 360, step: 1, default: 0 },
    ],
    glsl: `vec2 off;
if (p_mode < 0.5) { float e = 1. / 256.; off = vec2(inG_by(uv + vec2(e, 0.)) - inG_by(uv - vec2(e, 0.)), inG_by(uv + vec2(0., e)) - inG_by(uv - vec2(0., e))) / (2. * e) * p_amount * 0.01; }
else off = vec2(cos(radians(p_angle)), sin(radians(p_angle))) * (inG_by(uv) - 0.5) * p_amount * 0.25;
outColor = vec4(inC_in(uv + off).rgb, 1.);`,
  },
  {
    type: 'directionalWarp',
    group: 'change',
    label: l('Directional warp', 'Направленное искажение'),
    hint: l('Push the picture along one direction by how bright another is: once (a shift), or flowing step by step (smeared, streaky).', 'Сдвинуть картинку в одном направлении по яркости другой: один раз (сдвиг) или течением шаг за шагом (размазанно, полосами).'),
    inputs: [IN_COLOR(), IN_GREY('by', l('Intensity', 'Сила'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'angle', label: l('Direction', 'Направление'), kind: 'number', min: 0, max: 360, step: 1, default: 0 },
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 1, default: 0.15 },
      { id: 'mode', label: l('How', 'Как'), kind: 'choice', options: [opt('shift', 'Shift', 'Сдвиг'), opt('flow', 'Flow', 'Течение')], default: 'shift' },
      { id: 'centred', label: l('Grey stays put', 'Серое на месте'), kind: 'bool', default: true },
    ],
    glsl: `vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle)));
float bias = p_centred > 0.5 ? 0.5 : 0.;
vec2 q = uv;
if (p_mode < 0.5) q += dir * (inG_by(uv) - bias) * p_amount;
else for (int k = 0; k < 12; k++) q += dir * (inG_by(q) - bias) * p_amount / 12.;
outColor = vec4(inC_in(q).rgb, 1.);`,
  },
  {
    type: 'floodFill',
    group: 'change',
    label: l('Flood fill', 'Заливка областей'),
    hint: l('Give each separate white shape of a mask (each brick, tile, plank) its own value: a random grey or colour, a gradient across it, or where it is. Exact for rectangular shapes.', 'Дать каждой отдельной белой фигуре маски (кирпичу, плитке, доске) своё значение: случайный серый или цвет, градиент по ней или её положение. Точно для прямоугольных фигур.'),
    inputs: [IN_GREY('in', l('Mask', 'Маска'), [1, 1, 1])],
    output: 'color',
    params: [
      {
        id: 'gives',
        label: l('Gives', 'Выдаёт'),
        kind: 'choice',
        options: [opt('grey', 'Random grey', 'Случайный серый'), opt('colour', 'Random colour', 'Случайный цвет'), opt('gradient', 'Gradient', 'Градиент'), opt('position', 'Position', 'Положение'), opt('size', 'Size', 'Размер')],
        default: 'grey',
      },
      { id: 'direction', label: l('Gradient', 'Градиент'), kind: 'choice', options: [opt('across', 'Across', 'Поперёк'), opt('down', 'Down', 'Вниз'), opt('random', 'Random way', 'Случайно')], default: 'random' },
      { id: 'threshold', label: l('White from', 'Белое от'), kind: 'number', min: 0.01, max: 0.99, default: 0.5 },
      seed,
    ],
    glsl: `if (inG_in(uv) < p_threshold) { outColor = vec4(0., 0., 0., 1.); return; }
// The shape's extent: step out each way until the mask goes dark (2 pixels a step).
float st = u_px * 2.; float l = 0., r = 0., u = 0., d = 0.;
for (int k = 1; k <= 160; k++) { if (inG_in(uv - vec2(float(k) * st, 0.)) < p_threshold) break; l = float(k) * st; }
for (int k = 1; k <= 160; k++) { if (inG_in(uv + vec2(float(k) * st, 0.)) < p_threshold) break; r = float(k) * st; }
for (int k = 1; k <= 160; k++) { if (inG_in(uv - vec2(0., float(k) * st)) < p_threshold) break; u = float(k) * st; }
for (int k = 1; k <= 160; k++) { if (inG_in(uv + vec2(0., float(k) * st)) < p_threshold) break; d = float(k) * st; }
vec2 lo = uv - vec2(l, u), hi = uv + vec2(r, d);
vec2 ctr = fract((lo + hi) * 0.5);
// One id per shape: its centre, rounded to a few pixels so every pixel of it agrees (wrapped whole, so a shape
// crossing the square's edge gets one id on both sides).
float cell = st * 4.; float n = floor(1. / cell + 0.5);
vec2 id = mod(floor((lo + hi) * 0.5 / cell + 0.5), n);
float h = hash12(id + seedv(p_seed));
int g = int(p_gives + 0.5); vec3 c;
if (g == 0) c = vec3(h);
else if (g == 1) c = hsv2rgb(vec3(h, 0.55 + 0.4 * hash12(id + seedv(p_seed) + 3.3), 0.6 + 0.4 * hash12(id + seedv(p_seed) + 7.1)));
else if (g == 2) {
  vec2 t = (uv - lo) / max(hi - lo, vec2(1e-4));
  float a = p_direction < 0.5 ? 0. : p_direction < 1.5 ? 1.5707963 : h * 6.2831853;
  vec2 dv = vec2(cos(a), sin(a));
  float v = dot(t - 0.5, dv) / (abs(dv.x) * 0.5 + abs(dv.y) * 0.5 + 1e-4) * 0.5 + 0.5;
  c = vec3(clamp(v, 0., 1.));
}
else if (g == 3) c = vec3(ctr, 0.);
else c = vec3(clamp((hi - lo) * 1., 0., 1.), 0.);
outColor = vec4(c, 1.);`,
  },
  {
    type: 'transform',
    group: 'change',
    label: l('Transform', 'Трансформация'),
    hint: l('Repeat, slide or turn the picture (in quarter turns, so it still tiles).', 'Повторить, сдвинуть или повернуть картинку (на четверть оборота, чтобы стыковалась).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'tiles', label: l('Repeat', 'Повторов'), kind: 'int', min: 1, max: 32, default: 2 },
      { id: 'x', label: l('Slide across', 'Сдвиг поперёк'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'y', label: l('Slide down', 'Сдвиг вниз'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'turn', label: l('Turn', 'Поворот'), kind: 'choice', options: [opt('0', 'None', 'Нет'), opt('90', '90°', '90°'), opt('180', '180°', '180°'), opt('270', '270°', '270°')], default: '0' },
    ],
    glsl: `vec2 q = uv - 0.5;
if (p_turn > 0.5 && p_turn < 1.5) q = vec2(-q.y, q.x); else if (p_turn > 1.5 && p_turn < 2.5) q = -q; else if (p_turn > 2.5) q = vec2(q.y, -q.x);
outColor = vec4(inC_in((q + 0.5) * p_tiles + vec2(p_x, p_y)).rgb, 1.);`,
  },
  {
    type: 'slopeBlur',
    group: 'change',
    label: l('Slope blur', 'Размытие по склону'),
    hint: l('Smear a picture along the slopes of another: melted, eroded or flowing looks.', 'Размазать картинку вдоль склонов другой: оплавленный, выветренный, текучий вид.'),
    inputs: [IN_COLOR(), IN_GREY('slope', l('Slope', 'Склон'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 0.2, step: 0.002, default: 0.04 },
      { id: 'mode', label: l('Mode', 'Режим'), kind: 'choice', options: [opt('blur', 'Blur', 'Размыть'), opt('min', 'Darkest', 'Темнее'), opt('max', 'Lightest', 'Светлее')], default: 'blur' },
    ],
    glsl: `float e = 1. / 256.;
vec2 g = vec2(inG_slope(uv + vec2(e, 0.)) - inG_slope(uv - vec2(e, 0.)), inG_slope(uv + vec2(0., e)) - inG_slope(uv - vec2(0., e)));
vec2 dir = length(g) > 1e-5 ? -normalize(g) : vec2(0.);
vec3 acc = inC_in(uv).rgb; vec3 lo = acc, hi = acc;
for (int i = 1; i <= 12; i++) {
  vec3 c = inC_in(uv + dir * p_amount * float(i) / 12.).rgb;
  acc += c; lo = min(lo, c); hi = max(hi, c);
}
outColor = vec4(p_mode < 0.5 ? acc / 13. : p_mode < 1.5 ? lo : hi, 1.);`,
  },
  {
    type: 'distance',
    group: 'change',
    label: l('Distance', 'Расстояние'),
    hint: l('A soft edge growing out from white shapes: bevels, glows and wear around marks.', 'Мягкий край вокруг белых фигур: фаски, свечение, износ вокруг отметин.'),
    inputs: [IN_GREY('in', l('Shapes', 'Фигуры'))],
    output: 'grey',
    params: [{ id: 'distance', label: l('How far', 'Как далеко'), kind: 'number', min: 0.005, max: 0.25, step: 0.005, default: 0.05 }],
    glsl: `float best = inG_in(uv) > 0.5 ? 0. : 1e3;
for (int r = 1; r <= 10; r++) {
  float rad = p_distance * float(r) / 10.;
  for (int a = 0; a < 16; a++) {
    float t = float(a) / 16. * 6.2831853 + float(r) * 0.37;
    if (inG_in(uv + vec2(cos(t), sin(t)) * rad) > 0.5) best = min(best, rad);
  }
}
outColor = vec4(vec3(clamp(1. - best / p_distance, 0., 1.)), 1.);`,
  },
  {
    type: 'edges',
    group: 'change',
    label: l('Edge detect', 'Поиск краёв'),
    hint: l('White lines where the picture changes sharply: outlines of bricks and shapes.', 'Белые линии там, где картинка резко меняется: контуры кирпичей и фигур.'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'width', label: l('Width', 'Толщина'), kind: 'number', min: 0.001, max: 0.05, step: 0.001, default: 0.006 },
      { id: 'threshold', label: l('Threshold', 'Порог'), kind: 'number', min: 0, max: 1, default: 0.1 },
    ],
    glsl: `float e = abs(inG_in(uv + vec2(p_width, 0.)) - inG_in(uv - vec2(p_width, 0.))) + abs(inG_in(uv + vec2(0., p_width)) - inG_in(uv - vec2(0., p_width)));
outColor = vec4(vec3(smoothstep(p_threshold, p_threshold + 0.05, e)), 1.);`,
  },

  // ── Combine ──
  {
    type: 'blend',
    group: 'combine',
    label: l('Blend', 'Смешать'),
    hint: l('Put one picture over another: mixed, added, multiplied … and only where a mask is white.', 'Наложить одну картинку на другую: смешать, сложить, умножить … и только там, где маска белая.'),
    inputs: [IN_COLOR('top', l('Top', 'Сверху'), [1, 1, 1]), IN_COLOR('bottom', l('Bottom', 'Снизу'), [0, 0, 0]), IN_GREY('mask', l('Mask', 'Маска'), [1, 1, 1])],
    output: 'color',
    params: [
      {
        id: 'mode',
        label: l('Mode', 'Режим'),
        kind: 'choice',
        options: [
          opt('mix', 'Mix', 'Смешать'),
          opt('add', 'Add', 'Сложить'),
          opt('subtract', 'Subtract', 'Вычесть'),
          opt('multiply', 'Multiply', 'Умножить'),
          opt('screen', 'Screen', 'Экран'),
          opt('overlay', 'Overlay', 'Перекрытие'),
          opt('max', 'Lighter', 'Светлее'),
          opt('min', 'Darker', 'Темнее'),
          opt('difference', 'Difference', 'Разница'),
        ],
        default: 'mix',
      },
      { id: 'opacity', label: l('Opacity', 'Непрозрачность'), kind: 'number', min: 0, max: 1, default: 1 },
    ],
    glsl: `vec3 a = inC_top(uv).rgb, b = inC_bottom(uv).rgb; vec3 r;
int m = int(p_mode + 0.5);
if (m == 0) r = a; else if (m == 1) r = a + b; else if (m == 2) r = b - a; else if (m == 3) r = a * b;
else if (m == 4) r = 1. - (1. - a) * (1. - b);
else if (m == 5) r = mix(2. * a * b, 1. - 2. * (1. - a) * (1. - b), step(0.5, b));
else if (m == 6) r = max(a, b); else if (m == 7) r = min(a, b); else r = abs(a - b);
outColor = vec4(clamp(mix(b, r, inG_mask(uv) * p_opacity), 0., 1.), 1.);`,
  },
  {
    type: 'switch',
    group: 'combine',
    label: l('Switch', 'Переключатель'),
    hint: l('Pass on one of two inputs (handy for trying a change).', 'Передать один из двух входов (удобно, чтобы сравнить).'),
    inputs: [IN_COLOR('a', l('A', 'А')), IN_COLOR('b', l('B', 'Б'))],
    output: 'color',
    params: [{ id: 'useB', label: l('Use B', 'Взять Б'), kind: 'bool', default: false }],
    glsl: 'outColor = vec4(p_useB > 0.5 ? inC_b(uv).rgb : inC_a(uv).rgb, 1.);',
  },

  // ── Colour ──
  {
    type: 'gradientMap',
    group: 'colour',
    label: l('Gradient map', 'Карта градиента'),
    hint: l('Colour a grey picture: black takes the left colour, white the right.', 'Раскрасить серую картинку: чёрное берёт левый цвет, белое — правый.'),
    inputs: [IN_GREY()],
    output: 'color',
    params: [
      {
        id: 'ramp',
        label: l('Colours', 'Цвета'),
        kind: 'ramp',
        default: [
          { at: 0, color: '#1e1a16' },
          { at: 1, color: '#e8dcc8' },
        ],
      },
    ],
    glsl: 'outColor = vec4(ramp(inG_in(uv), p_ramp_c, p_ramp_t, p_ramp_n), 1.);',
  },
  {
    type: 'hsl',
    group: 'colour',
    label: l('Hue, saturation, lightness', 'Тон, насыщенность, яркость'),
    hint: l('Shift the colours round the wheel, make them stronger or greyer, lighter or darker.', 'Сдвинуть цвета по кругу, сделать насыщеннее или серее, светлее или темнее.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'hue', label: l('Hue', 'Тон'), kind: 'number', min: -180, max: 180, step: 1, default: 0 },
      { id: 'saturation', label: l('Saturation', 'Насыщенность'), kind: 'number', min: 0, max: 2, default: 1 },
      { id: 'lightness', label: l('Lightness', 'Яркость'), kind: 'number', min: -1, max: 1, default: 0 },
    ],
    glsl: `vec3 h = rgb2hsv(inC_in(uv).rgb);
h.x = fract(h.x + p_hue / 360.); h.y = clamp(h.y * p_saturation, 0., 1.);
outColor = vec4(clamp(hsv2rgb(h) + p_lightness, 0., 1.), 1.);`,
  },
  {
    type: 'tint',
    group: 'colour',
    label: l('Colourise', 'Окрасить'),
    hint: l('Tint a picture with one colour.', 'Окрасить картинку одним цветом.'),
    inputs: [IN_GREY('in', l('In', 'Вход'), [1, 1, 1])],
    output: 'color',
    params: [{ id: 'color', label: l('Colour', 'Цвет'), kind: 'color', default: '#c08040' }],
    glsl: 'outColor = vec4(p_color * inG_in(uv), 1.);',
  },

  // ── Surface ──
  {
    type: 'normal',
    group: 'surface',
    label: l('Height to normal', 'Высота в нормали'),
    hint: l('Bumps for lighting from a height picture (white is high).', 'Рельеф для освещения из карты высот (белое — выше).'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'color',
    params: [{ id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 10, default: 2 }],
    glsl: `float e = u_px;
float dx = (inG_in(uv + vec2(e, 0.)) - inG_in(uv - vec2(e, 0.))) / (2. * e);
float dy = (inG_in(uv + vec2(0., e)) - inG_in(uv - vec2(0., e))) / (2. * e);
vec3 n = normalize(vec3(-dx * p_strength * 0.02, -dy * p_strength * 0.02, 1.));
outColor = vec4(n * 0.5 + 0.5, 1.);`,
  },
  {
    type: 'occlusion',
    group: 'surface',
    label: l('Height to occlusion', 'Высота в затенение'),
    hint: l('Dark in the dips and cracks, where light hardly reaches.', 'Темнее во впадинах и трещинах, куда свет почти не попадает.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.002, max: 0.1, step: 0.001, default: 0.02 },
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 4, default: 1.5 },
    ],
    glsl: `float h = inG_in(uv); float s = 0., w = 0.;
for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { vec2 o = vec2(x, y) / 2.; float k = exp(-dot(o, o)); s += inG_in(uv + o * p_radius) * k; w += k; }
outColor = vec4(vec3(clamp(1. - max(s / w - h, 0.) * p_strength * 4., 0., 1.)), 1.);`,
  },
  {
    type: 'curvature',
    group: 'surface',
    label: l('Height to curvature', 'Высота в кривизну'),
    hint: l('Light on ridges and edges, dark in grooves (grey where flat): for wear and dirt masks.', 'Светлее на гребнях и краях, темнее в бороздах (серое — где ровно): для масок износа и грязи.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.001, max: 0.05, step: 0.001, default: 0.005 },
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 10, default: 3 },
    ],
    glsl: `float h = inG_in(uv); float r = p_radius;
float lap = 4. * h - inG_in(uv + vec2(r, 0.)) - inG_in(uv - vec2(r, 0.)) - inG_in(uv + vec2(0., r)) - inG_in(uv - vec2(0., r));
outColor = vec4(vec3(clamp(0.5 + lap * p_strength, 0., 1.)), 1.);`,
  },

  // ── More: make ──
  {
    type: 'waves',
    group: 'make',
    label: l('Waves and stripes', 'Волны и полосы'),
    hint: l('Repeating bands: soft waves, hard stripes, saw or zigzag-like ramps, optionally wobbly.', 'Повторяющиеся полосы: мягкие волны, чёткие полосы, пила или треугольник, можно с волнистостью.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'kind', label: l('Kind', 'Вид'), kind: 'choice', options: [opt('sine', 'Waves', 'Волны'), opt('stripes', 'Stripes', 'Полосы'), opt('saw', 'Saw', 'Пила'), opt('triangle', 'Triangle', 'Треугольник')], default: 'sine' },
      { id: 'count', label: l('Count', 'Количество'), kind: 'int', min: 1, max: 64, default: 8 },
      { id: 'direction', label: l('Direction', 'Направление'), kind: 'choice', options: [opt('across', 'Across', 'Поперёк'), opt('down', 'Down', 'Вниз'), opt('diagonal', 'Diagonal', 'По диагонали')], default: 'down' },
      { id: 'sharpness', label: l('Sharpness', 'Чёткость'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'wobble', label: l('Wobble', 'Волнистость'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'wobbleScale', label: l('Wobble size', 'Размер волнистости'), kind: 'int', min: 1, max: 16, default: 3 },
      seed,
    ],
    glsl: `float t = p_direction < 0.5 ? uv.x : p_direction < 1.5 ? uv.y : uv.x + uv.y;
t += (fbm(uv, p_wobbleScale, 4., 0.5, 0., p_seed) - 0.5) * p_wobble * 2. / max(p_count, 1.);
float x = fract(t * p_count); int k = int(p_kind + 0.5); float v;
if (k == 0) v = 0.5 + 0.5 * sin(x * 6.2831853);
else if (k == 1) v = 0.5 + 0.5 * sin(x * 6.2831853);
else if (k == 2) v = x;
else v = 1. - abs(x * 2. - 1.);
float e = k == 1 ? (1. - p_sharpness) * 0.45 + 0.01 : (1. - p_sharpness) * 0.5 + 0.02;
if (k == 1 || p_sharpness > 0.) v = mix(v, smoothstep(0.5 - e, 0.5 + e, v), k == 1 ? 1. : p_sharpness);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'hexagons',
    group: 'make',
    label: l('Hexagons', 'Шестиугольники'),
    hint: l('Hexagonal tiles with gaps between them (white tile, black gap).', 'Шестиугольная плитка со швами (белое — плитка, чёрное — шов).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Across', 'В ряд'), kind: 'int', min: 2, max: 48, default: 6 },
      { id: 'gap', label: l('Gap', 'Шов'), kind: 'number', min: 0, max: 0.4, default: 0.06 },
      { id: 'bevel', label: l('Bevel', 'Скос'), kind: 'number', min: 0, max: 0.5, default: 0.15 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `float N = p_scale; float M = max(1., floor(N / 1.7320508 + 0.5));
vec2 p = vec2(uv.x * N, uv.y * M * 1.7320508);
vec2 r = vec2(1., 1.7320508); vec2 hh = r * 0.5;
vec2 a = mod(p, r) - hh; vec2 b = mod(p - hh, r) - hh;
vec2 g = dot(a, a) < dot(b, b) ? a : b;
vec2 cid = p - g;
vec2 q = abs(g); float d = max(q.x, dot(q, vec2(0.5, 0.8660254)));
float edge = 0.5 - d - p_gap * 0.5;
float rnd = hash12(floor(mod(cid + 0.01, vec2(N, M * 1.7320508)) * 4.) + seedv(p_seed));
float v = edge <= 0. ? 0. : (p_bevel > 0. ? smoothstep(0., p_bevel * 0.5, edge) : 1.) * (1. - p_random * rnd);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'weave',
    group: 'make',
    label: l('Weave', 'Плетение'),
    hint: l('Threads woven over and under each other: cloth, baskets, wicker (as height).', 'Нити, переплетённые сверху и снизу: ткань, корзины (как высота).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'threads', label: l('Threads', 'Нитей'), kind: 'int', min: 2, max: 64, default: 8 },
      { id: 'width', label: l('Thread width', 'Толщина нити'), kind: 'number', min: 0.3, max: 1, default: 0.8 },
    ],
    glsl: `vec2 p = uv * p_threads; vec2 c = floor(p); vec2 f = fract(p) - 0.5;
float over = mod(c.x + c.y, 2.); float w = p_width * 0.5;
float hT = 1. - smoothstep(w - 0.08, w, abs(f.y)); float vT = 1. - smoothstep(w - 0.08, w, abs(f.x));
float hH = hT * (0.65 + 0.35 * cos(f.x * 3.14159)); float vH = vT * (0.65 + 0.35 * cos(f.y * 3.14159));
float v = over > 0.5 ? max(hH, vH * 0.55) : max(vH, hH * 0.55);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'planks',
    group: 'make',
    label: l('Planks', 'Доски'),
    hint: l('Rows of boards of staggered lengths with gaps, each a little different, with grain.', 'Ряды досок разной длины со щелями, каждая чуть другая, с волокнами.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'rows', label: l('Rows', 'Рядов'), kind: 'int', min: 1, max: 32, default: 6 },
      { id: 'lengths', label: l('Boards per row', 'Досок в ряду'), kind: 'int', min: 1, max: 8, default: 2 },
      { id: 'gap', label: l('Gap', 'Щель'), kind: 'number', min: 0, max: 0.2, default: 0.03 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.35 },
      { id: 'grain', label: l('Grain', 'Волокна'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `float y = uv.y * p_rows; float row = floor(y); float fy = fract(y);
float sh = hash12(vec2(mod(row, p_rows), 3.) + seedv(p_seed));
float x = uv.x * p_lengths + sh; float col = floor(x); float fx = fract(x);
float dGap = min(min(fy, 1. - fy), min(fx, 1. - fx) * p_rows / p_lengths);
float board = smoothstep(p_gap * 0.5, p_gap * 0.5 + 0.03, dGap);
float r = hash12(vec2(mod(col, p_lengths), mod(row, p_rows)) + seedv(p_seed) + 5.);
float g = 0.5 + 0.5 * sin((fy * 7. + fbm(uv, 8., 4., 0.5, 0., p_seed + r * 7.) * 3.) * 6.2831853);
outColor = vec4(vec3(board * (1. - p_random * r) * mix(1., 0.72 + 0.28 * g, p_grain)), 1.);`,
  },
  {
    type: 'woodGrain',
    group: 'make',
    label: l('Wood grain', 'Древесина'),
    hint: l('Growth rings bent by noise, like sawn wood.', 'Годовые кольца, изогнутые шумом, как у распиленного дерева.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'rings', label: l('Rings', 'Колец'), kind: 'int', min: 1, max: 48, default: 8 },
      { id: 'distortion', label: l('Distortion', 'Искривление'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 16, default: 3 },
      seed,
    ],
    glsl: `float n = fbm(uv, p_scale, 5., 0.55, 0., p_seed);
float t = uv.y * p_rings + n * p_distortion * 4.;
float v = pow(0.5 + 0.5 * sin(t * 6.2831853), 3.);
outColor = vec4(vec3(1. - v * 0.8), 1.);`,
  },
  {
    type: 'cobblestones',
    group: 'make',
    label: l('Cobblestones', 'Булыжник'),
    hint: l('Rounded stones packed together with gaps (as height).', 'Округлые камни вплотную со швами (как высота).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 2, max: 48, default: 7 },
      { id: 'gap', label: l('Gap', 'Шов'), kind: 'number', min: 0, max: 0.3, default: 0.05 },
      { id: 'bevel', label: l('Roundness', 'Округлость'), kind: 'number', min: 0, max: 1, default: 0.6 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `vec3 v = voronoi(uv, p_scale, 0.9, p_seed);
float d = (v.y - v.x) * 0.5 - p_gap * 0.5;
float h = d <= 0. ? 0. : smoothstep(0., p_bevel * 0.4 + 1e-3, d);
outColor = vec4(vec3(h * (1. - p_random * v.z)), 1.);`,
  },
  {
    type: 'cracks',
    group: 'make',
    label: l('Cracks', 'Трещины'),
    hint: l('A network of thin wandering cracks (white): dry mud, old paint, broken stone.', 'Сеть тонких извилистых трещин (белое): сухая грязь, старая краска, камень.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 2, max: 48, default: 6 },
      { id: 'width', label: l('Width', 'Ширина'), kind: 'number', min: 0.01, max: 1, default: 0.25 },
      { id: 'distortion', label: l('Wander', 'Извилистость'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `vec2 w = vec2(fbm(uv, 4., 4., 0.5, 0., p_seed + 11.), fbm(uv, 4., 4., 0.5, 0., p_seed + 23.)) - 0.5;
vec3 v = voronoi(fract(uv + w * p_distortion * 0.25), p_scale, 1., p_seed);
outColor = vec4(vec3(1. - smoothstep(0., p_width * 0.1 + 1e-3, v.y - v.x)), 1.);`,
  },
  {
    type: 'marble',
    group: 'make',
    label: l('Marble', 'Мрамор'),
    hint: l('Veins swirled through stone.', 'Прожилки, закрученные в камне.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'veins', label: l('Veins', 'Прожилок'), kind: 'int', min: 1, max: 16, default: 3 },
      { id: 'turbulence', label: l('Turbulence', 'Завихрения'), kind: 'number', min: 0, max: 1, default: 0.6 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 16, default: 3 },
      { id: 'sharpness', label: l('Thin veins', 'Тонкие прожилки'), kind: 'number', min: 0, max: 1, default: 0.6 },
      seed,
    ],
    glsl: `float n = fbm(uv, p_scale, 6., 0.55, 0., p_seed);
float t = (uv.x + uv.y) * p_veins + (n - 0.5) * p_turbulence * 3.;
float v = pow(1. - abs(sin(t * 3.14159265)), mix(1., 6., p_sharpness));
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'blobs',
    group: 'make',
    label: l('Blobs', 'Пятна'),
    hint: l('Soft or sharp random patches covering as much as you say: rust spots, puddles, moss.', 'Мягкие или чёткие случайные пятна нужной площади: ржавчина, лужи, мох.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 32, default: 4 },
      { id: 'coverage', label: l('Coverage', 'Покрытие'), kind: 'number', min: 0, max: 1, default: 0.4 },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 1, default: 0.2 },
      seed,
    ],
    glsl: `float n = fbm(uv, p_scale, 5., 0.5, 0., p_seed);
float e = 1. - p_coverage; float s = p_softness * 0.2 + 0.005;
outColor = vec4(vec3(smoothstep(e - s, e + s, n)), 1.);`,
  },
  {
    type: 'speckles',
    group: 'make',
    label: l('Speckles', 'Крапинки'),
    hint: l('Small random dots: gravel, terrazzo, stars, dust.', 'Мелкие случайные точки: гравий, терраццо, звёзды, пыль.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'density', label: l('Grid', 'Сетка'), kind: 'int', min: 4, max: 256, default: 24 },
      { id: 'amount', label: l('Amount', 'Сколько'), kind: 'number', min: 0, max: 1, default: 0.35 },
      { id: 'size', label: l('Size', 'Размер'), kind: 'number', min: 0.05, max: 1, default: 0.7 },
      seed,
    ],
    glsl: `vec2 p = uv * p_density; vec2 c = floor(p); vec2 f = fract(p);
vec2 o = seedv(p_seed); vec2 cm = mod(c, p_density);
float has = step(1. - p_amount, hash12(cm + o));
vec2 at = 0.25 + 0.5 * hash22(cm + o + 3.1);
float r = p_size * 0.3 * (0.5 + hash12(cm + o + 9.2));
float v = has * (1. - smoothstep(r * 0.6, r, length(f - at)));
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'scatter',
    group: 'make',
    label: l('Scatter', 'Разброс'),
    hint: l('Copies of a picture scattered over the square, each a different size, turn and brightness: leaves, pebbles, bolts.', 'Копии картинки, разбросанные по квадрату, разного размера, поворота и яркости: листья, камешки, болты.'),
    inputs: [IN_COLOR('in', l('Picture', 'Картинка'), [1, 1, 1])],
    output: 'color',
    params: [
      { id: 'count', label: l('Per row', 'В ряду'), kind: 'int', min: 1, max: 32, default: 6 },
      { id: 'size', label: l('Size', 'Размер'), kind: 'number', min: 0.05, max: 2, default: 0.6 },
      { id: 'sizeRandom', label: l('Size varies', 'Разный размер'), kind: 'number', min: 0, max: 1, default: 0.4 },
      { id: 'turn', label: l('Turn varies', 'Разный поворот'), kind: 'number', min: 0, max: 1, default: 1 },
      { id: 'brightRandom', label: l('Brightness varies', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      { id: 'apart', label: l('Keep apart', 'Не пересекать'), kind: 'bool', default: false },
      { id: 'margin', label: l('Space between', 'Промежуток'), kind: 'number', min: 0, max: 0.5, default: 0.05 },
      seed,
    ],
    glsl: `vec2 p = uv * p_count; vec2 c = floor(p); float best = 0.; vec3 col = vec3(0.); vec2 o = seedv(p_seed);
// Keep apart: each copy stays inside its own cell (its turned corners too, plus the space between), so none touch.
float reach = p_turn > 0. ? 0.70711 : 0.5;
float room = max(0., 1. - p_margin);
for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
  vec2 cc = c + vec2(float(x), float(y)); vec2 cm = mod(cc, p_count);
  if (p_apart > 0.5 && (x != 0 || y != 0)) continue;
  float s = p_size * (1. - p_sizeRandom * hash12(cm + o + 1.7));
  if (p_apart > 0.5) s = min(s, room / (2. * reach));
  float slack = p_apart > 0.5 ? max(0., room - 2. * reach * s) : 0.8;
  vec2 ctr = cc + 0.5 + (hash22(cm + o) - 0.5) * slack;
  float a = hash12(cm + o + 4.4) * 6.2831853 * p_turn;
  vec2 d = mat2(cos(a), -sin(a), sin(a), cos(a)) * ((p - ctr) / max(s, 1e-3));
  if (abs(d.x) < 0.5 && abs(d.y) < 0.5) {
    vec3 t = inC_in(d + 0.5).rgb * (1. - p_brightRandom * hash12(cm + o + 8.8));
    float g = dot(t, vec3(0.3333));
    if (g > best) { best = g; col = t; }
  }
}
outColor = vec4(col, 1.);`,
  },
  {
    type: 'zigzag',
    group: 'make',
    label: l('Zigzag', 'Зигзаг'),
    hint: l('Chevron stripes (herringbone-like bands).', 'Полосы-ёлочки (шевроны).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'count', label: l('Count', 'Количество'), kind: 'int', min: 1, max: 32, default: 6 },
      { id: 'amount', label: l('Zig size', 'Размах'), kind: 'number', min: 0, max: 2, default: 0.5 },
      { id: 'direction', label: l('Direction', 'Направление'), kind: 'choice', options: [opt('down', 'Down', 'Вниз'), opt('across', 'Across', 'Поперёк')], default: 'down' },
      { id: 'sharpness', label: l('Sharpness', 'Чёткость'), kind: 'number', min: 0, max: 1, default: 0.8 },
    ],
    glsl: `vec2 q = p_direction < 0.5 ? uv : uv.yx;
float t = q.y * p_count + p_amount * (1. - abs(fract(q.x * p_count) * 2. - 1.));
float s = 0.5 + 0.5 * sin(t * 6.2831853); float e = (1. - p_sharpness) * 0.5 + 0.01;
outColor = vec4(vec3(smoothstep(0.5 - e, 0.5 + e, s)), 1.);`,
  },

  // ── More: change ──
  {
    type: 'sharpen',
    group: 'change',
    label: l('Sharpen', 'Резкость'),
    hint: l('Crisper details: edges pushed apart.', 'Чётче детали: края усилены.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 4, default: 1 },
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.004 },
    ],
    glsl: `vec3 c = inC_in(uv).rgb; float r = p_radius;
vec3 b = (inC_in(uv + vec2(r, 0.)).rgb + inC_in(uv - vec2(r, 0.)).rgb + inC_in(uv + vec2(0., r)).rgb + inC_in(uv - vec2(0., r)).rgb) * 0.25;
outColor = vec4(clamp(c + (c - b) * p_amount, 0., 1.), 1.);`,
  },
  {
    type: 'posterize',
    group: 'change',
    label: l('Posterize', 'Постеризация'),
    hint: l('Fewer shades: hard steps instead of smooth changes (good for stylized looks).', 'Меньше оттенков: ступеньки вместо плавных переходов (для стилизации).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'steps', label: l('Steps', 'Ступеней'), kind: 'int', min: 2, max: 32, default: 4 }],
    glsl: 'outColor = vec4(min(floor(inC_in(uv).rgb * p_steps), vec3(p_steps - 1.)) / max(p_steps - 1., 1.), 1.);',
  },
  {
    type: 'threshold',
    group: 'change',
    label: l('Threshold', 'Порог'),
    hint: l('Black below a level, white above, with a soft or hard step between: turn any grey into a mask.', 'Чёрное ниже уровня, белое выше, с мягким или резким переходом: сделать маску из любого серого.'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'position', label: l('Level', 'Уровень'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'contrast', label: l('Hardness', 'Резкость'), kind: 'number', min: 0, max: 1, default: 0.8 },
    ],
    glsl: `float w = (1. - p_contrast) * 0.5 + 0.002;
outColor = vec4(vec3(smoothstep(p_position - w, p_position + w, inG_in(uv))), 1.);`,
  },
  {
    type: 'brightness',
    group: 'change',
    label: l('Brightness and contrast', 'Яркость и контраст'),
    hint: l('Lighter or darker, more or less contrast, and gamma (mid-tones).', 'Светлее или темнее, больше или меньше контраста, и гамма (средние тона).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'brightness', label: l('Brightness', 'Яркость'), kind: 'number', min: -1, max: 1, default: 0 },
      { id: 'contrast', label: l('Contrast', 'Контраст'), kind: 'number', min: 0, max: 3, default: 1 },
      { id: 'gamma', label: l('Gamma', 'Гамма'), kind: 'number', min: 0.2, max: 5, default: 1 },
    ],
    glsl: `vec3 c = (inC_in(uv).rgb - 0.5) * p_contrast + 0.5 + p_brightness;
outColor = vec4(pow(clamp(c, 0., 1.), vec3(1. / p_gamma)), 1.);`,
  },
  {
    type: 'mirror',
    group: 'change',
    label: l('Mirror', 'Зеркало'),
    hint: l('Make the picture symmetric: left matches right, top matches bottom, or both.', 'Сделать картинку симметричной: слева как справа, сверху как снизу, или оба.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'mode', label: l('Mirror', 'Отразить'), kind: 'choice', options: [opt('across', 'Left–right', 'Слева–справа'), opt('down', 'Top–bottom', 'Сверху–снизу'), opt('both', 'Both', 'Оба')], default: 'across' }],
    glsl: `vec2 q = uv;
if (p_mode < 0.5 || p_mode > 1.5) q.x = 0.5 - abs(uv.x - 0.5);
if (p_mode > 0.5) q.y = 0.5 - abs(uv.y - 0.5);
outColor = vec4(inC_in(q).rgb, 1.);`,
  },
  {
    type: 'pixelate',
    group: 'change',
    label: l('Pixelate', 'Пикселизация'),
    hint: l('Big square pixels (retro look).', 'Крупные квадратные пиксели (ретро).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'cells', label: l('Pixels across', 'Пикселей в ряд'), kind: 'int', min: 2, max: 256, default: 32 }],
    glsl: 'outColor = vec4(inC_in((floor(uv * p_cells) + 0.5) / p_cells).rgb, 1.);',
  },
  {
    type: 'swirl',
    group: 'change',
    label: l('Swirl', 'Завихрение'),
    hint: l('Twist the middle of the picture round (the edges stay put, so it still tiles).', 'Закрутить середину картинки (края на месте, так что плитка стыкуется).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'amount', label: l('Twist', 'Закрутка'), kind: 'number', min: -10, max: 10, default: 3 },
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.05, max: 0.5, default: 0.45 },
    ],
    glsl: `vec2 d = uv - 0.5; float t = clamp(1. - length(d) / p_radius, 0., 1.); float a = p_amount * t * t;
outColor = vec4(inC_in(0.5 + mat2(cos(a), -sin(a), sin(a), cos(a)) * d).rgb, 1.);`,
  },
  {
    type: 'outline',
    group: 'change',
    label: l('Outline', 'Контур'),
    hint: l('White where brightness changes quickly: the edges of shapes.', 'Белое там, где яркость резко меняется: края фигур.'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 10, default: 2 },
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.003 },
    ],
    glsl: `float r = p_radius;
float tl = inG_in(uv + vec2(-r, -r)), tc = inG_in(uv + vec2(0., -r)), tr = inG_in(uv + vec2(r, -r));
float ml = inG_in(uv + vec2(-r, 0.)), mr = inG_in(uv + vec2(r, 0.));
float bl = inG_in(uv + vec2(-r, r)), bc = inG_in(uv + vec2(0., r)), br = inG_in(uv + vec2(r, r));
float gx = tr + 2. * mr + br - tl - 2. * ml - bl; float gy = bl + 2. * bc + br - tl - 2. * tc - tr;
outColor = vec4(vec3(clamp(length(vec2(gx, gy)) * p_strength, 0., 1.)), 1.);`,
  },
  {
    type: 'motionBlur',
    group: 'change',
    label: l('Directional blur', 'Размытие в движении'),
    hint: l('Smear the picture one way: streaks, brushed metal, rain.', 'Смазать картинку в одну сторону: потёки, шлифованный металл, дождь.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'angle', label: l('Direction', 'Направление'), kind: 'number', min: 0, max: 360, step: 1, default: 90 },
      { id: 'length', label: l('Length', 'Длина'), kind: 'number', min: 0, max: 0.25, step: 0.002, default: 0.04 },
    ],
    glsl: `vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle))) * p_length;
vec3 s = vec3(0.); for (int k = -8; k <= 8; k++) s += inC_in(uv + dir * float(k) / 8.).rgb;
outColor = vec4(s / 17., 1.);`,
  },
  {
    type: 'emboss',
    group: 'change',
    label: l('Light from height', 'Свет по высоте'),
    hint: l('Light a height picture from one side: bright slopes face the light (a quick preview or stylized shading).', 'Осветить карту высот с одной стороны: склоны к свету светлее (быстрый просмотр или стилизованные тени).'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'angle', label: l('Light from', 'Свет с'), kind: 'number', min: 0, max: 360, step: 1, default: 225 },
      { id: 'elevation', label: l('Light height', 'Высота света'), kind: 'number', min: 5, max: 85, step: 1, default: 40 },
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 4, default: 1 },
    ],
    glsl: `float e = 1. / 256.;
vec2 g = vec2(inG_in(uv + vec2(e, 0.)) - inG_in(uv - vec2(e, 0.)), inG_in(uv + vec2(0., e)) - inG_in(uv - vec2(0., e))) * p_strength * 32.;
vec3 n = normalize(vec3(-g, 1.)); float el = radians(p_elevation), az = radians(p_angle);
vec3 L = vec3(cos(az) * cos(el), sin(az) * cos(el), sin(el));
outColor = vec4(vec3(clamp(dot(n, L), 0., 1.)), 1.);`,
  },

  // ── More: combine ──
  {
    type: 'math',
    group: 'combine',
    label: l('Math', 'Математика'),
    hint: l('Combine two greys with a sum: add, subtract, multiply, divide, min, max, power … (B is the number when not linked).', 'Совместить два серых: сложить, вычесть, умножить, разделить, мин, макс, степень … (Б — число, если не подключено).'),
    inputs: [IN_GREY('a', l('A', 'А'), [0.5, 0.5, 0.5]), IN_GREY('b', l('B', 'Б'), [0.5, 0.5, 0.5])],
    output: 'grey',
    params: [
      {
        id: 'op',
        label: l('Sum', 'Действие'),
        kind: 'choice',
        options: [opt('add', 'A + B', 'А + Б'), opt('sub', 'A − B', 'А − Б'), opt('mul', 'A × B', 'А × Б'), opt('div', 'A ÷ B', 'А ÷ Б'), opt('min', 'Smaller', 'Меньшее'), opt('max', 'Larger', 'Большее'), opt('pow', 'A to the power B', 'А в степени Б'), opt('diff', 'Difference', 'Разница'), opt('avg', 'Average', 'Среднее')],
        default: 'mul',
      },
      { id: 'value', label: l('B (when not linked)', 'Б (без связи)'), kind: 'number', min: -1, max: 4, default: 1 },
    ],
    glsl: `float a = inG_a(uv); float b = h_b > 0.5 ? inG_b(uv) : p_value; int m = int(p_op + 0.5); float r;
if (m == 0) r = a + b; else if (m == 1) r = a - b; else if (m == 2) r = a * b; else if (m == 3) r = a / max(abs(b), 1e-4) * sign(b + 1e-9);
else if (m == 4) r = min(a, b); else if (m == 5) r = max(a, b); else if (m == 6) r = pow(max(a, 0.), b); else if (m == 7) r = abs(a - b); else r = (a + b) * 0.5;
outColor = vec4(vec3(clamp(r, 0., 1.)), 1.);`,
  },
  {
    type: 'heightBlend',
    group: 'combine',
    label: l('Height blend', 'Смешать по высоте'),
    hint: l('Two materials meet by height: the higher one shows (sand between stones, moss in cracks, paint chipping off).', 'Два материала встречаются по высоте: видно более высокий (песок между камнями, мох в трещинах, облупившаяся краска).'),
    inputs: [IN_COLOR('top', l('Top colour', 'Верхний цвет'), [1, 1, 1]), IN_GREY('heightTop', l('Top height', 'Верхняя высота'), [0.5, 0.5, 0.5]), IN_COLOR('bottom', l('Bottom colour', 'Нижний цвет'), [0, 0, 0]), IN_GREY('heightBottom', l('Bottom height', 'Нижняя высота'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'offset', label: l('Top raised by', 'Поднять верхний на'), kind: 'number', min: -1, max: 1, default: 0 },
      { id: 'contrast', label: l('Hardness', 'Резкость'), kind: 'number', min: 0, max: 1, default: 0.85 },
      { id: 'out', label: l('Gives', 'Выдаёт'), kind: 'choice', options: [opt('colour', 'Colour', 'Цвет'), opt('height', 'Height', 'Высоту'), opt('mask', 'Mask', 'Маску')], default: 'colour' },
    ],
    glsl: `float ha = inG_heightTop(uv) + p_offset, hb = inG_heightBottom(uv); float w = (1. - p_contrast) * 0.5 + 0.005;
float m = smoothstep(-w, w, ha - hb);
vec3 r = p_out < 0.5 ? mix(inC_bottom(uv).rgb, inC_top(uv).rgb, m) : p_out < 1.5 ? vec3(clamp(mix(hb, ha, m), 0., 1.)) : vec3(m);
outColor = vec4(r, 1.);`,
  },
  {
    type: 'combineChannels',
    group: 'combine',
    label: l('Combine channels', 'Собрать каналы'),
    hint: l('Make a colour from three greys as its red, green and blue.', 'Собрать цвет из трёх серых как красный, зелёный и синий.'),
    inputs: [IN_GREY('r', l('Red', 'Красный')), IN_GREY('g', l('Green', 'Зелёный')), IN_GREY('b', l('Blue', 'Синий'))],
    output: 'color',
    params: [],
    glsl: 'outColor = vec4(inG_r(uv), inG_g(uv), inG_b(uv), 1.);',
  },
  {
    type: 'splitChannel',
    group: 'combine',
    label: l('Pick channel', 'Взять канал'),
    hint: l('One channel of a colour as grey: red, green, blue, or brightness.', 'Один канал цвета как серое: красный, зелёный, синий или яркость.'),
    inputs: [IN_COLOR()],
    output: 'grey',
    params: [{ id: 'channel', label: l('Channel', 'Канал'), kind: 'choice', options: [opt('r', 'Red', 'Красный'), opt('g', 'Green', 'Зелёный'), opt('b', 'Blue', 'Синий'), opt('l', 'Brightness', 'Яркость')], default: 'r' }],
    glsl: `vec3 c = inC_in(uv).rgb; int k = int(p_channel + 0.5);
float v = k == 0 ? c.r : k == 1 ? c.g : k == 2 ? c.b : dot(c, vec3(0.2126, 0.7152, 0.0722));
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'colorSelect',
    group: 'combine',
    label: l('Colour to mask', 'Цвет в маску'),
    hint: l('White where the picture is close to a colour: pick out one part to treat differently.', 'Белое там, где картинка близка к цвету: выделить часть, чтобы обработать отдельно.'),
    inputs: [IN_COLOR()],
    output: 'grey',
    params: [
      { id: 'color', label: l('Colour', 'Цвет'), kind: 'color', default: '#808080' },
      { id: 'tolerance', label: l('Tolerance', 'Допуск'), kind: 'number', min: 0, max: 1, default: 0.2 },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 1, default: 0.2 },
    ],
    glsl: `float d = distance(inC_in(uv).rgb, p_color);
outColor = vec4(vec3(1. - smoothstep(p_tolerance, p_tolerance + p_softness * 0.3 + 1e-3, d)), 1.);`,
  },

  // ── More: colour ──
  {
    type: 'replaceColor',
    group: 'colour',
    label: l('Replace colour', 'Заменить цвет'),
    hint: l('Swap one colour for another (and its near shades).', 'Заменить один цвет другим (и близкие оттенки).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'from', label: l('From', 'Какой'), kind: 'color', default: '#808080' },
      { id: 'to', label: l('To', 'На какой'), kind: 'color', default: '#c05040' },
      { id: 'tolerance', label: l('Tolerance', 'Допуск'), kind: 'number', min: 0, max: 1, default: 0.25 },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 1, default: 0.3 },
    ],
    glsl: `vec3 c = inC_in(uv).rgb;
float m = 1. - smoothstep(p_tolerance, p_tolerance + p_softness * 0.3 + 1e-3, distance(c, p_from));
outColor = vec4(mix(c, clamp(c + (p_to - p_from), 0., 1.), m), 1.);`,
  },
  {
    type: 'desaturate',
    group: 'colour',
    label: l('Desaturate', 'Обесцветить'),
    hint: l('Take the colour out, partly or fully.', 'Убрать цвет, частично или полностью.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 1, default: 1 }],
    glsl: 'vec3 c = inC_in(uv).rgb; outColor = vec4(mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), p_amount), 1.);',
  },
  {
    type: 'colorVariation',
    group: 'colour',
    label: l('Colour variation', 'Разнообразие цвета'),
    hint: l('Break up a flat colour with large, soft shifts in brightness and hue.', 'Оживить ровный цвет крупными мягкими сдвигами яркости и тона.'),
    inputs: [IN_COLOR('in', l('In', 'Вход'), [0.6, 0.6, 0.6])],
    output: 'color',
    params: [
      { id: 'amount', label: l('Brightness', 'Яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      { id: 'hue', label: l('Hue', 'Тон'), kind: 'number', min: 0, max: 0.5, default: 0.05 },
      { id: 'scale', label: l('Size', 'Размер'), kind: 'int', min: 1, max: 32, default: 4 },
      seed,
    ],
    glsl: `float n = fbm(uv, p_scale, 4., 0.5, 0., p_seed) - 0.5; float n2 = fbm(uv, p_scale, 4., 0.5, 0., p_seed + 9.) - 0.5;
vec3 h = rgb2hsv(inC_in(uv).rgb); h.x = fract(h.x + n2 * p_hue * 2.); h.z = clamp(h.z * (1. + n * p_amount * 2.), 0., 1.);
outColor = vec4(hsv2rgb(h), 1.);`,
  },
  {
    type: 'temperature',
    group: 'colour',
    label: l('Warm or cool', 'Теплее или холоднее'),
    hint: l('Shift the colours warmer (orange) or cooler (blue), and greener or pinker.', 'Сдвинуть цвета теплее (оранжевее) или холоднее (синее), и зеленее или розовее.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'warmth', label: l('Warmth', 'Теплота'), kind: 'number', min: -1, max: 1, default: 0.2 },
      { id: 'tint', label: l('Green–pink', 'Зелёный–розовый'), kind: 'number', min: -1, max: 1, default: 0 },
    ],
    glsl: `vec3 c = inC_in(uv).rgb; c.r += p_warmth * 0.12; c.b -= p_warmth * 0.12; c.g -= p_tint * 0.1; c.rb += p_tint * 0.04;
outColor = vec4(clamp(c, 0., 1.), 1.);`,
  },

  // ── More: surface ──
  {
    type: 'normalBlend',
    group: 'surface',
    label: l('Combine normals', 'Совместить нормали'),
    hint: l('Lay fine detail bumps over a base normal map (both from Height to normal).', 'Наложить мелкий рельеф на основную карту нормалей (обе из «Высота в нормали»).'),
    inputs: [IN_COLOR('base', l('Base', 'Основа'), [0.5, 0.5, 1]), IN_COLOR('detail', l('Detail', 'Детали'), [0.5, 0.5, 1])],
    output: 'color',
    params: [{ id: 'strength', label: l('Detail strength', 'Сила деталей'), kind: 'number', min: 0, max: 2, default: 1 }],
    glsl: `vec3 a = inC_base(uv).rgb * 2. - 1.; vec3 b = inC_detail(uv).rgb * 2. - 1.; b.xy *= p_strength;
outColor = vec4(normalize(vec3(a.xy + b.xy, max(a.z * b.z, 1e-3))) * 0.5 + 0.5, 1.);`,
  },
  {
    type: 'normalAdjust',
    group: 'surface',
    label: l('Adjust normals', 'Настроить нормали'),
    hint: l('Make bumps stronger or flatter, or flip them (for maps made the other way up).', 'Сделать рельеф сильнее или площе, или перевернуть (для карт, сделанных наоборот).'),
    inputs: [IN_COLOR('in', l('Normal', 'Нормали'), [0.5, 0.5, 1])],
    output: 'color',
    params: [
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 4, default: 1 },
      { id: 'flip', label: l('Flip green', 'Перевернуть зелёный'), kind: 'bool', default: false },
    ],
    glsl: `vec3 n = inC_in(uv).rgb * 2. - 1.; n.xy *= p_strength; if (p_flip > 0.5) n.y = -n.y;
outColor = vec4(normalize(vec3(n.xy, max(n.z, 1e-3))) * 0.5 + 0.5, 1.);`,
  },
  {
    type: 'edgeWear',
    group: 'surface',
    label: l('Edge wear', 'Износ краёв'),
    hint: l('A mask of worn edges from a height picture, broken up with noise: paint chipped off corners.', 'Маска стёртых краёв по карте высот, разбитая шумом: краска, стёртая на углах.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'amount', label: l('Amount', 'Сколько'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'breakup', label: l('Breakup', 'Разрывы'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 64, default: 12 },
      seed,
    ],
    glsl: `float h = inG_in(uv); float r = 0.004;
float lap = 4. * h - inG_in(uv + vec2(r, 0.)) - inG_in(uv - vec2(r, 0.)) - inG_in(uv + vec2(0., r)) - inG_in(uv - vec2(0., r));
float edge = clamp(lap * 40., 0., 1.); float n = fbm(uv, p_scale, 5., 0.6, 0., p_seed);
float v = edge * mix(1., n * 1.6, p_breakup);
outColor = vec4(vec3(smoothstep(1. - p_amount, 1. - p_amount + 0.15, v)), 1.);`,
  },
  {
    type: 'dirt',
    group: 'surface',
    label: l('Dirt', 'Грязь'),
    hint: l('A mask of dirt gathering in the dips of a height picture, spread a little with noise.', 'Маска грязи, собирающейся во впадинах карты высот, немного разбросанной шумом.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'amount', label: l('Amount', 'Сколько'), kind: 'number', min: 0, max: 1, default: 0.4 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 32, default: 6 },
      seed,
    ],
    glsl: `float h = inG_in(uv); float s = 0., w = 0.;
for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { vec2 o = vec2(x, y) / 2.; float k = exp(-dot(o, o)); s += inG_in(uv + o * 0.03) * k; w += k; }
float cav = clamp((s / w - h) * 8., 0., 1.); float n = fbm(uv, p_scale, 5., 0.55, 0., p_seed);
outColor = vec4(vec3(clamp(cav * 1.5 + (n - 1. + p_amount) * 1.5, 0., 1.)), 1.);`,
  },
  {
    type: 'drips',
    group: 'surface',
    label: l('Drips and streaks', 'Потёки'),
    hint: l('Thin streaks running down, thinning as they go: rain stains, rust runs, leaks.', 'Тонкие потёки вниз, сужающиеся к концу: следы дождя, ржавчины, протечки.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'count', label: l('Lanes', 'Дорожек'), kind: 'int', min: 4, max: 128, default: 32 },
      { id: 'amount', label: l('Amount', 'Сколько'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'length', label: l('Length', 'Длина'), kind: 'number', min: 0.05, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `float col = floor(uv.x * p_count); vec2 o = seedv(p_seed); float cm = mod(col, p_count);
float has = step(1. - p_amount, hash12(vec2(cm, 1.) + o));
float start = hash12(vec2(cm, 2.) + o); float len = p_length * (0.3 + 0.7 * hash12(vec2(cm, 3.) + o));
float y = fract(uv.y - start); float t = clamp(y / max(len, 1e-3), 0., 1.);
float fx = fract(uv.x * p_count) - 0.5; float wd = 0.35 * (1. - t) + 0.02;
float v = has * step(y, len) * (1. - smoothstep(wd * 0.6, wd, abs(fx))) * (1. - t);
outColor = vec4(vec3(v), 1.);`,
  },

  // ── Outputs ──
  output('outColor', 'color', 'color', 'Colour', 'Цвет', 'The material’s colour.', 'Цвет материала.', [0.7, 0.7, 0.7]),
  output('outHeight', 'height', 'grey', 'Height', 'Высота', 'How high each spot is (white high): bumps when there is no normal map.', 'Высота каждой точки (белое — выше): рельеф, если нет карты нормалей.', [0.5, 0.5, 0.5]),
  output('outNormal', 'normal', 'color', 'Normal', 'Нормали', 'Bumps for lighting (from Height to normal).', 'Рельеф для освещения (из «Высота в нормали»).', [0.5, 0.5, 1]),
  output('outRoughness', 'roughness', 'grey', 'Roughness', 'Шероховатость', 'White is matte, black mirror-smooth.', 'Белое — матовое, чёрное — гладкое как зеркало.', [0.8, 0.8, 0.8]),
  output('outMetal', 'metalness', 'grey', 'Metal', 'Металл', 'White where it is metal.', 'Белое — там, где металл.', [0, 0, 0]),
  output('outOcclusion', 'occlusion', 'grey', 'Occlusion', 'Затенение', 'Dark where little light gets in (cracks, dips).', 'Темнее там, куда мало света попадает (трещины, впадины).', [1, 1, 1]),
  output('outGlow', 'glow', 'color', 'Glow', 'Свечение', 'Where it glows, and in what colour (black: no glow).', 'Где светится и каким цветом (чёрное — не светится).', [0, 0, 0]),
  output('outOpacity', 'opacity', 'grey', 'Opacity', 'Непрозрачность', 'Black is see-through (cut out), white solid.', 'Чёрное — насквозь (вырезано), белое — сплошное.', [1, 1, 1]),
  output('outWearColor', 'wearColor', 'color', 'Wear colour', 'Цвет износа', 'The wear layer’s colour (bare metal under paint, dust): shown on edges, in creases or on top, as the material’s Wear settings say.', 'Цвет слоя износа (металл под краской, пыль): виден на краях, в углах или сверху, как задано в настройках износа материала.', [0.6, 0.6, 0.6]),
  output('outWearRoughness', 'wearRoughness', 'grey', 'Wear roughness', 'Шероховатость износа', 'The wear layer’s roughness (white matte).', 'Шероховатость слоя износа (белое — матовое).', [0.35, 0.35, 0.35]),
  output('outWearMetal', 'wearMetal', 'grey', 'Wear metal', 'Металл износа', 'Where the wear layer is metal (white).', 'Где слой износа металлический (белое).', [1, 1, 1]),
  output('outWearNoise', 'wearNoise', 'grey', 'Wear noise', 'Шум износа', 'Breaks the wear up: where it is white, wear shows sooner (a grunge works well).', 'Разбивает износ: где белое, износ проявляется раньше (хорошо подходит «Грязь»).', [0.5, 0.5, 0.5]),
];

const byType = new Map(NODES.map((n) => [n.type, n]));
export const nodeDef = (type: string): NodeDef | undefined => byType.get(type);

export const GROUPS: { id: Group; label: L }[] = [
  { id: 'make', label: l('Make', 'Создать') },
  { id: 'change', label: l('Change', 'Изменить') },
  { id: 'combine', label: l('Combine', 'Совместить') },
  { id: 'colour', label: l('Colour', 'Цвет') },
  { id: 'surface', label: l('Surface', 'Поверхность') },
  { id: 'output', label: l('Outputs', 'Выходы') },
];

/** The maps a material can have, in the order they are listed. */
export const OUTPUT_ROLES: OutputRole[] = ['color', 'height', 'normal', 'roughness', 'metalness', 'occlusion', 'glow', 'opacity', 'wearColor', 'wearRoughness', 'wearMetal', 'wearNoise'];
