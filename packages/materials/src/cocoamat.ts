/**
 * The CocoaSuite material file (`.cocoamat`): a graph material as an editable graph, for CocoaSurface and back.
 * The contract is docs/cocoamat-format.md; section numbers below are its sections. Pure: no DOM, no files.
 */
import { CATALOG_VERSION, nodeCatalog, type Catalog, type CatalogNode, type CatalogParam } from './catalog';
import { GRAPH_FORMAT, exposedOf, outputNodes, paramsOf, validateGraph, withOverrides, type MatGraph } from './graph';
import { nodeDef, type OutputRole, type ParamValue } from './nodes';
import { readZip, writeZip, type ZipEntry } from './zip';

export const COCOAMAT_MIME = 'application/vnd.cocoasuite.material+zip';
export const COCOAMAT_FORMAT = 'cocoasuite.material';
export const COCOAMAT_VERSION = '1.0';
export const UNITS_PER_METRE = 39.37;

/** What a manifest is made from: the fields of a project material (`MaterialDef`) that a file carries. */
export interface MaterialSource {
  id: string;
  name: string;
  folder?: string;
  color: string;
  roughness: number;
  metalness: number;
  normalStrength?: number;
  emissive?: string;
  emissiveStrength?: number;
  opacity?: number;
  cutout?: boolean;
  doubleSided?: boolean;
  scroll?: [number, number];
  tile?: number;
  mapping?: 'face' | 'world' | 'object';
  bakeSize?: number;
  overrides?: Record<string, unknown>;
  wear?: Wear;
  bevel?: number;
  refraction?: number;
  ior?: number;
  thickness?: number;
  blend?: number;
  blendNoise?: number;
  blendSize?: number;
}

export interface Wear {
  edge: number;
  crease: number;
  up: number;
  width: number;
  noise: number;
  color: string;
  roughness: number;
  metalness: number;
}

export type ParamKind = CatalogParam['kind'];

export interface Parameter {
  id: string;
  label: string;
  node: string;
  param: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  default: unknown;
  value: unknown;
}

export interface Manifest {
  format: typeof COCOAMAT_FORMAT;
  version: string;
  generator?: string;
  created?: string;
  id?: string;
  name: string;
  folder: string;
  units: { perMetre: number };
  tiling: { worldSize: number; mapping: 'face' | 'world' | 'object' };
  evaluation: { size: number };
  parameters: Parameter[];
  surface: {
    color: string;
    roughness: number;
    metalness: number;
    normalStrength: number;
    emissive: string;
    emissiveStrength: number;
    opacity: number;
    cutout: boolean;
    doubleSided: boolean;
    scroll: [number, number];
  };
  normalGreen: 'down' | 'up';
  wear: Wear | null;
  glass: { transmission: number; ior: number; thickness: number } | null;
  blend: { distance: number; noise: number; noiseSize: number } | null;
  bevel: number;
  baked?: { size: number; roles: OutputRole[] };
  extensions?: Record<string, unknown>;
  [field: string]: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Image settings of a graph, with the values materials give them: every project image the file needs. */
export function imagesUsed(g: MatGraph, overrides?: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const n of g.nodes.concat(withOverrides(g, overrides).nodes)) {
    const params = paramsOf(n);
    for (const p of nodeDef(n.type)?.params ?? []) if (p.kind === 'image' && params[p.id]) out.add(String(params[p.id]));
  }
  return [...out];
}

/**
 * Where each project image goes in the file: `images/<its name>` (WebP becomes PNG, since readers need only PNG
 * and JPEG), made unique.
 */
export function imageNames(paths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const p of paths) {
    const file = (p.split('/').pop() ?? 'image').replace(/\.webp$/i, '.png');
    const dot = file.lastIndexOf('.');
    const stem = dot > 0 ? file.slice(0, dot) : file, ext = dot > 0 ? file.slice(dot) : '.png';
    let name = `images/${stem}${ext}`;
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `images/${stem}_${k}${ext}`;
    taken.add(name.toLowerCase());
    out.set(p, name);
  }
  return out;
}

