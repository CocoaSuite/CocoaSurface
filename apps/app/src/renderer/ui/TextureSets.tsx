import { Field, Section } from '@cocoasurface/ui';
import { CHANNELS, MESH_MAPS, TEXTURE_SIZES, type TextureSize } from '@cocoasurface/project';
import { Button, IconButton, Segmented, Switch } from '@cocoasurface/ui';
import { uid } from '@cocoasurface/project';
import { commit, currentSet, editSet, ENVIRONMENTS, set, useApp, type Environment, type ViewLight } from '../store';
import { Chips, Color, Range } from './controls';
import { focusPanel } from './Dock';

export function TextureSetList() {
  const project = useApp((s) => s.project)!;
  const setId = useApp((s) => s.setId);
  return (
      <div className="cs-scroll">
      {project.textureSets.map((x) => (
        <div key={x.id} className={`cs-lr${x.id === setId ? ' on' : ''}`} onClick={() => set({ setId: x.id, layerId: x.layers[0]?.id ?? null, maskItem: null })}>
          <span className="cs-ln" style={{ paddingLeft: 8 }}>{x.name}</span>
          <span className="cs-meta">{x.size}</span>
          <button type="button" className="cs-btn sm ghost" onClick={(e) => (e.stopPropagation(), set({ setId: x.id }), focusPanel('settings'))}>
            Settings
          </button>
        </div>
      ))}
      {!project.textureSets.length && <div className="cs-empty">The model has no material slots.</div>}
    </div>
  );
}

