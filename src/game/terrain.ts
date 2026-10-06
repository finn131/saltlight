export type TerrainId =
  | 'soil'
  | 'grass'
  | 'rock'
  | 'sand'
  | 'water_shallow'
  | 'water_deep'
  | 'ledge'
  | 'vent';

export interface TerrainDef {
  id: TerrainId;
  name: string;
  /** Mote may occupy this cell. */
  walkable: boolean;
  /** till() may convert this cell to plantable ground. */
  tillable: boolean;
  /** Counts as water for growth, irrigation, and chapter gating. */
  isWater: boolean;
  /** Blocks line of sight for sense() and fog seeding. */
  blocksSight: boolean;
  /** Visual footprint, resolved by the sprite baker. */
  sprite: 'flat' | 'slope' | 'rock' | 'void' | 'plant';
  /** Fill colour, used when the cell is exposed by till() or harvest. */
  fill: string;
  /** Optional tint applied on top of the baked sprite in Chapter 2. */
  glow?: string;
}

export const TERRAIN: Record<TerrainId, TerrainDef> = {
  soil: {
    id: 'soil',
    name: 'Soil',
    walkable: true,
    tillable: true,
    isWater: false,
    blocksSight: false,
    sprite: 'flat',
    fill: '#5b4636',
  },
  grass: {
    id: 'grass',
    name: 'Grass',
    walkable: true,
    tillable: true,
    isWater: false,
    blocksSight: false,
    sprite: 'flat',
    fill: '#6f8f5a',
  },
  sand: {
    id: 'sand',
    name: 'Sand',
    walkable: true,
    tillable: true,
    isWater: false,
    blocksSight: false,
    sprite: 'flat',
    fill: '#c2b280',
  },
  rock: {
    id: 'rock',
    name: 'Rock',
    walkable: true,
    tillable: false,
    isWater: false,
    blocksSight: true,
    sprite: 'rock',
    fill: '#7b8087',
  },
  ledge: {
    id: 'ledge',
    name: 'Ledge',
    walkable: false,
    tillable: false,
    isWater: false,
    blocksSight: true,
    sprite: 'rock',
    fill: '#5f646a',
  },
  water_shallow: {
    id: 'water_shallow',
    name: 'Shallow water',
    walkable: false,
    tillable: false,
    isWater: true,
    blocksSight: false,
    sprite: 'flat',
    fill: '#4a7d95',
  },
  water_deep: {
    id: 'water_deep',
    name: 'Deep water',
    walkable: false,
    tillable: false,
    isWater: true,
    blocksSight: false,
    sprite: 'void',
    fill: '#12324a',
    glow: '#1d5f7a',
  },
  vent: {
    id: 'vent',
    name: 'Hydrothermal vent',
    walkable: true,
    tillable: false,
    isWater: false,
    blocksSight: false,
    sprite: 'plant',
    fill: '#2a1f2c',
    glow: '#ff7a3d',
  },
};