const rewrite = (v: unknown, kind: ParamKind, paths: Map<string, string>): unknown => (kind === 'image' && typeof v === 'string' && v ? (paths.get(v) ?? v) : v);

/** The graph as `graph.json` holds it: no overrides applied, image paths inside the file. */
export function graphForExport(g: MatGraph, paths: Map<string, string>): MatGraph {
  return {
    format: g.format,
    version: g.version,
    nodes: g.nodes.map((n) => {
      const def = nodeDef(n.type);
      const params: Record<string, ParamValue> = {};
      for (const [k, v] of Object.entries(n.params)) params[k] = rewrite(v, def?.params.find((p) => p.id === k)?.kind ?? 'number', paths) as ParamValue;
      return { id: n.id, type: n.type, x: n.x, y: n.y, params };
    }),
    links: g.links.map((l) => ({ from: l.from, to: l.to, input: l.input })),
    ...(g.exposed ? { exposed: exposedOf(g).map((e) => ({ id: e.id, node: e.node, param: e.param, label: e.label })) } : {}),
  };
}

/** The exposed settings as the manifest lists them (section 2). */
export function parametersOf(g: MatGraph, overrides: Record<string, unknown> | undefined, paths = new Map<string, string>()): Parameter[] {
  return exposedOf(g).map((e) => {
    const n = g.nodes.find((x) => x.id === e.node)!;
    const p = nodeDef(n.type)!.params.find((x) => x.id === e.param)!;
    const def = paramsOf(n)[e.param];
    const out = { id: e.id, label: e.label, node: e.node, param: e.param, kind: p.kind } as Parameter;
    if (p.kind === 'number' || p.kind === 'int') {
      out.min = p.min;
      out.max = p.max;
      if (p.kind === 'number' && p.step !== undefined) out.step = p.step;
    }
    if (p.kind === 'choice') out.options = p.options.map((o) => o.value);
    out.default = rewrite(def, p.kind, paths);
    out.value = rewrite(overrides?.[e.id] ?? def, p.kind, paths);
    return out;
  });
}

/** A material's manifest (section 2). */
export function manifestOf(m: MaterialSource, g: MatGraph, opts: { generator?: string; created?: string; paths?: Map<string, string>; baked?: { size: number; roles: OutputRole[] } } = {}): Manifest {
  const glows = outputNodes(withOverrides(g, m.overrides)).has('glow');
  const emissive = m.emissive ?? (glows ? '#ffffff' : '#000000');
  return {
    format: COCOAMAT_FORMAT,
    version: COCOAMAT_VERSION,
    ...(opts.generator ? { generator: opts.generator } : {}),
    created: opts.created ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    id: m.id,
    name: m.name,
    folder: m.folder ?? '',
    units: { perMetre: UNITS_PER_METRE },
    tiling: { worldSize: m.tile ?? 128, mapping: m.mapping ?? 'face' },
    evaluation: { size: m.bakeSize ?? 512 },
    parameters: parametersOf(g, m.overrides, opts.paths),
    surface: {
      color: m.color,
      roughness: m.roughness,
      metalness: m.metalness,
      normalStrength: m.normalStrength ?? 1,
      emissive,
      // (CocoaWorlds glows at strength 1 when a glow is set and no strength is.)
      emissiveStrength: m.emissive || glows ? (m.emissiveStrength ?? 1) : 0,
      opacity: m.opacity ?? 1,
      cutout: m.cutout !== false,
      doubleSided: !!m.doubleSided,
      scroll: m.scroll ?? [0, 0],
    },
    normalGreen: 'down',
    wear: m.wear ? { ...m.wear } : null,
    glass: m.refraction ? { transmission: m.refraction, ior: m.ior ?? 1.5, thickness: m.thickness ?? 8 } : null,
    blend: m.blend ? { distance: m.blend, noise: m.blendNoise ?? 0.5, noiseSize: m.blendSize ?? 24 } : null,
    bevel: m.bevel ?? 0,
    ...(opts.baked?.roles.length ? { baked: opts.baked } : {}),
  };
}

