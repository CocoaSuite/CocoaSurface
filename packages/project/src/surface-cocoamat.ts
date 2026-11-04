import { catalogFor, COCOAMAT_MIME, COCOAMAT_FORMAT, readZip, writeCocoaMat, writeZip, COCOAMAT_VERSION, GRAPH_FORMAT, GRAPH_VERSION, nodeId, type CocoaMatParts, type Manifest, type MatGraph, type OutputRole } from '@cocoasurface/materials';
import type { Channel, TextureSet } from './model';

const OUT: Record<Channel, string> = {
  color: 'outColor',
  roughness: 'outRoughness',
  metalness: 'outMetal',
  normal: 'outNormal',
  height: 'outHeight',
  occlusion: 'outOcclusion',
  glow: 'outGlow',
  opacity: 'outOpacity',
};

export interface SetMaterialInput {
  set: TextureSet;
  /** PNGs by channel, top row first, normals green down (CocoaWorlds). */
  maps: Map<Channel, Uint8Array>;
  generator: string;
  created?: string;
  /** Extra entries carried under `cocoasurface/` so CocoaSurface can reopen the layer stack. */
  extra?: Map<string, Uint8Array>;
}

/**
 * A texture set as a `.cocoamat`: one Image node per map wired to its output node. The editable layer stack goes
 * in `extensions.cocoasurface`; CocoaWorlds ignores it and keeps it when it rewrites the file.
 */
export function setMaterial(i: SetMaterialInput): CocoaMatParts {
  const g: MatGraph = { format: GRAPH_FORMAT, version: GRAPH_VERSION, nodes: [], links: [], exposed: [] };
  const images = new Map<string, Uint8Array>();
  const stem = i.set.name.replace(/[^\w-]+/g, '_') || 'set';
  let y = 0;
  for (const [ch, png] of i.maps) {
    const path = `images/${stem}_${ch}.png`;
    images.set(path, png);
    const img = { id: nodeId(), type: 'image', x: 0, y, params: { image: path } };
    const out = { id: nodeId(), type: OUT[ch], x: 260, y, params: {} };
    g.nodes.push(img, out);
    g.links.push({ from: img.id, to: out.id, input: 'in' });
    y += 160;
  }
  const manifest: Manifest = {
    format: COCOAMAT_FORMAT,
    version: COCOAMAT_VERSION,
    generator: i.generator,
    created: i.created ?? new Date().toISOString(),
    name: i.set.name,
    folder: '',
    units: { perMetre: 39.37 },
    tiling: { worldSize: 128, mapping: 'face' },
    evaluation: { size: i.set.size },
    parameters: [],
    surface: { color: '#b4b4b4', roughness: 0.8, metalness: 0, normalStrength: 1, emissive: i.maps.has('glow') ? '#ffffff' : '#000000', emissiveStrength: i.maps.has('glow') ? 1 : 0, opacity: 1, cutout: true, doubleSided: false, scroll: [0, 0] },
    normalGreen: 'down',
    wear: null,
    glass: null,
    blend: null,
    bevel: 0,
    extensions: { cocoasurface: { version: 1, textureSet: i.set, files: [...(i.extra?.keys() ?? [])].map((k) => `cocoasurface/${k}`) } },
  };
  const parts: CocoaMatParts = { manifest, graph: g, nodes: catalogFor(g), images };
  return parts;
}

/** The file, with the extra `cocoasurface/` entries after the standard ones. */
export async function writeSetMaterial(parts: CocoaMatParts, extra = new Map<string, Uint8Array>()): Promise<Uint8Array> {
  const std = await writeCocoaMat(parts);
  if (!extra.size) return std;
  const zip = await readZip(std);
  if (typeof zip === 'string') throw new Error(zip);
  const entries = [...zip].map(([name, data]) => ({ name, data, deflate: name.endsWith('.json') }));
  for (const [name, data] of extra) entries.push({ name: `cocoasurface/${name}`, data, deflate: !name.endsWith('.png') });
  if (entries[0]?.name !== 'mimetype' || new TextDecoder().decode(entries[0].data) !== COCOAMAT_MIME) throw new Error('Bad material file.');
  return writeZip(entries);
}

export const setRoles = (maps: Map<Channel, Uint8Array>): OutputRole[] => [...maps.keys()];
