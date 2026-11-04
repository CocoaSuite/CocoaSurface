import { Button, Field, NumberField, PanelHeader, Section, Switch } from '@cocoasurface/ui';
import { BLEND_MODES, CHANNELS, GENERATOR_SOURCES, updateLayer, type BlendMode, type FillLayer, type FlatValues, type Generator, type Layer, type TextureSet } from '@cocoasurface/project';
import type { Parameter } from '@cocoasurface/materials';
import type { LoadedMaterial } from '../engine/library';
import { exportFillMaterial } from '../io';
import { commit, currentLayer, currentSet, editSet, set, useApp, type Brush } from '../store';
import { Chips, Colour, Range } from './controls';

const change = (l: Layer, label: string, f: (x: Layer) => Layer, gesture = false) => editSet(label, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, f) }), gesture);

function Param({ p, m, l }: { p: Parameter; m: LoadedMaterial; l: FillLayer }) {
  const value = l.use!.values[p.id] ?? p.value;
  const put = (v: unknown, gesture = false) => change(l, `Change ${p.label}`, (x) => ({ ...(x as FillLayer), use: { ...(x as FillLayer).use!, values: { ...(x as FillLayer).use!.values, [p.id]: v } } }), gesture);
  const done = () => commit(`Change ${p.label}`);
  const node = m.file.graph.nodes.find((n) => n.id === p.node);
  const def = node && m.file.nodes.nodes.find((n) => n.type === node.type)?.params.find((q) => q.id === p.param);
  let control;
  switch (p.kind) {
    case 'number':
    case 'int':
      control = <Range value={value as number} min={p.min ?? 0} max={p.max ?? 1} step={p.kind === 'int' ? 1 : p.step} label={p.label} onChange={(v) => put(v, true)} onCommit={done} />;
      break;
    case 'seed':
      control = (
        <span className="cs-range">
          <NumberField value={value as number} label="" ariaLabel={p.label} onCommit={(v) => put(Math.round(v))} />
          <Button size="sm" onClick={() => put(Math.floor(Math.random() * 100000))}>
            New
          </Button>
        </span>
      );
      break;
    case 'choice':
      control = (
        <select className="cs-select" value={value as string} onChange={(e) => put(e.target.value)}>
          {(def?.options ?? (p.options ?? []).map((o) => ({ value: o, label: { en: o } }))).map((o) => (
            <option key={o.value} value={o.value}>
              {(o.label as { en: string }).en}
            </option>
          ))}
        </select>
      );
      break;
    case 'color':
      control = <Colour value={value as string} label={p.label} onChange={(v) => put(v, true)} onCommit={done} />;
      break;
    case 'bool':
      control = <Switch checked={!!value} label={p.label} onChange={(v) => put(v)} />;
      break;
    case 'ramp': {
      const stops = value as { at: number; color: string }[];
      control = (
        <span className="cs-checks">
          {stops.map((s, i) => (
            <Colour key={i} value={s.color} label={`${p.label} ${Math.round(s.at * 100)}%`} onChange={(c) => put(stops.map((x, j) => (j === i ? { ...x, color: c } : x)), true)} onCommit={done} />
          ))}
        </span>
      );
      break;
    }
    case 'image':
      control = (
        <select className="cs-select" value={value as string} onChange={(e) => put(e.target.value)}>
          <option value="">None</option>
          {[...m.file.images.keys()].map((k) => (
            <option key={k} value={k}>
              {k.replace('images/', '')}
            </option>
          ))}
        </select>
      );
      break;
  }
  return <Field label={p.label}>{control}</Field>;
}

const FLAT: { k: keyof FlatValues; c: string; label: string; colour?: boolean }[] = [
  { k: 'color', c: 'color', label: 'Colour', colour: true },
  { k: 'roughness', c: 'roughness', label: 'Roughness' },
  { k: 'metalness', c: 'metalness', label: 'Metal' },
  { k: 'height', c: 'height', label: 'Height' },
  { k: 'occlusion', c: 'occlusion', label: 'Occlusion' },
  { k: 'glow', c: 'glow', label: 'Glow', colour: true },
  { k: 'opacity', c: 'opacity', label: 'Opacity' },
];

