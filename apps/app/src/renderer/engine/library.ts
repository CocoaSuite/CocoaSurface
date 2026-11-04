import * as THREE from 'three';
import { changedNodes, evaluable, GraphEvaluator, outputNodes, readCocoaMat, type CocoaMat, type MatGraph, type OutputRole } from '@cocoasurface/materials';

export interface LoadedMaterial {
  id: string;
  file: CocoaMat;
  bytes: Uint8Array;
  /** Node kinds this CocoaSurface doesn't know, or knows differently from the file. */
  unknown: string[];
  thumb: string | null;
}

export type RoleTextures = Map<OutputRole, THREE.DataTexture>;

let gl: WebGL2RenderingContext | null = null;
function context(): WebGL2RenderingContext {
  if (!gl) {
    gl = document.createElement('canvas').getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })!;
    if (!gl) throw new Error('WebGL 2 is not available.');
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
  }
  return gl;
}

export async function parseMaterial(id: string, bytes: Uint8Array): Promise<LoadedMaterial> {
  const r = await readCocoaMat(bytes);
  if (!r.ok) throw new Error(r.error);
  const ch = changedNodes(r.value);
  const m: LoadedMaterial = { id, file: r.value, bytes, unknown: [...ch.missing, ...ch.different], thumb: null };
  const pic = r.value.preview ?? r.value.baked.get('color');
  if (pic) m.thumb = URL.createObjectURL(new Blob([pic as BlobPart], { type: 'image/png' }));
  else
    try {
      const px = (await evaluateMaps(m, {}, 96)).get('color');
      if (px) {
        const c = document.createElement('canvas');
        c.width = c.height = 96;
        c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), 96, 96), 0, 0);
        m.thumb = c.toDataURL();
      }
    } catch {
      /* no picture */
    }
  return m;
}

/** The graph with these values in its exposed settings. */
export function graphWith(m: LoadedMaterial, values: Record<string, unknown>): MatGraph {
  const manifest = { ...m.file.manifest, parameters: m.file.manifest.parameters.map((p) => (p.id in values ? { ...p, value: values[p.id] } : p)) };
  return evaluable({ graph: m.file.graph, manifest });
}

const evaluators = new Map<string, GraphEvaluator>();
const bitmaps = new Map<string, Promise<ImageBitmap>>();

function evaluatorFor(m: LoadedMaterial): GraphEvaluator {
  let ev = evaluators.get(m.id);
  if (!ev) {
    ev = new GraphEvaluator(context(), {
      loadImage: (path) => {
        const key = `${m.id}:${path}`;
        if (!bitmaps.has(key)) {
          const b = m.file.images.get(path);
          bitmaps.set(key, b ? createImageBitmap(new Blob([b as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }) : Promise.reject(new Error('missing')));
        }
        return bitmaps.get(key)!;
      },
    });
    evaluators.set(m.id, ev);
  }
  return ev;
}

export function forgetMaterial(id: string): void {
  evaluators.get(id)?.dispose();
  evaluators.delete(id);
  for (const k of bitmaps.keys()) if (k.startsWith(`${id}:`)) bitmaps.delete(k);
}

/** Evaluate on the graphics card; maps as RGBA bytes, top row first (row 0 at v = 0, as the graph sees it). */
export async function evaluateMaps(m: LoadedMaterial, values: Record<string, unknown>, size: number): Promise<Map<OutputRole, Uint8Array>> {
  const g = graphWith(m, values);
  const ev = evaluatorFor(m);
  ev.evaluate(g, size);
  if (m.file.images.size) {
    await Promise.all([...bitmaps.entries()].filter(([k]) => k.startsWith(`${m.id}:`)).map(([, p]) => p.catch(() => null)));
    await new Promise((r) => setTimeout(r, 0));
    ev.evaluate(g, size);
  }
  const out = new Map<OutputRole, Uint8Array>();
  for (const [role, n] of outputNodes(g)) {
    const px = ev.read(n.id);
    if (px) out.set(role, px);
  }
  return out;
}

export function toTextures(maps: Map<OutputRole, Uint8Array>, size: number): RoleTextures {
  const out: RoleTextures = new Map();
  for (const [role, px] of maps) {
    const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    out.set(role, t);
  }
  return out;
}
