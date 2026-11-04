/**
 * The graph of a Cocoa Materials material (decision C3: one `.cwmat` file per graph material). Plain JSON:
 * nodes with their settings and positions, and links from a node's output to another node's input. Every
 * node has one output; an input takes at most one link. Output nodes (Colour, Height, Normal …) say which map
 * of the material they make.
 */
import { NODES, nodeDef, nodeDef as nodeOf, type NodeDef, type OutputRole, type ParamValue, type RampStop } from './nodes';

export const GRAPH_FORMAT = 'cocoaworlds.material';
export const GRAPH_VERSION = 1;

export interface GraphNode {
  id: string;
  type: string;
  /** Where it sits in the editor. */
  x: number;
  y: number;
  /** Settings that differ from the node's defaults (others are left out). */
  params: Record<string, ParamValue>;
}

export interface GraphLink {
  /** The node whose output this is. */
  from: string;
  /** The node and the input it goes into. */
  to: string;
  input: string;
}

export interface MatGraph {
  format: typeof GRAPH_FORMAT;
  version: typeof GRAPH_VERSION;
  nodes: GraphNode[];
  links: GraphLink[];
  /**
   * Exposed settings: node settings each material using the graph can set for itself (“brick colour”, “wear”),
   * so one graph makes a family of materials (variants). Missing: none.
   */
  exposed?: Exposed[];
}

export interface Exposed {
  id: string;
  node: string;
  param: string;
  /** What materials call it. */
  label: string;
}

/** Expose a node's setting (once). */
export function expose(g: MatGraph, node: string, param: string, label: string): MatGraph {
  if ((g.exposed ?? []).some((e) => e.node === node && e.param === param)) return g;
  return { ...g, exposed: [...(g.exposed ?? []), { id: nodeId(), node, param, label }] };
}

export function unexpose(g: MatGraph, node: string, param: string): MatGraph {
  const exposed = (g.exposed ?? []).filter((e) => !(e.node === node && e.param === param));
  return { ...g, exposed };
}

/** Exposed settings whose node and setting still exist. */
export function exposedOf(g: MatGraph): Exposed[] {
  return (g.exposed ?? []).filter((e) => {
    const n = g.nodes.find((x) => x.id === e.node);
    return !!n && !!nodeDef(n.type)?.params.some((p) => p.id === e.param);
  });
}

/** The graph as a material using it sees it: its own values for exposed settings in place of the graph's. */
export function withOverrides(g: MatGraph, overrides: Record<string, unknown> | undefined): MatGraph {
  if (!overrides || !Object.keys(overrides).length) return g;
  let out = g;
  for (const e of exposedOf(g)) if (overrides[e.id] !== undefined) out = setParam(out, e.node, e.param, overrides[e.id] as ParamValue);
  return out;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function nodeId(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return s;
}

export function newNode(type: string, x = 0, y = 0, params: Record<string, ParamValue> = {}): GraphNode {
  if (!nodeDef(type)) throw new Error(`Unknown node “${type}”.`);
  return { id: nodeId(), type, x, y, params };
}

/** A node's settings with the defaults filled in. */
export function paramsOf(n: GraphNode): Record<string, ParamValue> {
  const def = nodeDef(n.type);
  const out: Record<string, ParamValue> = {};
  for (const p of def?.params ?? []) out[p.id] = n.params[p.id] ?? p.default;
  return out;
}

/**
 * A graph to start from: a stone-like surface. Noise makes the height; a gradient map colours it; the height
 * also gives the bumps; roughness is a flat value. Every map is wired, so the result shows straight away.
 */
export function newGraph(): MatGraph {
  const noise = newNode('noise', 0, 190, { scale: 4, octaves: 6 });
  const colour = newNode('gradientMap', 220, 0, {
    ramp: [
      { at: 0, color: '#4a4640' },
      { at: 0.55, color: '#8a8378' },
      { at: 1, color: '#c9c1b2' },
    ],
  });
  const normal = newNode('normal', 220, 220);
  const rough = newNode('value', 220, 440, { value: 0.8 });
  const outColour = newNode('outColor', 440, 20);
  const outHeight = newNode('outHeight', 440, 150);
  const outNormal = newNode('outNormal', 440, 280);
  const outRough = newNode('outRoughness', 440, 410);
  return {
    format: GRAPH_FORMAT,
    version: GRAPH_VERSION,
    nodes: [noise, colour, normal, rough, outColour, outHeight, outNormal, outRough],
    links: [
      { from: noise.id, to: colour.id, input: 'in' },
      { from: noise.id, to: normal.id, input: 'in' },
      { from: colour.id, to: outColour.id, input: 'in' },
      { from: noise.id, to: outHeight.id, input: 'in' },
      { from: normal.id, to: outNormal.id, input: 'in' },
      { from: rough.id, to: outRough.id, input: 'in' },
    ],
  };
}

/** Whether linking `from` into `to` would make a loop (a node feeding itself). */
export function wouldLoop(g: MatGraph, from: string, to: string): boolean {
  if (from === to) return true;
  // Is `from` downstream of `to`?
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const l of g.links) if (l.from === id) stack.push(l.to);
  }
  return false;
}

