export type Channel = 'color' | 'roughness' | 'metalness' | 'normal' | 'height' | 'occlusion' | 'glow' | 'opacity';

export interface ChannelInfo {
  id: Channel;
  label: string;
  /** colour: sRGB picture; grey: one value in red; normal: tangent space, green up. */
  kind: 'color' | 'grey' | 'normal';
}

export const CHANNELS: ChannelInfo[] = [
  { id: 'color', label: 'Base color', kind: 'color' },
  { id: 'roughness', label: 'Roughness', kind: 'grey' },
  { id: 'metalness', label: 'Metal', kind: 'grey' },
  { id: 'normal', label: 'Normal', kind: 'normal' },
  { id: 'height', label: 'Height', kind: 'grey' },
  { id: 'occlusion', label: 'Occlusion', kind: 'grey' },
  { id: 'glow', label: 'Glow', kind: 'color' },
  { id: 'opacity', label: 'Opacity', kind: 'grey' },
];

export const channelInfo = (c: Channel) => CHANNELS.find((x) => x.id === c)!;

export const DEFAULT_CHANNELS: Channel[] = ['color', 'roughness', 'metalness', 'normal', 'height'];

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'subtract' | 'darken' | 'lighten';
export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
];

/** What a fill layer puts in each channel when it has no material (or the material has no such map). */
export interface FlatValues {
  color: string;
  roughness: number;
  metalness: number;
  height: number;
  occlusion: number;
  glow: string;
  opacity: number;
}

export const FLAT_DEFAULTS: FlatValues = { color: '#9a9a9a', roughness: 0.6, metalness: 0, height: 0.5, occlusion: 1, glow: '#000000', opacity: 1 };

export type MeshMap = 'normal' | 'worldNormal' | 'position' | 'occlusion' | 'curvature' | 'thickness' | 'id' | 'light';

export const MESH_MAPS: { id: MeshMap; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'worldNormal', label: 'World normal' },
  { id: 'position', label: 'Position' },
  { id: 'occlusion', label: 'Ambient occlusion' },
  { id: 'curvature', label: 'Curvature' },
  { id: 'thickness', label: 'Thickness' },
  { id: 'id', label: 'ID' },
  { id: 'light', label: 'Light' },
];

export interface BakeSettings {
  size: TextureSize;
  maps: MeshMap[];
  /** Cast from the low-poly surface onto the project's high-poly model. */
  useHigh: boolean;
  /** Ray distances in front of and behind the surface, as a share of the model's size. */
  front: number;
  rear: number;
  aoSamples: number;
  /** As a share of the model's size. */
  aoDistance: number;
  idFrom: 'mesh' | 'material';
  /** Low and high meshes pair up by name (`body_low` with `body_high`); rays only reach a mesh's own pair. */
  matchByName: boolean;
  /** Work out each mesh's cage from how far its high-poly surface is. */
  autoCage: boolean;
  /** Cage per low-poly mesh (by name), as a share of the model's size. */
  cages: Record<string, { front: number; rear: number }>;
  /** Cast along normals averaged across hard edges, so they bake smooth and seamless. */
  averageNormals: boolean;
  /** Cast along the mesh's own normals first and along averaged ones only where those miss: no wavy edges where hard edges meet curved high-poly surfaces. */
  meshFirst?: boolean;
  /** Samples per texel side: 1, 2 or 4. */
  antialias: 1 | 2 | 4;
  /** Curvature from the mesh's shape, or from the baked normal map (picks up high-poly detail). */
  curvatureFrom: 'mesh' | 'normal';
  curvatureStrength: number;
  /** High-poly (or low-poly) meshes, by name, that don't darken anything in occlusion. */
  aoExclude?: string[];
  /** How much the bake lights brighten the occlusion map, 0 to 1. */
  lightMix?: number;
}

/** A light placed for baking: lights the Light map, and can brighten occlusion. */
export interface BakeLight {
  id: string;
  /** In the model's space. */
  position: [number, number, number];
  /** Size, as a share of the model's size: bigger gives softer shadows. */
  radius: number;
  strength: number;
}

