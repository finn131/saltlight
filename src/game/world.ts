import { TERRAIN, type TerrainId } from './terrain';
import { CROPS, growthTick, type CropId } from './crops';

export interface Cell {
  x: number;
  y: number;
  h: number;
  terrain: TerrainId;
  plant: CropId | null;
  growth: number;
  moisture: number;
}

export interface WorldRuleSlots {
  claimWater?: (cell: Cell) => boolean;
}

export interface WorldJSON {
  width: number;
  height: number;
  credits: number;
  tech: string[];
  cells: Cell[];
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
  private store = new Map<string, Cell>();

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
  }

  *cells(): Iterable<Cell> {
    yield* this.store.values();
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
    mote.enqueue('plant', { crop: crop.id, x: cell.x, y: cell.y, h: cell.h });
    return crop.id;
  }

  harvest(mote: MoteLike): number {
    const cell = this.get(mote.x, mote.y, mote.h);
    if (!cell || cell.plant === null) return 0;
    const crop = CROPS[cell.plant];
    if (cell.growth < crop.growthSteps) return 0;
    // ponytail: 1 credit per yield unit; add creditsPerUnit to CropDef if balance needs it
    mote.inventory[crop.id] = (mote.inventory[crop.id] ?? 0) + crop.yieldAmount;
    this.credits += crop.yieldAmount;
    cell.plant = null;
    cell.growth = 0;
    mote.enqueue('harvest', { amount: crop.yieldAmount, crop: crop.id, x: cell.x, y: cell.y, h: cell.h });
    return crop.yieldAmount;
  }

  water(mote: { x: number; y: number; h: number }): boolean {
    const cell = this.get(mote.x, mote.y, mote.h);
    if (!cell || cell.plant === null) return false;
    const crop = CROPS[cell.plant];
    cell.moisture = Math.min(cell.moisture + 1, crop.waterNeed);
    return true;
  }

  tick(mote: MoteLike): void {
    growthTick(this.store.values());
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
    };
  }

  static fromJSON(j: WorldJSON): World {
    const w = new World({ width: j.width, height: j.height, credits: j.credits });
    w.tech = new Set(j.tech);
    w.store.clear();
    for (const c of j.cells) w.store.set(w.key(c.x, c.y, c.h), { ...c });
    return w;
  }
}