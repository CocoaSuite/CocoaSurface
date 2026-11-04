import { useEffect, useRef } from 'react';
import { Button, IconButton } from '@cocoasurface/ui';
import { CHANNELS } from '@cocoasurface/project';
import { Viewport, type CameraView } from '../engine/viewport';
import { setView } from '../io';
import { set, useApp, type ViewMode } from '../store';

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
        </select>
        <Button size="sm" aria-pressed={view.ortho} onClick={() => set((s) => ({ view: { ...s.view, ortho: !s.view.ortho } }))}>
          {view.ortho ? 'Orthographic' : 'Perspective'}
        </Button>
        <Button size="sm" aria-pressed={view.wire} onClick={() => set((s) => ({ view: { ...s.view, wire: !s.view.wire } }))}>
          Wireframe
        </Button>
      </div>
      {busy && <div className="cs-busy">{busy}…</div>}
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