/** Rounds hard edges in the baked maps, as if they were bevelled, by blending normals of nearby surfaces. */
export interface Bevel {
  /** As a share of the model's size. */
  radius: number;
  samples: number;
  edges: 'both' | 'convex' | 'concave';
}

export const BEVEL_DEFAULTS: Bevel = { radius: 0.01, samples: 16, edges: 'convex' };

export const BAKE_DEFAULTS: BakeSettings = { size: 2048, maps: ['normal', 'worldNormal', 'position', 'occlusion', 'curvature', 'thickness', 'id'], useHigh: false, front: 0.03, rear: 0.03, aoSamples: 64, aoDistance: 0.2, idFrom: 'material', matchByName: true, autoCage: true, averageNormals: true, meshFirst: true, cages: {}, antialias: 1, curvatureFrom: 'mesh', curvatureStrength: 1 };

/** A mask made from a baked mesh map: edges, cavities, thin parts, height or up-facing surfaces. */
export interface Generator {
  source: 'curvature' | 'occlusion' | 'thickness' | 'height' | 'up' | 'light';
  level: number;
  spread: number;
  invert: boolean;
  /** Breaks up the edge (edge wear): amount 0–1, size, and a seed. */
  noise?: number;
  noiseScale?: number;
  seed?: number;
  noiseType?: NoiseType;
  /** Picture used when the noise type is 'image' (inside the project). */
  noiseImage?: { file: string; name: string };
}

export type NoiseType = 'clouds' | 'cells' | 'grain' | 'scratches' | 'image';
export const NOISE_TYPES: NoiseType[] = ['clouds', 'cells', 'grain', 'scratches', 'image'];
export const NOISE_LABELS: Record<NoiseType, string> = { clouds: 'Clouds', cells: 'Cells', grain: 'Grain', scratches: 'Scratches', image: 'Library or picture' };

export const GENERATOR_SOURCES: { value: Generator['source']; label: string; map: MeshMap }[] = [
  { value: 'curvature', label: 'Edges (curvature)', map: 'curvature' },
  { value: 'occlusion', label: 'Cavities (occlusion)', map: 'occlusion' },
  { value: 'thickness', label: 'Thin parts (thickness)', map: 'thickness' },
  { value: 'height', label: 'Height on the model', map: 'position' },
  { value: 'up', label: 'Facing up', map: 'worldNormal' },
  { value: 'light', label: 'Lit by bake lights', map: 'light' },
];

/** A library material used by a fill layer, with this layer's own parameter values. */
export interface MaterialUse {
  material: string;
  values: Record<string, unknown>;
  /** Repeats across the texture set's UV square. */
  scale: number;
}

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
  /** Blend and opacity of single channels, in place of the layer's. */
  channelBlend?: Partial<Record<Channel, { blend: BlendMode; opacity: number }>>;
  /** The channels this layer changes. */
  channels: Channel[];
  /** Where the layer shows: white shows it, black hides it. */
  mask: Mask | null;
  /** Steps that change what the layer puts in its channels, top first. Not on groups. */
  effects?: Effect[];
}

export type MaskBlend = 'normal' | 'multiply' | 'add' | 'subtract' | 'lighten' | 'darken';
export const MASK_BLENDS: { value: MaskBlend; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'darken', label: 'Darken' },
];

export type EffectKind = 'paint' | 'generator' | 'image' | 'procedural' | 'fill' | 'levels' | 'blur' | 'invert' | 'hsl';

export const EFFECT_KINDS: { kind: EffectKind; label: string; mask: boolean }[] = [
  { kind: 'paint', label: 'Paint', mask: true },
  { kind: 'fill', label: 'Fill', mask: true },
  { kind: 'generator', label: 'Generator', mask: true },
  { kind: 'image', label: 'Image', mask: true },
  { kind: 'procedural', label: 'Procedural', mask: true },
  { kind: 'levels', label: 'Levels', mask: true },
  { kind: 'blur', label: 'Blur', mask: true },
  { kind: 'invert', label: 'Invert', mask: true },
  { kind: 'hsl', label: 'Hue and saturation', mask: false },
];

