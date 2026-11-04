import { useState, type DragEvent } from 'react';
import { Icon, IconButton, PanelHeader } from '@cocoasurface/ui';
import { duplicateLayer, findLayer, insertLayer, moveLayer, newFillLayer, newGroup, newPaintLayer, placeOf, removeLayer, updateLayer, type Layer, type Place } from '@cocoasurface/project';
import { engine } from '../engine/engine';
import { currentLayer, currentSet, editSet, get, set, useApp } from '../store';

export function addLayer(kind: Layer['kind']): void {
  const t = currentSet();
  if (!t) return;
  const ch = t.channels.filter((c) => c !== 'normal');
  const l = kind === 'paint' ? newPaintLayer(`Paint ${count(t.layers, 'paint') + 1}`, ch) : kind === 'fill' ? newFillLayer(`Fill ${count(t.layers, 'fill') + 1}`, t.channels.filter((c) => c !== 'opacity' && c !== 'glow')) : newGroup(`Group ${count(t.layers, 'group') + 1}`, t.channels);
  const cur = currentLayer();
  const at: Place = cur ? (cur.kind === 'group' && cur.open ? { parent: cur.id, index: 0 } : placeOf(t.layers, cur.id)!) : { parent: null, index: 0 };
  editSet(`Add ${l.name}`, (s) => ({ ...s, layers: insertLayer(s.layers, l, at) }));
  set({ layerId: l.id, maskEdit: false });
}

const count = (ls: Layer[], k: Layer['kind']): number => ls.reduce((n, l) => n + (l.kind === k ? 1 : 0) + (l.kind === 'group' ? count(l.children, k) : 0), 0);

export function removeCurrentLayer(): void {
  const l = currentLayer();
  if (!l) return;
  const t = currentSet()!;
  const p = placeOf(t.layers, l.id)!;
  editSet(`Delete ${l.name}`, (s) => ({ ...s, layers: removeLayer(s.layers, l.id) }));
  const next = currentSet()!;
  const sib = p.parent ? (findLayer(next.layers, p.parent) as { children: Layer[] } | null)?.children : next.layers;
  set({ layerId: sib?.[Math.min(p.index, (sib?.length ?? 1) - 1)]?.id ?? p.parent, maskEdit: false });
}

function duplicate(): void {
  const l = currentLayer();
  const t = currentSet();
  if (!l || !t) return;
  const { layer, ids } = duplicateLayer(l);
  layer.name = `${l.name} copy`;
  const g = engine.sets.get(t.id);
  if (g)
    for (const [from, to] of ids)
      for (const [key, src] of g.pixels.get(from) ?? []) g.p.copyTo(src.texture, g.target(to, key)!);
  editSet(`Duplicate ${l.name}`, (s) => ({ ...s, layers: insertLayer(s.layers, layer, placeOf(s.layers, l.id)!) }));
  set({ layerId: layer.id });
}

