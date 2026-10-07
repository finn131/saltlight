import { TERRAIN } from './terrain';

export type Facing = 'north' | 'south' | 'east' | 'west';

export type EventKind = 'harvest' | 'plant' | 'low_inventory' | 'blocked' | 'tick';

export const EVENTS: readonly EventKind[] = [
  'harvest',
  'plant',
  'low_inventory',
  'blocked',
  'tick',
];

export type RuleFn = (...args: unknown[]) => unknown;

export interface PendingEvent {
  kind: EventKind;
  ctx: Record<string, unknown>;
}

export interface MoteJSON {
  x: number;
  y: number;
  h: number;
  facing: Facing;
  inventory: Record<string, number>;
  tickCount: number;
  lowThresholds: Record<string, number>;
}

interface WorldLike {
  allowVertical: boolean;
  get(x: number, y: number, h: number): { terrain: string } | undefined;
  rules?: {
    senseFilter?: (cell: { terrain: string; x: number; y: number; h: number }, mote: { x: number; y: number; h: number }) => string;
    moveDrift?: (cell: { terrain: string; x: number; y: number; h: number }, mote: { x: number; y: number; h: number }) => { dx: number; dy: number };
  };
}

const VEC: Record<Facing, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

const OPPOSITE: Record<Facing, Facing> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const LEFT: Record<Facing, Facing> = {
  north: 'west',
  west: 'south',
  south: 'east',
  east: 'north',
};

const RIGHT: Record<Facing, Facing> = {
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north',
};

export function resolveDir(facing: Facing, dir: string): readonly [number, number] {
  switch (dir) {
    case 'forward':
      return VEC[facing];
    case 'back':
      return VEC[OPPOSITE[facing]];
    case 'left':
      return VEC[LEFT[facing]];
    case 'right':
      return VEC[RIGHT[facing]];
    default:
      throw new Error(`invalid direction: ${dir}`);
  }
}

export class Mote {
  x: number;
  y: number;
  h: number;
  facing: Facing;
  inventory: Record<string, number>;
  tickCount: number;
  lowThresholds: Record<string, number>;
  inRule = false;
  readonly rules = new Map<EventKind, RuleFn>();
  readonly pending: PendingEvent[] = [];

  constructor(opts?: { x?: number; y?: number; h?: number; facing?: Facing }) {
    this.x = opts?.x ?? 0;
    this.y = opts?.y ?? 0;
    this.h = opts?.h ?? 0;
    this.facing = opts?.facing ?? 'north';
    this.inventory = {};
    this.tickCount = 0;
    this.lowThresholds = {};
  }

  position(): { x: number; y: number; h: number; facing: Facing } {
    return { x: this.x, y: this.y, h: this.h, facing: this.facing };
  }

  inventoryCopy(): Record<string, number> {
    return { ...this.inventory };
  }

  enqueue(kind: EventKind, ctx: Record<string, unknown>): void {
    this.pending.push({ kind, ctx });
  }

  setRule(event: string, fn: RuleFn): void {
    if (this.inRule) throw new Error('set_rule is not allowed inside a rule');
    if (!EVENTS.includes(event as EventKind)) throw new Error(`unknown event: ${event}`);
    this.rules.set(event as EventKind, fn);
  }

  clearRule(event: string): void {
    if (this.inRule) throw new Error('clear_rule is not allowed inside a rule');
    this.rules.delete(event as EventKind);
  }

  move(world: WorldLike, dir: string): boolean {
    const [dx0, dy0] = resolveDir(this.facing, dir);
    let dx = dx0;
    let dy = dy0;
    // Chapter 2 current drifts the target before the walkability check. The
    // rule only ever modifies offsets, never terrain rules, so nothing here
    // branches on which chapter is loaded.
    if (world.rules?.moveDrift) {
      const from = world.get(this.x, this.y, this.h);
      if (from) {
        const d = world.rules.moveDrift(from as never, { x: this.x, y: this.y, h: this.h });
        dx += d.dx;
        dy += d.dy;
      }
    }
    const tx = this.x + dx;
    const ty = this.y + dy;
    const cell = world.get(tx, ty, this.h);
    if (!cell || !TERRAIN[cell.terrain as keyof typeof TERRAIN].walkable) {
      this.enqueue('blocked', { dir, x: this.x, y: this.y, h: this.h });
      return false;
    }
    this.x = tx;
    this.y = ty;
    return true;
  }

  sense(world: WorldLike, dir: string): string {
    const [dx, dy] = resolveDir(this.facing, dir);
    const cell = world.get(this.x + dx, this.y + dy, this.h);
    if (!cell) return 'UNKNOWN';
    if (world.rules?.senseFilter) {
      return world.rules.senseFilter(cell as never, { x: this.x, y: this.y, h: this.h });
    }
    return cell.terrain;
  }

  ascend(world: WorldLike): boolean {
    if (!world.allowVertical) return false;
    if (!world.get(this.x, this.y, this.h + 1)) return false;
    this.h++;
    return true;
  }

  descend(world: WorldLike): boolean {
    if (!world.allowVertical) return false;
    if (!world.get(this.x, this.y, this.h - 1)) return false;
    this.h--;
    return true;
  }

  dispatch(invoke: (fn: RuleFn, ctx: Record<string, unknown>) => unknown): void {
    if (this.pending.length === 0) return;
    // ponytail: events enqueued during a rule dispatch defer to the next tick, prevents harvest loops
    const snapshot = this.pending.splice(0, this.pending.length);
    for (const ev of snapshot) {
      const fn = this.rules.get(ev.kind);
      if (!fn) continue;
      const frozen = Object.freeze({ ...ev.ctx });
      this.inRule = true;
      try {
        invoke(fn, frozen);
      } finally {
        this.inRule = false;
      }
    }
  }

  checkLowInventory(): void {
    for (const [item, threshold] of Object.entries(this.lowThresholds)) {
      const count = this.inventory[item] ?? 0;
      if (count < threshold) this.enqueue('low_inventory', { item, count });
    }
  }

  toJSON(): MoteJSON {
    return {
      x: this.x,
      y: this.y,
      h: this.h,
      facing: this.facing,
      inventory: { ...this.inventory },
      tickCount: this.tickCount,
      lowThresholds: { ...this.lowThresholds },
    };
  }

  static fromJSON(j: MoteJSON): Mote {
    const m = new Mote({ x: j.x, y: j.y, h: j.h, facing: j.facing });
    m.inventory = { ...j.inventory };
    m.tickCount = j.tickCount;
    m.lowThresholds = { ...j.lowThresholds };
    return m;
  }
}