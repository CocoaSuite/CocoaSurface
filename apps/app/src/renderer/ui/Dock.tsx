import { useState, type DragEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { create } from 'zustand';

export type PanelId = 'list' | 'settings' | 'display' | 'layers' | 'properties' | 'assets';
export type Side = 'left' | 'right' | 'bottom';
interface Group {
  id: string;
  panels: PanelId[];
  active: PanelId;
  size: number;
}
interface Layout {
  left: Group[];
  right: Group[];
  bottom: Group[];
  w: Record<Side, number>;
}

export const TITLES: Record<PanelId, string> = { list: 'Texture Set List', settings: 'Texture Set Settings', display: 'Display Settings', layers: 'Layers', properties: 'Properties', assets: 'Assets' };
const IDS = Object.keys(TITLES) as PanelId[];
const SIDES: Side[] = ['left', 'right', 'bottom'];
const KEY = 'cocoasurface.dock';
const TYPE = 'application/x-cocoasurface-panel';

let n = 0;
const g = (panels: PanelId[], size = 1): Group => ({ id: `g${++n}`, panels, active: panels[0]!, size });
const fresh = (): Layout => ({
  left: [g(['assets'])],
  right: [g(['list', 'settings', 'display'], 0.8), g(['layers'], 1.5), g(['properties'], 2)],
  bottom: [],
  w: { left: 280, right: 340, bottom: 220 },
});

function load(): Layout {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) ?? '') as Layout;
    const seen = new Set<PanelId>();
    for (const s of SIDES) {
      if (!Array.isArray(l[s])) throw 0;
      l[s] = l[s]
        .map((x) => ({ ...g(x.panels.filter((p) => IDS.includes(p) && !seen.has(p) && seen.add(p)), Number(x.size) || 1), active: x.active }))
        .filter((x) => x.panels.length)
        .map((x) => ({ ...x, active: x.panels.includes(x.active) ? x.active : x.panels[0]! }));
    }
    if (!l.w || SIDES.some((s) => !(l.w[s] > 0))) throw 0;
    return l;
  } catch {
    return fresh();
  }
}

export const useDock = create<Layout & { dragging: PanelId | null }>(() => ({ ...load(), dragging: null }));
useDock.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ left: s.left, right: s.right, bottom: s.bottom, w: s.w }));
  } catch {}
});

const without = (l: Layout, p: PanelId): Pick<Layout, Side> => {
  const out = {} as Pick<Layout, Side>;
  for (const s of SIDES)
    out[s] = l[s]
      .map((x) => (x.panels.includes(p) ? { ...x, panels: x.panels.filter((q) => q !== p), active: x.active === p ? (x.panels.find((q) => q !== p) ?? p) : x.active } : x))
      .filter((x) => x.panels.length);
  return out;
};

export const shown = (p: PanelId) => SIDES.some((s) => useDock.getState()[s].some((x) => x.panels.includes(p)));

type Target = { side: Side; group?: string; at: 'tab' | 'before' | 'after' };

function move(p: PanelId, t: Target): void {
  useDock.setState((l) => {
    const sides = without(l, p);
    const list = [...sides[t.side]];
    const i = t.group ? list.findIndex((x) => x.id === t.group) : -1;
    if (i < 0) list.push(g([p]));
    else if (t.at === 'tab') list[i] = { ...list[i]!, panels: [...list[i]!.panels, p], active: p };
    else list.splice(t.at === 'before' ? i : i + 1, 0, g([p], list[i]!.size));
    return { ...sides, [t.side]: list };
  });
}

export function togglePanel(p: PanelId): void {
  if (shown(p)) useDock.setState((l) => without(l, p));
  else move(p, { side: 'right', at: 'after' });
}

export function focusPanel(p: PanelId): void {
  if (!shown(p)) move(p, { side: 'right', at: 'after' });
  useDock.setState((l) => Object.fromEntries(SIDES.map((s) => [s, l[s].map((x) => (x.panels.includes(p) ? { ...x, active: p } : x))])));
}

export const resetLayout = () => useDock.setState(fresh());

const dragged = (e: DragEvent) => e.dataTransfer.types.includes(TYPE);

/** Drag on a splitter: `f` gets the distance moved since the start. */
function drag(e: RPointerEvent, f: (dx: number, dy: number) => void): void {
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const x0 = e.clientX, y0 = e.clientY;
  const mv = (ev: PointerEvent) => f(ev.clientX - x0, ev.clientY - y0);
  const up = () => (el.removeEventListener('pointermove', mv), el.removeEventListener('pointerup', up));
  el.addEventListener('pointermove', mv);
  el.addEventListener('pointerup', up);
}

