import { readZip, writeZip, type ZipEntry } from '@cocoasurface/materials';
import { allLayers } from './layers';
import { CHANNELS, PROJECT_FORMAT, PROJECT_VERSION, TEXTURE_SIZES, type Layer, type Project } from './model';

export const PROJECT_MIME = 'application/vnd.cocoasuite.surface+zip';
export const PROJECT_EXT = 'cocoasurf';

export interface ProjectFile {
  project: Project;
  /** Every other entry by path: the model, library materials (`materials/…`) and pixels (`pixels/…`). */
  files: Map<string, Uint8Array>;
}

export const pixelPath = (layer: string, channel: string) => `pixels/${layer}/${channel}.png`;

const enc = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v, null, 2)}\n`);

export function writeProject(f: ProjectFile): Promise<Uint8Array> {
  const entries: ZipEntry[] = [
    { name: 'mimetype', data: new TextEncoder().encode(PROJECT_MIME) },
    { name: 'project.json', data: enc(f.project), deflate: true },
  ];
  for (const [name, data] of f.files) entries.push({ name, data, deflate: !/\.(png|jpe?g|cocoamat|glb)$/i.test(name) });
  return writeZip(entries);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkLayer(l: unknown): string | null {
  if (!isObj(l) || typeof l.id !== 'string' || typeof l.name !== 'string') return 'A layer is broken.';
  if (l.kind !== 'paint' && l.kind !== 'fill' && l.kind !== 'group') return `The layer “${l.name}” is of an unknown kind.`;
  if (!Array.isArray(l.channels) || l.channels.some((c) => !CHANNELS.some((x) => x.id === c))) return `The layer “${l.name}” has unknown channels.`;
  if (l.kind === 'group') {
    if (!Array.isArray(l.children)) return `The group “${l.name}” is broken.`;
    for (const c of l.children) {
      const bad = checkLayer(c);
      if (bad) return bad;
    }
  }
  if (l.kind === 'fill' && !isObj(l.flat)) return `The fill layer “${l.name}” is broken.`;
  return null;
}

export async function readProject(bytes: Uint8Array): Promise<{ ok: true; value: ProjectFile } | { ok: false; error: string }> {
  const fail = (error: string) => ({ ok: false as const, error });
  const zip = await readZip(bytes);
  if (typeof zip === 'string') return fail('This is not a CocoaSurface project.');
  if (new TextDecoder().decode(zip.get('mimetype')) !== PROJECT_MIME) return fail('This is not a CocoaSurface project.');
  let p: unknown;
  try {
    p = JSON.parse(new TextDecoder().decode(zip.get('project.json')));
  } catch {
    return fail('The project description is unreadable.');
  }
  if (!isObj(p) || p.format !== PROJECT_FORMAT) return fail('The project description is unreadable.');
  if (typeof p.version !== 'number' || p.version > PROJECT_VERSION) return fail('This project was saved by a newer CocoaSurface.');
  if (!Array.isArray(p.textureSets) || !Array.isArray(p.library)) return fail('The project description is broken.');
  const ids = new Set<string>();
  for (const s of p.textureSets as unknown[]) {
    if (!isObj(s) || typeof s.id !== 'string' || !Array.isArray(s.layers) || !Array.isArray(s.slots)) return fail('A texture set is broken.');
    if (!TEXTURE_SIZES.includes(s.size as never)) return fail(`The texture set “${String(s.name)}” has an unsupported size.`);
    for (const l of s.layers) {
      const bad = checkLayer(l);
      if (bad) return fail(bad);
    }
    for (const l of allLayers(s.layers as Layer[])) {
      if (ids.has(l.id)) return fail('Two layers have the same id.');
      ids.add(l.id);
    }
  }
  const project = p as unknown as Project;
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of zip) if (name !== 'mimetype' && name !== 'project.json') files.set(name, data);
  if (project.model && !files.has(project.model.file)) return fail(`The model “${project.model.name}” is missing from the project.`);
  for (const m of project.library) if (!files.has(m.file)) return fail(`The material “${m.name}” is missing from the project.`);
  return { ok: true, value: { project, files } };
}
