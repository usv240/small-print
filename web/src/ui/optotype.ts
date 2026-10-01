// Draws a tumbling E at an exact physical size. The E is a 5×5 grid: a spine plus three prongs, each
// one grid cell thick, so the stroke width is one fifth of the letter height (the standard optotype).

import { cssPxPerMm } from '../camera/calibration';

export type Direction = 'right' | 'left' | 'up' | 'down';
export const DIRECTIONS: Direction[] = ['right', 'left', 'up', 'down'];

export const randomDirection = (avoid?: Direction): Direction => {
  const options = DIRECTIONS.filter((d) => d !== avoid);
  return options[Math.floor(Math.random() * options.length)];
};

/** Render the E (prongs pointing in `dir`) `heightMm` tall onto the canvas, centred, crisp on any pixel density. */
export function drawE(canvas: HTMLCanvasElement, heightMm: number, dir: Direction, color = '#111'): void {
  const dpr = window.devicePixelRatio || 1;
  const cssBox = Math.max(48, Math.ceil(heightMm * cssPxPerMm() * 1.6));
  canvas.style.width = `${cssBox}px`;
  canvas.style.height = `${cssBox}px`;
  canvas.width = Math.round(cssBox * dpr);
  canvas.height = Math.round(cssBox * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sizeDev = heightMm * cssPxPerMm() * dpr; // letter height in device pixels
  const cell = sizeDev / 5;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const angle = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir];

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  const x0 = -sizeDev / 2;
  const y0 = -sizeDev / 2;
  // Spine on the left, prongs to the right (pointing "right" before rotation).
  ctx.fillRect(x0, y0, cell, sizeDev);
  for (const row of [0, 2, 4]) ctx.fillRect(x0, y0 + row * cell, sizeDev, cell);
  ctx.restore();
}

/** Calls back with a direction from a swipe on `el`, an arrow key, or one of the arrow buttons. */
export function onDirection(el: HTMLElement, cb: (d: Direction) => void): () => void {
  let start: { x: number; y: number } | null = null;
  const down = (e: PointerEvent) => { start = { x: e.clientX, y: e.clientY }; };
  const up = (e: PointerEvent) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
    cb(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  };
  const key = (e: KeyboardEvent) => {
    const map: Record<string, Direction> = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };
    if (map[e.key]) { e.preventDefault(); cb(map[e.key]); }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  window.addEventListener('keydown', key);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', key);
  };
}
