import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Part {
  mesh: THREE.Mesh;
  /** Slot name of each material index of the mesh. */
  slots: string[];
}

export interface LoadedModel {
  name: string;
  root: THREE.Group;
  parts: Part[];
  slots: string[];
  /** Texture v goes up the picture (OBJ, FBX, USD) rather than down it (glTF). */
  vUp: boolean;
  warnings: string[];
  triangles: number;
  /** How the file was moved and scaled into view (a high-poly model uses the same). */
  fit: { centre: THREE.Vector3; scale: number };
}

export const MODEL_EXTENSIONS = ['fbx', 'obj', 'glb', 'gltf', 'usdz'];

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

async function parse(ext: string, bytes: Uint8Array): Promise<THREE.Object3D> {
  switch (ext) {
    case 'obj':
      return new OBJLoader().parse(new TextDecoder().decode(bytes));
    case 'fbx':
      return new FBXLoader().parse(ab(bytes), '');
    case 'glb':
    case 'gltf':
      return (await new GLTFLoader().parseAsync(ab(bytes), '')).scene;
    case 'usdz':
      return new USDLoader().parse(ab(bytes), '') as THREE.Object3D;
  }
  throw new Error(`CocoaSurface can't open .${ext} files.`);
}

export async function loadModel(name: string, bytes: Uint8Array, fit?: LoadedModel['fit']): Promise<LoadedModel> {
  const ext = name.split('.').pop()!.toLowerCase();
  let src: THREE.Object3D;
  try {
    src = await parse(ext, bytes);
  } catch (e) {
    throw new Error(ext === 'gltf' ? 'This .gltf file needs files beside it. Save it as .glb and try again.' : `The model could not be read: ${(e as Error).message}`);
  }
  src.updateMatrixWorld(true);
  const noNormals = ext === 'obj' && !/^vn\s/m.test(new TextDecoder().decode(bytes));
  const root = new THREE.Group();
  root.name = name;
  const parts: Part[] = [];
  const slots: string[] = [];
  const warnings: string[] = [];
  let unnamed = 0;
  let triangles = 0;
  const named = new Map<THREE.Material, string>();
  const slotOf = (m: THREE.Material) => {
    if (!named.has(m)) named.set(m, m.name?.trim() || `Material ${++unnamed}`);
    const s = named.get(m)!;
    if (!slots.includes(s)) slots.push(s);
    return s;
  };

  src.traverse((o) => {
    const src = o as THREE.Mesh;
    if (!src.isMesh || (src as unknown as THREE.Points).isPoints) return;
    let g = src.geometry.clone();
    g.applyMatrix4(src.matrixWorld);
    for (const k of ['skinIndex', 'skinWeight']) g.deleteAttribute(k);
    g.morphAttributes = {};
    if (noNormals || !g.getAttribute('normal')) {
      g.deleteAttribute('normal');
      // No normals in the file: smooth across shared corners, as sculpting tools expect.
      const groups = g.groups;
      g = mergeVertices(g);
      if (groups.length && !g.groups.length) for (const x of groups) g.addGroup(x.start, x.count, x.materialIndex);
      g.computeVertexNormals();
    }
    const mats = Array.isArray(src.material) ? src.material : [src.material];
    const meshSlots = mats.map(slotOf);
    if (!g.getAttribute('uv')) warnings.push(`“${src.name || 'A mesh'}” has no texture coordinates (UVs) and can't be painted.`);
    if (!g.groups.length) g.addGroup(0, g.index ? g.index.count : g.getAttribute('position').count, 0);
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    const mesh = new THREE.Mesh(g, []);
    mesh.name = src.name;
    parts.push({ mesh, slots: meshSlots });
    root.add(mesh);
  });
  if (!parts.length) throw new Error('The file has no meshes.');

  const box = new THREE.Box3().setFromObject(root);
  const centre = fit?.centre ?? box.getCenter(new THREE.Vector3());
  const s = fit?.scale ?? 2 / (box.getSize(new THREE.Vector3()).length() || 1);
  for (const p of parts) {
    p.mesh.geometry.translate(-centre.x, -centre.y, -centre.z);
    p.mesh.geometry.scale(s, s, s);
    p.mesh.geometry.computeBoundingSphere();
    p.mesh.geometry.computeBoundingBox();
  }
  return { name, root, parts, slots, vUp: ext !== 'glb' && ext !== 'gltf', warnings, triangles, fit: { centre, scale: s } };
}
