import { useRef } from 'react';
import { ColorField, NumberField } from '@cocoasurface/ui';

/** Slider with a number field. `onChange` while dragging, `onCommit` when the gesture ends. */
export function Range({ value, min, max, step, label, onChange, onCommit }: { value: number; min: number; max: number; step?: number; label: string; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const st = step ?? (max - min > 10 ? 1 : 0.01);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <span className="cs-range">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={st}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      />
      <NumberField value={value} label="" step={st} ariaLabel={label} onChange={(v) => onChange(clamp(v))} onCommit={(v) => onCommit(clamp(v))} />
    </span>
  );
}

/** Colour picker that makes one undo step a moment after the last change. */
export function Colour({ value, label, onChange, onCommit }: { value: string; label: string; onChange: (v: string) => void; onCommit: (v: string) => void }) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <ColorField
      value={value}
      label={label}
      onChange={(v) => {
        onChange(v);
        if (t.current) clearTimeout(t.current);
        t.current = setTimeout(() => onCommit(v), 400);
      }}
    />
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string; disabled?: boolean }[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="cs-checks">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`cs-chip${value.includes(o.value) ? ' on' : ''}`}
          aria-pressed={value.includes(o.value)}
          disabled={o.disabled}
          onClick={() => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
