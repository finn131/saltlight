import './style.css';
import { World } from './game/world';
import { Mote } from './game/drone';
import { WorkerClient } from './workerClient';
import { bakeSprites, type SpriteAtlas } from './render/sprites';
import { project, drawOrder, TILE_W, TILE_H, TILE_Z } from './render/iso';
import { createCamera, clampZoom, clampPan, viewport, cullCells, worldExtents } from './render/camera';
import { createEditor } from './ui/editor';
import { downloadProgram, pickProgramFile } from './ui/filetools';
import { DEFAULT_SETTINGS, loadSettings, saveProgram, saveSettings, getProgram, debounce } from './ui/store';

const GRID = 40;
const STARTER = "report('hello')\n";
const PROGRAM_ID = 'main';

const world = new World({ width: GRID, height: GRID });
const mote = new Mote();
const atlas: SpriteAtlas = bakeSprites();
const camera = createCamera(GRID, GRID);

const canvasEl = document.getElementById('grid-canvas');
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('#grid-canvas missing');
const canvas: HTMLCanvasElement = canvasEl;
const ctx: CanvasRenderingContext2D = canvas.getContext('2d')!;

const editorEl = document.getElementById('editor');
const panelsEl = document.getElementById('panels');
if (!editorEl || !panelsEl) throw new Error('#editor and #panels are required');

let cssW = 1;
let cssH = 1;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  cssW = Math.max(1, rect.width);
  cssH = Math.max(1, rect.height);
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const ANCHOR_X = TILE_W / 2;
const ANCHOR_Y = TILE_H / 2;

function draw(): void {
  ctx.clearRect(0, 0, cssW, cssH);
  const ox = cssW / 2 + camera.x;
  const { extentY } = worldExtents(camera);
  const oy = cssH / 2 - (extentY * camera.zoom) / 2;
  const z = camera.zoom;

  const vp = viewport(camera, cssW, cssH);
  const visible = cullCells(world.getAllCells(), vp, cssW, cssH).sort(drawOrder);
  for (const cell of visible) {
    const { sx, sy } = project(cell.x, cell.y, cell.h);
    const px = ox + sx * z - ANCHOR_X * z;
    const py = oy + sy * z - ANCHOR_Y * z - TILE_Z * z;
    const terrain = atlas[cell.terrain];
    if (terrain) ctx.drawImage(terrain, px, py, TILE_W * z, (TILE_H + TILE_Z * 2) * z);
    if (cell.plant !== null) {
      const crop = atlas[cell.plant + '_' + cell.growth] ?? atlas[cell.plant + '_0'];
      if (crop) ctx.drawImage(crop, px, py - TILE_H * z, TILE_W * z, TILE_H * 2 * z);
    }
  }

  const mp = project(mote.x, mote.y, mote.h);
  const moteTile = atlas['mote'];
  if (moteTile) {
    ctx.drawImage(moteTile, ox + mp.sx * z - ANCHOR_X * z, oy + mp.sy * z - ANCHOR_Y * z - TILE_Z * z, TILE_W * z, (TILE_H + TILE_Z * 2) * z);
  }
}

// ─── console --------------------------------------------------------------------------

const consoleEl = document.createElement('div');
consoleEl.className = 'console';
panelsEl.appendChild(consoleEl);

const eventLog: string[] = [];
function logLine(s: string): void {
  eventLog.push(s);
  if (eventLog.length > 200) eventLog.shift();
  consoleEl.textContent = eventLog.join('\n');
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// ─── editor + UI ----------------------------------------------------------------------

let editor!: import('./ui/editor').EditorHandle;

function autosaveProgram(): void {
  const rec = { id: PROGRAM_ID, name: 'main', source: editor.getSource(), updatedAt: Date.now() };
  void saveProgram(rec);
}

function clearWorld(): void {
  for (const c of world.getAllCells()) {
    c.terrain = 'soil';
    c.plant = null;
    c.growth = 0;
    c.moisture = 0;
  }
  mote.x = 0;
  mote.y = 0;
  mote.h = 0;
  mote.facing = 'north';
  client.init(world.toJSON(), mote.toJSON());
}

function buildToolbar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  const btn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'btn';
    b.addEventListener('click', fn);
    bar.appendChild(b);
    return b;
  };
  btn('Run', () => {
    eventLog.length = 0;
    consoleEl.textContent = '';
    client.run(editor.getSource(), 'main');
  });
  btn('Pause', () => client.pause());
  btn('Resume', () => client.resume());
  btn('Step', () => client.step(1));
  btn('Reset', () => clearWorld());
  btn('Export', () => downloadProgram(editor.getSource(), 'main'));
  btn('Import', () =>
    pickProgramFile((source) => {
      // ponytail: import only loads text; it never runs. Run is a separate click.
      editor.setSource(source);
      autosaveProgram();
    })
  );
  return bar;
}

// ─── worker ---------------------------------------------------------------------------

const client = new WorkerClient({
  tick: (cells, pos) => {
    for (const c of cells) {
      const cell = world.get(c.x, c.y, c.h);
      if (!cell) continue;
      if (c.terrain !== undefined) cell.terrain = c.terrain;
      if (c.plant !== undefined) cell.plant = c.plant;
      if (c.growth !== undefined) cell.growth = c.growth;
      if (c.moisture !== undefined) cell.moisture = c.moisture;
    }
    mote.x = pos.x;
    mote.y = pos.y;
    mote.h = pos.h;
    mote.facing = pos.facing as typeof mote.facing;
  },
  event: (kind, x, y, h, data) => logLine(`${kind} @(${x},${y},${h}) ${JSON.stringify(data)}`),
  console: (lines) => {
    for (const l of lines) logLine(`> ${l}`);
  },
  error: (e) => logLine(`ERROR ${e.phase} line ${e.line} col ${e.col}: ${e.message}`),
  aborted: (a) => logLine(`ABORTED ${a.reason} after ${a.ops} ops`),
});

client.init(world.toJSON(), mote.toJSON());

// ─── boot -----------------------------------------------------------------------------

async function boot(): Promise<void> {
  const settings = await loadSettings();
  camera.zoom = settings.zoom ?? DEFAULT_SETTINGS.zoom;

  const saved = await getProgram(PROGRAM_ID);
  editor = createEditor(editorEl!, saved?.source ?? STARTER, debounce(autosaveProgram, 1000));
  editor.focus();

  const saveSettingsDebounced = debounce(() => void saveSettings({ speedMultiplier: settings.speedMultiplier, zoom: camera.zoom, textScale: settings.textScale, spriteDetail: settings.spriteDetail }), 400);
  window.addEventListener('beforeunload', () => void saveSettings({ speedMultiplier: settings.speedMultiplier, zoom: camera.zoom, textScale: settings.textScale, spriteDetail: settings.spriteDetail }));
  window.addEventListener('wheel', saveSettingsDebounced, { passive: true });
}

panelsEl.insertBefore(buildToolbar(), panelsEl.firstChild);

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
  clampPan(camera, cssW, cssH);
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
  clampPan(camera, cssW, cssH);
}, { passive: false });

function frame(): void {
  draw();
  requestAnimationFrame(frame);
}

resize();
window.addEventListener('resize', resize);
requestAnimationFrame(frame);
void boot();