function FillProps({ l }: { l: FillLayer }) {
  const project = useApp((s) => s.project)!;
  const materials = useApp((s) => s.materials);
  const m = l.use ? materials[l.use.material] : undefined;
  const flat = (k: keyof FlatValues, v: unknown, gesture: boolean) => change(l, `Change ${l.name}`, (x) => ({ ...(x as FillLayer), flat: { ...(x as FillLayer).flat, [k]: v } }), gesture);
  return (
    <>
      <Section title="Fill" />
      <Field label="Material">
        <select
          className="cs-select"
          value={l.use?.material ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            const lm = materials[id];
            change(l, id ? `Use ${lm?.file.manifest.name}` : 'Use flat values', (x) => ({ ...(x as FillLayer), use: id && lm ? { material: id, scale: 1, values: Object.fromEntries(lm.file.manifest.parameters.map((p) => [p.id, p.value])) } : null }));
          }}
        >
          <option value="">Flat values</option>
          {project.library.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      {l.use && m ? (
        <>
          {m.unknown.length > 0 && <span className="cs-note warn">This material uses nodes this version doesn't know ({m.unknown.join(', ')}). They may look different here than in CocoaWorlds.</span>}
          <Field label="Repeat">
            <Range value={l.use.scale} min={0.25} max={16} step={0.25} label="Repeat" onChange={(v) => change(l, 'Change repeat', (x) => ({ ...(x as FillLayer), use: { ...(x as FillLayer).use!, scale: v } }), true)} onCommit={() => commit('Change repeat')} />
          </Field>
          {m.file.manifest.parameters.length ? <Section title="Parameters" /> : <span className="cs-note">The material has no exposed parameters.</span>}
          {m.file.manifest.parameters.map((p) => (
            <Param key={p.id} p={p} m={m} l={l} />
          ))}
          <Button size="sm" onClick={() => void exportFillMaterial(l)}>
            Export with these values…
          </Button>
          <span className="cs-note">Channels the material has no map for use the flat values below.</span>
        </>
      ) : null}
      {FLAT.filter((f) => l.channels.includes(f.c as never)).map((f) => (
        <Field key={f.k} label={f.label}>
          {f.colour ? (
            <Colour value={l.flat[f.k] as string} label={f.label} onChange={(v) => flat(f.k, v, true)} onCommit={() => commit(`Change ${l.name}`)} />
          ) : (
            <Range value={l.flat[f.k] as number} min={0} max={1} label={f.label} onChange={(v) => flat(f.k, v, true)} onCommit={() => commit(`Change ${l.name}`)} />
          )}
        </Field>
      ))}
    </>
  );
}

function GeneratorProps({ l, t }: { l: Layer; t: TextureSet }) {
  const g = l.generator;
  const put = (v: Partial<Generator> | null, gesture = false) =>
    change(l, v ? `Change the mask of ${l.name}` : `Remove the generated mask of ${l.name}`, (x) => ({ ...x, generator: v ? { ...(x.generator ?? { source: 'curvature', level: 0.6, spread: 0.1, invert: false }), ...v } : null }), gesture);
  const src = g && GENERATOR_SOURCES.find((x) => x.value === g.source)!;
  return (
    <>
      <Section title="Generated mask" />
      <Field label="From">
        <select className="cs-select" value={g?.source ?? ''} onChange={(e) => put(e.target.value ? { source: e.target.value as Generator['source'] } : null)}>
          <option value="">None</option>
          {GENERATOR_SOURCES.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
      </Field>
      {g && (
        <>
          {!t.bake?.done.includes(src!.map) && <span className="cs-note warn">Bake the {src!.map === 'worldNormal' ? 'world normal' : src!.map} mesh map to use this.</span>}
          <Field label="Level">
            <Range value={g.level} min={0} max={1} label="Level" onChange={(v) => put({ level: v }, true)} onCommit={() => commit(`Change the mask of ${l.name}`)} />
          </Field>
          <Field label="Softness">
            <Range value={g.spread} min={0} max={0.5} label="Softness" onChange={(v) => put({ spread: v }, true)} onCommit={() => commit(`Change the mask of ${l.name}`)} />
          </Field>
          <Field label="Invert">
            <Switch checked={g.invert} label="Invert" onChange={(v) => put({ invert: v })} />
          </Field>
          {l.mask && <span className="cs-note">Multiplied by the painted mask.</span>}
        </>
      )}
    </>
  );
}

function BrushProps({ l }: { l: Layer }) {
  const b = useApp((s) => s.brush);
  const put = (k: keyof Brush, v: unknown) => set((s) => ({ brush: { ...s.brush, [k]: v } }));
  const has = (c: string) => l.channels.includes(c as never);
  return (
    <>
      <Section title="Brush" />
      {has('color') && (
        <Field label="Colour">
          <Colour value={b.color} label="Brush colour" onChange={(v) => put('color', v)} onCommit={() => {}} />
        </Field>
      )}
      {has('roughness') && (
        <Field label="Roughness">
          <Range value={b.roughness} min={0} max={1} label="Brush roughness" onChange={(v) => put('roughness', v)} onCommit={() => {}} />
        </Field>
      )}
      {has('metalness') && (
        <Field label="Metal">
          <Range value={b.metalness} min={0} max={1} label="Brush metal" onChange={(v) => put('metalness', v)} onCommit={() => {}} />
        </Field>
      )}
      {has('height') && (
        <Field label="Height">
          <Range value={b.height} min={0} max={1} label="Brush height" onChange={(v) => put('height', v)} onCommit={() => {}} />
        </Field>
      )}
      {has('glow') && (
        <Field label="Glow">
          <Colour value={b.glow} label="Brush glow" onChange={(v) => put('glow', v)} onCommit={() => {}} />
        </Field>
      )}
    </>
  );
}

export function Properties() {
  useApp((s) => s.project);
  useApp((s) => s.layerId);
  const maskEdit = useApp((s) => s.maskEdit);
  const t = currentSet();
  const l = currentLayer();
  if (!t || !l)
    return (
      <div className="cs-pane">
        <PanelHeader title="Properties" />
        <div className="cs-empty" style={{ padding: '0 12px' }}>
          Pick a layer to change it.
        </div>
      </div>
    );
  return (
    <div className="cs-pane">
      <PanelHeader title={l.name} />
      <div className="cs-scroll">
        <div className="cs-props" style={{ padding: '0 4px 14px' }}>
          {l.kind !== 'group' && (
            <Field label="Blend">
              <select className="cs-select" value={l.blend} onChange={(e) => change(l, `Change blend of ${l.name}`, (x) => ({ ...x, blend: e.target.value as BlendMode }))}>
                {BLEND_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Opacity">
            <Range value={l.opacity} min={0} max={1} label="Opacity" onChange={(v) => change(l, '', (x) => ({ ...x, opacity: v }), true)} onCommit={() => commit(`Change opacity of ${l.name}`)} />
          </Field>
          <span className="cs-note">Channels</span>
          <Chips
            options={CHANNELS.filter((c) => t.channels.includes(c.id)).map((c) => ({ value: c.id, label: c.label, disabled: l.kind === 'paint' && c.id === 'normal' }))}
            value={l.channels}
            onChange={(v) => change(l, `Change channels of ${l.name}`, (x) => ({ ...x, channels: v }))}
          />
          {maskEdit && l.mask && <span className="cs-note">Painting the mask: Paint shows the layer, Erase hides it.</span>}
          {l.kind === 'paint' && !maskEdit && <BrushProps l={l} />}
          {l.kind === 'paint' && !maskEdit && <span className="cs-note">Normal detail comes from painted height.</span>}
          {l.kind === 'fill' && <FillProps l={l} />}
          {l.kind === 'fill' && !l.mask && !l.generator && <span className="cs-note">Add a mask to paint where this fill shows, or generate one from the mesh maps.</span>}
          {l.kind !== 'group' && <GeneratorProps l={l} t={t} />}
          {l.kind === 'group' && <span className="cs-note">The group's opacity and visibility apply to the layers in it.</span>}
        </div>
      </div>
    </div>
  );
}
