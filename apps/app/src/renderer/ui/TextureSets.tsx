import { Field, PanelHeader, Section } from '@cocoasurface/ui';
import { CHANNELS, TEXTURE_SIZES, type TextureSize } from '@cocoasurface/project';
import { commit, currentSet, editSet, set, useApp } from '../store';
import { Chips, Range } from './controls';

export function TextureSets() {
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