/** The node catalog cut down to the kinds of node a graph uses (`nodes.json`). */
export function catalogFor(g: MatGraph, c: Catalog = nodeCatalog()): Catalog {
  const used = new Set(g.nodes.map((n) => n.type));
  return { ...c, nodes: c.nodes.filter((n) => used.has(n.type)) };
}

export interface CocoaMatParts {
  manifest: Manifest;
  graph: MatGraph;
  nodes: Catalog;
  /** By path inside the file (`images/…`). */
  images?: Map<string, Uint8Array>;
  /** PNGs by role. */
  baked?: Map<OutputRole, Uint8Array>;
  preview?: Uint8Array;
}

const json = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v, null, 2)}\n`);

/** The file (section 1): `mimetype` first and stored, JSON deflated, images stored. */
export function writeCocoaMat(p: CocoaMatParts): Promise<Uint8Array> {
  const entries: ZipEntry[] = [
    { name: 'mimetype', data: new TextEncoder().encode(COCOAMAT_MIME) },
    { name: 'material.json', data: json(p.manifest), deflate: true },
    { name: 'graph.json', data: json(p.graph), deflate: true },
    { name: 'nodes.json', data: json(p.nodes), deflate: true },
  ];
  for (const [name, data] of p.images ?? []) entries.push({ name, data });
  for (const [role, data] of p.baked ?? []) entries.push({ name: `baked/${role}.png`, data });
  if (p.preview) entries.push({ name: 'preview.png', data: p.preview });
  return writeZip(entries);
}

export interface CocoaMat {
  /** With every default filled in and numbers clamped. */
  manifest: Manifest;
  /** As in the file (no parameter values applied: `evaluable` applies them). */
  graph: MatGraph;
  nodes: Catalog;
  images: Map<string, Uint8Array>;
  baked: Map<OutputRole, Uint8Array>;
  preview: Uint8Array | null;
}

const ROLES: OutputRole[] = ['color', 'height', 'normal', 'roughness', 'metalness', 'occlusion', 'glow', 'opacity', 'wearColor', 'wearRoughness', 'wearMetal', 'wearNoise'];

/** A value of a setting checked against its definition: the value (clamped), or undefined if it's the wrong kind. */
function checkValue(p: CatalogParam, v: unknown, images: Map<string, Uint8Array>): unknown {
  switch (p.kind) {
    case 'number':
      return isNum(v) ? clamp(v, p.min ?? -Infinity, p.max ?? Infinity) : undefined;
    case 'int':
      return isNum(v) ? clamp(Math.round(v), p.min ?? -Infinity, p.max ?? Infinity) : undefined;
    case 'seed':
      return isNum(v) ? Math.round(v) : undefined;
    case 'choice':
      return typeof v === 'string' && p.options?.some((o) => o.value === v) ? v : undefined;
    case 'color':
      return isColor(v) ? v : undefined;
    case 'bool':
      return typeof v === 'boolean' ? v : undefined;
    case 'ramp':
      return Array.isArray(v) && v.length >= 1 && v.length <= 8 && v.every((s) => isObj(s) && isNum(s.at) && isColor(s.color))
        ? v.map((s) => ({ at: clamp(s.at, 0, 1), color: s.color }))
        : undefined;
    case 'image':
      return typeof v === 'string' && (v === '' || images.has(v)) ? v : undefined;
  }
}

const num = (v: unknown, def: number, lo: number, hi: number) => (isNum(v) ? clamp(v, lo, hi) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const color = (v: unknown, def: string) => (isColor(v) ? v : def);

/** The manifest with defaults filled in and numbers clamped (section 2). */
export function fillManifest(raw: Record<string, unknown>, parameters: Parameter[]): Manifest {
  const s = isObj(raw.surface) ? raw.surface : {};
  const tiling = isObj(raw.tiling) ? raw.tiling : {};
  const ev = isObj(raw.evaluation) ? raw.evaluation : {};
  const size = isNum(ev.size) ? 2 ** Math.round(Math.log2(clamp(ev.size, 256, 4096))) : 512;
  const w = isObj(raw.wear) ? raw.wear : null;
  const gl = isObj(raw.glass) ? raw.glass : null;
  const bl = isObj(raw.blend) ? raw.blend : null;
  const scroll: [number, number] = Array.isArray(s.scroll) && s.scroll.length === 2 && s.scroll.every(isNum) ? [s.scroll[0] as number, s.scroll[1] as number] : [0, 0];
  const baked = isObj(raw.baked) && Array.isArray(raw.baked.roles) ? { size: isNum(raw.baked.size) ? raw.baked.size : size, roles: raw.baked.roles.filter((r): r is OutputRole => ROLES.includes(r as OutputRole)) } : undefined;
  return {
    ...raw,
    format: COCOAMAT_FORMAT,
    version: String(raw.version),
    name: String(raw.name),
    folder: typeof raw.folder === 'string' ? raw.folder : '',
    units: { perMetre: isObj(raw.units) && isNum(raw.units.perMetre) && raw.units.perMetre > 0 ? raw.units.perMetre : UNITS_PER_METRE },
    tiling: { worldSize: isNum(tiling.worldSize) && tiling.worldSize > 0 ? tiling.worldSize : 128, mapping: tiling.mapping === 'world' || tiling.mapping === 'object' ? tiling.mapping : 'face' },
    evaluation: { size },
    parameters,
    surface: {
      color: color(s.color, '#b4b4b4'),
      roughness: num(s.roughness, 0.8, 0, 1),
      metalness: num(s.metalness, 0, 0, 1),
      normalStrength: num(s.normalStrength, 1, 0, 2),
      emissive: color(s.emissive, '#000000'),
      emissiveStrength: num(s.emissiveStrength, 0, 0, 10),
      opacity: num(s.opacity, 1, 0, 1),
      cutout: bool(s.cutout, true),
      doubleSided: bool(s.doubleSided, false),
      scroll,
    },
    normalGreen: raw.normalGreen === 'up' ? 'up' : 'down',
    wear: w
      ? {
          edge: num(w.edge, 0, 0, 1),
          crease: num(w.crease, 0, 0, 1),
          up: num(w.up, 0, 0, 1),
          width: num(w.width, 8, 0, 32),
          noise: num(w.noise, 0, 0, 1),
          color: color(w.color, '#c4c4c4'),
          roughness: num(w.roughness, 0.4, 0, 1),
          metalness: num(w.metalness, 0, 0, 1),
        }
      : null,
    glass: gl ? { transmission: num(gl.transmission, 0, 0, 1), ior: num(gl.ior, 1.5, 1, 2.5), thickness: num(gl.thickness, 8, 0, Infinity) } : null,
    blend: bl ? { distance: num(bl.distance, 0, 0, Infinity), noise: num(bl.noise, 0.5, 0, 1), noiseSize: num(bl.noiseSize, 24, 0, Infinity) } : null,
    bevel: num(raw.bevel, 0, 0, 32),
    ...(baked ? { baked } : {}),
  };
}

/** Whether the bytes start like a `.cocoamat` (section 1), without reading the ZIP. */
export function isCocoaMat(b: Uint8Array): boolean {
  if (b.length < 38 + COCOAMAT_MIME.length) return false;
  const ascii = (from: number, n: number) => String.fromCharCode(...b.subarray(from, from + n));
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4 && b[8] === 0 && b[9] === 0 && ascii(30, 8) === 'mimetype' && ascii(38, COCOAMAT_MIME.length) === COCOAMAT_MIME;
}

/** Read and check a `.cocoamat` (sections 3 and 9). A broken file is refused whole, with the reason. */
export async function readCocoaMat(bytes: Uint8Array): Promise<{ ok: true; value: CocoaMat } | { ok: false; error: string }> {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isCocoaMat(bytes)) return fail('This is not a CocoaSuite material file.');
  const zip = await readZip(bytes);
  if (typeof zip === 'string') return fail(zip);
  if (new TextDecoder().decode(zip.get('mimetype')) !== COCOAMAT_MIME) return fail('This is not a CocoaSuite material file.');
  const parse = (name: string): Record<string, unknown> | string => {
    const b = zip.get(name);
    if (!b) return `It has no ${name}.`;
    try {
      const v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as unknown;
      return isObj(v) ? v : `${name} is not an object.`;
    } catch {
      return `${name} is not valid JSON.`;
    }
  };
  const raw = parse('material.json');
  if (typeof raw === 'string') return fail(raw);
  if (raw.format !== COCOAMAT_FORMAT) return fail('material.json is not a CocoaSuite material.');
  const ver = typeof raw.version === 'string' ? /^(\d+)\.(\d+)$/.exec(raw.version) : null;
  if (!ver) return fail('The file has no valid version.');
  if (Number(ver[1]) > Number(COCOAMAT_VERSION.split('.')[0])) return fail(`This material was made by a newer program (format ${raw.version}).`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) return fail('The material has no name.');

  const cat = parse('nodes.json');
  if (typeof cat === 'string') return fail(cat);
  if (cat.format !== 'cocoasuite.material-nodes' || !Array.isArray(cat.nodes) || typeof cat.library !== 'string' || typeof cat.vertexShader !== 'string') return fail('nodes.json is not a node catalog.');
  if (!isNum(cat.version) || cat.version > CATALOG_VERSION) return fail(`The nodes were made by a newer program (catalog ${String(cat.version)}).`);
  const nodes = cat as unknown as Catalog;
  for (const n of nodes.nodes) if (!isObj(n) || typeof n.type !== 'string' || !Array.isArray(n.params) || !Array.isArray(n.inputs) || typeof n.glsl !== 'string') return fail('A node in nodes.json is broken.');
  const byType = new Map<string, CatalogNode>(nodes.nodes.map((n) => [n.type, n]));

  const g = parse('graph.json');
  if (typeof g === 'string') return fail(g);
  if (g.format !== GRAPH_FORMAT) return fail('graph.json is not a material graph.');
  const bad = validateGraph(g, { nodes: (t) => byType.get(t), imagePrefix: 'images/' });
  if (bad) return fail(bad);
  const graph = g as unknown as MatGraph;

  const images = new Map<string, Uint8Array>();
  for (const [name, data] of zip) if (name.startsWith('images/')) images.set(name, data);
  for (const n of graph.nodes)
    for (const p of byType.get(n.type)!.params)
      if (p.kind === 'image') {
        const v = n.params[p.id] ?? p.default;
        if (typeof v === 'string' && v && !images.has(v)) return fail(`The image “${v}” is missing.`);
      }

  if (raw.parameters !== undefined && !Array.isArray(raw.parameters)) return fail('The parameters are broken.');
  const params: Parameter[] = [];
  const ids = new Set<string>();
  for (const q of (raw.parameters ?? []) as unknown[]) {
    if (!isObj(q) || typeof q.id !== 'string' || typeof q.node !== 'string' || typeof q.param !== 'string') return fail('A parameter is broken.');
    if (ids.has(q.id)) return fail('Two parameters have the same id.');
    ids.add(q.id);
    const n = graph.nodes.find((x) => x.id === q.node);
    const p = n && byType.get(n.type)!.params.find((x) => x.id === q.param);
    if (!n || !p) return fail(`The parameter “${String(q.label ?? q.id)}” points at a setting that is not there.`);
    const def = checkValue(p, n.params[p.id] ?? p.default, images);
    const value = q.value === undefined ? def : checkValue(p, q.value, images);
    if (value === undefined) return fail(`The parameter “${String(q.label ?? q.id)}” has a bad value.`);
    const out = { ...q, id: q.id, label: typeof q.label === 'string' ? q.label : p.id, node: q.node, param: q.param, kind: p.kind } as Parameter;
    if (p.kind === 'number' || p.kind === 'int') {
      out.min = p.min;
      out.max = p.max;
      if (p.step !== undefined) out.step = p.step;
    }
    if (p.kind === 'choice') out.options = p.options!.map((o) => o.value);
    out.default = def;
    out.value = value;
    params.push(out);
  }

  const baked = new Map<OutputRole, Uint8Array>();
  for (const r of ROLES) {
    const b = zip.get(`baked/${r}.png`);
    if (b) baked.set(r, b);
  }
  return { ok: true, value: { manifest: fillManifest(raw, params), graph, nodes, images, baked, preview: zip.get('preview.png') ?? null } };
}

/** The graph with the manifest's parameter values in its settings: what gets evaluated (section 2). */
export function evaluable(f: Pick<CocoaMat, 'graph' | 'manifest'>): MatGraph {
  const nodes = f.graph.nodes.map((n) => ({ ...n, params: { ...n.params } }));
  for (const p of f.manifest.parameters) {
    const n = nodes.find((x) => x.id === p.node);
    if (n) n.params[p.param] = p.value as ParamValue;
  }
  return { ...f.graph, nodes };
}

/** Kinds of node the file defines differently from this CocoaWorlds (or that it doesn't have). */
export function changedNodes(f: Pick<CocoaMat, 'nodes'>, own: Catalog = nodeCatalog()): { missing: string[]; different: string[] } {
  const mine = new Map(own.nodes.map((n) => [n.type, n.hash]));
  const missing: string[] = [], different: string[] = [];
  for (const n of f.nodes.nodes) {
    const h = mine.get(n.type);
    if (h === undefined) missing.push(n.type);
    else if (h !== n.hash) different.push(n.type);
  }
  return { missing, different };
}

/**
 * A project material's fields from a manifest (for importing): everything but its id, graph and maps. Values
 * that equal the graph's become no override.
 */
export function materialOf(m: Manifest): Omit<MaterialSource, 'id'> {
  const s = m.surface;
  const overrides: Record<string, unknown> = {};
  for (const p of m.parameters) if (JSON.stringify(p.value) !== JSON.stringify(p.default)) overrides[p.id] = p.value;
  const out: Omit<MaterialSource, 'id'> = {
    name: m.name,
    color: s.color,
    roughness: s.roughness,
    metalness: s.metalness,
    tile: m.tiling.worldSize,
    bakeSize: Math.min(2048, m.evaluation.size),
  };
  if (m.folder) out.folder = m.folder;
  if (m.tiling.mapping !== 'face') out.mapping = m.tiling.mapping;
  if (s.normalStrength !== 1) out.normalStrength = s.normalStrength;
  if (s.emissive !== '#000000' && s.emissiveStrength > 0) {
    out.emissive = s.emissive;
    out.emissiveStrength = s.emissiveStrength;
  }
  if (s.opacity !== 1) out.opacity = s.opacity;
  if (!s.cutout) out.cutout = false;
  if (s.doubleSided) out.doubleSided = true;
  if (s.scroll[0] || s.scroll[1]) out.scroll = [s.scroll[0], s.scroll[1]];
  if (Object.keys(overrides).length) out.overrides = overrides;
  if (m.wear) out.wear = { ...m.wear };
  if (m.bevel) out.bevel = m.bevel;
  if (m.glass && m.glass.transmission > 0) Object.assign(out, { refraction: m.glass.transmission, ior: m.glass.ior, thickness: m.glass.thickness });
  if (m.blend && m.blend.distance > 0) Object.assign(out, { blend: m.blend.distance, blendNoise: m.blend.noise, blendSize: m.blend.noiseSize });
  return out;
}

/** A file name from a material's name: characters not allowed in file names made `_`. */
export function fileStem(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[. ]+|[. ]+$/g, '').trim() || 'material';
}
