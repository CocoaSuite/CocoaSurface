import { useEffect, useRef } from 'react';
import { Button, IconButton } from '@cocoasurface/ui';
import { CHANNELS, MESH_MAPS } from '@cocoasurface/project';
import { Viewport, type CameraView } from '../engine/viewport';
import { setView } from '../io';
import { engine } from '../engine/engine';
import { currentSet, set, useApp, type ViewMode } from '../store';

let current: Viewport | null = null;
export const viewport = () => current;

const VIEWS: { v: CameraView; label: string }[] = [
  { v: 'front', label: 'Front' },
  { v: 'back', label: 'Back' },
  { v: 'left', label: 'Left' },
  { v: 'right', label: 'Right' },
  { v: 'top', label: 'Top' },
];

export function ViewportPane() {
  const ref = useRef<HTMLDivElement>(null);
  const view = useApp((s) => s.view);
  const busy = useApp((s) => s.busy);
  const warnings = useApp((s) => s.warnings);
  const job = useApp((s) => s.job);
  const stencil = useApp((s) => s.stencil);
  const stencilUrl = stencil?.on ? engine.toolImages.get(stencil.name)?.url : undefined;
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
    if (el) el.style.cursor = useApp.getState().tool === 'orbit' ? 'grab' : 'crosshair';
  });

  return (
    <div className="cs-view" ref={ref}>
      {stencil && stencilUrl && (
        <img className="cs-stencil" src={stencilUrl} alt="" style={{ left: `${stencil.x * 100}%`, top: `${stencil.y * 100}%`, width: `${stencil.scale * 100}%`, transform: `translate(-50%, -50%) rotate(${-stencil.angle}deg)` }} />
      )}
      <div className="cs-axes">
        {VIEWS.map((x) => (
          <Button key={x.v} size="sm" onClick={() => current?.look(x.v)}>
            {x.label}
          </Button>
        ))}
        <Button size="sm" onClick={() => current?.frame()}>
          Frame
        </Button>
      </div>
      <div className="cs-overlay">
        <select className="cs-select" aria-label="Show" value={view.mode} onChange={(e) => set((s) => ({ view: { ...s.view, mode: e.target.value as ViewMode } }))}>
          <option value="material">Material</option>
          {CHANNELS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          {baked.length > 0 && (
            <optgroup label="Mesh maps">
              {MESH_MAPS.filter((m) => baked.includes(m.id)).map((m) => (
                <option key={m.id} value={`mesh:${m.id}`}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          )}
          <option value="bake:skew">Skew (bake)</option>
          <option value="bake:offset">Offset (bake)</option>
        </select>
        <Button size="sm" aria-pressed={view.ortho} onClick={() => set((s) => ({ view: { ...s.view, ortho: !s.view.ortho } }))}>
          {view.ortho ? 'Orthographic' : 'Perspective'}
        </Button>
        <Button size="sm" aria-pressed={view.wire} onClick={() => set((s) => ({ view: { ...s.view, wire: !s.view.wire } }))}>
          Wireframe
        </Button>
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
