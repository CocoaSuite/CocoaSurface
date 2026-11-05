import { useState, type DragEvent } from 'react';
import { Icon, IconButton } from '@cocoasurface/ui';
import { outputNodes } from '@cocoasurface/materials';
import { allLayers, findLayer, GENERATOR_SOURCES, insertLayer, newFillLayer, newLayerEffect, newMaskItem, placeOf, updateLayer, type Effect, type EffectKind, type FillLayer, type Generator, type Layer } from '@cocoasurface/project';
import { engine } from '../engine/engine';
import { forgetMaterial } from '../engine/library';
import { ASSETS } from '../engine/procedural';
import { importMaterials } from '../io';
import { currentSet, edit, editSet, ENVIRONMENTS, get, set, toast, useApp, type Environment } from '../store';

export type ShelfItem = { kind: 'material' | 'smartmask' | 'alpha' | 'grunge' | 'procedural' | 'filter' | 'environment'; id: string; name: string };

const TYPE = 'application/x-cocoasurface-asset';
const FILTERS: { id: EffectKind; name: string }[] = [
  { id: 'levels', name: 'Levels' },
  { id: 'blur', name: 'Blur' },
  { id: 'invert', name: 'Invert' },
  { id: 'hsl', name: 'Hue and saturation' },
];
const CATS: { id: ShelfItem['kind']; label: string }[] = [
  { id: 'material', label: 'Materials' },
  { id: 'smartmask', label: 'Smart masks' },
  { id: 'alpha', label: 'Alphas' },
  { id: 'grunge', label: 'Grunges' },
  { id: 'procedural', label: 'Procedurals' },
  { id: 'filter', label: 'Filters' },
  { id: 'environment', label: 'Environments' },
];

export const shelfItem = (e: DragEvent): ShelfItem | null => {
  try {
    return JSON.parse(e.dataTransfer.getData(TYPE)) as ShelfItem;
  } catch {
    return null;
  }
};
export const isShelfDrag = (e: DragEvent) => e.dataTransfer.types.includes(TYPE);

/** A material as a new fill layer above `at`, or on the fill layer itself. */
export function useMaterial(id: string, layerId: string | null = get().layerId, replace = true): void {
  const m = get().materials[id];
  const t = currentSet();
  if (!m || !t) return;
  const use = { material: id, values: Object.fromEntries(m.file.manifest.parameters.map((p) => [p.id, p.value])), scale: 1 };
  const l = layerId ? findLayer(t.layers, layerId) : null;
  if (replace && l?.kind === 'fill') {
    editSet(`Use ${m.file.manifest.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...(x as FillLayer), use })) }));
    set({ layerId: l.id, maskItem: null, effect: null });
    return;
  }
  const layer: FillLayer = { ...newFillLayer(m.file.manifest.name, t.channels.filter((c) => (c !== 'opacity' && c !== 'glow') || outputNodes(m.file.graph).has(c))), use };
  const at = l ? placeOf(t.layers, l.id)! : { parent: null, index: 0 };
  editSet(`Add ${m.file.manifest.name}`, (s) => ({ ...s, layers: insertLayer(s.layers, layer, at) }));
  set({ layerId: layer.id, maskItem: null, effect: null });
}

function toMask(l: Layer, item: Effect, label: string): void {
  editSet(label, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, mask: x.mask ? { ...x.mask, items: [...x.mask.items, item] } : { base: 0, items: [item] } })) }));
  set({ layerId: l.id, maskItem: item.id, effect: null });
}

/** What clicking an asset, or dropping it on a layer, does. */
export function applyItem(a: ShelfItem, layerId: string | null = get().layerId): void {
  const t = currentSet();
  const l = t && layerId ? findLayer(t.layers, layerId) : null;
  switch (a.kind) {
    case 'material':
      return useMaterial(a.id, layerId);
    case 'alpha':
      return set((s) => ({ brush: { ...s.brush, shape: 'image', alpha: `lib:${a.id}` } }));
    case 'environment':
      return set((s) => ({ view: { ...s.view, env: a.id as Environment } }));
  }
  if (!l) return toast('Pick a layer first.');
  if (a.kind === 'smartmask') {
    const g: Generator = { source: a.id as Generator['source'], level: 0.6, spread: 0.1, invert: false };
    if (!t!.bake?.done.includes(GENERATOR_SOURCES.find((x) => x.value === a.id)!.map)) toast('Bake the mesh maps for this mask to show.');
    return toMask(l, newMaskItem('generator', { generator: g, name: a.name }), `Add ${a.name} to ${l.name}`);
  }
  if (a.kind === 'grunge' || a.kind === 'procedural') return toMask(l, newMaskItem('image', { image: { file: `lib:${a.id}`, name: a.name, scale: 1, invert: false }, name: a.name }), `Add ${a.name} to ${l.name}`);
  if (a.kind === 'filter') {
    if (l.kind === 'group') return toast('Groups take masks, not effects.');
    const e = newLayerEffect(a.id as EffectKind);
    editSet(`Add ${e.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, effects: [...(x.effects ?? []), e] })) }));
    set({ layerId: l.id, effect: e.id, maskItem: null });
  }
}

