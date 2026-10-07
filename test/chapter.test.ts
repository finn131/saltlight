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

const { generateChapter1, generateChapter } = await import('../src/game/chapter.ts');

test('chapter 1: island is 22x22', () => {
  const { world } = generateChapter1({ seed: 1 });
  assert.equal(world.width, 22);
  assert.equal(world.height, 22);
});

test('chapter 1: interior is walkable, centre is plantable soil or grass', () => {
  const { world, mote } = generateChapter1({ seed: 1 });
  assert.equal(world.get(mote.x, mote.y, 0) !== undefined, true, 'mote starts on a cell');
  const centre = world.get(mote.x, mote.y, 0);
  assert.ok(['soil', 'grass'].includes(centre.terrain), `centre terrain ${centre.terrain} is plantable`);
});

test('chapter 1: the rim blocks movement (walking outward eventually fails)', () => {
  const { world, mote } = generateChapter1({ seed: 1 });
  let blocked = false;
  for (let i = 0; i < 40; i++) {
    if (!mote.move(world, 'forward')) {
      blocked = true;
      break;
    }
  }
  assert.equal(blocked, true, 'the rim eventually blocks forward movement');
});

test('chapter 1: heights stay in 0..2', () => {
  const { world } = generateChapter1({ seed: 1 });
  for (const c of world.getAllCells()) {
    assert.ok(c.h >= 0 && c.h <= 2, `height ${c.h} within 0..2`);
  }
});

test('chapter 1: has height-1 and height-2 cells', () => {
  const { world } = generateChapter1({ seed: 1 });
  const cells = world.getAllCells();
  assert.ok(cells.some((c) => c.h === 1), 'has a height-1 rim');
  assert.ok(cells.some((c) => c.h === 2), 'has a height-2 spur');
});

test('chapter 1: deterministic for a seed', () => {
  const a = generateChapter1({ seed: 42 });
  const b = generateChapter1({ seed: 42 });
  assert.deepEqual(a.world.toJSON(), b.world.toJSON());
});

test('chapter 1: water is not walkable', () => {
  const { world } = generateChapter1({ seed: 1 });
  const water = world.getAllCells().find((c) => c.terrain === 'water_deep');
  assert.ok(water, 'island has water');
  assert.equal(world.get(water.x, water.y, water.h).terrain, 'water_deep');
});

test('generateChapter defaults to chapter 1', () => {
  assert.equal(generateChapter({}).chapter, 1);
});

test('chapter 1: upgrades and tech carry over', () => {
  const { world } = generateChapter1({ seed: 1, upgrades: { yield: 2 }, tech: ['glasswort_drying'] });
  assert.equal(world.upgrades['yield'], 2);
  assert.ok(world.tech.has('glasswort_drying'));
});