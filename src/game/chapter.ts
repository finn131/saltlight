import { World, type Cell } from './world';
import { Mote } from './drone';
import { makeFog } from './rules/fog';
import { makeCurrent, trenchDirection } from './rules/current';

export type ChapterId = 1 | 2;

export interface ChapterWorld {
  world: World;
  mote: Mote;
  chapter: ChapterId;
  seed: number;
}

export interface ChapterOptions {
  seed?: number;
  chapter?: ChapterId;
  /** Task index the save resumes at. */
  taskIndex?: number;
  upgrades?: Record<string, number>;
  credits?: number;
  tech?: string[];
}

const TERRAIN_WATER = new Set(['water_deep', 'water_shallow']);

// ponytail: the island is a deterministic function of the seed, no PRNG library.
// A ring test plus a small hash keeps the shape reproducible across reloads.
function hash(seed: number, x: number, y: number): number {
  let h = seed ^ (x * 374761393) ^ (y * 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const ISLAND_SIZE = 22;
const RIM = 2;

/**
 * Chapter 1, Sky Isles: a floating island. Grass inside, a rock rim, water
 * below and around, a few rock outcrops, heights 0 to 2.
 */
export function generateChapter1(opts: ChapterOptions = {}): ChapterWorld {
  const seed = opts.seed ?? 1;
  const world = new World({ width: ISLAND_SIZE, height: ISLAND_SIZE, credits: opts.credits ?? 20 });
  const half = (ISLAND_SIZE - 1) / 2;

  for (let y = 0; y < ISLAND_SIZE; y++) {
    for (let x = 0; x < ISLAND_SIZE; x++) {
      const dx = x - half;
      const dy = y - half;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const noise = hash(seed, x, y);
      const isWater = dist > half - RIM;
      const cell: Cell = {
        x,
        y,
        h: 0,
        terrain: isWater ? 'water_deep' : noise > 0.94 ? 'rock' : noise > 0.86 ? 'grass' : 'soil',
        plant: null,
        growth: 0,
        moisture: 0,
      };
      world.set(cell);
    }
  }

  // A raised rim of rock at height 1 makes the island read as floating.
  for (let y = 0; y < ISLAND_SIZE; y++) {
    for (let x = 0; x < ISLAND_SIZE; x++) {
      const dx = x - half;
      const dy = y - half;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > half - RIM - 1.6 && dist <= half - RIM + 0.6) {
        world.set({ x, y, h: 1, terrain: 'rock', plant: null, growth: 0, moisture: 0 });
      }
    }
  }

  // Two rock spurs at height 2 give the painter sort something to exercise.
  world.set({ x: 7, y: 7, h: 1, terrain: 'rock', plant: null, growth: 0, moisture: 0 });
  world.set({ x: 7, y: 7, h: 2, terrain: 'rock', plant: null, growth: 0, moisture: 0 });
  world.set({ x: 14, y: 14, h: 1, terrain: 'rock', plant: null, growth: 0, moisture: 0 });

  const mote = new Mote({ x: Math.floor(half), y: Math.floor(half), h: 0, facing: 'south' });
  world.upgrades = { ...(opts.upgrades ?? {}) };
  for (const t of opts.tech ?? []) world.tech.add(t);
  world.takeDirty();

  return { world, mote, chapter: 1, seed };
}

export function generateChapter(opts: ChapterOptions = {}): ChapterWorld {
  if (opts.chapter === 2) return generateChapter2(opts);
  return generateChapter1(opts);
}

const TRENCH_SIZE = 22;
const TRENCH_FLOOR = -8;

export interface Chapter2Options extends ChapterOptions {
  fogRadius?: number;
  currentStrength?: number;
  currentResist?: number;
}

/**
 * Chapter 2, Deep Trench: the information model is inverted. Heights run from 0
 * at the entry ledge down to -8, water is claimable ground, fog hides anything
 * past the sensing radius, and a current pushes the Mote off course.
 */
export function generateChapter2(opts: Chapter2Options = {}): ChapterWorld {
  const seed = opts.seed ?? 2;
  const world = new World({ width: TRENCH_SIZE, height: TRENCH_SIZE, credits: opts.credits ?? 40 });
  world.allowVertical = true;

  const centre = Math.floor((TRENCH_SIZE - 1) / 2);
  for (let y = 0; y < TRENCH_SIZE; y++) {
    for (let x = 0; x < TRENCH_SIZE; x++) {
      const dx = x - centre;
      const dy = y - centre;
      // Descend away from the entry ledge on the north edge.
      const depth = Math.max(0, -dy) * (TRENCH_FLOOR / centre);
      const h = Math.round(depth);
      const noise = hash(seed, x, y);
      const isLedge = h < TRENCH_FLOOR / 2 && noise > 0.9;
      const isVent = noise > 0.82;
      const terrain: Cell['terrain'] = isLedge
        ? 'ledge'
        : isVent
          ? 'vent'
          : h <= TRENCH_FLOOR / 3
            ? 'water_deep'
            : 'sand';
      world.set({ x, y, h, terrain, plant: null, growth: 0, moisture: 0 });
    }
  }

  // A solid entry ledge at the top so the Mote has somewhere to stand.
  for (let x = 0; x < TRENCH_SIZE; x++) {
    world.set({ x, y: 0, h: 0, terrain: 'rock', plant: null, growth: 0, moisture: 0 });
  }

  // Water is the resource here: claim it with till().
  world.rules.claimWater = (cell) => TERRAIN_WATER.has(cell.terrain);
  world.rules.senseFilter = makeFog(opts.fogRadius ?? 3).senseFilter;
  world.rules.moveDrift = makeCurrent({
    strength: opts.currentStrength ?? 1,
    resist: opts.currentResist ?? 0,
    directionAt: trenchDirection,
  }).moveDrift;

  const mote = new Mote({ x: centre, y: 0, h: 0, facing: 'south' });
  world.upgrades = { ...(opts.upgrades ?? {}) };
  for (const t of opts.tech ?? ['glasswort_drying']) world.tech.add(t);
  world.takeDirty();

  return { world, mote, chapter: 2, seed };
}