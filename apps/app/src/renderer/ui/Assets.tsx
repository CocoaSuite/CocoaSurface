import { useState } from 'react';
import { Button, Segmented } from '@cocoasurface/ui';
import { engine } from '../engine/engine';
import { ASSETS, assetOf, type AssetGroup } from '../engine/procedural';

const GROUPS: { value: AssetGroup; label: string }[] = [
  { value: 'alpha', label: 'Alphas' },
  { value: 'pattern', label: 'Patterns' },
  { value: 'noise', label: 'Noises' },
];

/** Picks a picture from the built-in library (`lib:<id>`) or from a file. */
export function AssetPicker({ value, name, start, onPick, onFile }: { value: string | null | undefined; name?: string; start: AssetGroup; onPick: (ref: string, label: string) => void; onFile: () => void }) {
  const [open, setOpen] = useState(false);
  const cur = value ? assetOf(value) : undefined;
  const [group, setGroup] = useState<AssetGroup>(cur?.group ?? start);
  return (
    <div className="cs-assets">
      <Button size="sm" onClick={() => setOpen(!open)}>
        {cur && <img className="cs-athumb sm" src={engine.thumb(cur)} alt="" />}
        {cur?.label ?? name ?? 'Choose…'}
      </Button>
      {open && (
        <>
          <Segmented label="Library" options={GROUPS} value={group} onChange={(v) => setGroup(v as AssetGroup)} />
          <div className="cs-agrid">
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
