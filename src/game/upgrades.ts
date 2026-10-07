export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  chapter: 1 | 2;
  maxLevel: number;
  /** Cumulative harvested units needed for each level; thresholds[0] unlocks level 1. */
  thresholds: number[];
}

export const UPGRADES: Record<string, UpgradeDef> = {
  yield: {
    id: 'yield',
    name: 'Harvest yield',
    desc: 'Each level adds 25% to the units a harvest returns.',
    chapter: 1,
    maxLevel: 4,
    thresholds: [10, 40, 120, 300],
  },
  growth: {
    id: 'growth',
    name: 'Growth speed',
    desc: 'Each level adds one growth step every few ticks.',
    chapter: 1,
    maxLevel: 4,
    thresholds: [15, 60, 180, 420],
  },
  movement: {
    id: 'movement',
    name: 'Movement budget',
    desc: 'Each level extends how far the Mote may move before resting.',
    chapter: 1,
    maxLevel: 3,
    thresholds: [20, 90, 240],
  },
  capacity: {
    id: 'capacity',
    name: 'Inventory capacity',
    desc: 'Each level raises how much the Mote can carry.',
    chapter: 1,
    maxLevel: 3,
    thresholds: [25, 100, 260],
  },
  senseRadius: {
    id: 'senseRadius',
    name: 'Sensing radius',
    desc: 'Each level widens the fog reveal around the Mote.',
    chapter: 2,
    maxLevel: 4,
    thresholds: [30, 120, 300, 600],
  },
  currentResist: {
    id: 'currentResist',
    name: 'Current resistance',
    desc: 'Each level reduces the trench current drift.',
    chapter: 2,
    maxLevel: 3,
    thresholds: [40, 160, 360],
  },
};

/** Harvest-yield multiplier applied in World.harvest. */
export function yieldMultiplier(level: number): number {
  return 1 + 0.25 * level;
}

/** Total units harvested across all crops, the progression currency. */
export function totalHarvested(inventory: Record<string, number>): number {
  let sum = 0;
  for (const n of Object.values(inventory)) sum += n;
  return sum;
}

/** Highest level of `def` unlocked by a cumulative-harvested total. */
export function unlockedLevel(def: UpgradeDef, harvested: number): number {
  let level = 0;
  for (const t of def.thresholds) if (harvested >= t) level++;
  return Math.min(level, def.maxLevel);
}