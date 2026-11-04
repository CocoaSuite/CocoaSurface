/**
 * The node catalog: every kind of node, written out as data, for other programs to evaluate graphs the way
 * CocoaWorlds does (CocoaSurface reads `.cocoamat` files natively: see docs/cocoamat-format.md). It is made from
 * the node set itself, so it can't drift from it. `docs/cocoamat/nodes.json` and `docs/cocoamat/nodes.md` are
 * written from here (`CW_WRITE_CATALOG=1 npx vitest run packages/materials/test/catalog.test.ts`), and a test
 * checks they are current.
 */
import { GRAPH_FORMAT, GRAPH_VERSION } from './graph';
import { NODES, type NodeDef, type Param } from './nodes';
import { LIBRARY, VERTEX_SHADER, fragmentShader } from './shader';

/** The catalog's own format version: a reader that knows version 1 knows how to read every entry below. */
export const CATALOG_VERSION = 1;

export interface CatalogParam {
  id: string;
  kind: Param['kind'];
  label: { en: string; ru: string };
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  /** For `choice`: the values in order. The shader gets the chosen value's index (0, 1, 2 …) as a float. */
  options?: { value: string; label: { en: string; ru: string } }[];
}

export interface CatalogNode {
  type: string;
  group: NodeDef['group'];
  label: { en: string; ru: string };
  hint: { en: string; ru: string };
  inputs: { id: string; kind: 'grey' | 'color'; label: { en: string; ru: string }; fallback: [number, number, number] }[];
  /** What it makes ('grey' or 'color'), or null for an output node. */
  output: NodeDef['output'];
  /** For output nodes: which map of the material. */
  role?: string;
  params: CatalogParam[];
  /** The body of the node's fragment program (the normative definition of what it does). */
  glsl: string;
  /** FNV-1a (32-bit, hex) of the node's whole fragment program: equal hashes mean the node does the same thing. */
  hash: string;
}

export interface Catalog {
  format: 'cocoasuite.material-nodes';
  version: typeof CATALOG_VERSION;
  /** The graph format the catalog's nodes are used in. */
  graph: { format: typeof GRAPH_FORMAT; version: typeof GRAPH_VERSION };
  /** GLSL ES 3.00 shared by every node program (noise, cells, curves, colour conversions). */
  library: string;
  vertexShader: string;
  nodes: CatalogNode[];
}

/** FNV-1a, 32-bit, as 8 hex digits. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function param(p: Param): CatalogParam {
  const out: CatalogParam = { id: p.id, kind: p.kind, label: p.label, default: p.default };
  if (p.kind === 'number') {
    out.min = p.min;
    out.max = p.max;
    if (p.step !== undefined) out.step = p.step;
  } else if (p.kind === 'int') {
    out.min = p.min;
    out.max = p.max;
  } else if (p.kind === 'choice') out.options = p.options;
  return out;
}

/** Every node, as data. */
export function nodeCatalog(): Catalog {
  return {
    format: 'cocoasuite.material-nodes',
    version: CATALOG_VERSION,
    graph: { format: GRAPH_FORMAT, version: GRAPH_VERSION },
    library: LIBRARY,
    vertexShader: VERTEX_SHADER,
    nodes: NODES.map((n) => ({
      type: n.type,
      group: n.group,
      label: n.label,
      hint: n.hint,
      inputs: n.inputs.map((i) => ({ id: i.id, kind: i.kind, label: i.label, fallback: i.fallback ?? [0, 0, 0] })),
      output: n.output,
      ...(n.role ? { role: n.role } : {}),
      params: n.params.map(param),
      glsl: n.glsl,
      hash: fnv1a(fragmentShader(n.type)),
    })),
  };
}

const range = (p: CatalogParam): string => {
  if (p.kind === 'number' || p.kind === 'int') return `${p.min} – ${p.max}${p.step ? ` (step ${p.step})` : ''}`;
  if (p.kind === 'choice') return p.options!.map((o, i) => `${i} \`${o.value}\``).join(', ');
  if (p.kind === 'seed') return 'any whole number';
  if (p.kind === 'ramp') return '1–8 stops';
  if (p.kind === 'image') return 'image path';
  return '';
};
const shown = (v: unknown): string => (typeof v === 'string' ? `\`${v || '""'}\`` : `\`${JSON.stringify(v)}\``);
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The catalog as a page for people (docs/cocoamat/nodes.md). */
export function catalogMarkdown(c: Catalog = nodeCatalog()): string {
  const out: string[] = [
    '# Cocoa Materials node reference',
    '',
    '<!-- Written from packages/materials/src/catalog.ts. Do not edit by hand: run',
    '     CW_WRITE_CATALOG=1 npx vitest run packages/materials/test/catalog.test.ts -->',
    '',
    `Catalog version ${c.version}, for graph format \`${c.graph.format}\` version ${c.graph.version}. ${c.nodes.length} nodes.`,
    'How a node is evaluated (uniforms, inputs, uv) is in [the format spec](../cocoamat-format.md), section 5;',
    'the same data as JSON, with the shared GLSL library, is in [nodes.json](nodes.json).',
    '',
  ];
  const groups = [...new Set(c.nodes.map((n) => n.group))];
  for (const g of groups) {
    out.push(`## ${g[0]!.toUpperCase()}${g.slice(1)}`, '');
    for (const n of c.nodes.filter((x) => x.group === g)) {
      out.push(`### ${n.label.en} — \`${n.type}\``, '', cell(n.hint.en), '');
      out.push(`Makes: ${n.output ?? `nothing (output node: the material's \`${n.role}\` map)`} · hash \`${n.hash}\``, '');
      if (n.inputs.length) {
        out.push('| Input | Reads as | Unlinked |', '|---|---|---|');
        for (const i of n.inputs) out.push(`| \`${i.id}\` (${cell(i.label.en)}) | ${i.kind} | ${i.fallback.join(', ')} |`);
        out.push('');
      }
      if (n.params.length) {
        out.push('| Setting | Kind | Range | Default |', '|---|---|---|---|');
        for (const p of n.params) out.push(`| \`${p.id}\` (${cell(p.label.en)}) | ${p.kind} | ${cell(range(p))} | ${cell(shown(p.default))} |`);
        out.push('');
      }
      out.push('```glsl', n.glsl, '```', '');
    }
  }
  return out.join('\n');
}
