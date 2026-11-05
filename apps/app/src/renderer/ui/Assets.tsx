import { useState } from 'react';
import { Button, Segmented } from '@cocoasurface/ui';
import { engine } from '../engine/engine';
import { ASSETS, assetOf, type AssetGroup } from '../engine/procedural';
import { imported, inProject, useLibrary } from '../assets';
import { useApp } from '../store';

const GROUPS: { value: AssetGroup | 'mine'; label: string }[] = [
  { value: 'mine', label: 'Imported' },
  { value: 'alpha', label: 'Alphas' },
  { value: 'pattern', label: 'Patterns' },
  { value: 'noise', label: 'Noises' },
];

/** Picks a picture from the built-in library (`lib:<id>`) or from a file. */
export function AssetPicker({ value, name, start, onPick, onFile }: { value: string | null | undefined; name?: string; start: AssetGroup; onPick: (ref: string, label: string) => void; onFile: () => void }) {
  const [open, setOpen] = useState(false);
  const cur = value ? assetOf(value) : undefined;
  const [group, setGroup] = useState<AssetGroup | 'mine'>(cur?.group ?? (value && !value.startsWith('lib:') ? 'mine' : start));
  useApp((s) => s.project);
  useLibrary((s) => s.items);
  const mine = imported(start === 'alpha' ? 'alpha' : 'texture');
  const ownName = mine.find((x) => value?.includes(x.id))?.name;
  return (
    <div className="cs-assets">
      <Button size="sm" onClick={() => setOpen(!open)}>
        {cur && <img className="cs-athumb sm" src={engine.thumb(cur)} alt="" />}
        {cur?.label ?? ownName ?? name ?? 'Choose…'}
      </Button>
      {open && (
        <>
          <Segmented label="Library" options={GROUPS} value={group} onChange={(v) => setGroup(v as AssetGroup | 'mine')} />
          <div className="cs-agrid">
            {group === 'mine' &&
              mine.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={`cs-acell${value?.includes(x.id) ? ' on' : ''}`}
                  title={x.name}
                  aria-label={x.name}
                  onClick={async () => {
                    const ref = await inProject(x.id);
                    if (ref) onPick(ref, x.name);
                    setOpen(false);
                  }}
                >
                  <img className="cs-athumb" src={x.thumb} alt="" />
                </button>
              ))}
            {ASSETS.filter((a) => a.group === group).map((a) => (
              <button key={a.id} type="button" className={`cs-acell${cur?.id === a.id ? ' on' : ''}`} title={a.label} aria-label={a.label} onClick={() => (onPick(`lib:${a.id}`, a.label), setOpen(false))}>
                <img className="cs-athumb" src={engine.thumb(a)} alt="" />
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => (onFile(), setOpen(false))}>
            Your own picture…
          </Button>
        </>
      )}
    </div>
  );
}
