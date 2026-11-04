import { Field, PanelHeader, Section } from '@cocoasurface/ui';
import { CHANNELS, MESH_MAPS, TEXTURE_SIZES, type TextureSize } from '@cocoasurface/project';
import { Button } from '@cocoasurface/ui';
import { commit, currentSet, editSet, set, useApp } from '../store';
import { Chips, Range } from './controls';

export function TextureSets({ onBake }: { onBake: () => void }) {
  const project = useApp((s) => s.project)!;
  const setId = useApp((s) => s.setId);
  const view = useApp((s) => s.view);
  const t = currentSet();
  return (
    <div className="cs-pane">
      <PanelHeader title="Texture sets" />
      <div className="cs-scroll" style={{ flex: 'none', maxHeight: 180 }}>
        {project.textureSets.map((x) => (
          <div key={x.id} className={`cs-lr${x.id === setId ? ' on' : ''}`} onClick={() => set({ setId: x.id, layerId: x.layers[0]?.id ?? null, maskEdit: false })}>
            <span className="cs-ln" style={{ paddingLeft: 8 }}>{x.name}</span>
            <span className="cs-meta">{x.size}</span>
          </div>
        ))}
        {!project.textureSets.length && <div className="cs-empty">The model has no material slots.</div>}
      </div>
      {t && (
        <div className="cs-props">
          <Section title="Set" />
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
          <Button size="sm" onClick={onBake} disabled={!!useApp.getState().job}>
            {t.bake?.done.length ? 'Bake again…' : 'Bake mesh maps…'}
          </Button>
          <Section title="Lighting" />
          <Field label="Brightness">
            <Range value={view.light} min={0} max={3} label="Brightness" onChange={(v) => set((s) => ({ view: { ...s.view, light: v } }))} onCommit={() => {}} />
          </Field>
          <Field label="Turn">
            <Range value={view.turn} min={0} max={360} label="Turn" onChange={(v) => set((s) => ({ view: { ...s.view, turn: v } }))} onCommit={() => {}} />
          </Field>
        </div>
      )}
    </div>
  );
}
