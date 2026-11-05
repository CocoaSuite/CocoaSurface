import { useEffect, useState } from 'react';
import { Button, Divider, MenuBar, NumberField, Segmented, Spacer, Toast, ToolButton, type MenuEntry } from '@cocoasurface/ui';
import { CHANNELS, MESH_MAPS } from '@cocoasurface/project';
import { autosave, exportSetMaterial, importMaterials, importModelInto, newFromModel, openProject, recover, saveProject } from '../io';
import { currentSet, get, redo, set, undo, useApp, type Brush, type Tool, type ViewMode } from '../store';
import type { CameraView } from '../engine/viewport';
import { BakeDialog } from './BakeDialog';
import { ExportDialog } from './ExportDialog';
import { Layers, addLayer, duplicate, removeCurrentLayer } from './Layers';
import { Shelf } from './Shelf';
import { LightPanel } from './LightPanel';
import { loadLibrary } from '../assets';
import { Properties } from './Properties';
import { Start } from './Start';
import { DisplaySettings, TextureSetList, TextureSetSettings } from './TextureSets';
import { DockSide, DockSplit, EdgeZones, TITLES, resetLayout, shown, togglePanel, useDock, type PanelId } from './Dock';
import { ViewportPane, viewport } from './ViewportPane';

const TOOLS: { id: Tool; icon: 'brush' | 'eraser' | 'fill' | 'smudge' | 'blur' | 'picker'; label: string }[] = [
  { id: 'paint', icon: 'brush', label: 'Paint' },
  { id: 'erase', icon: 'eraser', label: 'Erase' },
  { id: 'fill', icon: 'fill', label: 'Fill' },
  { id: 'smudge', icon: 'smudge', label: 'Smudge' },
  { id: 'blur', icon: 'blur', label: 'Blur' },
  { id: 'picker', icon: 'picker', label: 'Color picker' },
];

const KEYS: Record<string, Tool> = { Digit1: 'paint', Digit2: 'erase', Digit4: 'fill', Digit5: 'smudge', KeyP: 'picker' };

function ContextBar({ onBake }: { onBake: () => void }) {
  const b = useApp((s) => s.brush);
  const sym = useApp((s) => s.symmetry);
  const tool = useApp((s) => s.tool);
  const put = (v: Partial<Brush>) => set((s) => ({ brush: { ...s.brush, ...v } }));
  const field = (k: 'size' | 'flow' | 'opacity' | 'spacing' | 'hardness' | 'angle', label: string, scale: number, max: number) => {
    const f = (v: number) => put({ [k]: Math.min(max, Math.max(k === 'size' ? 1 : 0, v)) / scale });
    return (
      <>
        <span>{label}</span>
        <NumberField value={Math.round(b[k] * scale)} label="" ariaLabel={label} onChange={f} onCommit={f} />
      </>
    );
  };
  const busy = useApp((s) => !!s.job);
  const bake = (
    <span className="cs-bakebtn">
      <Button size="sm" disabled={busy || !currentSet()} onClick={onBake}>
        Bake mesh maps
      </Button>
    </span>
  );
  return (
    <div className="cs-ctxbar cs-brushbar">
      {tool === 'fill' ? (
        <>
          <span>Fill mode</span>
          <Segmented label="Fill mode" options={[{ value: 'island', label: 'UV island' }, { value: 'mesh', label: 'Mesh' }]} value={b.fillBy} onChange={(v) => put({ fillBy: v as Brush['fillBy'] })} />
        </>
      ) : tool === 'picker' ? (
        <span>Color picker</span>
      ) : (
        <>
          {field('size', 'Size', 1, 1000)}
          {field('flow', 'Flow', 100, 100)}
          {field('opacity', 'Stroke opacity', 100, 100)}
          {field('spacing', 'Spacing', 100, 200)}
          {field('hardness', 'Hardness', 100, 100)}
          {field('angle', 'Angle', 1, 360)}
          <Divider />
          <ToolButton icon="symmetry" label="Symmetry" active={sym} onClick={() => set({ symmetry: !sym })} />
          <span>Lazy mouse</span>
          <NumberField value={b.stabilize} label="" ariaLabel="Lazy mouse" onChange={(v) => put({ stabilize: Math.max(0, Math.min(100, v)) })} onCommit={(v) => put({ stabilize: Math.max(0, Math.min(100, v)) })} />
        </>
      )}
      {bake}
    </div>
  );
}