/** Link `from` into input `input` of `to`, replacing what was there. Unchanged if it would make a loop. */
export function connect(g: MatGraph, from: string, to: string, input: string): MatGraph {
  const a = g.nodes.find((n) => n.id === from), b = g.nodes.find((n) => n.id === to);
  if (!a || !b || !nodeDef(a.type)?.output || !nodeDef(b.type)?.inputs.some((p) => p.id === input) || wouldLoop(g, from, to)) return g;
  return { ...g, links: [...g.links.filter((l) => !(l.to === to && l.input === input)), { from, to, input }] };
}

export function disconnect(g: MatGraph, to: string, input: string): MatGraph {
  return { ...g, links: g.links.filter((l) => !(l.to === to && l.input === input)) };
}

/** Take nodes out, with their links. */
export function removeNodes(g: MatGraph, ids: Iterable<string>): MatGraph {
  const gone = new Set(ids);
  return { ...g, nodes: g.nodes.filter((n) => !gone.has(n.id)), links: g.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)), ...(g.exposed ? { exposed: g.exposed.filter((e) => !gone.has(e.node)) } : {}) };
}

export function setParam(g: MatGraph, id: string, key: string, value: ParamValue): MatGraph {
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      if (n.id !== id) return n;
      const def = nodeDef(n.type)?.params.find((p) => p.id === key);
      const params = { ...n.params };
      // (Defaults are left out of the file.)
      if (def && JSON.stringify(def.default) === JSON.stringify(value)) delete params[key];
      else params[key] = value;
      return { ...n, params };
    }),
  };
}

/** Nodes in an order where every node comes after the nodes feeding it. */
export function evaluationOrder(g: MatGraph): GraphNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out: GraphNode[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (n: GraphNode) => {
    const s = state.get(n.id);
    if (s === 2) return;
    if (s === 1) return; // (A loop: can't happen in a valid graph.)
    state.set(n.id, 1);
    for (const l of g.links) if (l.to === n.id) {
      const src = byId.get(l.from);
      if (src) visit(src);
    }
    state.set(n.id, 2);
    out.push(n);
  };
  for (const n of g.nodes) visit(n);
  return out;
}

/**
 * A fingerprint of what each node's picture depends on (its kind, settings and everything feeding it), so only
 * nodes whose fingerprint changed are drawn again.
 */
export function fingerprints(g: MatGraph, extra: (n: GraphNode) => string = () => ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of evaluationOrder(g)) {
    const ins = g.links
      .filter((l) => l.to === n.id)
      .map((l) => `${l.input}<${out.get(l.from) ?? ''}>`)
      .sort()
      .join(',');
    out.set(n.id, `${n.type}${JSON.stringify(paramsOf(n))}${extra(n)}[${ins}]`);
  }
  return out;
}

