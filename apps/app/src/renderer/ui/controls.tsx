import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { ColorField } from '@cocoasurface/ui';

/** Slider bar with its label and value inside. Drag to change, double-click the value to type. 0–1 ranges show percent. */
export function Range({ value, min, max, step, label, onChange, onCommit }: { value: number; min: number; max: number; step?: number; label: string; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const st = step ?? (max - min > 10 ? 1 : 0.01);
  const pct = min === 0 && max === 1;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / st) * st));
  const show = (v: number) => (pct ? `${Math.round(v * 100)}%` : String(Number(v.toFixed(st < 1 ? Math.min(3, String(st).split('.')[1]?.length ?? 2) : 0))));
  const [draft, setDraft] = useState<string | null>(null);
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const at = (e: { clientX: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return clamp(min + ((e.clientX - r.left) / r.width) * (max - min));
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || document.activeElement === e.target) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = at(e, el);
    onChange(last);
    const move = (ev: PointerEvent) => onChange((last = at(ev, el)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onCommit(last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const typed = () => {
    if (draft === null) return;
    setDraft(null);
    const n = Number(draft.replace('%', '').replace(',', '.').trim());
    if (draft.trim() === '' || !Number.isFinite(n)) return;
    const v = clamp(pct ? n / 100 : n);
    onChange(v);
    onCommit(v);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const v = clamp(value + (e.key === 'ArrowRight' ? st : -st));
    onChange(v);
    onCommit(v);
  };
  return (
    <div className="cs-slider" role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} onPointerDown={down} onKeyDown={key} onClick={(e) => e.preventDefault()}>
      <div className="cs-sfill" style={{ width: `${t * 100}%` }} />
      <div className="cs-shandle" style={{ left: `${t * 100}%` }} />
      <span className="cs-slabel">{label}</span>
      <input
        className="cs-input cs-sval"
        aria-label={label}
        inputMode="decimal"
        value={draft ?? show(value)}
        onDoubleClick={(e) => e.currentTarget.focus()}
        onPointerDown={(e) => document.activeElement === e.currentTarget && e.stopPropagation()}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={typed}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') (setDraft(null), e.currentTarget.blur());
        }}
      />
    </div>
  );
}

/** Color picker that makes one undo step a moment after the last change. */
export function Color({ value, label, onChange, onCommit }: { value: string; label: string; onChange: (v: string) => void; onCommit: (v: string) => void }) {
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
