import './style.css';
import { Mote, type MoteJSON } from './game/drone';
import { World, type WorldJSON } from './game/world';
import { generateChapter1, generateChapter2 } from './game/chapter';
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

const editorEl = document.getElementById('editor')!;
const editorBody = document.getElementById('editor-body')!;
const editorDrag = document.getElementById('editor-drag')!;
const taskPanelEl = document.getElementById('task-panel')!;
const panelsEl = document.getElementById('panels')!;
if (!editorEl || !editorBody || !editorDrag || !taskPanelEl || !panelsEl) {
  throw new Error('app shell is missing one of #editor, #editor-body, #editor-drag, #task-panel, #panels');
}

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

// ── draggable editor window ────────────────────────────────────────────────────────
// Pointer drag plus arrow-key nudging, so the window is movable without a mouse.
// Pointer capture keeps the drag alive when the cursor leaves the title bar.

const DRAG_STEP = 24;
let dragState: { id: number; dx: number; dy: number } | null = null;

/** Below this width the editor is a bottom sheet, so it has nothing to drag. */
const DOCK_BELOW = 1200;

function clampEditor(): void {
  if (window.innerWidth < DOCK_BELOW) {
    editorEl.style.left = '';
    editorEl.style.top = '';
    editorEl.style.transform = '';
    return;
  }
  const r = editorEl.getBoundingClientRect();
  // Keep at least a grabbable strip of the title bar and 120px of body on screen.
  const minVisible = 120;
  const x = Math.min(window.innerWidth - minVisible, Math.max(minVisible - r.width, r.left));
  const y = Math.min(window.innerHeight - 32, Math.max(0, r.top));
  editorEl.style.left = `${x}px`;
  editorEl.style.top = `${y}px`;
  editorEl.style.transform = 'none';
}

editorDrag.addEventListener('pointerdown', (e) => {
  if (window.innerWidth < DOCK_BELOW) return;
  const r = editorEl.getBoundingClientRect();
  dragState = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
  // Freeze the visual spot before .dragging drops the centering transform,
  // otherwise the window teleports right by half its width on mousedown.
  editorEl.style.left = `${r.left}px`;
  editorEl.style.top = `${r.top}px`;
  editorEl.style.transform = 'none';
  editorEl.classList.add('dragging');
  editorDrag.setPointerCapture(e.pointerId);
  e.preventDefault();
});

editorDrag.addEventListener('pointermove', (e) => {
  if (!dragState || dragState.id !== e.pointerId) return;
  editorEl.style.left = `${e.clientX - dragState.dx}px`;
  editorEl.style.top = `${e.clientY - dragState.dy}px`;
  editorEl.style.transform = 'none';
});

function endDrag(e: PointerEvent): void {
  if (!dragState || dragState.id !== e.pointerId) return;
  dragState = null;
  editorEl.classList.remove('dragging');
  if (editorDrag.hasPointerCapture(e.pointerId)) editorDrag.releasePointerCapture(e.pointerId);
  clampEditor();
  announcePosition();
}

editorDrag.addEventListener('pointerup', endDrag);
editorDrag.addEventListener('pointercancel', endDrag);

// Screen-reader users get no visual feedback from an arrow-key nudge, so the
// new position is written into the handle's label.
function announcePosition(): void {
  const r = editorEl.getBoundingClientRect();
  editorDrag.setAttribute('aria-label', `Move the Loam window. Use the arrow keys. Position ${Math.round(r.left)}, ${Math.round(r.top)}.`);
}

editorDrag.addEventListener('keydown', (e) => {
  const nudge: Record<string, [number, number]> = {
    ArrowLeft: [-DRAG_STEP, 0],
    ArrowRight: [DRAG_STEP, 0],
    ArrowUp: [0, -DRAG_STEP],
    ArrowDown: [0, DRAG_STEP],
  };
  const delta = nudge[e.key];
  if (!delta) return;
  const r = editorEl.getBoundingClientRect();
  editorEl.style.left = `${r.left + delta[0]}px`;
  editorEl.style.top = `${r.top + delta[1]}px`;
  editorEl.style.transform = 'none';
  clampEditor();
  announcePosition();
  e.preventDefault();
});

window.addEventListener('resize', clampEditor);

// The drag hint must not promise an interaction that is switched off.
const dragHint = document.getElementById('editor-drag-hint');
function syncDragHint(): void {
  if (!dragHint) return;
  dragHint.style.display = window.innerWidth < DOCK_BELOW ? 'none' : '';
}
syncDragHint();
window.addEventListener('resize', syncDragHint);

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
consoleEl.setAttribute('role', 'log');
consoleEl.setAttribute('aria-live', 'polite');
consoleEl.setAttribute('aria-label', 'Program output');

