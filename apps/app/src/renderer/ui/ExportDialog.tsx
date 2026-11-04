import { useState } from 'react';
import { Button, Dialog, Field, Switch } from '@cocoasurface/ui';
import { TEXTURE_SIZES, type ExportSettings } from '@cocoasurface/project';
import { exportTextures } from '../io';
import { edit, get, useApp } from '../store';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useApp((s) => s.project)!;
  const [ex, setEx] = useState<ExportSettings>(project.export);
  const [mesh, setMesh] = useState(false);
  const [sets, setSets] = useState<string[]>(project.textureSets.map((t) => t.id));
  const put = <K extends keyof ExportSettings>(k: K, v: ExportSettings[K]) => setEx({ ...ex, [k]: v });
  const go = async () => {
    if (JSON.stringify(ex) !== JSON.stringify(project.export)) edit('Change export settings', (p) => ({ ...p, export: ex }));
    onClose();
    await exportTextures(get().project!.textureSets.filter((t) => sets.includes(t.id)), mesh);
  };
  return (
    <Dialog title="Export textures" onClose={onClose} width={440}>
      <Field label="Names">
        <input className="cs-input mono" value={ex.naming} onChange={(e) => put('naming', e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </Field>
      <p className="cs-note">{'{set}'} is the texture set, {'{map}'} the map, for example {ex.naming.replace('{set}', project.textureSets[0]?.name ?? 'Body').replace('{map}', 'BaseColor')}.png</p>
      <Field label="Size">
        <select className="cs-select" value={ex.size} onChange={(e) => put('size', Number(e.target.value) as ExportSettings['size'])}>
          <option value={0}>Each set's own</option>
          {TEXTURE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} × {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Normals">
        <select className="cs-select" value={ex.normalGreen} onChange={(e) => put('normalGreen', e.target.value as 'up' | 'down')}>
          <option value="up">Green up (OpenGL, Blender, glTF)</option>
          <option value="down">Green down (DirectX, Unreal)</option>
        </select>
      </Field>
      <Field label="Pack ORM">
        <Switch checked={ex.packOrm} onChange={(v) => put('packOrm', v)} label="Pack occlusion, roughness and metal into one image" />
      </Field>
      {project.textureSets.some((t) => t.bake?.done.length) && (
        <Field label="Mesh maps">
          <Switch checked={mesh} onChange={setMesh} label="Also export the baked mesh maps" />
        </Field>
      )}
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