/** A filter or source on a layer or in a mask, like Substance Painter's effects. Mask effects use mask blends. */
export interface Effect {
  id: string;
  name: string;
  /** paint: strokes (pixels under the effect's id); generator: from mesh maps; image: a picture; fill: a value; the rest change what's below. */
  kind: EffectKind;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  generator?: Generator;
  image?: { file: string; name: string; scale: number; invert: boolean };
  procedural?: Procedural;
  /** Fill in a mask. */
  value?: number;
  /** Fill on a layer. */
  flat?: FlatValues;
  levels?: { low: number; high: number; gamma: number };
  /** Radius as a share of the texture. */
  radius?: number;
  hsl?: { hue: number; saturation: number; lightness: number };
}

/** A noise or pattern from the built-in library, made with its own seed and tone. On layers, dark to light goes from the first color to the second. */
export interface Procedural {
  /** Library asset id (a noise or pattern). */
  asset: string;
  scale: number;
  seed: number;
  contrast: number;
  balance: number;
  invert: boolean;
  colors: [string, string];
}

export const PROCEDURAL_DEFAULTS: Procedural = { asset: 'clouds', scale: 1, seed: 0, contrast: 1, balance: 0, invert: false, colors: ['#000000', '#ffffff'] };

/** How a procedural is looked up as a picture. */
export const proceduralRef = (p: Procedural) => `proc:${p.asset}:${p.seed}:${p.contrast}:${p.balance}`;

export type MaskItem = Effect;

/** A layer's mask: black or white to start with, then its effects, top first. */
export interface Mask {
  base: 0 | 1;
  items: Effect[];
}

export function newEffect(kind: EffectKind, extra: Partial<Effect> = {}): Effect {
  const e: Effect = { id: uid(), name: EFFECT_KINDS.find((x) => x.kind === kind)!.label, kind, visible: true, opacity: 1, blend: 'normal', ...extra };
  if (kind === 'generator' && !e.generator) e.generator = { source: 'curvature', level: 0.6, spread: 0.1, invert: false };
  if (kind === 'procedural' && !e.procedural) e.procedural = { ...PROCEDURAL_DEFAULTS, colors: [...PROCEDURAL_DEFAULTS.colors] };
  if (kind === 'levels' && !e.levels) e.levels = { low: 0, high: 1, gamma: 1 };
  if (kind === 'blur' && e.radius === undefined) e.radius = 0.005;
  if (kind === 'hsl' && !e.hsl) e.hsl = { hue: 0, saturation: 0, lightness: 0 };
  return e;
}

export function newMaskItem(kind: EffectKind, extra: Partial<Effect> = {}): Effect {
  const e = newEffect(kind, extra);
  if (kind === 'fill' && e.value === undefined) e.value = 1;
  return e;
}

export function newLayerEffect(kind: EffectKind, extra: Partial<Effect> = {}): Effect {
  const e = newEffect(kind, extra);
  if (kind === 'fill' && !e.flat) e.flat = { ...FLAT_DEFAULTS };
  return e;
}

export interface PaintLayer extends LayerBase {
  kind: 'paint';
}

export interface FillLayer extends LayerBase {
  kind: 'fill';
  flat: FlatValues;
  use: MaterialUse | null;
}

export interface GroupLayer extends LayerBase {
  kind: 'group';
  open: boolean;
  children: Layer[];
}

export type Layer = PaintLayer | FillLayer | GroupLayer;

export type TextureSize = 512 | 1024 | 2048 | 4096;
export const TEXTURE_SIZES: TextureSize[] = [512, 1024, 2048, 4096];

export interface TextureSet {
  id: string;
  name: string;
  /** The model's material slot names painted by this set. */
  slots: string[];
  size: TextureSize;
  channels: Channel[];
  /** How strongly height becomes bumps in the normal map (1 = default). */
  bump?: number;
  /** Mesh maps baked for this set and how. Their pixels are stored with the project. */
  bake?: { settings: BakeSettings; done: MeshMap[] };
  /** Top of the stack first. */
  layers: Layer[];
}

export interface LibraryMaterial {
  id: string;
  name: string;
  /** Inside the project file. */
  file: string;
}

