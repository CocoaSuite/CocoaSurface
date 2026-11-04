import { Button, Field, IconButton, NumberField, PanelHeader, Section, Segmented, Switch } from '@cocoasurface/ui';
import { engine } from '../engine/engine';
import { host } from '../host';
import { MASK_ROOT, setMask } from './Layers';
import { BLEND_MODES, CHANNELS, EFFECT_KINDS, GENERATOR_SOURCES, NOISE_LABELS, NOISE_TYPES, type NoiseType, MASK_BLENDS, newLayerEffect, newMaskItem, uid, updateLayer, type BlendMode, type Effect, type EffectKind, type FillLayer, type FlatValues, type Generator, type Layer, type TextureSet } from '@cocoasurface/project';
import type { Parameter } from '@cocoasurface/materials';
import type { LoadedMaterial } from '../engine/library';
import { exportFillMaterial } from '../io';
import { commit, currentLayer, currentSet, editSet, set, useApp, type Brush } from '../store';
import { Chips, Color, Range } from './controls';
import { AssetPicker } from './Assets';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="cs-f">
    <span>{label}</span>
    {children}
  </div>
);

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
      control = <Color value={value as string} label={p.label} onChange={(v) => put(v, true)} onCommit={done} />;
      break;
    case 'bool':
      control = <Switch checked={!!value} label={p.label} onChange={(v) => put(v)} />;
      break;
    case 'ramp': {
      const stops = value as { at: number; color: string }[];
      control = (
        <span className="cs-checks">
          {stops.map((s, i) => (
            <Color key={i} value={s.color} label={`${p.label} ${Math.round(s.at * 100)}%`} onChange={(c) => put(stops.map((x, j) => (j === i ? { ...x, color: c } : x)), true)} onCommit={done} />
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

const FLAT: { k: keyof FlatValues; c: string; label: string; color?: boolean }[] = [
  { k: 'color', c: 'color', label: 'Color', color: true },
  { k: 'roughness', c: 'roughness', label: 'Roughness' },
  { k: 'metalness', c: 'metalness', label: 'Metal' },
  { k: 'height', c: 'height', label: 'Height' },
  { k: 'occlusion', c: 'occlusion', label: 'Occlusion' },
  { k: 'glow', c: 'glow', label: 'Glow', color: true },
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
          {f.color ? (
            <Color value={l.flat[f.k] as string} label={f.label} onChange={(v) => flat(f.k, v, true)} onCommit={() => commit(`Change ${l.name}`)} />
          ) : (
            <Range value={l.flat[f.k] as number} min={0} max={1} label={f.label} onChange={(v) => flat(f.k, v, true)} onCommit={() => commit(`Change ${l.name}`)} />
          )}
        </Field>
      ))}
    </>
  );
}

type Where = 'mask' | 'layer';

const listOf = (l: Layer, w: Where) => (w === 'mask' ? (l.mask?.items ?? []) : (l.effects ?? []));

function putList(l: Layer, w: Where, label: string, f: (items: Effect[]) => Effect[], gesture = false) {
  change(l, label, (x) => (w === 'mask' ? { ...x, mask: x.mask && { ...x.mask, items: f(x.mask.items) } } : { ...x, effects: f(x.effects ?? []) }), gesture);
}

function AddEffect({ l, w }: { l: Layer; w: Where }) {
  const sel = useApp((s) => (w === 'mask' ? s.maskItem : s.effect));
  const add = (kind: EffectKind) => {
    const n = w === 'mask' ? newMaskItem(kind) : newLayerEffect(kind, kind === 'fill' && l.kind === 'fill' ? { flat: { ...l.flat } } : {});
    const items = listOf(l, w);
    const at = Math.max(0, items.findIndex((x) => x.id === sel));
    putList(l, w, `Add ${n.name}`, (xs) => [...xs.slice(0, at), n, ...xs.slice(at)]);
    set(w === 'mask' ? { maskItem: n.id } : { effect: n.id, maskItem: null });
  };
  return (
    <div className="cs-checks">
      {EFFECT_KINDS.filter((x) => w === 'layer' || x.mask).map((x) => (
        <button key={x.kind} type="button" className="cs-chip" onClick={() => add(x.kind)}>
          {x.label}
        </button>
      ))}
    </div>
  );
}

function EffectProps({ l, t, w, it }: { l: Layer; t: TextureSet; w: Where; it: Effect }) {
  const maskValue = useApp((s) => s.brush.maskValue);
  const items = listOf(l, w);
  const putItem = (v: Partial<Effect>, gesture = false) => putList(l, w, `Change ${it.name}`, (xs) => xs.map((x) => (x.id === it.id ? { ...x, ...v } : x)), gesture);
  const done = () => commit(`Change ${it.name}`);
  const move = (d: -1 | 1) => {
    const i = items.indexOf(it), j = i + d;
    if (j < 0 || j >= items.length) return;
    putList(l, w, 'Move an effect', (xs) => {
      const ys = [...xs];
      [ys[i], ys[j]] = [ys[j]!, ys[i]!];
      return ys;
    });
  };
  const pickImage = async () => {
    const [f] = await host.open([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]);
    if (!f) return;
    const file = `masks/${uid()}.${f.name.split('.').pop()!.toLowerCase()}`;
    await engine.addImage(file, f.bytes);
    putItem({ image: { file, name: f.name, scale: it.image?.scale ?? 1, invert: it.image?.invert ?? false }, name: f.name.replace(/\.[^.]+$/, '') });
  };
  const pickNoise = async () => {
    const [f] = await host.open([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]);
    if (!f) return;
    const file = `masks/${uid()}.${f.name.split('.').pop()!.toLowerCase()}`;
    await engine.addImage(file, f.bytes);
    putItem({ generator: { ...it.generator!, noiseImage: { file, name: f.name } } });
  };
  const src = it.generator && GENERATOR_SOURCES.find((x) => x.value === it.generator!.source)!;
  const range = (label: string, value: number, min: number, max: number, f: (v: number) => Partial<Effect>, step?: number) => (
    <Field label={label}>
      <Range value={value} min={min} max={max} step={step} label={label} onChange={(v) => putItem(f(v), true)} onCommit={done} />
    </Field>
  );
  const filter = it.kind === 'levels' || it.kind === 'blur' || it.kind === 'invert' || it.kind === 'hsl';
  return (
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
                putList(l, w, `Delete ${it.name}`, (xs) => xs.filter((x) => x.id !== it.id));
                set(w === 'mask' ? { maskItem: MASK_ROOT } : { effect: null });
              }}
            />
          </span>
        }
      />
      {!filter && (
        <Field label="Blend">
          <select className="cs-select" value={it.blend} onChange={(e) => putItem({ blend: e.target.value as BlendMode })}>
            {(w === 'mask' ? MASK_BLENDS : BLEND_MODES).map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {range(filter ? 'Strength' : 'Opacity', it.opacity, 0, 1, (v) => ({ opacity: v }))}
      {it.kind === 'paint' && w === 'mask' && (
        <>
          <Field label="Paints">
            <Segmented label="Paints" options={[{ value: '1', label: 'White' }, { value: '0', label: 'Black' }]} value={maskValue >= 0.5 ? '1' : '0'} onChange={(v) => set((s) => ({ brush: { ...s.brush, maskValue: v === '1' ? 1 : 0 } }))} />
          </Field>
          <Field label="Grey">
            <Range value={maskValue} min={0} max={1} label="Painted grey" onChange={(v) => set((s) => ({ brush: { ...s.brush, maskValue: v } }))} onCommit={() => {}} />
          </Field>
          <span className="cs-note">White shows the layer, black hides it.</span>
        </>
      )}
      {it.kind === 'paint' && w === 'layer' && <BrushProps l={l} />}
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
          {range('Level', it.generator.level, 0, 1, (v) => ({ generator: { ...it.generator!, level: v } }))}
          {range('Softness', it.generator.spread, 0, 0.5, (v) => ({ generator: { ...it.generator!, spread: v } }))}
          {range('Noise', it.generator.noise ?? 0, 0, 1, (v) => ({ generator: { ...it.generator!, noise: v } }))}
          {(it.generator.noise ?? 0) > 0 && (
            <>
              <Field label="Noise type">
                <select className="cs-select" value={it.generator.noiseType ?? 'clouds'} onChange={(e) => putItem({ generator: { ...it.generator!, noiseType: e.target.value as NoiseType } })}>
                  {NOISE_TYPES.map((n) => (
                    <option key={n} value={n}>
                      {NOISE_LABELS[n]}
                    </option>
                  ))}
                </select>
              </Field>
              {it.generator.noiseType === 'image' && (
                <Row label="Noise picture">
                  <AssetPicker value={it.generator.noiseImage?.file} name={it.generator.noiseImage?.name} start="noise" onPick={(file, name) => putItem({ generator: { ...it.generator!, noiseImage: { file, name } } })} onFile={() => void pickNoise()} />
                </Row>
              )}
              {range('Noise size', it.generator.noiseScale ?? 1, 0.1, 4, (v) => ({ generator: { ...it.generator!, noiseScale: v } }), 0.05)}
              <Field label="Seed">
                <span className="cs-range">
                  <NumberField value={it.generator.seed ?? 0} label="" ariaLabel="Seed" onCommit={(v) => putItem({ generator: { ...it.generator!, seed: Math.round(v) } })} />
                  <Button size="sm" onClick={() => putItem({ generator: { ...it.generator!, seed: Math.floor(Math.random() * 1000) } })}>
                    New
                  </Button>
                </span>
              </Field>
            </>
          )}
          <Field label="Invert">
            <Switch checked={it.generator.invert} label="Invert" onChange={(v) => putItem({ generator: { ...it.generator!, invert: v } })} />
          </Field>
        </>
      )}
      {it.kind === 'image' && (
        <>
          <Row label="Image">
            <AssetPicker value={it.image?.file} name={it.image?.name} start="pattern" onPick={(file, name) => putItem({ image: { file, name, scale: it.image?.scale ?? 1, invert: it.image?.invert ?? false }, name })} onFile={() => void pickImage()} />
          </Row>
          {it.image && (
            <>
              {range('Repeat', it.image.scale, 0.25, 16, (v) => ({ image: { ...it.image!, scale: v } }), 0.25)}
              <Field label="Invert">
                <Switch checked={it.image.invert} label="Invert" onChange={(v) => putItem({ image: { ...it.image!, invert: v } })} />
              </Field>
            </>
          )}
        </>
      )}
      {it.kind === 'fill' && w === 'mask' && range('Value', it.value ?? 1, 0, 1, (v) => ({ value: v }))}
      {it.kind === 'fill' &&
        w === 'layer' &&
        it.flat &&
        FLAT.filter((f) => l.channels.includes(f.c as never)).map((f) => (
          <Field key={f.k} label={f.label}>
            {f.color ? (
              <Color value={it.flat![f.k] as string} label={f.label} onChange={(v) => putItem({ flat: { ...it.flat!, [f.k]: v } }, true)} onCommit={done} />
            ) : (
              <Range value={it.flat![f.k] as number} min={0} max={1} label={f.label} onChange={(v) => putItem({ flat: { ...it.flat!, [f.k]: v } }, true)} onCommit={done} />
            )}
          </Field>
        ))}
      {it.kind === 'levels' && it.levels && (
        <>
          {range('Black point', it.levels.low, 0, 1, (v) => ({ levels: { ...it.levels!, low: v } }))}
          {range('White point', it.levels.high, 0, 1, (v) => ({ levels: { ...it.levels!, high: v } }))}
          {range('Midtones', it.levels.gamma, 0.1, 4, (v) => ({ levels: { ...it.levels!, gamma: v } }), 0.05)}
        </>
      )}
      {it.kind === 'blur' && range('Radius', (it.radius ?? 0.005) * 1000, 0, 50, (v) => ({ radius: v / 1000 }), 0.5)}
      {it.kind === 'hsl' && it.hsl && (
        <>
          {range('Hue', it.hsl.hue, -0.5, 0.5, (v) => ({ hsl: { ...it.hsl!, hue: v } }))}
          {range('Saturation', it.hsl.saturation, -1, 1, (v) => ({ hsl: { ...it.hsl!, saturation: v } }))}
          {range('Lightness', it.hsl.lightness, -1, 1, (v) => ({ hsl: { ...it.hsl!, lightness: v } }))}
        </>
      )}
      {filter && <span className="cs-note">Changes what's below it{w === 'layer' ? ' in the layer' : ' in the mask'}.</span>}
    </>
  );
}

