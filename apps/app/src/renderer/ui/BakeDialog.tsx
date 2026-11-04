import { useState } from 'react';
import { Button, Dialog, Field, Switch } from '@cocoasurface/ui';
import { MESH_MAPS, TEXTURE_SIZES, type BakeSettings, type TextureSize } from '@cocoasurface/project';
import { bake, dropHighPoly, loadHighPoly, settingsOf } from '../baking';
import { currentSet, useApp } from '../store';
import { Chips, Range } from './controls';

export function BakeDialog({ onClose }: { onClose: () => void }) {
  const project = useApp((s) => s.project)!;
  const t = currentSet()!;
  const [st, setSt] = useState<BakeSettings>(() => ({ ...settingsOf(t), useHigh: settingsOf(t).useHigh || !!project.highPoly }));
  const [all, setAll] = useState(project.textureSets.length > 1);
  const put = <K extends keyof BakeSettings>(k: K, v: BakeSettings[K]) => setSt((x) => ({ ...x, [k]: v }));
  const go = () => {
    onClose();
    void bake(all ? project.textureSets.map((x) => x.id) : [t.id], st);
  };
  return (
    <Dialog title="Bake mesh maps" onClose={onClose} width={480}>
      <span className="cs-note">Maps</span>
      <Chips options={MESH_MAPS.map((m) => ({ value: m.id, label: m.label }))} value={st.maps} onChange={(v) => put('maps', MESH_MAPS.map((m) => m.id).filter((m) => v.includes(m)))} />
      <Field label="Size">
        <select className="cs-select" value={st.size} onChange={(e) => put('size', Number(e.target.value) as TextureSize)}>
          {TEXTURE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} × {n}
            </option>
          ))}
        </select>
      </Field>
      <div className="cs-sec">High poly</div>
      <Field label="Model">
        <span className="cs-range" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
          <span className="cs-note" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.highPoly?.name ?? 'None: bake from the mesh itself'}</span>
          {project.highPoly ? (
            <Button size="sm" onClick={dropHighPoly}>
              Remove
            </Button>
          ) : (
            <Button size="sm" onClick={() => void loadHighPoly().then(() => put('useHigh', true))}>
              Load…
            </Button>
          )}
        </span>
      </Field>
      {project.highPoly && (
        <>
          <Field label="Use it">
            <Switch checked={st.useHigh} onChange={(v) => put('useHigh', v)} label="Bake from the high-poly model" />
          </Field>
          <Field label="In front">
            <Range value={st.front * 100} min={0} max={10} step={0.1} label="Ray distance in front, % of the model" onChange={(v) => put('front', v / 100)} onCommit={(v) => put('front', v / 100)} />
          </Field>
          <Field label="Behind">
            <Range value={st.rear * 100} min={0} max={10} step={0.1} label="Ray distance behind, % of the model" onChange={(v) => put('rear', v / 100)} onCommit={(v) => put('rear', v / 100)} />
          </Field>
          <span className="cs-note">The distances are a share of the model's size. Rays start that far in front of the low-poly surface and reach that far behind it.</span>
        </>
      )}
      {(st.maps.includes('occlusion') || st.maps.includes('thickness')) && (
        <>
          <div className="cs-sec">Occlusion and thickness</div>
          <Field label="Rays">
            <select className="cs-select" value={st.aoSamples} onChange={(e) => put('aoSamples', Number(e.target.value))}>
              {[16, 32, 64, 128, 256].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Distance">
            <Range value={st.aoDistance * 100} min={1} max={100} step={1} label="Occlusion distance, % of the model" onChange={(v) => put('aoDistance', v / 100)} onCommit={(v) => put('aoDistance', v / 100)} />
          </Field>
        </>
      )}
      {st.maps.includes('id') && (
        <Field label="ID colours">
          <select className="cs-select" value={st.idFrom} onChange={(e) => put('idFrom', e.target.value as BakeSettings['idFrom'])}>
            <option value="material">By material</option>
            <option value="mesh">By mesh</option>
          </select>
        </Field>
      )}
      {project.textureSets.length > 1 && (
        <Field label="All sets">
          <Switch checked={all} onChange={setAll} label="Bake every texture set" />
        </Field>
      )}
      <div className="cs-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!st.maps.length} onClick={go}>
          Bake
        </Button>
      </div>
    </Dialog>
  );
}
