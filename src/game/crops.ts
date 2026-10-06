import type { TerrainId } from './terrain';

export type CropId = 'kelp' | 'glasswort' | 'lantern_pearl' | 'glowcap';

export interface CropDef {
  id: CropId;
  name: string;
  /** Seed cost in credits. */
  seedCost: number;
  /** Water units required per growth step. */
  waterNeed: number;
  /** Growth steps required to reach harvestable. */
  growthSteps: number;
  /** Units added to inventory on harvest. */
  yieldAmount: number;
  /** Where this crop may be planted. */
  plantableOn: TerrainId[];
  /** Unlock predicate, evaluated by the tech tree, not by the VM. */
  unlock: { tech: string | null };
  /** Baked sprite tints; glow is additive and pulses in Chapter 2. */
  colors: { body: string; tip: string; glow?: string };
}

export const CROPS: Record<CropId, CropDef> = {
  kelp: {
    id: 'kelp',
    name: 'Kelp',
    seedCost: 4,
    waterNeed: 1,
    growthSteps: 3,
    yieldAmount: 2,
    plantableOn: ['soil'],
    unlock: { tech: null },
    colors: { body: '#3f7d4e', tip: '#8fd694' },
  },
  glasswort: {
    id: 'glasswort',
    name: 'Glasswort',
    seedCost: 12,
    waterNeed: 2,
    growthSteps: 5,
    yieldAmount: 5,
    plantableOn: ['soil', 'water_shallow'],
    unlock: { tech: 'glasswort_drying' },
    colors: { body: '#9ad5c0', tip: '#e8fff6', glow: '#b6f2ff' },
  },
  lantern_pearl: {
    id: 'lantern_pearl',
    name: 'Lantern pearl',
    seedCost: 20,
    waterNeed: 1,
    growthSteps: 6,
    yieldAmount: 6,
    plantableOn: ['soil', 'water_shallow'],
    unlock: { tech: 'lantern_pearl_cultivation' },
    colors: { body: '#3f7d4e', tip: '#b6f2ff', glow: '#b6f2ff' },
  },
  glowcap: {
    id: 'glowcap',
    name: 'Glowcap',
    seedCost: 18,
    waterNeed: 1,
    growthSteps: 4,
    yieldAmount: 4,
    plantableOn: ['soil'],
    unlock: { tech: 'glowcap_cultivation' },
    colors: { body: '#6f8f5a', tip: '#c58bff', glow: '#c58bff' },
  },
};

export interface CellLike {
  plant: CropId | null;
  growth: number;
  moisture: number;
}

export function growthTick(cells: Iterable<CellLike>): void {
  const list: CellLike[] = [];
  for (const c of cells) if (c.plant !== null) list.push(c);

  for (const c of list) {
    const crop = CROPS[c.plant!];
    if (c.moisture > crop.waterNeed) c.moisture--;
  }
  for (const c of list) {
    const crop = CROPS[c.plant!];
    if (c.growth < crop.growthSteps && c.moisture >= crop.waterNeed) c.growth++;
  }
}