function toggleMask(): void {
  const l = currentLayer();
  if (!l || l.kind === 'group') return;
  editSet(l.mask ? `Remove mask from ${l.name}` : `Add mask to ${l.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, mask: !x.mask })) }));
  set({ maskEdit: !l.mask });
}

function Row({ l, depth, drag, setDrag }: { l: Layer; depth: number; drag: string | null; setDrag: (v: string | null) => void }) {
  const layerId = useApp((s) => s.layerId);
  const maskEdit = useApp((s) => s.maskEdit);
  const [rename, setRename] = useState(false);
  const [drop, setDrop] = useState<'before' | 'after' | 'into' | null>(null);
  const flip = (k: 'visible' | 'locked' | 'open') => editSet(`${k === 'visible' ? (l.visible ? 'Hide' : 'Show') : k === 'locked' ? (l.locked ? 'Unlock' : 'Lock') : 'Toggle'} ${l.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, [k]: !(x as unknown as Record<string, boolean>)[k] })) }));
  const where = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return l.kind === 'group' && y > 0.3 && y < 0.7 ? 'into' : y < 0.5 ? 'before' : 'after';
  };
  const swatch = l.kind === 'fill' ? (l.use ? get().materials[l.use.material]?.thumb : null) : null;
  return (
    <>
      <div
        className={`cs-lr${l.id === layerId ? ' on' : ''}${l.visible ? '' : ' off'}${drop === 'into' ? ' cs-dropin' : drop ? ' cs-drop' : ''}`}
        style={{ paddingLeft: 4 + depth * 14, ...(drop === 'after' ? { boxShadow: 'inset 0 -2px 0 var(--sel)' } : {}) }}
        draggable={!rename}
        onDragStart={() => setDrag(l.id)}
        onDragEnd={() => setDrag(null)}
        onDragOver={(e) => {
          if (!drag || drag === l.id) return;
          e.preventDefault();
          setDrop(where(e));
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          const w = where(e);
          setDrop(null);
          if (!drag) return;
          const t = currentSet()!;
          const p = placeOf(t.layers, l.id)!;
          const to: Place = w === 'into' ? { parent: l.id, index: 0 } : { parent: p.parent, index: p.index + (w === 'after' ? 1 : 0) };
          editSet('Move layer', (s) => ({ ...s, layers: moveLayer(s.layers, drag, to) }));
        }}
        onClick={() => set({ layerId: l.id, maskEdit: false })}
      >
        {l.kind === 'group' ? <button type="button" className={`cs-cx${l.open ? ' o' : ''}`} aria-label={l.open ? 'Collapse' : 'Expand'} onClick={(e) => (e.stopPropagation(), flip('open'))} /> : <span style={{ width: 14 }} />}
        {l.kind === 'fill' && !l.use ? (
          <span className={`cs-swatch${l.id === layerId && !maskEdit ? ' on' : ''}`} style={{ background: l.flat.color }} />
        ) : swatch ? (
          <span className={`cs-swatch${l.id === layerId && !maskEdit ? ' on' : ''}`} style={{ backgroundImage: `url(${swatch})` }} />
        ) : (
          <span className="cs-ls">
            <Icon name={l.kind === 'paint' ? 'brush' : l.kind === 'group' ? 'folder' : 'fill'} />
          </span>
        )}
        {l.mask && <button type="button" className={`cs-maskchip${l.id === layerId && maskEdit ? ' on' : ''}`} aria-label="Paint the mask" title="Mask" onClick={(e) => (e.stopPropagation(), set({ layerId: l.id, maskEdit: true }))} />}
        <span className="cs-ln" onDoubleClick={() => setRename(true)}>
          {rename ? (
            <input
              className="cs-input"
              autoFocus
              defaultValue={l.name}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRename(false);
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                setRename(false);
                if (v && v !== l.name) editSet(`Rename ${l.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, name: v })) }));
              }}
            />
          ) : (
            l.name
          )}
        </span>
        {l.blend !== 'normal' && <span className="cs-meta">{l.blend}</span>}
        {l.opacity < 1 && <span className="cs-meta">{Math.round(l.opacity * 100)}%</span>}
        <button type="button" className={`cs-lb${l.locked ? ' set' : ''}`} aria-label={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => (e.stopPropagation(), flip('locked'))}>
          <Icon name={l.locked ? 'lock' : 'unlock'} />
        </button>
        <button type="button" className={`cs-lb${l.visible ? '' : ' set'}`} aria-label={l.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), flip('visible'))}>
          <Icon name={l.visible ? 'eye' : 'eyeOff'} />
        </button>
      </div>
      {l.kind === 'group' && l.open && l.children.map((c) => <Row key={c.id} l={c} depth={depth + 1} drag={drag} setDrag={setDrag} />)}
    </>
  );
}

export function Layers() {
  useApp((s) => s.project);
  const t = currentSet();
  const cur = useApp((s) => (s.layerId ? s.layerId : null));
  const l = cur ? currentLayer() : null;
  const [drag, setDrag] = useState<string | null>(null);
  return (
    <div className="cs-pane">
      <PanelHeader title="Layers">
        <span className="cs-acts">
          <IconButton icon="brush" label="New paint layer" onClick={() => addLayer('paint')} />
          <IconButton icon="fill" label="New fill layer" onClick={() => addLayer('fill')} />
          <IconButton icon="folder" label="New group" onClick={() => addLayer('group')} />
          <IconButton icon="mask" label={l?.mask ? 'Remove mask' : 'Add mask'} disabled={!l || l.kind === 'group'} onClick={toggleMask} />
          <IconButton icon="copy" label="Duplicate" disabled={!l} onClick={duplicate} />
          <IconButton icon="trash" label="Delete" disabled={!l} onClick={removeCurrentLayer} />
        </span>
      </PanelHeader>
      <div className="cs-scroll">
        {t?.layers.map((x) => <Row key={x.id} l={x} depth={0} drag={drag} setDrag={setDrag} />)}
        {t && !t.layers.length && <div className="cs-empty">No layers. Add a paint or fill layer.</div>}
      </div>
    </div>
  );
}