const eventLog: string[] = [];
// ponytail: coalesce writes; the keep-alive can emit hundreds of ticks a second
// and rewriting the whole node each time is the one real cost in the panel.
let consoleDirty = false;
let lastConsolePaint = 0;
function logLine(s: string): void {
  eventLog.push(s);
  if (eventLog.length > 200) eventLog.shift();
  consoleDirty = true;
}
function paintConsole(now: number): void {
  if (!consoleDirty || now - lastConsolePaint < 100) return;
  consoleDirty = false;
  lastConsolePaint = now;
  consoleEl.textContent = eventLog.join('\n');
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

let taskIndex = 0;
let freePlay = false;
let chapter: 1 | 2 = 1;

function enterChapter2(opts: { silent?: boolean; taskIndex?: number } = {}): void {
  // Chapter 2 is gated on finishing the tutorial, and the world is rebuilt with
  // fog and current wired in from the rule modules.
  const ch = generateChapter2({
    seed: 2,
    fogRadius: 3,
    currentStrength: 1,
    upgrades: world.upgrades,
    tech: [...world.tech],
  });
  world = ch.world;
  mote = ch.mote;
  chapter = 2;
  taskIndex = opts.taskIndex ?? TASKS.length;
  freePlay = true;
  if (!opts.silent) {
    eventLog.length = 0;
    logLine('entered the trench');
    editor.setSource("d = sense('back')\nreport(d)\n");
  }
  client.init(world.toJSON(), mote.toJSON());
  autosaveProgram();
  renderPanels();
}

const taskPanel = new TaskPanel();
const resourcePanel = new ResourcePanel();
let settingsPanel: SettingsPanel;

const chapterBtn = document.createElement('button');
chapterBtn.textContent = 'Descend';
chapterBtn.className = 'btn';
chapterBtn.style.alignSelf = 'flex-start';
chapterBtn.style.display = 'none';
chapterBtn.setAttribute('aria-label', 'Descend into the Deep Trench, Chapter 2');
chapterBtn.addEventListener('click', () => enterChapter2());

function currentTask() {
  return TASKS[taskIndex];
}

function renderPanels(): void {
  if (chapter === 2) {
    taskPanel.render({ index: TASKS.length, name: 'Deep Trench', concept: 'nothing here is what it seems', hint: 'Fog hides the grid past your sensing radius. Survey before you farm.', total: TASKS.length });
  } else if (!freePlay && currentTask()) {
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
      .filter((u) => u.chapter === chapter)
      .map((u) => ({ name: u.name, level: world.upgrades[u.id] ?? 0, maxLevel: unlockedLevel(u, harvested) })),
  });
  chapterBtn.style.display = freePlay && chapter === 1 ? '' : 'none';
}

function checkTask(): void {
  if (freePlay || !currentTask()) return;
  const source = editor.getSource();
  const { passed } = evaluateTask(currentTask(), source);
  if (!passed) return;
  logLine(`task ${currentTask().id} complete: ${currentTask().name}`);
  world.credits += 5;
  // Advance the index first so the saved index reaches TASKS.length on the last
  // task, which is what freePlay is restored from.
  taskIndex++;
  if (taskIndex >= TASKS.length) {
    freePlay = true;
    logLine('tutorial complete, free play unlocked');
  } else {
    editor.setSource(currentTask().starter);
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
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Program controls');
  const btn = (label: string, fn: () => void, ariaLabel: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'btn';
    b.type = 'button';
    b.title = ariaLabel;
    b.setAttribute('aria-label', ariaLabel);
    b.addEventListener('click', fn);
    bar.appendChild(b);
    return b;
  };
  btn('Run', () => {
    if (!editor) return;
    eventLog.length = 0;
    consoleEl.textContent = '';
    client.run(editor.getSource(), PROGRAM_ID);
  }, 'Run the program');
  btn('Pause', () => client.pause(), 'Pause the simulation');
  btn('Resume', () => client.resume(), 'Resume the simulation');
  btn('Step', () => client.step(1), 'Advance one slice');
  btn('Check', () => checkTask(), 'Check the current task');
  btn('Reset', () => clearWorld(), 'Reset the island');
  btn('Export', () => {
    if (!editor) return;
    downloadProgram(editor.getSource(), 'main');
  }, 'Export the program as a .py file');
  btn('Import', () =>
    pickProgramFile((source) => {
      if (!editor) return;
      editor.setSource(source);
      autosaveProgram();
    }), 'Import a .py file without running it');
  return bar;
}

const client = new WorkerClient({
  tick: (cells, pos, state) => {
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
    // The worker owns the economy; mirror it so the panels and saves agree.
    world.credits = state.credits;
    mote.inventory = { ...state.inventory };
    world.upgrades = { ...state.upgrades };
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
    const savedWorld = await loadWorld<{ world: WorldJSON; mote: MoteJSON; taskIndex: number; chapter: 1 | 2 }>();
    if (savedWorld) {
      // Chapter is stored explicitly because rule slots are functions and do not
      // survive a JSON round trip; the Chapter 2 world is rebuilt from the rule
      // modules instead of restored verbatim.
      if (savedWorld.chapter === 2) {
        enterChapter2({ silent: true, taskIndex: savedWorld.taskIndex ?? TASKS.length });
        client.init(world.toJSON(), mote.toJSON());
      } else {
        world = World.fromJSON(savedWorld.world);
        mote = Mote.fromJSON(savedWorld.mote);
        taskIndex = Math.min(savedWorld.taskIndex ?? 0, TASKS.length);
        if (taskIndex >= TASKS.length) freePlay = true;
        client.init(world.toJSON(), mote.toJSON());
      }
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

  editor = createEditor(editorBody, initialSource, debounce(autosaveProgram, 1000));
  editor.focus();
  clampEditor();

  const saveWorldNow = (): void => {
    void saveWorld({ world: world.toJSON(), mote: mote.toJSON(), taskIndex, chapter });
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
panelsEl.appendChild(resourcePanel.root);
panelsEl.appendChild(chapterBtn);
settingsPanel = new SettingsPanel((s) => client.setSpeed(s.speedMultiplier), { speedMultiplier: 1 });
panelsEl.appendChild(settingsPanel.root);
panelsEl.insertBefore(buildToolbar(), panelsEl.firstChild);
taskPanelEl.appendChild(taskPanel.root);

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
canvas.addEventListener('pointercancel', (e) => {
  dragging = false;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.zoom = clampZoom(camera, camera.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  clampPan(camera, cssW, cssH);
}, { passive: false });

function frame(): void {
  draw();
  paintConsole(performance.now());
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