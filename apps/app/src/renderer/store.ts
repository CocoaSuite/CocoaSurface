import { create } from 'zustand';
import { findLayer, type Channel, type Layer, type BakeSettings, type MeshMap, type Project, type TextureSet } from '@cocoasurface/project';
import type { LoadedMaterial } from './engine/library';

export type Tool = 'paint' | 'erase' | 'fill' | 'smudge' | 'blur' | 'picker';
export type ViewMode = 'material' | 'mask' | Channel | `mesh:${MeshMap}` | 'bake:skew' | 'bake:offset';

export interface Brush {
  size: number;
  flow: number;
  opacity: number;
  hardness: number;
  spacing: number;
  color: string;
  roughness: number;
  metalness: number;
  height: number;
  glow: string;
  /** What a brush paints into a mask: 1 white (shows), 0 black (hides). */
  maskValue: number;
  shape: 'round' | 'square' | 'image';
  /** Degrees. */
  angle: number;
  /** Picture used as the tip when the shape is 'image' (kept for the session, not in the project). */
  alpha: string | null;
  /** What pen pressure changes. */
  pressure: 'none' | 'size' | 'flow' | 'both';
  /** Lazy-mouse distance in screen pixels; 0 is off. */
  stabilize: number;
  /** The fill tool fills a UV island or the whole mesh. */
  fillBy: 'island' | 'mesh';
  /** Channels the brush leaves alone. */
  off: Channel[];
}

/** A picture the brush paints through, placed on the screen. */
export interface Stencil {
  name: string;
  /** Height over width of the picture. */
  aspect: number;
  /** Centre, as a share of the viewport. */
  x: number;
  y: number;
  /** Width as a share of the viewport's width. */
  scale: number;
  /** Degrees. */
  angle: number;
  on: boolean;
}

export interface View {
  mode: ViewMode;
  wire: boolean;
  ortho: boolean;
  /** Show the texture laid out flat instead of the model. */
  flat: boolean;
  grid: boolean;
  light: number;
  turn: number;
  /** Show the bake cage of the current texture set. */
  cage: boolean;
  /** What lights the model. */
  env: Environment;
  /** Show the environment behind the model instead of the plain background. */
  showEnv: boolean;
  /** Extra lights in the viewport, for previewing (not saved, not baked). */
  lights?: ViewLight[];
}

export interface ViewLight {
  id: string;
  kind: 'sun' | 'point' | 'spot';
  color: string;
  strength: number;
  /** Direction from the model's centre, in degrees. */
  turn: number;
  height: number;
  /** Point and spot: distance from the centre, in model radii. */
  distance: number;
  /** Spot: cone angle in degrees. */
  cone: number;
  shadows: boolean;
  on: boolean;
}

export type Environment = 'studio' | 'sunset' | 'day';
export const ENVIRONMENTS: { value: Environment; label: string }[] = [
  { value: 'studio', label: 'Studio' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'day', label: 'Clear day' },
];

interface State {
  project: Project | null;
  path: string | null;
  dirty: boolean;
  setId: string | null;
  layerId: string | null;
  /** The mask item being edited, if the mask rather than the layer is selected. */
  maskItem: string | null;
  /** The layer effect being edited. */
  effect: string | null;
  stencil: Stencil | null;
  /** The channel whose blend and opacity the layer list shows and edits; null for the whole layer. */
  stackChannel: Channel | null;
  tool: Tool;
  brush: Brush;
  symmetry: boolean;
  /** Painting the bake's skew or offset map instead of layers. */
  bakePaint: 'skew' | 'offset' | null;
  bakeValue: number;
  /** Bake settings being edited, so the cage shown follows them. */
  cagePreview: BakeSettings | null;
  /** Placing bake lights in the viewport, with the Bake dialog's settings kept for when it opens again. */
  lightEdit: BakeSettings | null;
  lightSel: string | null;
  view: View;
  materials: Record<string, LoadedMaterial>;
  warnings: string[];
  toast: { text: string; n: number } | null;
  busy: string | null;
  /** A long job that can be stopped: its label, share done (0–1), and how to stop it. */
  job: { label: string; share: number; cancel: () => void } | null;
  history: { undo: string | null; redo: string | null };
}

