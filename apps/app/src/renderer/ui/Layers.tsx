import { useState, type DragEvent, type MouseEvent } from 'react';
import { ContextMenu, IconButton, Icon, type MenuEntry } from '@cocoasurface/ui';
import { BLEND_MODES, CHANNELS, blendIn, EFFECT_KINDS, newLayerEffect, newMaskItem, duplicateLayer, findLayer, insertLayer, moveLayer, newFillLayer, newGroup, newPaintLayer, placeOf, removeLayer, updateLayer, type BlendMode, type Channel, type EffectKind, type Layer, type Place } from '@cocoasurface/project';
import { engine } from '../engine/engine';
import { commit, currentLayer, currentSet, editSet, get, set, useApp } from '../store';
import { applyItem, isShelfDrag, shelfItem } from './Shelf';

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

export function duplicate(): void {
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

/** A layer effect, or an item in the layer's mask, added above the one selected. */
export function addEffect(l: Layer, w: 'mask' | 'layer', kind: EffectKind): void {
  const s = get();
  const n = w === 'mask' ? newMaskItem(kind) : newLayerEffect(kind, kind === 'fill' && l.kind === 'fill' ? { flat: { ...l.flat } } : {});
  const items = w === 'mask' ? (l.mask?.items ?? []) : (l.effects ?? []);
  const sel = w === 'mask' ? s.maskItem : s.effect;
  const at = Math.max(0, items.findIndex((x) => x.id === sel));
  const put = <T,>(xs: T[]) => [...xs.slice(0, at), n as T, ...xs.slice(at)];
  editSet(`Add ${n.name}`, (t) => ({ ...t, layers: updateLayer(t.layers, l.id, (x) => (w === 'mask' ? { ...x, mask: x.mask ? { ...x.mask, items: put(x.mask.items) } : { base: 0, items: [n] } } : { ...x, effects: put(x.effects ?? []) })) }));
  set(w === 'mask' ? { layerId: l.id, maskItem: n.id, effect: null } : { layerId: l.id, effect: n.id, maskItem: null });
}

function effectMenu(l: Layer | null, mask: boolean): MenuEntry[] {
  if (!l) return [];
  return EFFECT_KINDS.filter((x) => !mask || x.mask).map((x) => ({ label: `Add ${x.label.toLowerCase()}`, onSelect: () => addEffect(l, mask ? 'mask' : 'layer', x.kind) }));
}

const ICON = { paint: 'brush', image: 'image', procedural: 'grid', fill: 'fill', generator: 'layers', levels: 'effect', blur: 'blur', invert: 'effect', hsl: 'effect' } as const;

function EffectRows({ l, depth }: { l: Layer; depth: number }) {
  const effect = useApp((s) => s.effect);
  const layerId = useApp((s) => s.layerId);
  const mask = useApp((s) => s.maskItem !== null);
  if (!l.effects?.length || l.id !== layerId || mask) return null;
  const toggle = (id: string) => editSet('Toggle an effect', (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, effects: x.effects?.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)) })) }));
  return (
    <>
      {l.effects.map((m) => (
        <div key={m.id} className={`cs-lr${effect === m.id ? ' on' : ''}${m.visible ? '' : ' off'}`} style={{ paddingLeft: 52 + depth * 14 }} onClick={() => set({ effect: m.id, maskItem: null })}>
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
  if (!l.mask || l.id !== layerId || maskItem === null) return null;
  const toggle = (id: string) => editSet('Toggle a mask item', (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, mask: x.mask && { ...x.mask, items: x.mask.items.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)) } })) }));
  return (
    <>
      <div className={`cs-lr${maskItem === MASK_ROOT ? ' on' : ''}`} style={{ paddingLeft: 32 + depth * 14 }} onClick={() => set({ maskItem: MASK_ROOT })}>
        <span className="cs-maskchip" style={{ background: l.mask.base ? '#fff' : '#000' }} />
        <span className="cs-ln">{l.mask.base ? 'White mask' : 'Black mask'}</span>
      </div>
      {l.mask.items.map((m) => (
        <div key={m.id} className={`cs-lr${maskItem === m.id ? ' on' : ''}${m.visible ? '' : ' off'}`} style={{ paddingLeft: 52 + depth * 14 }} onClick={() => set({ maskItem: m.id })}>
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

const abbr = (b: BlendMode) => BLEND_MODES.find((m) => m.value === b)!.label.slice(0, 4);

function Row({ l, depth, drag, setDrag, onMenu }: { l: Layer; depth: number; drag: string | null; setDrag: (v: string | null) => void; onMenu: (e: MouseEvent, l: Layer) => void }) {
  const layerId = useApp((s) => s.layerId);
  const maskItem = useApp((s) => s.maskItem);
  const sel = l.id === layerId;
  const maskEdit = sel && maskItem !== null;
  const [rename, setRename] = useState(false);
  const [drop, setDrop] = useState<'before' | 'after' | 'into' | 'on' | null>(null);
  const flip = (k: 'visible' | 'open') => editSet(`${k === 'visible' ? (l.visible ? 'Hide' : 'Show') : 'Toggle'} ${l.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, [k]: !(x as unknown as Record<string, boolean>)[k] })) }));
  const where = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return l.kind === 'group' && y > 0.3 && y < 0.7 ? 'into' : y < 0.5 ? 'before' : 'after';
  };
  const swatch = l.kind === 'fill' ? (l.use ? get().materials[l.use.material]?.thumb : null) : null;
  const ch = useApp((s) => s.stackChannel);
  const cur = ch ? blendIn(l, ch) : { blend: l.blend, opacity: l.opacity };
  const own = !!(ch && l.channelBlend?.[ch]);
  const put = (v: Partial<{ blend: BlendMode; opacity: number }>) => (x: Layer): Layer => (ch ? { ...x, channelBlend: { ...x.channelBlend, [ch]: { ...blendIn(x, ch), ...v } } } : { ...x, ...v });
  const where2 = ch ? ` (${CHANNELS.find((c) => c.id === ch)!.label})` : '';
  const opacity = (v: number) => {
    editSet('', (s) => ({ ...s, layers: updateLayer(s.layers, l.id, put({ opacity: Math.min(1, Math.max(0, v / 100)) })) }), true);
    commit(`Change opacity of ${l.name}${where2}`);
  };
  return (
    <>
      <div
        className={`cs-lr cs-layer${sel ? ' on' : ''}${l.visible ? '' : ' off'}${drop === 'into' || drop === 'on' ? ' cs-dropin' : drop ? ' cs-drop' : ''}`}
        style={drop === 'after' ? { boxShadow: 'inset 0 -2px 0 var(--sel)' } : undefined}
        draggable={!rename}
        onDragStart={(e) => (e.dataTransfer.setData('text/plain', l.name), setDrag(l.id))}
        onDragEnd={() => setDrag(null)}
        onDragOver={(e) => {
          if (isShelfDrag(e)) return (e.preventDefault(), setDrop('on'));
          if (!drag || drag === l.id) return;
          e.preventDefault();
          setDrop(where(e));
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDrop(null);
          const item = shelfItem(e);
          if (item) return applyItem(item, l.id);
          const w = where(e);
          if (!drag) return;
          const t = currentSet()!;
          const p = placeOf(t.layers, l.id)!;
          const to: Place = w === 'into' ? { parent: l.id, index: 0 } : { parent: p.parent, index: p.index + (w === 'after' ? 1 : 0) };
          editSet('Move layer', (s) => ({ ...s, layers: moveLayer(s.layers, drag, to) }));
        }}
        onClick={() => set({ layerId: l.id, maskItem: null, effect: null })}
        onContextMenu={(e) => (e.preventDefault(), set({ layerId: l.id }), onMenu(e, l))}
      >
        <button type="button" className={`cs-lb cs-eye${l.visible ? '' : ' set'}`} aria-label={l.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), flip('visible'))}>
          <Icon name={l.visible ? 'eye' : 'eyeOff'} />
        </button>
        <span className="cs-indent" style={{ width: depth * 14 }} />
        {l.kind === 'group' ? <button type="button" className={`cs-cx${l.open ? ' o' : ''}`} aria-label={l.open ? 'Collapse' : 'Expand'} onClick={(e) => (e.stopPropagation(), flip('open'))} /> : null}
        <span
          className={`cs-thumb${sel && !maskEdit ? ' on' : ''}`}
          style={l.kind === 'fill' && !l.use ? { background: l.flat.color } : swatch ? { backgroundImage: `url(${swatch})` } : undefined}
          onClick={(e) => (e.stopPropagation(), set({ layerId: l.id, maskItem: null, effect: null }))}
        >
          {(l.kind !== 'fill' || (l.use && !swatch)) && <Icon name={l.kind === 'paint' ? 'brush' : l.kind === 'group' ? 'folder' : 'fill'} />}
        </span>
        {l.mask && (
          <button
            type="button"
            className={`cs-thumb cs-maskchip${maskEdit ? ' on' : ''}`}
            style={{ background: l.mask.base ? '#fff' : '#000' }}
            aria-label="Edit the mask"
            onClick={(e) => (e.stopPropagation(), set({ layerId: l.id, maskItem: l.mask!.items[0]?.id ?? MASK_ROOT, effect: null }))}
          >
            {l.mask.items.length > 0 && <Icon name="mask" />}
          </button>
        )}
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
            <>
              {l.locked && <Icon name="lock" size={12} />}
              {l.name}
            </>
          )}
        </span>
        <span className={`cs-lblend${own ? ' own' : ''}`} onClick={(e) => e.stopPropagation()}>
          <select aria-label={`Blend of ${l.name}`} value={cur.blend} onChange={(e) => editSet(`Change blend of ${l.name}${where2}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, put({ blend: e.target.value as BlendMode })) }))}>
            {BLEND_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {l.kind === 'group' && m.value === 'normal' ? 'Pass' : abbr(m.value)}
              </option>
            ))}
          </select>
          <input
            aria-label={`Opacity of ${l.name}`}
            inputMode="numeric"
            defaultValue={Math.round(cur.opacity * 100)}
            key={`${ch}:${Math.round(cur.opacity * 100)}`}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && Math.round(n) !== Math.round(cur.opacity * 100)) opacity(n);
            }}
          />
        </span>
      </div>
      <EffectRows l={l} depth={depth} />
      <MaskRows l={l} depth={depth} />
      {l.kind === 'group' && l.open && l.children.map((c) => <Row key={c.id} l={c} depth={depth + 1} drag={drag} setDrag={setDrag} onMenu={onMenu} />)}
    </>
  );
}