export interface ExportSettings {
  folder: string;
  /** `{set}` and `{map}` are replaced. */
  naming: string;
  size: TextureSize | 0;
  format: 'png';
  normalGreen: 'up' | 'down';
  /** Old projects: true means `pack: 'orm'`. */
  packOrm: boolean;
  /** orm: occlusion, roughness, metal in RGB; unity: metal in RGB with smoothness in alpha. */
  pack?: 'none' | 'orm' | 'unity';
  /** Outputs left out: channel ids, `pack`, or `mesh:<map>`. */
  skip?: string[];
  preset?: string;
}

export const packOf = (ex: ExportSettings) => ex.pack ?? (ex.packOrm ? 'orm' : 'none');

export const EXPORT_PRESETS: { id: string; label: string; set: Partial<ExportSettings> }[] = [
  { id: 'cocoaworlds', label: 'CocoaWorlds', set: { naming: '{set}_{map}', normalGreen: 'up', pack: 'none' } },
  { id: 'gltf', label: 'glTF / Blender', set: { naming: '{set}_{map}', normalGreen: 'up', pack: 'orm' } },
  { id: 'unreal', label: 'Unreal Engine', set: { naming: 'T_{set}_{map}', normalGreen: 'down', pack: 'orm' } },
  { id: 'unity', label: 'Unity (URP)', set: { naming: '{set}_{map}', normalGreen: 'up', pack: 'unity' } },
  { id: 'godot', label: 'Godot', set: { naming: '{set}_{map}', normalGreen: 'up', pack: 'orm' } },
];

/** A picture the user brought in: a brush alpha or a texture for masks and stencils. Kept in the project. */
export interface ProjectAsset {
  id: string;
  file: string;
  name: string;
  kind: 'alpha' | 'texture';
}

export interface Project {
  format: 'cocoasurface.project';
  version: number;
  name: string;
  created: string;
  modified: string;
  model: { file: string; name: string } | null;
  /** The detailed model baked from, if any. */
  highPoly?: { file: string; name: string } | null;
  /** The bevel shader on the model baked from (the high-poly one if used, else the model itself). */
  bevel?: Bevel | null;
  textureSets: TextureSet[];
  library: LibraryMaterial[];
  assets?: ProjectAsset[];
  bakeLights?: BakeLight[];
  export: ExportSettings;
  extensions?: Record<string, unknown>;
}

export const PROJECT_FORMAT = 'cocoasurface.project';
export const PROJECT_VERSION = 1;

export function uid(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('');
}

export function newProject(name: string, now = new Date().toISOString()): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    created: now,
    modified: now,
    model: null,
    textureSets: [],
    library: [],
    export: { folder: '', naming: '{set}_{map}', size: 0, format: 'png', normalGreen: 'up', packOrm: false },
  };
}

const base = (name: string, channels: Channel[]) => ({ id: uid(), name, visible: true, locked: false, opacity: 1, blend: 'normal' as BlendMode, channels: [...channels], mask: null as Mask | null });

export const newPaintLayer = (name: string, channels: Channel[]): PaintLayer => ({ ...base(name, channels), kind: 'paint' });
export const newFillLayer = (name: string, channels: Channel[], flat: Partial<FlatValues> = {}): FillLayer => ({
  ...base(name, channels),
  kind: 'fill',
  flat: { ...FLAT_DEFAULTS, ...flat },
  use: null,
});
export const newGroup = (name: string, channels: Channel[]): GroupLayer => ({ ...base(name, channels), kind: 'group', open: true, children: [] });

export function newTextureSet(name: string, slots: string[], size: TextureSize = 2048): TextureSet {
  return { id: uid(), name, slots, size, channels: [...DEFAULT_CHANNELS], layers: [newFillLayer('Base', DEFAULT_CHANNELS)] };
}

/** How a layer blends into one channel: its own setting for the channel, or the layer's. */
export function blendIn(l: { blend: BlendMode; opacity: number; channelBlend?: Partial<Record<Channel, { blend: BlendMode; opacity: number }>> }, c: Channel): { blend: BlendMode; opacity: number } {
  return l.channelBlend?.[c] ?? { blend: l.blend, opacity: l.opacity };
}