export const useApp = create<State>(() => ({
  project: null,
  path: null,
  dirty: false,
  setId: null,
  layerId: null,
  maskItem: null,
  effect: null,
  stencil: null,
  stackChannel: null,
  tool: 'paint',
  brush: { size: 60, flow: 0.8, opacity: 1, hardness: 0.6, spacing: 0.15, color: '#c8b49a', roughness: 0.5, metalness: 0, height: 0.6, glow: '#000000', maskValue: 1, shape: 'round', angle: 0, alpha: null, pressure: 'size', stabilize: 0, fillBy: 'island', off: [] },
  symmetry: false,
  bakePaint: null,
  bakeValue: 1,
  cagePreview: null,
  lightEdit: null,
  lightSel: null,
  view: { mode: 'material', wire: false, ortho: false, flat: false, grid: true, light: 1, turn: 0, cage: false, env: 'studio', showEnv: false },
  materials: {},
  warnings: [],
  toast: null,
  busy: null,
  job: null,
  history: { undo: null, redo: null },
}));

export const get = () => useApp.getState();
export const set = useApp.setState;

useApp.subscribe((s, p) => {
  if (s.effect && s !== p && (s.maskItem || !currentLayer(s)?.effects?.some((e) => e.id === s.effect))) set({ effect: null });
});

export function toast(text: string): void {
  set((s) => ({ toast: { text, n: (s.toast?.n ?? 0) + 1 } }));
}

export function currentSet(s = get()): TextureSet | null {
  return s.project?.textureSets.find((t) => t.id === s.setId) ?? null;
}

export function currentLayer(s = get()): Layer | null {
  const t = currentSet(s);
  return t && s.layerId ? findLayer(t.layers, s.layerId) : null;
}

// Undo history: one entry per finished gesture.

interface Entry {
  label: string;
  undo(): void;
  redo(): void;
  drop?(): void;
}

const LIMIT = 80;
let done: Entry[] = [];
let undone: Entry[] = [];

function sync(): void {
  set({ history: { undo: done.at(-1)?.label ?? null, redo: undone.at(-1)?.label ?? null } });
}

export function push(e: Entry): void {
  done.push(e);
  for (const u of undone) u.drop?.();
  undone = [];
  while (done.length > LIMIT) done.shift()!.drop?.();
  set({ dirty: true });
  sync();
}

export function undo(): void {
  const e = done.pop();
  if (!e) return;
  e.undo();
  undone.push(e);
  set({ dirty: true });
  sync();
  toast(`Undid: ${e.label}`);
}

export function redo(): void {
  const e = undone.pop();
  if (!e) return;
  e.redo();
  done.push(e);
  set({ dirty: true });
  sync();
  toast(`Redid: ${e.label}`);
}

export function clearHistory(): void {
  for (const e of [...done, ...undone]) e.drop?.();
  done = [];
  undone = [];
  sync();
}

function restore(p: Project): void {
  const s = get();
  const setId = p.textureSets.some((t) => t.id === s.setId) ? s.setId : (p.textureSets[0]?.id ?? null);
  const ts = p.textureSets.find((t) => t.id === setId);
  set({ project: p, setId, layerId: ts && s.layerId && findLayer(ts.layers, s.layerId) ? s.layerId : null });
}

/** Change the project as one undo step. */
export function edit(label: string, f: (p: Project) => Project): void {
  const before = get().project;
  if (!before) return;
  const after = f(before);
  if (after === before) return;
  set({ project: after });
  push({ label, undo: () => restore(before), redo: () => restore(after) });
}

let liveBase: Project | null = null;

/** Change the project while a gesture is in progress (a slider being dragged); `commit` makes it one step. */
export function live(f: (p: Project) => Project): void {
  const p = get().project;
  if (!p) return;
  liveBase ??= p;
  set({ project: f(p) });
}

export function commit(label: string): void {
  const before = liveBase;
  liveBase = null;
  const after = get().project;
  if (!before || !after || before === after) return;
  push({ label, undo: () => restore(before), redo: () => restore(after) });
}

/** Change the current texture set. */
export function editSet(label: string, f: (t: TextureSet) => TextureSet, gesture = false): void {
  const id = get().setId;
  const g = (p: Project) => ({ ...p, textureSets: p.textureSets.map((t) => (t.id === id ? f(t) : t)) });
  if (gesture) live(g);
  else edit(label, g);
}