export function TextureSetSettings({ onBake }: { onBake: () => void }) {
  useApp((s) => s.project);
  const view = useApp((s) => s.view);
  const bakePaint = useApp((s) => s.bakePaint);
  const bakeValue = useApp((s) => s.bakeValue);
  const t = currentSet();
  if (!t) return <div className="cs-empty">No texture set.</div>;
  return (
    <div className="cs-tsets cs-scroll">
      <div className="cs-props">
          <Section title={t.name} />
          <Field label="Size">
            <select className="cs-select" value={t.size} onChange={(e) => editSet('Change texture size', (s) => ({ ...s, size: Number(e.target.value) as TextureSize }))}>
              {TEXTURE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} × {n}
                </option>
              ))}
            </select>
          </Field>
          <span className="cs-note">Channels</span>
          <Chips options={CHANNELS.map((c) => ({ value: c.id, label: c.label }))} value={t.channels} onChange={(v) => editSet('Change channels', (s) => ({ ...s, channels: CHANNELS.map((c) => c.id).filter((c) => v.includes(c)) }))} />
          {t.channels.includes('height') && t.channels.includes('normal') && (
            <Field label="Bumps">
              <Range value={t.bump ?? 1} min={0} max={4} label="Bump strength" onChange={(v) => editSet('', (s) => ({ ...s, bump: v }), true)} onCommit={() => commit('Change bump strength')} />
            </Field>
          )}
          <Section title="Mesh maps" />
          {t.bake?.done.length ? (
            <div className="cs-checks">
              {MESH_MAPS.filter((m) => t.bake!.done.includes(m.id)).map((m) => (
                <button key={m.id} type="button" className={`cs-chip${view.mode === `mesh:${m.id}` ? ' on' : ''}`} onClick={() => set((s) => ({ view: { ...s.view, mode: s.view.mode === `mesh:${m.id}` ? 'material' : `mesh:${m.id}` } }))}>
                  {m.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="cs-note">Not baked. Baked maps give the normal and occlusion channels their base, and drive edge, cavity and height masks.</span>
          )}
          {(
            <>
              <span className="cs-note">Paint for baking</span>
              <Segmented
                label="Paint for baking"
                options={[{ value: 'off', label: 'Off' }, { value: 'skew', label: 'Skew' }, { value: 'offset', label: 'Offset' }]}
                value={bakePaint ?? 'off'}
                onChange={(v) => set((s) => ({ bakePaint: v === 'off' ? null : v, bakeValue: v === 'offset' ? 0.75 : 1, view: { ...s.view, mode: v === 'off' ? 'material' : `bake:${v}` } }))}
              />
              {bakePaint && (
                <>
                  <Field label={bakePaint === 'skew' ? 'Skew' : 'Offset'}>
                    <Range value={bakeValue} min={0} max={1} label="Painted value" onChange={(v) => set({ bakeValue: v })} onCommit={() => {}} />
                  </Field>
                  <span className="cs-note">
                    {bakePaint === 'skew'
                      ? 'White turns rays to the face normal where details come out skewed. Erase returns to the smooth normal.'
                      : 'Grey is the cage as measured; lighter reaches further, darker less. Erase returns to grey.'}{' '}
                    Bake again to see the effect.
                  </span>
                </>
              )}
            </>
          )}
          <Field label="Cage">
            <Switch checked={view.cage} onChange={(v) => set((s) => ({ view: { ...s.view, cage: v } }))} label="Show the bake cage" />
          </Field>
          <Button size="sm" onClick={onBake} disabled={!!useApp.getState().job}>
            {t.bake?.done.length ? 'Bake again…' : 'Bake mesh maps…'}
          </Button>
      </div>
    </div>
  );
}

const KINDS = [{ value: 'sun', label: 'Sun' }, { value: 'point', label: 'Point' }, { value: 'spot', label: 'Spot' }] as const;

function ViewLights() {
  const lights = useApp((s) => s.view.lights) ?? [];
  const put = (f: (l: ViewLight[]) => ViewLight[]) => set((s) => ({ view: { ...s.view, lights: f(s.view.lights ?? []) } }));
  const change = (id: string, v: Partial<ViewLight>) => put((ls) => ls.map((l) => (l.id === id ? { ...l, ...v } : l)));
  const add = () => put((ls) => [...ls, { id: uid(), kind: 'sun', color: '#ffffff', strength: 2, turn: 45 + ls.length * 90, height: 40, distance: 2, cone: 35, shadows: true, on: true }]);
  return (
    <>
      <Section title="Lights" action={<IconButton icon="plus" label="Add a light" onClick={add} />} />
      {lights.map((l, i) => (
        <div key={l.id} className="cs-vlight">
          <div className="cs-vlight-head">
            <Switch checked={l.on} label={`Light ${i + 1}`} onChange={(on) => change(l.id, { on })} />
            <Segmented label="Kind" options={[...KINDS]} value={l.kind} onChange={(kind) => change(l.id, { kind })} />
            <IconButton icon="trash" label="Remove" onClick={() => put((ls) => ls.filter((x) => x.id !== l.id))} />
          </div>
          <Field label="Color">
            <Color value={l.color} label="Color" onChange={(color) => change(l.id, { color })} onCommit={() => {}} />
          </Field>
          <Field label="Strength">
            <Range value={l.strength} min={0} max={10} label="Strength" onChange={(strength) => change(l.id, { strength })} onCommit={() => {}} />
          </Field>
          <Field label="Turn">
            <Range value={l.turn} min={0} max={360} label="Turn" onChange={(turn) => change(l.id, { turn })} onCommit={() => {}} />
          </Field>
          <Field label="Height">
            <Range value={l.height} min={-90} max={90} label="Height" onChange={(height) => change(l.id, { height })} onCommit={() => {}} />
          </Field>
          {l.kind !== 'sun' && (
            <Field label="Distance">
              <Range value={l.distance} min={0.5} max={8} label="Distance" onChange={(distance) => change(l.id, { distance })} onCommit={() => {}} />
            </Field>
          )}
          {l.kind === 'spot' && (
            <Field label="Cone">
              <Range value={l.cone} min={5} max={85} label="Cone" onChange={(cone) => change(l.id, { cone })} onCommit={() => {}} />
            </Field>
          )}
          <Field label="Shadows">
            <Switch checked={l.shadows} label="Shadows" onChange={(shadows) => change(l.id, { shadows })} />
          </Field>
        </div>
      ))}
    </>
  );
}

export function DisplaySettings() {
  const view = useApp((s) => s.view);
  return (
    <div className="cs-scroll"><div className="cs-props">
          <Section title="Environment" />
          <Field label="Light">
            <select className="cs-select" value={view.env} onChange={(e) => set((s) => ({ view: { ...s.view, env: e.target.value as Environment } }))}>
              {ENVIRONMENTS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Show">
            <Switch checked={view.showEnv} label="Show the environment" onChange={(v) => set((s) => ({ view: { ...s.view, showEnv: v } }))} />
          </Field>
          <Field label="Brightness">
            <Range value={view.light} min={0} max={3} label="Brightness" onChange={(v) => set((s) => ({ view: { ...s.view, light: v } }))} onCommit={() => {}} />
          </Field>
          <Field label="Turn">
            <Range value={view.turn} min={0} max={360} label="Turn" onChange={(v) => set((s) => ({ view: { ...s.view, turn: v } }))} onCommit={() => {}} />
          </Field>
          <ViewLights />
          <Section title="Camera" />
          <Field label="Projection">
            <Segmented label="Projection" options={[{ value: 'p', label: 'Perspective' }, { value: 'o', label: 'Orthographic' }]} value={view.ortho ? 'o' : 'p'} onChange={(v) => set((s) => ({ view: { ...s.view, ortho: v === 'o' } }))} />
          </Field>
          <Field label="Wireframe">
            <Switch checked={view.wire} label="Wireframe" onChange={(v) => set((s) => ({ view: { ...s.view, wire: v } }))} />
          </Field>
          <Field label="Grid">
            <Switch checked={view.grid} label="Grid" onChange={(v) => set((s) => ({ view: { ...s.view, grid: v } }))} />
          </Field>
    </div></div>
  );
}
