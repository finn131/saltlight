import type { Cell } from '../game/world';
import { TERRAIN, type TerrainId } from '../game/terrain';
import { CROPS, type CropId } from '../game/crops';
import type { Mote } from '../game/drone';

const TERRAIN_KEY: Record<TerrainId, string> = {
  soil: '.',
  grass: ',',
  rock: '#',
  sand: ':',
  water_shallow: '~',
  water_deep: '~~',
  ledge: 'L',
  vent: '^',
};

const CROP_KEY: Record<CropId, string> = {
  kelp: 'k',
  glasswort: 'g',
  lantern_pearl: 'p',
  glowcap: 'c',
};

// growth stage: lower = immature, upper = harvestable (growth >= growthSteps)
function cropChar(plant: CropId, growth: number, growthSteps: number): string {
  const ch = CROP_KEY[plant];
  return growth >= growthSteps ? ch.toUpperCase() : ch.toLowerCase();
}

export interface AsciiFrame {
  lines: string[];
  legend: string;
}

export function renderAscii(cells: Iterable<Cell>, mote: Mote, width: number, height: number): AsciiFrame {
  const grid: string[][] = [];
  for (let y = 0; y < height; y++) grid.push(new Array<string>(width).fill(' '));

  for (const c of cells) {
    if (c.x < 0 || c.x >= width || c.y < 0 || c.y >= height) continue;
    grid[c.y][c.x] = c.plant !== null ? cropChar(c.plant, c.growth, CROPS[c.plant].growthSteps) : TERRAIN_KEY[c.terrain];
  }

  if (mote.x >= 0 && mote.x < width && mote.y >= 0 && mote.y < height) {
    grid[mote.y][mote.x] = '@';
  }

  const header = `w=${width} h=${height}  mote=(${mote.x},${mote.y},${mote.h}) facing=${mote.facing} ticks=${mote.tickCount}`;
  const lines = [header, ...grid.map((row) => row.join(' '))];
  const legend = buildLegend();
  return { lines, legend };
}

function buildLegend(): string {
  const t = Object.entries(TERRAIN_KEY).map(([id, ch]) => `${ch}=${id}`).join(' ');
  const c = Object.entries(CROP_KEY).map(([id, ch]) => `${ch}=${id}`).join(' ');
  return `terrain: ${t}\ncrops: ${c}\n@ = mote, upper=harvestable, digit suffix = growth stage`;
}

export { buildLegend as asciiLegend };

export function debugEnabled(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}