import './style.css';
import { World } from './game/world';
import { Mote } from './game/drone';
import { WorkerClient } from './workerClient';
import { bakeSprites, type SpriteAtlas } from './render/sprites';
import { project, drawOrder, TILE_W, TILE_H, TILE_Z } from './render/iso';
import { createCamera, clampZoom, clampPan, viewport, cullCells } from './render/camera';

const GRID = 20;

const world = new World({ width: GRID, height: GRID });
const mote = new Mote();
const atlas: SpriteAtlas = bakeSprites();
const camera = createCamera(GRID, GRID);

const canvasEl = document.getElementById('grid-canvas');
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('#grid-canvas missing');
const canvas: HTMLCanvasElement = canvasEl;
const ctx: CanvasRenderingContext2D = canvas.getContext('2d')!;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const ANCHOR_X = TILE_W / 2;
const ANCHOR_Y = TILE_H / 2;

// ponytail: render loop is blits only; all path work happens in bakeSprites
function draw(): void {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const ox = w / 2 + camera.x;
  const oy = h / 4 + camera.y;
  const z = camera.zoom;

  const vp = viewport(camera, w, h);
  const visible = cullCells(world.getAllCells(), vp, w, h).sort(drawOrder);
  for (const cell of visible) {
    const { sx, sy } = project(cell.x, cell.y, cell.h);
    const px = ox + sx * z - ANCHOR_X * z;
    const py = oy + sy * z - ANCHOR_Y * z;
    const terrain = atlas[cell.terrain];
    if (terrain) {
      ctx.drawImage(terrain, px, py - TILE_Z * z, TILE_W * z, (TILE_H + TILE_Z * 2) * z);
    }
    if (cell.plant !== null) {
      const crop = atlas[cell.plant + '_' + cell.growth] ?? atlas[cell.plant + '_0'];
      if (crop) {
        ctx.drawImage(crop, px, py - TILE_H * z, TILE_W * z, TILE_H * 2 * z);
      }
    }
  }

  const mp = project(mote.x, mote.y, mote.h);
  const moteTile = atlas['soil'];
  if (moteTile) {
    ctx.drawImage(moteTile, ox + mp.sx * z - ANCHOR_X * z, oy + mp.sy * z - ANCHOR_Y * z, TILE_W * z, (TILE_H + TILE_Z * 2) * z);
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
  clampPan(camera);
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.zoom = clampZoom(camera, camera.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  clampPan(camera);
}, { passive: false });

const eventLog: string[] = [];
const client = new WorkerClient({
  tick: (cells) => {
    for (const c of cells) {
      const cell = world.get(c.x, c.y, c.h);
      if (!cell) continue;
      if (c.terrain !== undefined) cell.terrain = c.terrain;
      if (c.plant !== undefined) cell.plant = c.plant;
      if (c.growth !== undefined) cell.growth = c.growth;
      if (c.moisture !== undefined) cell.moisture = c.moisture;
    }
  },
  event: (kind, x, y, h, data) => {
    eventLog.push(`${kind} @(${x},${y},${h}) ${JSON.stringify(data)}`);
  },
  console: (lines) => {
    for (const l of lines) eventLog.push(`> ${l}`);
  },
  error: (e) => {
    eventLog.push(`ERROR ${e.phase} line ${e.line} col ${e.col}: ${e.message}`);
  },
  aborted: (a) => {
    eventLog.push(`ABORTED ${a.reason} after ${a.ops} ops`);
  },
});

client.init(world.toJSON(), mote.toJSON());

function frame(): void {
  draw();
  requestAnimationFrame(frame);
}

resize();
window.addEventListener('resize', resize);
requestAnimationFrame(frame);