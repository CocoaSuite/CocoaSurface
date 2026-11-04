import { useState } from 'react';
import { Button, Dialog, Field, Switch } from '@cocoasurface/ui';
import { BEVEL_DEFAULTS, MESH_MAPS, TEXTURE_SIZES, type BakeSettings, type Bevel, type TextureSize } from '@cocoasurface/project';
import { bake, dropHighPoly, loadHighPoly, measureCages, meshesOf, pairsOf, settingsOf } from '../baking';
import { commit, currentSet, edit, live, useApp } from '../store';
import { Chips, Range } from './controls';

const pct = (v: number) => Math.round(v * 1000) / 10;

export function BakeDialog({ onClose }: { onClose: () => void }) {
  const project = useApp((s) => s.project)!;
  const t = currentSet()!;
  const [st, setSt] = useState<BakeSettings>(() => ({ ...settingsOf(t), useHigh: settingsOf(t).useHigh || !!project.highPoly }));
  const [all, setAll] = useState(project.textureSets.length > 1);
  const put = <K extends keyof BakeSettings>(k: K, v: BakeSettings[K]) => setSt((x) => ({ ...x, [k]: v }));
  const bevel = project.bevel ?? null;
  const setBevel = (b: Bevel | null) => edit(b ? (bevel ? 'Change the bevel shader' : 'Add a bevel shader') : 'Remove the bevel shader', (p) => ({ ...p, bevel: b }));
  const meshes = meshesOf(t.id);
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
          <Field label="Match names">
            <Switch checked={st.matchByName} onChange={(v) => put('matchByName', v)} label="Pair low and high meshes by name" />
          </Field>
          <Field label="Auto cages">
            <Switch checked={st.autoCage} onChange={(v) => put('autoCage', v)} label="Measure each mesh's cage before baking" />
          </Field>
          <div className="cs-cages">
            <span className="cs-meta">Mesh</span>
            <span className="cs-meta">In front %</span>
            <span className="cs-meta">Behind %</span>
            {meshes.map(({ name }) => {
              const c = st.cages[name] ?? { front: st.front, rear: st.rear };
              const pairs = st.matchByName ? pairsOf(name) : [];
              const cell = (k: 'front' | 'rear') => (
                <input
                  className="cs-input mono"
                  aria-label={`${name} ${k}`}
                  disabled={st.autoCage}
                  value={pct(c[k])}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 0) put('cages', { ...st.cages, [name]: { ...c, [k]: v / 100 } });
                  }}
                />
              );
              return (
                <span key={name} style={{ display: 'contents' }}>
                  <span title={pairs.length ? `Pairs with ${pairs.join(', ')}` : st.matchByName ? 'No high-poly mesh with this name: uses all of them' : undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                    {st.matchByName && !pairs.length && <span className="cs-meta"> (no pair)</span>}
                  </span>
                  {cell('front')}
                  {cell('rear')}
                </span>
              );
            })}
          </div>
          <Button size="sm" onClick={() => setSt((x) => ({ ...x, cages: measureCages(t.id, x) }))}>
            Measure cages now
          </Button>
          <span className="cs-note">Distances are a share of the model's size: rays start that far in front of each low-poly mesh and reach that far behind it. Paint skew and offset in the Mesh maps panel to fix spots by hand.</span>
        </>
      )}
      <div className="cs-sec">
        <span>Bevel shader</span>
        {bevel ? (
          <Button size="sm" onClick={() => setBevel(null)}>
            Remove
          </Button>
        ) : (
          <Button size="sm" onClick={() => setBevel({ ...BEVEL_DEFAULTS })}>
            Add
          </Button>
        )}
      </div>
      {bevel ? (
        <>
          <Field label="Radius">
            <Range value={pct(bevel.radius)} min={0.1} max={5} step={0.1} label="Bevel radius, % of the model" onChange={(v) => live((p) => ({ ...p, bevel: { ...bevel, radius: v / 100 } }))} onCommit={() => commit('Change the bevel radius')} />
          </Field>
          <Field label="Samples">
            <select className="cs-select" value={bevel.samples} onChange={(e) => setBevel({ ...bevel, samples: Number(e.target.value) })}>
              {[8, 16, 32, 64].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Edges">
            <select className="cs-select" value={bevel.edges} onChange={(e) => setBevel({ ...bevel, edges: e.target.value as Bevel['edges'] })}>
              <option value="convex">Outer edges</option>
              <option value="concave">Inner corners</option>
              <option value="both">Both</option>
            </select>
          </Field>
          <span className="cs-note">Rounds hard edges of the {st.useHigh && project.highPoly ? 'high-poly' : ''} model in every map baked from its surface: normal, world normal, occlusion, curvature and thickness.</span>
        </>
      ) : (
        <span className="cs-note">Add one to round hard edges in the bake without modelling bevels.</span>
      )}
      <Field label="Antialias">
        <select className="cs-select" value={st.antialias} onChange={(e) => put('antialias', Number(e.target.value) as BakeSettings['antialias'])}>
          <option value={1}>Off</option>
          <option value={2}>2 × 2</option>
          <option value={4}>4 × 4</option>
        </select>
      </Field>
      {st.antialias > 1 && st.size * st.antialias > 4096 && <span className="cs-note">Lowered to {Math.max(1, Math.floor(4096 / st.size))} × at this size.</span>}
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