function MaskProps({ l, t }: { l: Layer; t: TextureSet }) {
  const maskItem = useApp((s) => s.maskItem);
  const m = l.mask!;
  const it = m.items.find((x) => x.id === maskItem);
  return (
    <>
      <Section title="Mask" />
      <Field label="Start">
        <Segmented label="Mask starts" options={[{ value: '0', label: 'Black' }, { value: '1', label: 'White' }]} value={String(m.base) as '0' | '1'} onChange={(v) => change(l, 'Change the mask', (x) => ({ ...x, mask: x.mask && { ...x.mask, base: v === '1' ? 1 : 0 } }))} />
      </Field>
      <span className="cs-note">Add to the mask</span>
      <AddEffect l={l} w="mask" />
      {it && <EffectProps l={l} t={t} w="mask" it={it} />}
      {(!it || it.kind === 'paint') && <TipProps />}
    </>
  );
}

function TipProps() {
  const b = useApp((s) => s.brush);
  const tool = useApp((s) => s.tool);
  const stencil = useApp((s) => s.stencil);
  const put = (v: Partial<Brush>) => set((s) => ({ brush: { ...s.brush, ...v } }));
  const pick = async (f: (name: string, aspect: number) => void) => {
    const [x] = await host.open([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]);
    if (!x) return;
    f(x.name, await engine.addToolImage(x.name, x.bytes));
  };
  const st = (v: Partial<NonNullable<typeof stencil>>) => set((s) => ({ stencil: s.stencil && { ...s.stencil, ...v } }));
  return (
    <>
      <Section title="Brush tip" />
      {tool === 'fill' && (
        <Field label="Fills">
          <Segmented label="Fills" options={[{ value: 'island', label: 'UV island' }, { value: 'mesh', label: 'Mesh' }]} value={b.fillBy} onChange={(v) => put({ fillBy: v as Brush['fillBy'] })} />
        </Field>
      )}
      <Field label="Shape">
        <Segmented label="Shape" options={[{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }, { value: 'image', label: 'Picture' }]} value={b.shape} onChange={(v) => put({ shape: v as Brush['shape'] })} />
      </Field>
      {b.shape === 'image' && (
        <Row label="Picture">
          <AssetPicker value={b.alpha} name={b.alpha ?? undefined} start="alpha" onPick={(ref) => put({ alpha: ref })} onFile={() => void pick((name) => put({ alpha: name }))} />
        </Row>
      )}
      <Field label="Angle">
        <Range value={b.angle} min={0} max={360} step={1} label="Angle" onChange={(v) => put({ angle: v })} onCommit={() => {}} />
      </Field>
      <Field label="Pressure">
        <select className="cs-select" value={b.pressure} onChange={(e) => put({ pressure: e.target.value as Brush['pressure'] })}>
          <option value="none">Nothing</option>
          <option value="size">Size</option>
          <option value="flow">Flow</option>
          <option value="both">Size and flow</option>
        </select>
      </Field>
      <Field label="Stabiliser">
        <Range value={b.stabilize} min={0} max={100} step={1} label="Stabiliser" onChange={(v) => put({ stabilize: v })} onCommit={() => {}} />
      </Field>
      <Section title="Stencil" />
      <Row label="Picture">
        <AssetPicker
          value={stencil?.name}
          name={stencil?.name}
          start="pattern"
          onPick={(name) => set((s) => ({ stencil: { x: 0.5, y: 0.5, scale: 0.5, angle: 0, ...s.stencil, name, aspect: 1, on: true } }))}
          onFile={() => void pick((name, aspect) => set((s) => ({ stencil: { x: 0.5, y: 0.5, scale: 0.5, angle: 0, ...s.stencil, name, aspect, on: true } })))}
        />
      </Row>
      {stencil && (
        <>
          <Field label="Use">
            <Switch checked={stencil.on} label="Use the stencil" onChange={(v) => st({ on: v })} />
          </Field>
          <Field label="Size">
            <Range value={stencil.scale} min={0.05} max={3} step={0.01} label="Stencil size" onChange={(v) => st({ scale: v })} onCommit={() => {}} />
          </Field>
          <Field label="Angle">
            <Range value={stencil.angle} min={0} max={360} step={1} label="Stencil angle" onChange={(v) => st({ angle: v })} onCommit={() => {}} />
          </Field>
          <Button size="sm" onClick={() => set({ stencil: null })}>
            Remove stencil
          </Button>
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
        <Field label="Color">
          <Color value={b.color} label="Brush color" onChange={(v) => put('color', v)} onCommit={() => {}} />
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
          <Color value={b.glow} label="Brush glow" onChange={(v) => put('glow', v)} onCommit={() => {}} />
        </Field>
      )}
    </>
  );
}

