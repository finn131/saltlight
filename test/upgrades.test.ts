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

const { yieldMultiplier, totalHarvested, unlockedLevel, UPGRADES } = await import('../src/game/upgrades.ts');
const { World } = await import('../src/game/world.ts');
const { Mote } = await import('../src/game/drone.ts');

test('yieldMultiplier: +25% per level, 1.0 at level 0', () => {
  assert.equal(yieldMultiplier(0), 1);
  assert.equal(yieldMultiplier(1), 1.25);
  assert.equal(yieldMultiplier(4), 2);
});

test('totalHarvested: sums every item', () => {
  assert.equal(totalHarvested({}), 0);
  assert.equal(totalHarvested({ kelp: 3, glasswort: 2 }), 5);
});

test('unlockedLevel: counts thresholds met', () => {
  const y = UPGRADES['yield'];
  assert.equal(unlockedLevel(y, 0), 0);
  assert.equal(unlockedLevel(y, 10), 1);
  assert.equal(unlockedLevel(y, 39), 1);
  assert.equal(unlockedLevel(y, 40), 2);
  assert.equal(unlockedLevel(y, 9999), y.maxLevel);
});

test('acceptance 4: yield upgrade is reflected in harvest() output', () => {
  const world = new World({ width: 10, height: 10 });
  const mote = new Mote();
  world.plant(mote, 'kelp');
  for (let i = 0; i < 3; i++) {
    world.water(mote);
    world.tick(mote);
  }
  assert.equal(world.harvest(mote), 2, 'base kelp yield');

  world.upgrades['yield'] = 2;
  world.plant(mote, 'kelp');
  for (let i = 0; i < 3; i++) {
    world.water(mote);
    world.tick(mote);
  }
  assert.equal(world.harvest(mote), 3, 'yield x2 level -> kelp returns 3');
});

test('upgrades: survive a JSON round trip', () => {
  const world = new World({ width: 5, height: 5 });
  world.upgrades['yield'] = 3;
  world.upgrades['capacity'] = 1;
  const back = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
  assert.deepEqual(back.upgrades, { yield: 3, capacity: 1 });
});