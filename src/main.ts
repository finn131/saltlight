import './style.css';

const TILE_W = 64;
const TILE_H = 32;
const TILE_Z = 16;
const GRID = 20;

// ponytail: inline camera seed; real camera.ts arrives in Phase 4
const camera = { x: 0, y: 0, zoom: 1 };

// ponytail: seed of project() from ARCHITECTURE §7; src/render/iso.ts arrives in Phase 4
function project(x: number, y: number, h: number): { sx: number; sy: number } {
  return {
    sx: (x - y) * (TILE_W / 2),
    sy: (x + y) * (TILE_H / 2) - h * TILE_Z,
  };
}

const heights: number[] = new Array(GRID * GRID).fill(0);
for (let i = 0; i < GRID; i++) {
  heights[i] = 1;
  heights[(GRID - 1) * GRID + i] = 1;
  heights[i * GRID] = 1;
  heights[i * GRID + GRID - 1] = 1;
}
heights[5 * GRID + 5] = 2;
heights[12 * GRID + 12] = 2;

const mount = document.getElementById('grid-canvas');
if (!(mount instanceof HTMLCanvasElement)) {
  throw new Error('#grid-canvas missing');
}
const canvas: HTMLCanvasElement = mount;
const maybeCtx: CanvasRenderingContext2D | null = canvas.getContext('2d');
if (!maybeCtx) {
  throw new Error('2d context unavailable on #grid-canvas');
}
const ctx: CanvasRenderingContext2D = maybeCtx;

const css = getComputedStyle(document.documentElement);
function paletteVar(name: string, fallback: string): string {
  const v = css.getPropertyValue(name).trim();
  return v || fallback;
}
const colSoil = paletteVar('--soil', '#5b4636');
const colSoilTilled = paletteVar('--soil-tilled', '#3f3125');
const colRockTop = paletteVar('--rock-top', '#7b8087');
const colBorder = paletteVar('--ui-border', '#3b4650');

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function fillFor(h: number): string {
  if (h >= 2) return colRockTop;
  if (h >= 1) return colSoilTilled;
  return colSoil;
}

// ponytail: throwaway path draw for Phase 0; Phase 4 replaces paths with baked sprite drawImage
function drawGrid(): void {
  const rect = canvas.getBoundingClientRect();
  const originX = rect.width / 2 + camera.x;
  const originY = rect.height / 4 + camera.y;
  ctx.clearRect(0, 0, rect.width, rect.height);

  for (let sum = 0; sum <= 2 * (GRID - 1); sum++) {
    for (let x = 0; x < GRID; x++) {
      const y = sum - x;
      if (y < 0 || y >= GRID) continue;
      const h = heights[y * GRID + x];
      const { sx, sy } = project(x, y, h);
      const px = originX + sx * camera.zoom;
      const py = originY + sy * camera.zoom;
      const hw = (TILE_W / 2) * camera.zoom;
      const hh = (TILE_H / 2) * camera.zoom;

      ctx.beginPath();
      ctx.moveTo(px, py - hh);
      ctx.lineTo(px + hw, py);
      ctx.lineTo(px, py + hh);
      ctx.lineTo(px - hw, py);
      ctx.closePath();
      ctx.fillStyle = fillFor(h);
      ctx.fill();
      ctx.strokeStyle = colBorder;
      ctx.stroke();
    }
  }
}

let dragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  camera.x += e.clientX - lastX;
  camera.y += e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  canvas.releasePointerCapture(e.pointerId);
});

window.addEventListener('keydown', (e) => {
  const step = 40;
  if (e.key === 'ArrowLeft') camera.x += step;
  else if (e.key === 'ArrowRight') camera.x -= step;
  else if (e.key === 'ArrowUp') camera.y += step;
  else if (e.key === 'ArrowDown') camera.y -= step;
  else return;
  e.preventDefault();
});

function frame(): void {
  drawGrid();
  requestAnimationFrame(frame);
}

resize();
window.addEventListener('resize', resize);
requestAnimationFrame(frame);
