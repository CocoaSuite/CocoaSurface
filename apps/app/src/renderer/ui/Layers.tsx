import { useState, type DragEvent } from 'react';
import { ContextMenu, Icon, IconButton, PanelHeader } from '@cocoasurface/ui';
import { newMaskItem, duplicateLayer, findLayer, insertLayer, moveLayer, newFillLayer, newGroup, newPaintLayer, placeOf, removeLayer, updateLayer, type Layer, type Place } from '@cocoasurface/project';
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
  set({ layerId: l.id, maskItem: null });
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
  set({ layerId: sib?.[Math.min(p.index, (sib?.length ?? 1) - 1)]?.id ?? p.parent, maskItem: null });
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

export const MASK_ROOT = '#mask';

export function setMask(base: 0 | 1 | null): void {
  const l = currentLayer();
  if (!l) return;
  if (base === null) {
    editSet(`Remove the mask of ${l.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, mask: null })) }));
    set({ maskItem: null });
    return;
  }
  const paint = newMaskItem('paint');
  editSet(`Add a ${base ? 'white' : 'black'} mask to ${l.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, mask: { base, items: [paint] } })) }));
  set((s) => ({ maskItem: paint.id, brush: { ...s.brush, maskValue: base ? 0 : 1 } }));
}

const ICON = { paint: 'brush', image: 'image', fill: 'fill', generator: 'layers', levels: 'effect', blur: 'blur', invert: 'effect', hsl: 'effect' } as const;

function EffectRows({ l, depth }: { l: Layer; depth: number }) {
  const effect = useApp((s) => s.effect);
  const layerId = useApp((s) => s.layerId);
  if (!l.effects?.length || l.id !== layerId) return null;
  const toggle = (id: string) => editSet('Toggle an effect', (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, effects: x.effects?.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)) })) }));
  return (
    <>
      {l.effects.map((m) => (
        <div key={m.id} className={`cs-lr${effect === m.id ? ' on' : ''}${m.visible ? '' : ' off'}`} style={{ paddingLeft: 36 + depth * 14 }} onClick={() => set({ effect: m.id, maskItem: null })}>
          <span className="cs-ls">
            <Icon name={ICON[m.kind]} />
          </span>
          <span className="cs-ln">{m.name}</span>
          {m.blend !== 'normal' && <span className="cs-meta">{m.blend}</span>}
          <button type="button" className={`cs-lb${m.visible ? '' : ' set'}`} aria-label={m.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), toggle(m.id))}>
            <Icon name={m.visible ? 'eye' : 'eyeOff'} />
          </button>
        </div>
      ))}
    </>
  );
}

function MaskRows({ l, depth }: { l: Layer; depth: number }) {
  const maskItem = useApp((s) => s.maskItem);
  const layerId = useApp((s) => s.layerId);
  if (!l.mask || l.id !== layerId) return null;
  const toggle = (id: string) => editSet('Toggle a mask item', (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, mask: x.mask && { ...x.mask, items: x.mask.items.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)) } })) }));
  return (
    <>
      <div className={`cs-lr${maskItem === MASK_ROOT ? ' on' : ''}`} style={{ paddingLeft: 22 + depth * 14 }} onClick={() => set({ maskItem: MASK_ROOT })}>
        <span className="cs-maskchip" style={{ background: l.mask.base ? '#fff' : '#000' }} />
        <span className="cs-ln">{l.mask.base ? 'White mask' : 'Black mask'}</span>
      </div>
      {l.mask.items.map((m) => (
        <div key={m.id} className={`cs-lr${maskItem === m.id ? ' on' : ''}${m.visible ? '' : ' off'}`} style={{ paddingLeft: 36 + depth * 14 }} onClick={() => set({ maskItem: m.id })}>
          <span className="cs-ls">
            <Icon name={ICON[m.kind]} />
          </span>
          <span className="cs-ln">{m.name}</span>
          {m.blend !== 'normal' && <span className="cs-meta">{m.blend}</span>}
          <button type="button" className={`cs-lb${m.visible ? '' : ' set'}`} aria-label={m.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), toggle(m.id))}>
            <Icon name={m.visible ? 'eye' : 'eyeOff'} />
          </button>
        </div>
      ))}
    </>
  );
}

function Row({ l, depth, drag, setDrag }: { l: Layer; depth: number; drag: string | null; setDrag: (v: string | null) => void }) {
  const layerId = useApp((s) => s.layerId);
  const maskItem = useApp((s) => s.maskItem);
  const maskEdit = maskItem !== null;
  const effectSel = useApp((s) => s.effect) !== null;
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
        onClick={() => set({ layerId: l.id, maskItem: null, effect: null })}
      >
        {l.kind === 'group' ? <button type="button" className={`cs-cx${l.open ? ' o' : ''}`} aria-label={l.open ? 'Collapse' : 'Expand'} onClick={(e) => (e.stopPropagation(), flip('open'))} /> : <span style={{ width: 14 }} />}
        {l.kind === 'fill' && !l.use ? (
          <span className={`cs-swatch${l.id === layerId && !maskEdit && !effectSel ? ' on' : ''}`} style={{ background: l.flat.color }} />
        ) : swatch ? (
          <span className={`cs-swatch${l.id === layerId && !maskEdit && !effectSel ? ' on' : ''}`} style={{ backgroundImage: `url(${swatch})` }} />
        ) : (
          <span className="cs-ls">
            <Icon name={l.kind === 'paint' ? 'brush' : l.kind === 'group' ? 'folder' : 'fill'} />
          </span>
        )}
        {l.mask && <button type="button" className={`cs-maskchip${l.id === layerId && maskEdit ? ' on' : ''}`} style={{ background: l.mask.base ? '#fff' : '#000' }} aria-label="Edit the mask" title="Mask" onClick={(e) => (e.stopPropagation(), set({ layerId: l.id, maskItem: l.mask!.items[0]?.id ?? MASK_ROOT }))} />}
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
      <EffectRows l={l} depth={depth} />
      <MaskRows l={l} depth={depth} />
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className="cs-pane">
      <PanelHeader title="Layers">
        <span className="cs-acts">
          <IconButton icon="brush" label="New paint layer" onClick={() => addLayer('paint')} />
          <IconButton icon="fill" label="New fill layer" onClick={() => addLayer('fill')} />
          <IconButton icon="folder" label="New group" onClick={() => addLayer('group')} />
          <IconButton
            icon="mask"
            label="Mask"
            disabled={!l}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 4 });
            }}
          />
          <IconButton icon="copy" label="Duplicate" disabled={!l} onClick={duplicate} />
          <IconButton icon="trash" label="Delete" disabled={!l} onClick={removeCurrentLayer} />
        </span>
      </PanelHeader>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Add black mask', onSelect: () => setMask(0) },
            { label: 'Add white mask', onSelect: () => setMask(1) },
            'separator',
            { label: 'Remove mask', disabled: !l?.mask, onSelect: () => setMask(null) },
          ]}
        />
      )}
      <div className="cs-scroll">
        {t?.layers.map((x) => <Row key={x.id} l={x} depth={0} drag={drag} setDrag={setDrag} />)}
        {t && !t.layers.length && <div className="cs-empty">No layers. Add a paint or fill layer.</div>}
      </div>
    </div>
  );
}
