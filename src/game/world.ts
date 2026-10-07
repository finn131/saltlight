import { TERRAIN, type TerrainId } from './terrain';
import { CROPS, growthTick, type CropId } from './crops';
import { yieldMultiplier } from './upgrades';

export interface Cell {
  x: number;
  y: number;
  h: number;
  terrain: TerrainId;
  plant: CropId | null;
  growth: number;
  moisture: number;
}

export interface CellDelta {
  x: number;
  y: number;
  h: number;
  terrain?: TerrainId;
  plant?: CropId | null;
  growth?: number;
  moisture?: number;
}

export interface WorldRuleSlots {
  claimWater?: (cell: Cell) => boolean;
  /** Chapter 2 fog: override the terrain id that sense() reports. */
  senseFilter?: (cell: Cell, mote: { x: number; y: number; h: number }) => string;
  /** Chapter 2 current: per-tick drift applied inside move(). */
  moveDrift?: (cell: Cell, mote: { x: number; y: number; h: number }) => { dx: number; dy: number };
}

export interface WorldJSON {
  width: number;
  height: number;
  credits: number;
  tech: string[];
  cells: Cell[];
  upgrades: Record<string, number>;
}

interface MoteLike {
  x: number;
  y: number;
  h: number;
  inventory: Record<string, number>;
  tickCount: number;
  enqueue(kind: string, ctx: Record<string, unknown>): void;
}

export class World {
  readonly width: number;
  readonly height: number;
  credits: number;
  tech: Set<string>;
  readonly rules: WorldRuleSlots;
  allowVertical: boolean;
  upgrades: Record<string, number> = {};
  private store = new Map<string, Cell>();
  private dirty = new Map<string, CellDelta>();

  constructor(opts: { width: number; height: number; credits?: number }) {
    this.width = opts.width;
    this.height = opts.height;
    this.credits = opts.credits ?? 20;
    this.tech = new Set();
    this.rules = {};
    this.allowVertical = false;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.store.set(this.key(x, y, 0), {
          x,
          y,
          h: 0,
          terrain: 'soil',
          plant: null,
          growth: 0,
          moisture: 0,
        });
      }
    }
  }

  key(x: number, y: number, h: number): string {
    return `${x},${y},${h}`;
  }

  get(x: number, y: number, h: number): Cell | undefined {
    return this.store.get(this.key(x, y, h));
  }

  set(cell: Cell): void {
    this.store.set(this.key(cell.x, cell.y, cell.h), cell);
    this.markDirty(cell);
  }

  private markDirty(cell: Cell): void {
    const k = this.key(cell.x, cell.y, cell.h);
    this.dirty.set(k, {
      x: cell.x,
      y: cell.y,
      h: cell.h,
      terrain: cell.terrain,
      plant: cell.plant,
      growth: cell.growth,
      moisture: cell.moisture,
    });
  }

  takeDirty(): CellDelta[] {
    const out = [...this.dirty.values()];
    this.dirty.clear();
    return out;
  }

  *cells(): Iterable<Cell> {
    yield* this.store.values();
  }

  /** All cells for debug/serialization. */
  getAllCells(): Cell[] {
    return [...this.store.values()];
  }

  terrainAt(x: number, y: number, h: number): string {
    const c = this.get(x, y, h);
    return c ? c.terrain : '';
  }

  till(mote: { x: number; y: number; h: number }): boolean {
    const cell = this.get(mote.x, mote.y, mote.h);
    if (!cell) return false;
    if (TERRAIN[cell.terrain].tillable || this.rules.claimWater?.(cell)) {
      cell.terrain = 'soil';
      this.markDirty(cell);
      return true;
    }
    return false;
  }

  plant(mote: MoteLike, cropId: string): string {
    const crop = CROPS[cropId as CropId];
    if (!crop) return '';
    if (crop.unlock.tech !== null && !this.tech.has(crop.unlock.tech)) return '';
    const cell = this.get(mote.x, mote.y, mote.h);
    if (!cell) return '';
    if (!crop.plantableOn.includes(cell.terrain)) return '';
    if (cell.plant !== null) return '';
    if (this.credits < crop.seedCost) return '';
    this.credits -= crop.seedCost;
    cell.plant = crop.id;
    cell.growth = 0;
    this.markDirty(cell);
    mote.enqueue('plant', { crop: crop.id, x: cell.x, y: cell.y, h: cell.h });
    return crop.id;
  }

  harvest(mote: MoteLike): number {
    const cell = this.get(mote.x, mote.y, mote.h);
    if (!cell || cell.plant === null) return 0;
    const crop = CROPS[cell.plant];
    if (cell.growth < crop.growthSteps) return 0;
    // ponytail: 1 credit per yield unit; the yield upgrade scales the harvest.
    const amount = crop.yieldAmount * yieldMultiplier(this.upgrades['yield'] ?? 0);
    mote.inventory[crop.id] = (mote.inventory[crop.id] ?? 0) + amount;
    this.credits += amount;
    cell.plant = null;
    cell.growth = 0;
    this.markDirty(cell);
    mote.enqueue('harvest', { amount, crop: crop.id, x: cell.x, y: cell.y, h: cell.h });
    return amount;
  }

  water(mote: { x: number; y: number; h: number }): boolean {
    const cell = this.get(mote.x, mote.y, mote.h);
    if (!cell || cell.plant === null) return false;
    const crop = CROPS[cell.plant];
    cell.moisture = Math.min(cell.moisture + 1, crop.waterNeed);
    this.markDirty(cell);
    return true;
  }

  tick(mote: MoteLike): void {
    const before = new Map<string, { g: number; m: number }>();
    for (const c of this.store.values()) {
      if (c.plant !== null) before.set(this.key(c.x, c.y, c.h), { g: c.growth, m: c.moisture });
    }
    growthTick(this.store.values());
    for (const c of this.store.values()) {
      if (c.plant === null) continue;
      const k = this.key(c.x, c.y, c.h);
      const prev = before.get(k);
      if (prev && (prev.g !== c.growth || prev.m !== c.moisture)) this.markDirty(c);
    }
    mote.tickCount++;
    mote.enqueue('tick', { x: mote.x, y: mote.y, h: mote.h, ticks: mote.tickCount });
  }

  toJSON(): WorldJSON {
    return {
      width: this.width,
      height: this.height,
      credits: this.credits,
      tech: [...this.tech],
      cells: [...this.store.values()],
      upgrades: { ...this.upgrades },
    };
  }

  static fromJSON(j: WorldJSON): World {
    const w = new World({ width: j.width, height: j.height, credits: j.credits });
    w.tech = new Set(j.tech);
    w.upgrades = { ...(j.upgrades ?? {}) };
    w.store.clear();
    w.dirty.clear();
    for (const c of j.cells) w.store.set(w.key(c.x, c.y, c.h), { ...c });
    return w;
  }
}