function items(kind: ShelfItem['kind']): (ShelfItem & { thumb?: string; icon?: 'mask' | 'effect' | 'sun' })[] {
  const s = get();
  switch (kind) {
    case 'material':
      return (s.project?.library ?? []).map((m) => ({ kind, id: m.id, name: m.name, thumb: s.materials[m.id]?.thumb ?? undefined }));
    case 'smartmask':
      return GENERATOR_SOURCES.map((g) => ({ kind, id: g.value, name: g.label, icon: 'mask' }));
    case 'alpha':
    case 'grunge':
    case 'procedural': {
      const g = kind === 'alpha' ? 'alpha' : kind === 'grunge' ? 'pattern' : 'noise';
      return ASSETS.filter((a) => a.group === g).map((a) => ({ kind, id: a.id, name: a.label, thumb: engine.thumb(a) }));
    }
    case 'filter':
      return FILTERS.map((f) => ({ kind, id: f.id, name: f.name, icon: 'effect' }));
    case 'environment':
      return ENVIRONMENTS.map((e) => ({ kind, id: e.value, name: e.label, thumb: e.value === 'studio' ? undefined : `./env/${e.value}.jpg`, icon: 'sun' }));
  }
}

export function Shelf() {
  useApp((s) => s.project);
  useApp((s) => s.materials);
  const env = useApp((s) => s.view.env);
  const alpha = useApp((s) => (s.brush.shape === 'image' ? s.brush.alpha : null));
  const [cat, setCat] = useState<ShelfItem['kind']>('material');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const list = items(cat).filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()));
  const on = (x: ShelfItem) => (x.kind === 'environment' ? env === x.id : x.kind === 'alpha' ? alpha === `lib:${x.id}` : picked === x.id);
  const used = (id: string) => get().project!.textureSets.some((t) => allLayers(t.layers).some((l) => l.kind === 'fill' && l.use?.material === id));
  return (
    <div className="cs-shelf">
      <div className="cs-shbody">
        <div className="cs-shbar">
          <select className="cs-select" aria-label="Asset type" value={cat} onChange={(e) => (setCat(e.target.value as ShelfItem['kind']), setPicked(null))}>
            {CATS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="cs-shsearch">
            <Icon name="search" size={14} />
            <input className="cs-input" placeholder="Search" aria-label="Search assets" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </span>
          {cat === 'material' && picked && (
            <IconButton
              icon="trash"
              label="Remove from the project"
              onClick={() => {
                if (used(picked)) return toast('A fill layer uses this material.');
                const name = get().materials[picked]?.file.manifest.name ?? 'material';
                edit(`Remove ${name}`, (p) => ({ ...p, library: p.library.filter((m) => m.id !== picked) }));
                forgetMaterial(picked);
                setPicked(null);
              }}
            />
          )}
          {cat === 'material' && <IconButton icon="plus" label="Import materials" onClick={() => void importMaterials()} />}
        </div>
        <div className="cs-shgrid">
          {list.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`cs-shitem${on(x) ? ' on' : ''}`}
              title={x.name}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TYPE, JSON.stringify({ kind: x.kind, id: x.id, name: x.name }));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => (x.kind === 'alpha' || x.kind === 'environment' ? applyItem(x) : setPicked(x.id))}
              onDoubleClick={() => applyItem(x)}
            >
              <i className={x.kind === 'material' ? 'ball' : ''} style={x.thumb ? { backgroundImage: `url(${x.thumb})` } : undefined}>
                {!x.thumb && x.icon && <Icon name={x.icon} size={22} />}
              </i>
              <span>{x.name}</span>
            </button>
          ))}
          {!list.length && <div className="cs-empty">{cat === 'material' && !q ? 'Import .cocoamat materials to drag them onto the layers.' : 'Nothing here.'}</div>}
        </div>
      </div>
    </div>
  );
}
