import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { Button, Field } from '@cocoasurface/ui';
import { uid, type BakeLight } from '@cocoasurface/project';
import { engine } from '../engine/engine';
import { commit, edit, live, set, useApp } from '../store';
import { Range } from './controls';

const NONE: BakeLight[] = [];

/** Placing bake lights: drag their handles in the viewport, set their size and strength here. */
export function LightPanel({ onDone }: { onDone: () => void }) {
  const lights = useApp((s) => s.project?.bakeLights) ?? NONE;
  const sel = useApp((s) => s.lightSel);
  const host = document.querySelector('.cs-view');
  const l = lights.find((x) => x.id === sel);
  const change = (f: (x: BakeLight) => BakeLight) => live((p) => ({ ...p, bakeLights: (p.bakeLights ?? []).map((x) => (x.id === sel ? f(x) : x)) }));
  const add = () => {
    const box = engine.model ? new THREE.Box3().setFromObject(engine.model.root) : new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const n: BakeLight = { id: uid(), position: [c.x + size.x * 0.4, c.y + size.y * 0.9, c.z + size.z * 0.6], radius: 0.05, strength: 1 };
    edit('Add a bake light', (p) => ({ ...p, bakeLights: [...(p.bakeLights ?? []), n] }));
    set({ lightSel: n.id });
  };
  if (!host) return null;
  return createPortal(
    <div className="cs-lights">
      <div className="cs-sec">
        <span>Bake lights</span>
        <Button size="sm" onClick={add}>
          Add light
        </Button>
      </div>
      {lights.map((x, i) => (
        <button key={x.id} type="button" className={`cs-lr${x.id === sel ? ' on' : ''}`} onClick={() => set({ lightSel: x.id })}>
          <span className="cs-ln">Light {i + 1}</span>
        </button>
      ))}
      {!lights.length && <span className="cs-note">Add a light, then drag its handle in the viewport.</span>}
      {l && (
        <>
          <Field label="Size">
            <Range value={l.radius * 100} min={0.5} max={40} step={0.5} label="Light size, % of the model" onChange={(v) => change((x) => ({ ...x, radius: v / 100 }))} onCommit={() => commit('Change bake light size')} />
          </Field>
          <Field label="Strength">
            <Range value={l.strength} min={0} max={3} step={0.05} label="Light strength" onChange={(v) => change((x) => ({ ...x, strength: v }))} onCommit={() => commit('Change bake light strength')} />
          </Field>
          <Button
            size="sm"
            onClick={() => {
              edit('Remove a bake light', (p) => ({ ...p, bakeLights: (p.bakeLights ?? []).filter((x) => x.id !== l.id) }));
              set({ lightSel: null });
            }}
          >
            Remove light
          </Button>
        </>
      )}
      <Button variant="primary" onClick={onDone}>
        Back to baking
      </Button>
    </div>,
    host,
  );
}
