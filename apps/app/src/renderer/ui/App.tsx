import { useEffect, useState } from 'react';
import { Divider, MenuBar, NumberField, Spacer, Switch, Toast, ToolButton, type MenuEntry } from '@cocoasurface/ui';
import { CHANNELS, MESH_MAPS } from '@cocoasurface/project';
import { autosave, exportSetMaterial, importMaterials, importModelInto, newFromModel, openProject, recover, saveProject } from '../io';
import { currentSet, get, redo, set, undo, useApp, type Brush, type Tool } from '../store';
import { BakeDialog } from './BakeDialog';
import { ExportDialog } from './ExportDialog';
import { Layers, addLayer, removeCurrentLayer } from './Layers';
import { Library } from './Library';
import { Properties } from './Properties';
import { Start } from './Start';
import { TextureSets } from './TextureSets';
import { ViewportPane } from './ViewportPane';

const TOOLS: { id: Tool; icon: 'brush' | 'eraser' | 'orbit'; label: string }[] = [
  { id: 'paint', icon: 'brush', label: 'Paint' },
  { id: 'erase', icon: 'eraser', label: 'Erase' },
  { id: 'orbit', icon: 'orbit', label: 'Orbit' },
];

function BrushBar() {
  const b = useApp((s) => s.brush);
  const sym = useApp((s) => s.symmetry);
  const field = (k: keyof Brush, label: string, scale: number, max: number) => (
    <>
      <span>{label}</span>
      <NumberField
        value={Math.round((b[k] as number) * scale)}
        label=""
        ariaLabel={label}
        onChange={(v) => set((s) => ({ brush: { ...s.brush, [k]: Math.min(max, Math.max(scale === 1 ? 1 : 0, v)) / scale } }))}
        onCommit={(v) => set((s) => ({ brush: { ...s.brush, [k]: Math.min(max, Math.max(scale === 1 ? 1 : 0, v)) / scale } }))}
      />
    </>
  );
  return (
    <div className="cs-brushbar">
      {field('size', 'Size', 1, 1000)}
      {field('flow', 'Flow', 100, 100)}
      {field('opacity', 'Opacity', 100, 100)}
      {field('hardness', 'Hardness', 100, 100)}
      {field('spacing', 'Spacing', 100, 200)}
      <Divider />
      <span>Mirror X</span>
      <Switch checked={sym} onChange={(v) => set({ symmetry: v })} label="Mirror X" />
    </div>
  );
}

export function App() {
  const project = useApp((s) => s.project);
  const tool = useApp((s) => s.tool);
  const toastMsg = useApp((s) => s.toast);
  const history = useApp((s) => s.history);
  const [exporting, setExporting] = useState(false);
  const [baking, setBaking] = useState(false);

  useEffect(() => {
    void recover();
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
      else if (mod) return;
      else if (code === 'KeyB') set({ tool: 'paint' });
      else if (code === 'KeyE') set({ tool: 'erase' });
      else if (code === 'KeyO') set({ tool: 'orbit' });
      else if (code === 'BracketLeft') set((s) => ({ brush: { ...s.brush, size: Math.max(1, Math.round(s.brush.size / 1.15)) } }));
      else if (code === 'BracketRight') set((s) => ({ brush: { ...s.brush, size: Math.min(1000, Math.round(s.brush.size * 1.15)) } }));
      else if (code === 'Delete' || code === 'Backspace') removeCurrentLayer();
      else if (code === 'KeyM') set((s) => ({ view: { ...s.view, mode: s.view.mode === 'material' ? 'color' : 'material' } }));
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
        { label: 'New group', disabled: !has, onSelect: () => addLayer('group') },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Material', onSelect: () => set((s) => ({ view: { ...s.view, mode: 'material' } })) },
        ...CHANNELS.map((c) => ({ label: c.label, onSelect: () => set((s) => ({ view: { ...s.view, mode: c.id } })) })),
        ...(currentSet()?.bake?.done ?? []).map((m) => ({ label: `Mesh map: ${MESH_MAPS.find((x) => x.id === m)!.label}`, onSelect: () => set((s) => ({ view: { ...s.view, mode: `mesh:${m}` as const } })) })),
        'separator',
        { label: get().view.wire ? 'Hide wireframe' : 'Show wireframe', onSelect: () => set((s) => ({ view: { ...s.view, wire: !s.view.wire } })) },
        { label: get().view.grid ? 'Hide grid' : 'Show grid', onSelect: () => set((s) => ({ view: { ...s.view, grid: !s.view.grid } })) },
        { label: get().view.ortho ? 'Perspective' : 'Orthographic', onSelect: () => set((s) => ({ view: { ...s.view, ortho: !s.view.ortho } })) },
      ],
    },
  ];

  return (
    <div className="cs-app">
      <div className="cs-top">
        <img className="cs-mark" src="./logo-mark.svg" alt="CocoaSurface" />
        <MenuBar menus={menus} />
        <Spacer />
        {has && <BrushBar />}
      </div>
      {has ? (
        <div className="cs-main">
          <div className="cs-rail">
            {TOOLS.map((t) => (
              <ToolButton key={t.id} icon={t.icon} label={t.label} active={tool === t.id} onClick={() => set({ tool: t.id })} />
            ))}
          </div>
          <div className="cs-side l">
            <TextureSets onBake={() => setBaking(true)} />
            <Library />
          </div>
          <ViewportPane />
          <div className="cs-side r">
            <Layers />
            <Properties />
          </div>
        </div>
      ) : (
        <Start />
      )}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {baking && currentSet() && <BakeDialog onClose={() => setBaking(false)} />}
      <Toast message={toastMsg?.text ?? null} nonce={toastMsg?.n ?? 0} />
    </div>
  );
}