function GroupView({ side, x, render }: { side: Side; x: Group; render: (p: PanelId) => ReactNode }) {
  const dragging = useDock((s) => s.dragging);
  const [zone, setZone] = useState<Target['at'] | null>(null);
  const across = side === 'bottom';
  const where = (e: DragEvent): Target['at'] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = across ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    return f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'tab';
  };
  const drop = (e: DragEvent, at: Target['at']) => {
    const p = e.dataTransfer.getData(TYPE) as PanelId;
    setZone(null);
    if (!p) return;
    e.preventDefault();
    useDock.setState({ dragging: null });
    move(p, { side, group: x.id, at });
  };
  return (
    <div className="cs-group">
      <div className="cs-dockhead" onDragOver={(e) => dragged(e) && (e.preventDefault(), setZone('tab'))} onDragLeave={() => setZone(null)} onDrop={(e) => drop(e, 'tab')}>
        {x.panels.map((p) => (
          <button
            key={p}
            type="button"
            className={`cs-dtab${x.active === p ? ' on' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TYPE, p);
              e.dataTransfer.effectAllowed = 'move';
              setTimeout(() => useDock.setState({ dragging: p }));
            }}
            onDragEnd={() => useDock.setState({ dragging: null })}
            onClick={() => useDock.setState((l) => ({ [side]: l[side].map((y) => (y.id === x.id ? { ...y, active: p } : y)) }))}
          >
            {TITLES[p]}
          </button>
        ))}
      </div>
      <div className="cs-gbody">{render(x.active)}</div>
      {dragging && (
        <div className="cs-gdrop" onDragOver={(e) => dragged(e) && (e.preventDefault(), setZone(where(e)))} onDragLeave={() => setZone(null)} onDrop={(e) => drop(e, where(e))}>
          {zone && <i className={`${zone}${across ? ' x' : ''}`} />}
        </div>
      )}
    </div>
  );
}

export function DockSide({ side, render }: { side: Side; render: (p: PanelId) => ReactNode }) {
  const groups = useDock((s) => s[side]);
  if (!groups.length) return null;
  const across = side === 'bottom';
  return (
    <div className={`cs-dock ${side}`}>
      {groups.map((x, i) => (
        <div key={x.id} className="cs-gwrap" style={{ flexGrow: x.size }}>
          {i > 0 && (
            <div
              className={`cs-gsplit${across ? ' x' : ''}`}
              onPointerDown={(e) => {
                const box = (e.currentTarget.closest('.cs-dock') as HTMLElement).getBoundingClientRect();
                const total = groups.reduce((a, y) => a + y.size, 0);
                const px = across ? box.width : box.height;
                const a = groups[i - 1]!.size, b = x.size;
                drag(e, (dx, dy) => {
                  const d = ((across ? dx : dy) / px) * total;
                  const na = Math.max(0.15, a + d), nb = Math.max(0.15, b - (na - a));
                  useDock.setState((l) => ({ [side]: l[side].map((y, j) => (j === i - 1 ? { ...y, size: a + b - nb } : j === i ? { ...y, size: nb } : y)) }));
                });
              }}
            />
          )}
          <GroupView side={side} x={x} render={render} />
        </div>
      ))}
    </div>
  );
}

/** The splitter between a dock and the viewport. */
export function DockSplit({ side }: { side: Side }) {
  const has = useDock((s) => s[side].length > 0);
  if (!has) return null;
  return (
    <div
      className={`cs-dsplit ${side}`}
      onPointerDown={(e) => {
        const w0 = useDock.getState().w[side];
        drag(e, (dx, dy) => useDock.setState((l) => ({ w: { ...l.w, [side]: Math.round(Math.min(900, Math.max(180, side === 'left' ? w0 + dx : side === 'right' ? w0 - dx : w0 - dy))) } })));
      }}
    />
  );
}

/** While a panel is dragged: places to drop it on a side with no panels. */
export function EdgeZones() {
  const dragging = useDock((s) => s.dragging);
  const l = useDock();
  const [over, setOver] = useState<Side | null>(null);
  if (!dragging) return null;
  return (
    <>
      {SIDES.filter((s) => !l[s].length).map((s) => (
        <div
          key={s}
          className={`cs-edge ${s}${over === s ? ' on' : ''}`}
          onDragOver={(e) => dragged(e) && (e.preventDefault(), setOver(s))}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            const p = e.dataTransfer.getData(TYPE) as PanelId;
            setOver(null);
            useDock.setState({ dragging: null });
            if (p) (e.preventDefault(), move(p, { side: s, at: 'after' }));
          }}
        />
      ))}
    </>
  );
}
