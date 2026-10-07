import './style.css';
import { Mote, type MoteJSON } from './game/drone';
import { World, type WorldJSON } from './game/world';
import { generateChapter1 } from './game/chapter';
import { TASKS, evaluateTask } from './game/tasks';
import { UPGRADES, unlockedLevel, totalHarvested } from './game/upgrades';
import { WorkerClient } from './workerClient';
import { bakeSprites, type SpriteAtlas } from './render/sprites';
import { project, drawOrder, TILE_W, TILE_H, TILE_Z } from './render/iso';
import { createCamera, clampZoom, clampPan, viewport, cullCells, worldExtents } from './render/camera';
import { createEditor } from './ui/editor';
import { downloadProgram, pickProgramFile } from './ui/filetools';
import { DEFAULT_SETTINGS, loadSettings, saveProgram, saveSettings, loadWorld, saveWorld, getProgram, debounce } from './ui/store';
import { TaskPanel, ResourcePanel, SettingsPanel } from './ui/panels';

const PROGRAM_ID = 'main';

let world = new World({ width: 22, height: 22 });
let mote = new Mote({ x: 10, y: 10, h: 0, facing: 'south' });
{
  const ch = generateChapter1({ seed: 1 });
  world = ch.world;
  mote = ch.mote;
}

const atlas: SpriteAtlas = bakeSprites();
const camera = createCamera(world.width, world.height);

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

const consoleEl = document.createElement('div');
consoleEl.className = 'console';

const eventLog: string[] = [];
function logLine(s: string): void {
  eventLog.push(s);
  if (eventLog.length > 200) eventLog.shift();
  consoleEl.textContent = eventLog.join('\n');
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

let taskIndex = 0;
let freePlay = false;

const taskPanel = new TaskPanel();
const resourcePanel = new ResourcePanel();
let settingsPanel: SettingsPanel;

function currentTask() {
  return TASKS[taskIndex];
}

function renderPanels(): void {
  if (!freePlay && currentTask()) {
    const t = currentTask();
    taskPanel.render({ index: taskIndex, name: t.name, concept: t.concept, hint: t.hint, total: TASKS.length });
  } else {
    taskPanel.render({ index: TASKS.length, name: 'Free play', concept: 'the island is yours', hint: 'Farm it as you like.', total: TASKS.length });
  }
  const harvested = totalHarvested(mote.inventory);
  resourcePanel.render({
    credits: world.credits,
    harvested,
    upgrades: Object.values(UPGRADES)
      .filter((u) => u.chapter === 1)
      .map((u) => ({ name: u.name, level: world.upgrades[u.id] ?? 0, maxLevel: unlockedLevel(u, harvested) })),
  });
}

function checkTask(): void {
  if (freePlay || !currentTask()) return;
  const source = editor.getSource();
  const { passed } = evaluateTask(currentTask(), source);
  if (!passed) return;
  logLine(`task ${currentTask().id} complete: ${currentTask().name}`);
  world.credits += 5;
  if (taskIndex >= TASKS.length - 1) {
    freePlay = true;
    logLine('tutorial complete, free play unlocked');
  } else {
    taskIndex++;
    const next = currentTask();
    editor.setSource(next.starter);
    autosaveProgram();
  }
  renderPanels();
}

function unlockUpgrades(): void {
  const harvested = totalHarvested(mote.inventory);
  for (const u of Object.values(UPGRADES)) {
    const target = unlockedLevel(u, harvested);
    if (u.chapter === 1 && (world.upgrades[u.id] ?? 0) < target) world.upgrades[u.id] = target;
  }
}

let editor!: import('./ui/editor').EditorHandle;

function autosaveProgram(): void {
  if (!editor) return;
  const rec = { id: PROGRAM_ID, name: 'main', source: editor.getSource(), updatedAt: Date.now() };
  void saveProgram(rec);
}

function clearWorld(): void {
  const ch = generateChapter1({ seed: Math.floor(Math.random() * 1e6) + 1 });
  world = ch.world;
  mote = ch.mote;
  taskIndex = 0;
  freePlay = false;
  eventLog.length = 0;
  editor.setSource(currentTask().starter);
  client.init(world.toJSON(), mote.toJSON());
  autosaveProgram();
  renderPanels();
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
    if (!editor) return;
    eventLog.length = 0;
    consoleEl.textContent = '';
    client.run(editor.getSource(), PROGRAM_ID);
  });
  btn('Pause', () => client.pause());
  btn('Resume', () => client.resume());
  btn('Step', () => client.step(1));
  btn('Check', () => checkTask());
  btn('Reset', () => clearWorld());
  btn('Export', () => {
    if (!editor) return;
    downloadProgram(editor.getSource(), 'main');
  });
  btn('Import', () =>
    pickProgramFile((source) => {
      if (!editor) return;
      editor.setSource(source);
      autosaveProgram();
    })
  );
  return bar;
}

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

async function boot(): Promise<void> {
  let settings = DEFAULT_SETTINGS;
  try {
    settings = await loadSettings();
  } catch {
    /* IndexedDB unavailable: defaults */
  }
  camera.zoom = settings.zoom;

  try {
    const savedWorld = await loadWorld<{ world: WorldJSON; mote: MoteJSON; taskIndex: number }>();
    if (savedWorld) {
      world = World.fromJSON(savedWorld.world);
      mote = Mote.fromJSON(savedWorld.mote);
      taskIndex = savedWorld.taskIndex ?? 0;
      freePlay = taskIndex >= TASKS.length;
      client.init(savedWorld.world, savedWorld.mote);
    }
  } catch {
    /* first run */
  }

  let initialSource = freePlay ? TASKS[0].starter : currentTask().starter;
  try {
    const saved = await getProgram(PROGRAM_ID);
    if (saved?.source) initialSource = saved.source;
  } catch {
    /* fall back to the task starter */
  }

  editor = createEditor(editorEl!, initialSource, debounce(autosaveProgram, 1000));
  editor.focus();

  const saveWorldNow = (): void => {
    void saveWorld({ world: world.toJSON(), mote: mote.toJSON(), taskIndex });
  };
  setInterval(saveWorldNow, 10_000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveWorldNow();
  });
  window.addEventListener('pagehide', () => {
    saveWorldNow();
    autosaveProgram();
  });

  const saveSettingsNow = (): void =>
    void saveSettings({ speedMultiplier: settings.speedMultiplier, zoom: camera.zoom, textScale: settings.textScale, spriteDetail: settings.spriteDetail });
  const saveSettingsDebounced = debounce(saveSettingsNow, 400);
  window.addEventListener('pagehide', saveSettingsNow);
  window.addEventListener('wheel', saveSettingsDebounced, { passive: true });

  renderPanels();
}

panelsEl.appendChild(consoleEl);
panelsEl.appendChild(taskPanel.root);
panelsEl.appendChild(resourcePanel.root);
settingsPanel = new SettingsPanel((s) => client.setSpeed(s.speedMultiplier), { speedMultiplier: 1 });
panelsEl.appendChild(settingsPanel.root);
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

setInterval(() => {
  unlockUpgrades();
  renderPanels();
}, 1000);