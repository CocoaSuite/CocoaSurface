import { uid, type Layer } from './model';

export interface Place {
  /** Group id, or null for the top of the stack. */
  parent: string | null;
  index: number;
}

export function findLayer(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.kind === 'group') {
      const f = findLayer(l.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function placeOf(layers: Layer[], id: string, parent: string | null = null): Place | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (l.id === id) return { parent, index: i };
    if (l.kind === 'group') {
      const p = placeOf(l.children, id, l.id);
      if (p) return p;
    }
  }
  return null;
}

/** Every layer, depth first, top of the stack first. */
export function allLayers(layers: Layer[]): Layer[] {
  return layers.flatMap((l) => (l.kind === 'group' ? [l, ...allLayers(l.children)] : [l]));
}

export function updateLayer(layers: Layer[], id: string, f: (l: Layer) => Layer): Layer[] {
  return layers.map((l) => {
    if (l.id === id) return f(l);
    if (l.kind === 'group') return { ...l, children: updateLayer(l.children, id, f) };
    return l;
  });
}

export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers.filter((l) => l.id !== id).map((l) => (l.kind === 'group' ? { ...l, children: removeLayer(l.children, id) } : l));
}

export function insertLayer(layers: Layer[], layer: Layer, at: Place): Layer[] {
  if (at.parent === null) {
    const out = [...layers];
    out.splice(Math.max(0, Math.min(at.index, out.length)), 0, layer);
    return out;
  }
  return layers.map((l) => {
    if (l.kind !== 'group') return l;
    if (l.id === at.parent) {
      const children = [...l.children];
      children.splice(Math.max(0, Math.min(at.index, children.length)), 0, layer);
      return { ...l, children };
    }
    return { ...l, children: insertLayer(l.children, layer, at) };
  });
}

/** Move a layer. A group can't go inside itself. */
export function moveLayer(layers: Layer[], id: string, to: Place): Layer[] {
  const l = findLayer(layers, id);
  if (!l) return layers;
  if (to.parent && (to.parent === id || (l.kind === 'group' && findLayer(l.children, to.parent)))) return layers;
  const from = placeOf(layers, id)!;
  let index = to.index;
  if (from.parent === to.parent && from.index < to.index) index -= 1;
  return insertLayer(removeLayer(layers, id), l, { parent: to.parent, index });
}

/** A copy with new ids. `ids` maps each old id to its new one (painted pixels follow it). */
export function duplicateLayer(l: Layer, ids = new Map<string, string>()): { layer: Layer; ids: Map<string, string> } {
  const id = uid();
  ids.set(l.id, id);
  if (l.kind === 'group') return { layer: { ...l, id, children: l.children.map((c) => duplicateLayer(c, ids).layer) }, ids };
  return { layer: structuredClone({ ...l, id }), ids };
}