/** The node making each map of the material (the first of each kind, when there are several). */
export function outputNodes(g: MatGraph): Map<OutputRole, GraphNode> {
  const out = new Map<OutputRole, GraphNode>();
  for (const n of g.nodes) {
    const role = nodeDef(n.type)?.role;
    if (role && !out.has(role) && g.links.some((l) => l.to === n.id)) out.set(role, n);
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRamp = (v: unknown): v is RampStop[] =>
  Array.isArray(v) && v.length >= 1 && v.length <= 8 && v.every((s) => isObj(s) && typeof s.at === 'number' && s.at >= 0 && s.at <= 1 && typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color));

/** What validation needs to know of a kind of node (a `NodeDef`, or a node from a file's own catalog). */
export interface NodeShape {
  label: { en: string };
  inputs: { id: string }[];
  output: unknown;
  params: { id: string; kind: NodeDef['params'][number]['kind']; options?: { value: string }[] }[];
}

function paramOk(def: NodeShape, key: string, v: unknown, imagePrefix: string): boolean {
  const p = def.params.find((x) => x.id === key);
  if (!p) return false;
  switch (p.kind) {
    case 'number':
    case 'int':
    case 'seed':
      return typeof v === 'number' && Number.isFinite(v);
    case 'choice':
      return typeof v === 'string' && !!p.options?.some((o) => o.value === v);
    case 'color':
      return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    case 'bool':
      return typeof v === 'boolean';
    case 'ramp':
      return isRamp(v);
    case 'image':
      return typeof v === 'string' && (v === '' || v.startsWith(imagePrefix));
  }
}

/**
 * What's wrong with a graph read from a file, or null when it is fine. By default against CocoaWorlds' own
 * nodes, with images in the project; a `.cocoamat` is checked against its own nodes, with images inside it.
 */
export function validateGraph(g: unknown, opts: { nodes?: (type: string) => NodeShape | undefined; imagePrefix?: string } = {}): string | null {
  const nodeDef = opts.nodes ?? ((t: string) => nodeOf(t));
  const imagePrefix = opts.imagePrefix ?? 'assets/textures/';
  if (!isObj(g) || g.format !== GRAPH_FORMAT) return 'This is not a Cocoa Materials graph.';
  if (g.version !== GRAPH_VERSION) return `This graph was made by a newer version (format ${String(g.version)}).`;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.links)) return 'The graph has no nodes or links.';
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (!isObj(n) || typeof n.id !== 'string' || !n.id) return 'A node has no id.';
    if (ids.has(n.id)) return 'Two nodes have the same id.';
    ids.add(n.id);
    const def = typeof n.type === 'string' ? nodeDef(n.type) : undefined;
    if (!def) return `Unknown node “${String(n.type)}”.`;
    if (typeof n.x !== 'number' || typeof n.y !== 'number') return `The ${def.label.en} node has no position.`;
    if (!isObj(n.params)) return `The ${def.label.en} node has no settings.`;
    for (const [k, v] of Object.entries(n.params)) if (!paramOk(def, k, v, imagePrefix)) return `The ${def.label.en} node has a bad setting “${k}”.`;
  }
  const taken = new Set<string>();
  const nodes = g.nodes as GraphNode[];
  for (const l of g.links) {
    if (!isObj(l) || typeof l.from !== 'string' || typeof l.to !== 'string' || typeof l.input !== 'string') return 'A link is broken.';
    const a = nodes.find((n) => n.id === l.from), b = nodes.find((n) => n.id === l.to);
    if (!a || !b) return 'A link points at a node that is not there.';
    if (!nodeDef(a.type)!.output) return 'A link starts at a node with no output.';
    if (!nodeDef(b.type)!.inputs.some((p) => p.id === l.input)) return `The ${nodeDef(b.type)!.label.en} node has no input “${l.input}”.`;
    const key = `${l.to}:${l.input}`;
    if (taken.has(key)) return 'An input has two links.';
    taken.add(key);
  }
  if (g.exposed !== undefined) {
    if (!Array.isArray(g.exposed)) return 'The exposed settings are broken.';
    for (const e of g.exposed) if (!isObj(e) || typeof e.id !== 'string' || typeof e.node !== 'string' || typeof e.param !== 'string' || typeof e.label !== 'string') return 'An exposed setting is broken.';
  }
  const graph = g as unknown as MatGraph;
  for (const l of graph.links) if (wouldLoop({ ...graph, links: graph.links.filter((x) => x !== l) }, l.from, l.to)) return 'The graph loops back on itself.';
  return null;
}

export { NODES };
