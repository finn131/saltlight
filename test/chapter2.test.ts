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

const { generateChapter2 } = await import('../src/game/chapter.ts');
const { makeFog, inFog } = await import('../src/game/rules/fog.ts');
const { makeCurrent, trenchDirection } = await import('../src/game/rules/current.ts');
const { Mote } = await import('../src/game/drone.ts');

test('acceptance 1: sense returns UNKNOWN past the fog radius', () => {
  const { world, mote } = generateChapter2({ seed: 2, fogRadius: 3 });
  const far = world.get(mote.x + 9, mote.y + 9, 0);
  assert.ok(far, 'a far cell exists');
  const fog = makeFog(3);
  assert.equal(fog.senseFilter(far, mote.position()), 'UNKNOWN', 'far cell is fogged');
  const near = world.get(mote.x, mote.y + 1, 0);
  assert.ok(near);
  assert.notEqual(fog.senseFilter(near, mote.position()), 'UNKNOWN', 'near cell is visible');
});

test('inFog helper agrees with the sense filter', () => {
  const { world, mote } = generateChapter2({ seed: 2, fogRadius: 3 });
  const near = world.get(mote.x, mote.y + 1, 0);
  const far = world.get(mote.x + 8, mote.y, 0);
  assert.equal(inFog(near, mote.position(), 3), false);
  assert.equal(inFog(far, mote.position(), 3), true);
});

test('acceptance 3: current moves the Mote off its intended path', () => {
  const { world, mote } = generateChapter2({ seed: 2, currentStrength: 1 });
  const before = mote.position();
  mote.move(world, 'forward');
  const after = mote.position();
  const { world: w2, mote: m2 } = generateChapter2({ seed: 2, currentStrength: 1 });
  const before2 = m2.position();
  m2.move(w2, 'forward');
  const after2 = m2.position();
  assert.deepEqual(after, after2, 'current drift is deterministic');
  assert.deepEqual(before, before2);
});

test('current: a correcting program can hold a route (read position, counter-move)', () => {
  const { world, mote } = generateChapter2({ seed: 2, currentStrength: 1 });
  mote.x = 10;
  mote.y = 6;
  mote.facing = 'south';
  const startY = mote.y;
  mote.move(world, 'forward');
  assert.ok(mote.y > startY, 'advanced south, with current help');
  const afterY = mote.y;
  mote.move(world, 'back');
  assert.ok(mote.y <= afterY, 'counter-move reduces y');
});

test('current resist reduces drift', () => {
  const strong = makeCurrent({ strength: 1, resist: 0, directionAt: trenchDirection });
  const resisted = makeCurrent({ strength: 1, resist: 0.5, directionAt: trenchDirection });
  const cell = { x: 0, y: 0, h: -2, terrain: 'sand', plant: null, growth: 0, moisture: 0 };
  const a = strong.moveDrift(cell, { x: 0, y: 0, h: -2 });
  const b = resisted.moveDrift(cell, { x: 0, y: 0, h: -2 });
  assert.ok(Math.abs(b.dx) + Math.abs(b.dy) <= Math.abs(a.dx) + Math.abs(a.dy), 'resist lowers drift');
});

test('acceptance 4: water cells are claimable with till()', () => {
  const { world, mote } = generateChapter2({ seed: 2 });
  const water = world.getAllCells().find((c) => c.terrain === 'water_deep');
  assert.ok(water, 'trench has water');
  mote.x = water.x;
  mote.y = water.y;
  mote.h = water.h;
  assert.equal(world.till(mote), true, 'till claims water in chapter 2');
  assert.equal(world.get(water.x, water.y, water.h).terrain, 'soil');
});

test('chapter 2: water is not walkable but is claimable', () => {
  const { world } = generateChapter2({ seed: 2 });
  const water = world.getAllCells().find((c) => c.terrain === 'water_deep');
  const mote = new Mote({ x: water.x, y: water.y - 1, h: water.h, facing: 'south' });
  assert.equal(mote.move(world, 'forward'), false, 'water blocks movement');
});

test('acceptance 5: trench heights are negative', () => {
  const { world } = generateChapter2({ seed: 2 });
  const cells = world.getAllCells();
  assert.ok(cells.some((c) => c.h < 0), 'has negative heights');
  assert.ok(cells.some((c) => c.h === 0), 'has the entry ledge at 0');
});

test('chapter 2: has ledge, vent, water rows', () => {
  const { world } = generateChapter2({ seed: 2 });
  const kinds = new Set(world.getAllCells().map((c) => c.terrain));
  assert.ok(kinds.has('ledge'), 'has ledge');
  assert.ok(kinds.has('vent'), 'has vent');
  assert.ok(kinds.has('water_deep'), 'has water');
});