export function Layers() {
  useApp((s) => s.project);
  const project = useApp((s) => s.project)!;
  const setId = useApp((s) => s.setId);
  const maskSel = useApp((s) => s.maskItem !== null);
  const stackChannel = useApp((s) => s.stackChannel);
  const t = currentSet();
  const cur = useApp((s) => (s.layerId ? s.layerId : null));
  const l = cur ? currentLayer() : null;
  const [drag, setDrag] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [over, setOver] = useState(false);
  const at = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4 };
  };
  const maskMenu = (x: Layer | null): MenuEntry[] => [
    { label: 'Add black mask', disabled: !x, onSelect: () => setMask(0) },
    { label: 'Add white mask', disabled: !x, onSelect: () => setMask(1) },
    { label: 'Add mask with generator', disabled: !x, onSelect: () => x && addEffect(x, 'mask', 'generator') },
    'separator',
    { label: 'Remove mask', disabled: !x?.mask, onSelect: () => setMask(null) },
  ];
  const rowMenu = (e: MouseEvent, x: Layer) =>
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...maskMenu(x),
        'separator',
        ...effectMenu(x, false),
        'separator',
        {
          label: 'Same blend for every channel',
          disabled: !x.channelBlend || !Object.keys(x.channelBlend).length,
          onSelect: () => editSet(`Blend ${x.name} the same in every channel`, (s) => ({ ...s, layers: updateLayer(s.layers, x.id, (y) => ({ ...y, channelBlend: undefined })) })),
        },
        { label: x.locked ? 'Unlock' : 'Lock', onSelect: () => editSet(`${x.locked ? 'Unlock' : 'Lock'} ${x.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, x.id, (y) => ({ ...y, locked: !y.locked })) })) },
        { label: 'Duplicate layer', onSelect: duplicate },
        { label: 'Delete layer', onSelect: removeCurrentLayer },
      ],
    });
  return (
    <div className="cs-pane cs-layers">
      <div className="cs-lbar">
        <select className="cs-select" aria-label="Texture set" value={setId ?? ''} onChange={(e) => set({ setId: e.target.value, layerId: project.textureSets.find((x) => x.id === e.target.value)?.layers[0]?.id ?? null, maskItem: null, effect: null })}>
          {project.textureSets.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select className="cs-select" aria-label="Channel" value={stackChannel ?? ''} onChange={(e) => set({ stackChannel: (e.target.value || null) as Channel | null })}>
          <option value="">All channels</option>
          {CHANNELS.filter((c) => t?.channels.includes(c.id)).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="cs-acts">
          <IconButton icon="effect" label="Add effect" disabled={!l} onClick={(e) => setMenu({ ...at(e), items: effectMenu(l, maskSel) })} />
          <IconButton icon="mask" label="Mask" disabled={!l} onClick={(e) => setMenu({ ...at(e), items: maskMenu(l) })} />
          <IconButton icon="fill" label="New fill layer" onClick={() => addLayer('fill')} />
          <IconButton icon="brush" label="New paint layer" onClick={() => addLayer('paint')} />
          <IconButton icon="folder" label="New group" onClick={() => addLayer('group')} />
          <IconButton icon="copy" label="Duplicate" disabled={!l} onClick={duplicate} />
          <IconButton icon="trash" label="Delete" disabled={!l} onClick={removeCurrentLayer} />
        </span>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menu.items} />}
      <div
        className={`cs-scroll cs-stack${over ? ' cs-dropin' : ''}`}
        onDragOver={(e) => isShelfDrag(e) && (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const item = shelfItem(e);
          if (!item) return;
          e.preventDefault();
          applyItem(item, item.kind === 'material' ? null : get().layerId);
        }}
      >
        {t?.layers.map((x) => <Row key={x.id} l={x} depth={0} drag={drag} setDrag={setDrag} onMenu={rowMenu} />)}
        {t && !t.layers.length && <div className="cs-empty">No layers. Add a fill or paint layer, or drop a material here.</div>}
      </div>
    </div>
  );
}
