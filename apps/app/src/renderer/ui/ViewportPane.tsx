import { useEffect, useRef } from 'react';
import { Button, IconButton } from '@cocoasurface/ui';
import { applyItem, isShelfDrag, shelfItem, useMaterial } from './Shelf';
import { CHANNELS, MESH_MAPS } from '@cocoasurface/project';
import { Viewport } from '../engine/viewport';
import { setView } from '../io';
import { engine } from '../engine/engine';
import { currentLayer, currentSet, set, useApp, type ViewMode } from '../store';

let current: Viewport | null = null;
export const viewport = () => current;

export function ViewportPane() {
  const ref = useRef<HTMLDivElement>(null);
  const view = useApp((s) => s.view);
  const hasMask = useApp((s) => !!(s.layerId && s.project && currentLayer()?.mask));
  const busy = useApp((s) => s.busy);
  const warnings = useApp((s) => s.warnings);
  const job = useApp((s) => s.job);
  const stencil = useApp((s) => s.stencil);
  const stencilUrl = stencil?.on ? engine.toolImage(stencil.name)?.url : undefined;
  useApp((s) => s.project);
  const baked = currentSet()?.bake?.done ?? [];

  useEffect(() => {
    const v = new Viewport(ref.current!);
    current = v;
    setView(v);
    v.showModel();
    return () => {
      setView(null);
      current = null;
      v.dispose();
    };
  }, []);

  useEffect(() => {
    const el = current?.r.domElement;
    if (el) el.style.cursor = useApp.getState().tool === 'picker' ? 'copy' : 'crosshair';
  });

  return (
    <div
      className="cs-view"
      ref={ref}
      onDragOver={(e) => isShelfDrag(e) && e.preventDefault()}
      onDrop={(e) => {
        const item = shelfItem(e);
        if (!item) return;
        e.preventDefault();
        if (item.kind === 'material') useMaterial(item.id, useApp.getState().layerId, false);
        else applyItem(item);
      }}
    >
      {stencil && stencilUrl && (
        <img className="cs-stencil" src={stencilUrl} alt="" style={{ left: `${stencil.x * 100}%`, top: `${stencil.y * 100}%`, width: `${stencil.scale * 100}%`, transform: `translate(-50%, -50%) rotate(${-stencil.angle}deg)` }} />
      )}
      <div className="cs-overlay">
        <select className="cs-select" aria-label="Show" value={view.mode} onChange={(e) => set((s) => ({ view: { ...s.view, mode: e.target.value as ViewMode } }))}>
          <option value="material">Material</option>
          {CHANNELS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          {(hasMask || view.mode === 'mask') && <option value="mask">Mask</option>}
          {baked.length > 0 && (
            <optgroup label="Mesh maps">
              {MESH_MAPS.filter((m) => baked.includes(m.id) || view.mode === `mesh:${m.id}`).map((m) => (
                <option key={m.id} value={`mesh:${m.id}`}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          )}
          <option value="bake:skew">Skew (bake)</option>
          <option value="bake:offset">Offset (bake)</option>
        </select>
      </div>
      {busy && <div className="cs-busy">{busy}…</div>}
      {job && (
        <div className="cs-busy cs-job">
          <span>{job.label}</span>
          <span className="cs-bar">
            <i style={{ width: `${Math.round(job.share * 100)}%` }} />
          </span>
          <span className="cs-meta">{Math.round(job.share * 100)}%</span>
          <Button size="sm" onClick={job.cancel}>
            Stop
          </Button>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="cs-warn">
          {warnings.map((w, i) => (
            <div key={i}>
              <span>{w}</span>
              <IconButton icon="close" label="Dismiss" onClick={() => set((s) => ({ warnings: s.warnings.filter((_, j) => j !== i) }))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
