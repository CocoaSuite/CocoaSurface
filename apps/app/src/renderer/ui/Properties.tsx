import { Button, Field, IconButton, NumberField, PanelHeader, Section, Segmented, Switch } from '@cocoasurface/ui';
import { engine } from '../engine/engine';
import { host } from '../host';
import { MASK_ROOT, setMask } from './Layers';
import { BLEND_MODES, CHANNELS, GENERATOR_SOURCES, MASK_BLENDS, newMaskItem, uid, updateLayer, type BlendMode, type FillLayer, type FlatValues, type Generator, type Layer, type Mask, type MaskBlend, type MaskItem, type TextureSet } from '@cocoasurface/project';
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

const MASK_ITEMS: { kind: MaskItem['kind']; label: string }[] = [
  { kind: 'paint', label: 'Paint' },
  { kind: 'generator', label: 'Generator' },
  { kind: 'image', label: 'Image' },
  { kind: 'fill', label: 'Fill' },
];

function MaskProps({ l, t }: { l: Layer; t: TextureSet }) {
  const maskItem = useApp((s) => s.maskItem);
  const maskValue = useApp((s) => s.brush.maskValue);
  const m = l.mask!;
  const it = m.items.find((x) => x.id === maskItem);
  const putMask = (label: string, f: (m: Mask) => Mask, gesture = false) => change(l, label, (x) => ({ ...x, mask: x.mask && f(x.mask) }), gesture);
  const putItem = (v: Partial<MaskItem>, gesture = false) => putMask(`Change ${it!.name}`, (mm) => ({ ...mm, items: mm.items.map((x) => (x.id === it!.id ? { ...x, ...v } : x)) }), gesture);
  const add = (kind: MaskItem['kind']) => {
    const n = newMaskItem(kind);
    const at = it ? m.items.indexOf(it) : 0;
    putMask(`Add ${n.name} to the mask`, (mm) => ({ ...mm, items: [...mm.items.slice(0, at), n, ...mm.items.slice(at)] }));
    set({ maskItem: n.id });
  };
  const move = (d: -1 | 1) => {
    const i = m.items.indexOf(it!);
    const j = i + d;
    if (j < 0 || j >= m.items.length) return;
    putMask('Move a mask item', (mm) => {
      const items = [...mm.items];
      [items[i], items[j]] = [items[j]!, items[i]!];
      return { ...mm, items };
    });
  };
  const pickImage = async () => {
    const [f] = await host.open([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]);
    if (!f) return;
    const file = `masks/${uid()}.${f.name.split('.').pop()!.toLowerCase()}`;
    await engine.addImage(file, f.bytes);
    putItem({ image: { file, name: f.name, scale: it?.image?.scale ?? 1, invert: it?.image?.invert ?? false }, name: f.name.replace(/\.[^.]+$/, '') });
  };
  const src = it?.generator && GENERATOR_SOURCES.find((x) => x.value === it.generator!.source)!;
  return (
    <>
      <Section title="Mask" />
      <Field label="Start">
        <Segmented label="Mask starts" options={[{ value: '0', label: 'Black' }, { value: '1', label: 'White' }]} value={String(m.base) as '0' | '1'} onChange={(v) => putMask('Change the mask', (mm) => ({ ...mm, base: v === '1' ? 1 : 0 }))} />
      </Field>
      <span className="cs-note">Add to the mask</span>
      <div className="cs-checks">
        {MASK_ITEMS.map((x) => (
          <button key={x.kind} type="button" className="cs-chip" onClick={() => add(x.kind)}>
            {x.label}
          </button>
        ))}
      </div>
      {it && (
        <>
          <Section
            title={it.name}
            action={
              <span className="cs-acts">
                <IconButton icon="up" label="Move up" onClick={() => move(-1)} />
                <IconButton icon="down" label="Move down" onClick={() => move(1)} />
                <IconButton
                  icon="trash"
                  label="Delete"
                  onClick={() => {
                    putMask(`Delete ${it.name}`, (mm) => ({ ...mm, items: mm.items.filter((x) => x.id !== it.id) }));
                    set({ maskItem: MASK_ROOT });
                  }}
                />
              </span>
            }
          />
          <Field label="Blend">
            <select className="cs-select" value={it.blend} onChange={(e) => putItem({ blend: e.target.value as MaskBlend })}>
              {MASK_BLENDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Opacity">
            <Range value={it.opacity} min={0} max={1} label="Opacity" onChange={(v) => putItem({ opacity: v }, true)} onCommit={() => commit(`Change ${it.name}`)} />
          </Field>
          {it.kind === 'paint' && (
            <>
              <Field label="Paints">
                <Segmented label="Paints" options={[{ value: '1', label: 'White' }, { value: '0', label: 'Black' }]} value={maskValue >= 0.5 ? '1' : '0'} onChange={(v) => set((s) => ({ brush: { ...s.brush, maskValue: v === '1' ? 1 : 0 } }))} />
              </Field>
              <Field label="Grey">
                <Range value={maskValue} min={0} max={1} label="Painted grey" onChange={(v) => set((s) => ({ brush: { ...s.brush, maskValue: v } }))} onCommit={() => {}} />
              </Field>
              <span className="cs-note">White shows the layer, black hides it. Erase takes strokes away.</span>
            </>
          )}
          {it.kind === 'generator' && it.generator && (
            <>
              <Field label="From">
                <select className="cs-select" value={it.generator.source} onChange={(e) => putItem({ generator: { ...it.generator!, source: e.target.value as Generator['source'] } })}>
                  {GENERATOR_SOURCES.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </Field>
              {!t.bake?.done.includes(src!.map) && <span className="cs-note warn">Bake the {src!.map === 'worldNormal' ? 'world normal' : src!.map} mesh map to use this.</span>}
              <Field label="Level">
                <Range value={it.generator.level} min={0} max={1} label="Level" onChange={(v) => putItem({ generator: { ...it.generator!, level: v } }, true)} onCommit={() => commit(`Change ${it.name}`)} />
              </Field>
              <Field label="Softness">
                <Range value={it.generator.spread} min={0} max={0.5} label="Softness" onChange={(v) => putItem({ generator: { ...it.generator!, spread: v } }, true)} onCommit={() => commit(`Change ${it.name}`)} />
              </Field>
              <Field label="Invert">
                <Switch checked={it.generator.invert} label="Invert" onChange={(v) => putItem({ generator: { ...it.generator!, invert: v } })} />
              </Field>
            </>
          )}
          {it.kind === 'image' && (
            <>
              <Field label="Image">
                <Button size="sm" onClick={() => void pickImage()}>
                  {it.image ? it.image.name : 'Choose…'}
                </Button>
              </Field>
              {it.image && (
                <>
                  <Field label="Repeat">
                    <Range value={it.image.scale} min={0.25} max={16} step={0.25} label="Repeat" onChange={(v) => putItem({ image: { ...it.image!, scale: v } }, true)} onCommit={() => commit(`Change ${it.name}`)} />
                  </Field>
                  <Field label="Invert">
                    <Switch checked={it.image.invert} label="Invert" onChange={(v) => putItem({ image: { ...it.image!, invert: v } })} />
                  </Field>
                </>
              )}
            </>
          )}
          {it.kind === 'fill' && (
            <Field label="Value">
              <Range value={it.value ?? 1} min={0} max={1} label="Value" onChange={(v) => putItem({ value: v }, true)} onCommit={() => commit(`Change ${it.name}`)} />
            </Field>
          )}
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
  const maskEdit = useApp((s) => s.maskItem) !== null;
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
      <PanelHeader title={maskEdit ? `${l.name}: mask` : l.name}>
        {maskEdit && (
          <Button size="sm" onClick={() => set({ maskItem: null })}>
            Layer
          </Button>
        )}
      </PanelHeader>
      <div className="cs-scroll">
        <div className="cs-props" style={{ padding: '0 4px 14px' }}>
          {l.kind !== 'group' && !maskEdit && (
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
          {!maskEdit && <Field label="Opacity">
            <Range value={l.opacity} min={0} max={1} label="Opacity" onChange={(v) => change(l, '', (x) => ({ ...x, opacity: v }), true)} onCommit={() => commit(`Change opacity of ${l.name}`)} />
          </Field>}
          {!maskEdit && <span className="cs-note">Channels</span>}
          {!maskEdit && <Chips
            options={CHANNELS.filter((c) => t.channels.includes(c.id)).map((c) => ({ value: c.id, label: c.label, disabled: l.kind === 'paint' && c.id === 'normal' }))}
            value={l.channels}
            onChange={(v) => change(l, `Change channels of ${l.name}`, (x) => ({ ...x, channels: v }))}
          />}
          {maskEdit && l.mask && <MaskProps l={l} t={t} />}
          {l.kind === 'paint' && !maskEdit && <BrushProps l={l} />}
          {l.kind === 'paint' && !maskEdit && <span className="cs-note">Normal detail comes from painted height.</span>}
          {l.kind === 'fill' && !maskEdit && <FillProps l={l} />}
          {l.kind !== 'group' && !l.mask && (
            <>
              <Section title="Mask" />
              <div className="cs-checks">
                <Button size="sm" onClick={() => setMask(0)}>
                  Add black mask
                </Button>
                <Button size="sm" onClick={() => setMask(1)}>
                  Add white mask
                </Button>
              </div>
            </>
          )}
          {l.kind !== 'group' && l.mask && !maskEdit && (
            <Button size="sm" onClick={() => set({ maskItem: l.mask!.items[0]?.id ?? MASK_ROOT })}>
              Edit the mask
            </Button>
          )}
          {l.kind === 'group' && <span className="cs-note">The group's opacity and visibility apply to the layers in it.</span>}
        </div>
      </div>
    </div>
  );
}
