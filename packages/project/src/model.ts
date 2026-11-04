export type Channel = 'color' | 'roughness' | 'metalness' | 'normal' | 'height' | 'occlusion' | 'glow' | 'opacity';

export interface ChannelInfo {
  id: Channel;
  label: string;
  /** colour: sRGB picture; grey: one value in red; normal: tangent space, green up. */
  kind: 'color' | 'grey' | 'normal';
}

export const CHANNELS: ChannelInfo[] = [
  { id: 'color', label: 'Base colour', kind: 'color' },
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

export type MeshMap = 'normal' | 'worldNormal' | 'position' | 'occlusion' | 'curvature' | 'thickness' | 'id';

export const MESH_MAPS: { id: MeshMap; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'worldNormal', label: 'World normal' },
  { id: 'position', label: 'Position' },
  { id: 'occlusion', label: 'Ambient occlusion' },
  { id: 'curvature', label: 'Curvature' },
  { id: 'thickness', label: 'Thickness' },
  { id: 'id', label: 'ID' },
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
}

export const BAKE_DEFAULTS: BakeSettings = { size: 2048, maps: ['normal', 'worldNormal', 'position', 'occlusion', 'curvature', 'thickness', 'id'], useHigh: false, front: 0.03, rear: 0.03, aoSamples: 64, aoDistance: 0.2, idFrom: 'material' };

/** A mask made from a baked mesh map: edges, cavities, thin parts, height or up-facing surfaces. */
export interface Generator {
  source: 'curvature' | 'occlusion' | 'thickness' | 'height' | 'up';
  level: number;
  spread: number;
  invert: boolean;
}

export const GENERATOR_SOURCES: { value: Generator['source']; label: string; map: MeshMap }[] = [
  { value: 'curvature', label: 'Edges (curvature)', map: 'curvature' },
  { value: 'occlusion', label: 'Cavities (occlusion)', map: 'occlusion' },
  { value: 'thickness', label: 'Thin parts (thickness)', map: 'thickness' },
  { value: 'height', label: 'Height on the model', map: 'position' },
  { value: 'up', label: 'Facing up', map: 'worldNormal' },
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
  /** The channels this layer changes. */
  channels: Channel[];
  /** A painted black and white mask (white shows the layer). Its pixels are stored with the project. */
  mask: boolean;
  /** Multiplies the mask (or is the mask when there's no painted one). */
  generator?: Generator | null;
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
  packOrm: boolean;
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
  textureSets: TextureSet[];
  library: LibraryMaterial[];
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

const base = (name: string, channels: Channel[]) => ({ id: uid(), name, visible: true, locked: false, opacity: 1, blend: 'normal' as BlendMode, channels: [...channels], mask: false });

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
