// @ts-nocheck
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { renderAscii, asciiLegend } = await import('../src/debug/ascii.ts');
const { World } = await import('../src/game/world.ts');
const { Mote } = await import('../src/game/drone.ts');
const { CROPS } = await import('../src/game/crops.ts');

function fresh() {
  return { world: new World({ width: 10, height: 10 }), mote: new Mote() };
}

test('renderAscii: empty grid shows terrain keys', () => {
  const { world, mote } = fresh();
  const { lines, legend } = renderAscii(world.getAllCells(), mote, 5, 5);
  assert.ok(lines.length > 0);
  assert.ok(legend.includes('terrain:'));
  assert.ok(legend.includes('crops:'));
  // First line is header
  assert.ok(lines[0].includes('w=5 h=5'));
  // Grid lines
  const gridLines = lines.slice(1);
  assert.equal(gridLines.length, 5);
  // Empty cells should show soil '.'
  for (const line of gridLines.slice(0, 5)) {
    // Cells separated by space, 5 cells per row
    assert.ok(line.includes('.'));
  }
});

test('renderAscii: mote shows @ at its position', () => {
  const { world, mote } = fresh();
  mote.x = 2;
  mote.y = 3;
  const { lines } = renderAscii(world.getAllCells(), mote, 5, 5);
  const gridLines = lines.slice(1);
  // Row 3 (0-indexed), col 2 should have @
  const row3 = gridLines[3];
  assert.ok(row3.includes('@'), `row 3 should have @, got: ${row3}`);
});

test('renderAscii: crop shows lowercase when immature', () => {
  const { world, mote } = fresh();
  const cell = world.get(2, 2, 0)!;
  cell.plant = 'kelp';
  cell.growth = 0;
  cell.moisture = 0;
  const { lines } = renderAscii(world.getAllCells(), mote, 5, 5);
  const gridLines = lines.slice(1);
  const row2 = gridLines[2];
  assert.ok(row2.includes('k'), 'kelp immature should show lowercase k');
});

test('renderAscii: crop shows uppercase when harvestable', () => {
  const { world, mote } = fresh();
  const cell = world.get(2, 2, 0)!;
  cell.plant = 'kelp';
  cell.growth = CROPS.kelp.growthSteps;
  cell.moisture = CROPS.kelp.waterNeed;
  const { lines } = renderAscii(world.getAllCells(), mote, 5, 5);
  const gridLines = lines.slice(1);
  const row2 = gridLines[2];
  assert.ok(row2.includes('K'), 'kelp harvestable should show uppercase K');
});

test('asciiLegend: includes terrain and crop keys', () => {
  const legend = asciiLegend();
  assert.ok(legend.includes('terrain:'));
  assert.ok(legend.includes('crops:'));
  assert.ok(legend.includes('.'));
  assert.ok(legend.includes('k'));
  assert.ok(legend.includes('mote'));
  assert.ok(legend.includes('upper=harvestable'));
});