export function Properties() {
  useApp((s) => s.project);
  useApp((s) => s.layerId);
  const maskEdit = useApp((s) => s.maskItem) !== null;
  const effectId = useApp((s) => s.effect);
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
  const fx = effectId ? l.effects?.find((e) => e.id === effectId) : undefined;
  const own = !maskEdit && !fx;
  return (
    <div className="cs-pane">
      <PanelHeader title={maskEdit ? `${l.name}: mask` : fx ? `${l.name}: ${fx.name}` : l.name}>
        {!own && (
          <Button size="sm" onClick={() => set({ maskItem: null, effect: null })}>
            Layer
          </Button>
        )}
      </PanelHeader>
      <div className="cs-scroll">
        <div className="cs-props" style={{ padding: '0 4px 14px' }}>
          {own && (
            <Field label="Blend">
              <select className="cs-select" value={l.blend} onChange={(e) => change(l, `Change blend of ${l.name}`, (x) => ({ ...x, blend: e.target.value as BlendMode }))}>
                {BLEND_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {l.kind === 'group' && m.value === 'normal' ? 'Pass through' : m.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {own && (
            <Field label="Opacity">
              <Range value={l.opacity} min={0} max={1} label="Opacity" onChange={(v) => change(l, '', (x) => ({ ...x, opacity: v }), true)} onCommit={() => commit(`Change opacity of ${l.name}`)} />
            </Field>
          )}
          {own && l.kind !== 'group' && <span className="cs-note">Channels</span>}
          {own && l.kind !== 'group' && (
            <Chips
              options={CHANNELS.filter((c) => t.channels.includes(c.id)).map((c) => ({ value: c.id, label: c.label, disabled: l.kind === 'paint' && c.id === 'normal' }))}
              value={l.channels}
              onChange={(v) => change(l, `Change channels of ${l.name}`, (x) => ({ ...x, channels: v }))}
            />
          )}
          {maskEdit && l.mask && <MaskProps l={l} t={t} />}
          {fx && <EffectProps l={l} t={t} w="layer" it={fx} />}
          {fx && <Section title="Add an effect" />}
          {fx && <AddEffect l={l} w="layer" />}
          {fx?.kind === 'paint' && <TipProps />}
          {own && l.kind === 'paint' && <BrushProps l={l} />}
          {own && l.kind === 'paint' && <TipProps />}
          {own && l.kind === 'fill' && <FillProps l={l} />}
          {own && l.kind !== 'group' && (
            <>
              <Section title="Effects" />
              <AddEffect l={l} w="layer" />
            </>
          )}
          {own && !l.mask && (
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
          {own && l.mask && (
            <Button size="sm" onClick={() => set({ maskItem: l.mask!.items[0]?.id ?? MASK_ROOT })}>
              Edit the mask
            </Button>
          )}
          {own && l.kind === 'group' && <span className="cs-note">Pass through blends the group's layers with what's below them; any other mode blends the group as one.</span>}
        </div>
      </div>
    </div>
  );
}
