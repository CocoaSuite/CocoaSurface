import { useState } from 'react';
import { Button, Dialog, Field, Switch } from '@cocoasurface/ui';
import { CHANNELS, EXPORT_PRESETS, MESH_MAPS, packOf, TEXTURE_SIZES, type ExportSettings } from '@cocoasurface/project';
import { exportTextures, MAP_NAMES, PACK_NAMES } from '../io';
import { edit, get, useApp } from '../store';
import { Chips } from './controls';

const PACKED = { none: [], orm: ['occlusion', 'roughness', 'metalness'], unity: ['roughness', 'metalness'] } as const;

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useApp((s) => s.project)!;
  const [ex, setEx] = useState<ExportSettings>(project.export);
  const [mesh, setMesh] = useState(false);
  const [sets, setSets] = useState<string[]>(project.textureSets.map((t) => t.id));
  const put = (v: Partial<ExportSettings>) => setEx({ ...ex, ...v, preset: 'preset' in v ? v.preset : undefined });
  const pack = packOf(ex);
  const chosen = project.textureSets.filter((t) => sets.includes(t.id));
  const channels = CHANNELS.filter((c) => chosen.some((t) => t.channels.includes(c.id)));
  const packed = PACKED[pack] as readonly string[];
  const outputs = [
    ...(pack !== 'none' ? [{ value: 'pack', label: PACK_NAMES[pack] }] : []),
    ...channels.filter((c) => !packed.includes(c.id)).map((c) => ({ value: c.id as string, label: MAP_NAMES[c.id] })),
    ...(mesh ? MESH_MAPS.filter((m) => chosen.some((t) => t.bake?.done.includes(m.id))).map((m) => ({ value: `mesh:${m.id}`, label: `Mesh ${m.label.toLowerCase()}` })) : []),
  ];
  const skip = ex.skip ?? [];
  const go = async () => {
    if (JSON.stringify(ex) !== JSON.stringify(project.export)) edit('Change export settings', (p) => ({ ...p, export: ex }));
    onClose();
    await exportTextures(get().project!.textureSets.filter((t) => sets.includes(t.id)), mesh);
  };
  return (
    <Dialog title="Export textures" onClose={onClose} width={480}>
      <Field label="Preset">
        <select
          className="cs-select"
          value={ex.preset ?? ''}
          onChange={(e) => {
            const p = EXPORT_PRESETS.find((x) => x.id === e.target.value);
            if (p) put({ ...p.set, packOrm: p.set.pack === 'orm', preset: p.id });
          }}
        >
          <option value="">Custom</option>
          {EXPORT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Names">
        <input className="cs-input mono" value={ex.naming} onChange={(e) => put({ naming: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      </Field>
      <p className="cs-note">{'{set}'} is the texture set, {'{map}'} the map, for example {ex.naming.replace('{set}', project.textureSets[0]?.name ?? 'Body').replace('{map}', 'BaseColor')}.png</p>
      <Field label="Size">
        <select className="cs-select" value={ex.size} onChange={(e) => put({ size: Number(e.target.value) as ExportSettings['size'] })}>
          <option value={0}>Each set's own</option>
          {TEXTURE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} × {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Normals">
        <select className="cs-select" value={ex.normalGreen} onChange={(e) => put({ normalGreen: e.target.value as 'up' | 'down' })}>
          <option value="up">Green up (OpenGL, Blender, glTF)</option>
          <option value="down">Green down (DirectX, Unreal)</option>
        </select>
      </Field>
      <Field label="Packing">
        <select className="cs-select" value={pack} onChange={(e) => put({ pack: e.target.value as ExportSettings['pack'], packOrm: e.target.value === 'orm' })}>
          <option value="none">Separate maps</option>
          <option value="orm">Occlusion, roughness, metal in one (ORM)</option>
          <option value="unity">Metal with smoothness in alpha (Unity)</option>
        </select>
      </Field>
      {project.textureSets.some((t) => t.bake?.done.length) && (
        <Field label="Mesh maps">
          <Switch checked={mesh} onChange={setMesh} label="Also export the baked mesh maps" />
        </Field>
      )}
      <div className="cs-sec">Maps</div>
      <Chips options={outputs} value={outputs.map((o) => o.value).filter((v) => !skip.includes(v))} onChange={(v) => put({ skip: [...skip.filter((x) => !outputs.some((o) => o.value === x)), ...outputs.map((o) => o.value).filter((x) => !v.includes(x))] })} />
      <div className="cs-sec">Texture sets</div>
      {project.textureSets.map((t) => (
        <Field key={t.id} label={t.name}>
          <Switch checked={sets.includes(t.id)} onChange={(v) => setSets(v ? [...sets, t.id] : sets.filter((x) => x !== t.id))} label={t.name} />
        </Field>
      ))}
      <div className="cs-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!sets.length} onClick={() => void go()}>
          Export…
        </Button>
      </div>
    </Dialog>
  );
}