function cycle(kind: 'channel' | 'mesh'): void {
  const t = currentSet();
  if (!t) return;
  const list: ViewMode[] = kind === 'channel' ? CHANNELS.filter((c) => t.channels.includes(c.id)).map((c) => c.id) : (t.bake?.done ?? []).map((m) => `mesh:${m}` as const);
  if (!list.length) return;
  set((s) => ({ view: { ...s.view, mode: list[(list.indexOf(s.view.mode) + 1) % list.length]! } }));
}

export function App() {
  const project = useApp((s) => s.project);
  const tool = useApp((s) => s.tool);
  const toastMsg = useApp((s) => s.toast);
  const history = useApp((s) => s.history);
  const [exporting, setExporting] = useState(false);
  const [baking, setBaking] = useState(false);
  const [draft, setDraft] = useState<import('@cocoasurface/project').BakeSettings | null>(null);
  const lightEdit = useApp((s) => s.lightEdit);
  const dock = useDock();
  const panel = (p: PanelId) =>
    p === 'list' ? <TextureSetList /> : p === 'settings' ? <TextureSetSettings onBake={() => setBaking(true)} /> : p === 'display' ? <DisplaySettings /> : p === 'layers' ? <Layers /> : p === 'properties' ? <Properties /> : <Shelf />;

  useEffect(() => {
    void recover();
    void loadLibrary();
    const t = setInterval(() => void autosave(), 90_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      const code = e.code;
      if (mod && code === 'KeyZ') (e.shiftKey ? redo : undo)();
      else if (mod && code === 'KeyY') redo();
      else if (mod && code === 'KeyS') void saveProject(e.shiftKey);
      else if (mod && code === 'KeyO') void openProject();
      else if (mod && code === 'KeyN') void newFromModel();
      else if (mod && e.shiftKey && code === 'KeyE') setExporting(true);
      else if (mod || e.altKey) return;
      else if (KEYS[code]) set({ tool: KEYS[code] });
      else if (code === 'KeyX') set((s) => ({ brush: { ...s.brush, maskValue: 1 - s.brush.maskValue } }));
      else if (code === 'KeyC') cycle('channel');
      else if (code === 'KeyB') cycle('mesh');
      else if (code === 'KeyF') viewport()?.frame();
      else if (code === 'BracketLeft') set((s) => ({ brush: { ...s.brush, size: Math.max(1, Math.round(s.brush.size / 1.15)) } }));
      else if (code === 'BracketRight') set((s) => ({ brush: { ...s.brush, size: Math.min(1000, Math.round(s.brush.size * 1.15)) } }));
      else if (code === 'Delete' || code === 'Backspace') removeCurrentLayer();
      else if (code === 'KeyM') set((s) => ({ view: { ...s.view, mode: 'material' } }));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const has = !!project;
  const menus: { label: string; items: MenuEntry[] }[] = [
    {
      label: 'File',
      items: [
        { label: 'New project from a model…', onSelect: () => void newFromModel() },
        { label: 'Open…', onSelect: () => void openProject() },
        'separator',
        { label: 'Save', disabled: !has, onSelect: () => void saveProject() },
        { label: 'Save as…', disabled: !has, onSelect: () => void saveProject(true) },
        'separator',
        { label: 'Replace the model…', disabled: !has, onSelect: () => void importModelInto() },
        { label: 'Import materials…', disabled: !has, onSelect: () => void importMaterials() },
        'separator',
        { label: 'Bake mesh maps…', disabled: !has || !currentSet(), onSelect: () => setBaking(true) },
        'separator',
        { label: 'Export textures…', disabled: !has, onSelect: () => setExporting(true) },
        { label: 'Export texture set as material…', disabled: !has, onSelect: () => currentSet() && void exportSetMaterial(currentSet()!) },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: history.undo ? `Undo ${history.undo}` : 'Undo', disabled: !history.undo, onSelect: undo },
        { label: history.redo ? `Redo ${history.redo}` : 'Redo', disabled: !history.redo, onSelect: redo },
        'separator',
        { label: 'New paint layer', disabled: !has, onSelect: () => addLayer('paint') },
        { label: 'New fill layer', disabled: !has, onSelect: () => addLayer('fill') },
        { label: 'New folder', disabled: !has, onSelect: () => addLayer('group') },
        'separator',
        { label: 'Duplicate layer', disabled: !has, onSelect: duplicate },
        { label: 'Delete layer', disabled: !has, onSelect: removeCurrentLayer },
      ],
    },
    {
      label: 'Viewport',
      items: [
        { label: 'Material', onSelect: () => set((s) => ({ view: { ...s.view, mode: 'material' } })) },
        ...CHANNELS.map((c) => ({ label: c.label, onSelect: () => set((s) => ({ view: { ...s.view, mode: c.id } })) })),
        ...(currentSet()?.bake?.done ?? []).map((m) => ({ label: `Mesh map: ${MESH_MAPS.find((x) => x.id === m)!.label}`, onSelect: () => set((s) => ({ view: { ...s.view, mode: `mesh:${m}` as const } })) })),
        'separator',
        ...(['front', 'back', 'left', 'right', 'top', 'bottom'] as CameraView[]).map((v) => ({ label: `Camera: ${v[0]!.toUpperCase()}${v.slice(1)}`, onSelect: () => viewport()?.look(v) })),
        { label: 'Fit to screen', onSelect: () => viewport()?.frame() },
        'separator',
        { label: get().view.wire ? 'Hide wireframe' : 'Show wireframe', onSelect: () => set((s) => ({ view: { ...s.view, wire: !s.view.wire } })) },
        { label: get().view.grid ? 'Hide grid' : 'Show grid', onSelect: () => set((s) => ({ view: { ...s.view, grid: !s.view.grid } })) },
        { label: get().view.ortho ? 'Perspective' : 'Orthographic', onSelect: () => set((s) => ({ view: { ...s.view, ortho: !s.view.ortho } })) },
      ],
    },
    {
      label: 'Window',
      items: [
        ...(Object.keys(TITLES) as PanelId[]).map((p) => ({ label: `${shown(p) ? 'Hide' : 'Show'} ${TITLES[p]}`, onSelect: () => togglePanel(p) })),
        'separator',
        { label: 'Reset layout', onSelect: resetLayout },
      ],
    },
  ];

  return (
    <div className="cs-app">
      <div className="cs-top">
        <img className="cs-mark" src="./logo-mark.svg" alt="CocoaSurface" />
        <MenuBar menus={menus} />
        <Spacer />
      </div>
      {has && <ContextBar onBake={() => setBaking(true)} />}
      {has ? (
        <div className="cs-main">
          <div className="cs-rail">
            {TOOLS.map((t) => (
              <ToolButton key={t.id} icon={t.icon} label={t.label} active={tool === t.id} onClick={() => set({ tool: t.id })} />
            ))}
          </div>
          <div className="cs-work">
            <div className="cs-side l" style={{ width: dock.left.length ? dock.w.left : 0 }}>
              <DockSide side="left" render={panel} />
            </div>
            <DockSplit side="left" />
            <div className="cs-center">
              <ViewportPane />
              <DockSplit side="bottom" />
              <div className="cs-side b" style={{ height: dock.bottom.length ? dock.w.bottom : 0 }}>
                <DockSide side="bottom" render={panel} />
              </div>
            </div>
            <DockSplit side="right" />
            <div className="cs-side r" style={{ width: dock.right.length ? dock.w.right : 0 }}>
              <DockSide side="right" render={panel} />
            </div>
            <EdgeZones />
          </div>
        </div>
      ) : (
        <Start />
      )}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {baking && currentSet() && <BakeDialog draft={draft} onClose={() => (setBaking(false), setDraft(null))} />}
      {lightEdit && <LightPanel onDone={() => (setDraft(lightEdit), set({ lightEdit: null, lightSel: null }), setBaking(true))} />}
      <Toast message={toastMsg?.text ?? null} nonce={toastMsg?.n ?? 0} />
    </div>
  );
}
