/** 24×24 stroke icons in the CocoaCanvas style (stroke-width 2, round caps). Paths only; colour comes from `currentColor`. */
import type { SVGProps } from 'react';

const P = {
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  play: 'M7 4v16l13-8z',
  stop: 'M6 6h12v12H6z',
  select: 'M5 3l14 8-6 2-3 6z',
  move: 'M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3',
  rotate: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  scale: 'M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7',
  block: 'M12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  cylinder: 'M5 6c0-1.7 3-3 7-3s7 1.3 7 3-3 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6',
  sound: 'M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  sphere: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12c0 1.9 4 3.4 9 3.4s9-1.5 9-3.4M12 3c-2.2 2.4-3.4 5.6-3.4 9s1.2 6.6 3.4 9',
  wedge: 'M3 19h18L3 7z',
  terrain: 'M2 20l6-10 4 5 3-4 7 9z',
  stairs: 'M3 20h18V4h-5v5h-5v5H6v6',
  polygon: 'M12 3l8 6-3 11H7L4 9z',
  vertex: 'M5 19 12 5l7 14zM12 5h.01M5 19h.01M19 19h.01',
  face: 'M12 3 3 8v8l9 5 9-5V8zM12 13l9-5M12 13v8',
  loopcut: 'M12 3 3 8v8l9 5 9-5V8zM3 12l9 5 9-5',
  clip: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  entity: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v8M8 12h8',
  trigger: 'M4 4h4M12 4h4M20 4v4M20 12v4M20 20h-4M12 20H8M4 20v-4M4 12V8',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z',
  paint: 'M19 11 11 3 3 11l8 8zM19 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z',
  measure: 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
  folder: 'M3 7h7l2 2h9v10H3z',
  person: 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 21v-4a6 6 0 0 1 12 0v4',
  cube: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  plus: 'M12 5v14M5 12h14',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  grid: 'M3 9h18M3 15h18M9 3v18M15 3v18',
  warn: 'M12 3 2 21h20zM12 10v5M12 18v.5',
  close: 'M6 6l12 12M18 6 6 18',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  chevronDown: 'm6 9 6 6 6-6',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  spot: 'M9 3h6l3 8H6zM8 11l-4 10M16 11l4 10M12 11v10',
  brush: 'M18.4 2.6a2 2 0 0 1 2.9 2.9L12 15l-3-3zM9 12c-2.5 0-4 1.8-4 4 0 1.5-.8 2.5-2 3 4 1.5 9 .5 9-4',
  eraser: 'M7 21h13M4.6 15.4 14.8 5.2a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z',
  orbit: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 12c0-2.5 4-4.5 9-4.5s9 2 9 4.5-4 4.5-9 4.5c-1.3 0-2.6-.1-3.7-.4M7 13.5 8.3 16 6 17.5',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  mask: 'M4 4h16v16H4zM12 4a8 8 0 0 1 0 16z',
  fill: 'M4 4h16v16H4z',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M15 8.5a1 1 0 1 0 0 .01',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  symmetry: 'M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z',
  focus: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
} as const;

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="cs-icon" aria-hidden="true" {...rest}>
      <path d={P[name]} />
    </svg>
  );
}
