import { useState } from 'react';
import { Button, IconButton, PanelHeader } from '@cocoasurface/ui';
import { outputNodes } from '@cocoasurface/materials';
import { allLayers, newFillLayer, placeOf, insertLayer, updateLayer, type FillLayer } from '@cocoasurface/project';
import { forgetMaterial } from '../engine/library';
import { importMaterials } from '../io';
import { currentLayer, currentSet, edit, editSet, get, set, toast, useApp } from '../store';

export function useMaterial(id: string): void {
  const m = get().materials[id];
  const t = currentSet();
  if (!m || !t) return;
  const values = Object.fromEntries(m.file.manifest.parameters.map((p) => [p.id, p.value]));
  const use = { material: id, values, scale: 1 };
  const l = currentLayer();
  if (l?.kind === 'fill') {
    editSet(`Use ${m.file.manifest.name}`, (s) => ({ ...s, layers: updateLayer(s.layers, l.id, () => ({ ...l, use })) }));
    return;
  }
  const layer: FillLayer = { ...newFillLayer(m.file.manifest.name, t.channels.filter((c) => (c !== 'opacity' && c !== 'glow') || outputNodes(m.file.graph).has(c))), use };
  const at = l ? placeOf(t.layers, l.id)! : { parent: null, index: 0 };
  editSet(`Add ${m.file.manifest.name}`, (s) => ({ ...s, layers: insertLayer(s.layers, layer, at) }));
  set({ layerId: layer.id, maskItem: null });
}

export function Library() {
  const project = useApp((s) => s.project)!;
  const materials = useApp((s) => s.materials);
  const [picked, setPicked] = useState<string | null>(null);
  const used = (id: string) => project.textureSets.some((t) => allLayers(t.layers).some((l) => l.kind === 'fill' && l.use?.material === id));
  return (
    <div className="cs-pane">
      <PanelHeader title="Materials">
        <span className="cs-acts">
          {picked && (
            <IconButton
              icon="trash"
              label="Remove from the project"
              onClick={() => {
                if (used(picked)) return toast('A fill layer uses this material.');
                const name = materials[picked]?.file.manifest.name ?? 'material';
                edit(`Remove ${name}`, (p) => ({ ...p, library: p.library.filter((m) => m.id !== picked) }));
                forgetMaterial(picked);
                setPicked(null);
              }}
            />
          )}
          <IconButton icon="plus" label="Import materials" onClick={() => void importMaterials()} />
        </span>
      </PanelHeader>
      <div className="cs-scroll">
        {project.library.length ? (
          <div className="cs-lib">
            {project.library.map((m) => {
              const lm = materials[m.id];
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`cs-mat${picked === m.id ? ' on' : ''}`}
                  title={lm?.unknown.length ? `Unknown nodes: ${lm.unknown.join(', ')}` : m.name}
                  onClick={() => setPicked(m.id)}
                  onDoubleClick={() => useMaterial(m.id)}
                >
                  <i style={lm?.thumb ? { backgroundImage: `url(${lm.thumb})` } : undefined} />
                  <span>{m.name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="cs-empty">Import .cocoamat materials from CocoaWorlds or other projects to use them in fill layers.</div>
        )}
        {picked && (
          <Button size="sm" onClick={() => useMaterial(picked)}>
            {currentLayer()?.kind === 'fill' ? 'Use on the fill layer' : 'Add as a fill layer'}
          </Button>
        )}
      </div>
    </div>
  );
}
