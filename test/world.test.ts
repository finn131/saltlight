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

const { TERRAIN } = await import('../src/game/terrain.ts');
const { CROPS, growthTick } = await import('../src/game/crops.ts');
const { World } = await import('../src/game/world.ts');
const { Mote, EVENTS, resolveDir } = await import('../src/game/drone.ts');
const { parse } = await import('../src/vm/parser.ts');
const { Interp } = await import('../src/vm/interp.ts');
const { makeBuiltins, BUILTINS } = await import('../src/vm/builtins.ts');

function fresh(size = 10) {
  return { world: new World({ width: size, height: size }), mote: new Mote() };
}

// --- acceptance 1: full farm cycle ------------------------------------------------------

test('acceptance 1: till + plant kelp + 3 cycles yields 0, 0, 2', () => {
  const { world, mote } = fresh();
  assert.equal(world.till(mote), true);
  assert.equal(world.plant(mote, 'kelp'), 'kelp');
  assert.equal(world.credits, 16);
  const results: number[] = [];
  for (let i = 0; i < 3; i++) {
    world.water(mote);
    world.tick(mote);
    results.push(world.harvest(mote));
  }
  assert.deepEqual(results, [0, 0, 2]);
  assert.equal(mote.inventory['kelp'], 2);
  assert.equal(world.credits, 18);
});

// --- acceptance 2: locked tech ----------------------------------------------------------

test('acceptance 2: plant glasswort on locked tech returns "" and deducts no credit', () => {
  const { world, mote } = fresh();
  assert.equal(world.plant(mote, 'glasswort'), '');
  assert.equal(world.credits, 20);
  world.tech.add('glasswort_drying');
  assert.equal(world.plant(mote, 'glasswort'), 'glasswort');
  assert.equal(world.credits, 8);
});

// --- acceptance 3: plant on rock --------------------------------------------------------

test('acceptance 3: plant kelp on rock returns ""', () => {
  const { world, mote } = fresh();
  const cell = world.get(0, 0, 0)!;
  cell.terrain = 'rock';
  assert.equal(world.plant(mote, 'kelp'), '');
  assert.equal(world.credits, 20);
});

// --- acceptance 4: water clamps ---------------------------------------------------------

test('acceptance 4: water beyond waterNeed clamps instead of accumulating', () => {
  const { world, mote } = fresh();
  world.plant(mote, 'kelp');
  for (let i = 0; i < 5; i++) world.water(mote);
  const cell = world.get(0, 0, 0)!;
  assert.equal(cell.moisture, CROPS['kelp'].waterNeed);
});

// --- acceptance 5: set_rule replaces ----------------------------------------------------

test('acceptance 5: set_rule replaces binding rather than stacking', () => {
  const mote = new Mote();
  const calls: string[] = [];
  const fnA = () => calls.push('A');
  const fnB = () => calls.push('B');
  mote.setRule('harvest', fnA);
  mote.setRule('harvest', fnB);
  assert.equal(mote.rules.size, 1);
  mote.enqueue('harvest', { amount: 1 });
  mote.dispatch((fn, ctx) => (fn as () => void)(ctx as never));
  assert.deepEqual(calls, ['B']);
});

// --- acceptance 6: data-driven new crop row --------------------------------------------

test('acceptance 6: new crop row usable with no change to world/drone', () => {
  const { world, mote } = fresh();
  const row = {
    id: 'test_veg',
    name: 'Test veg',
    seedCost: 1,
    waterNeed: 1,
    growthSteps: 1,
    yieldAmount: 1,
    plantableOn: ['soil'],
    unlock: { tech: null },
    colors: { body: '#fff', tip: '#fff' },
  };
  (CROPS as Record<string, unknown>)['test_veg'] = row;
  assert.equal(world.plant(mote, 'test_veg'), 'test_veg');
  delete (CROPS as Record<string, unknown>)['test_veg'];
});

test('acceptance 6b: new terrain row usable with no change to world/drone', () => {
  const { world, mote } = fresh();
  (TERRAIN as Record<string, unknown>)['mud'] = {
    id: 'mud',
    name: 'Mud',
    walkable: true,
    tillable: true,
    isWater: false,
    blocksSight: false,
    sprite: 'flat',
    fill: '#4a3830',
  };
  const cell = world.get(0, 0, 0)!;
  cell.terrain = 'mud';
  assert.equal(world.till(mote), true);
  delete (TERRAIN as Record<string, unknown>)['mud'];
});

// --- acceptance 7: JSON round-trip ------------------------------------------------------

test('acceptance 7: world + mote JSON round-trip restores identical state', () => {
  const { world, mote } = fresh();
  world.tech.add('glasswort_drying');
  world.plant(mote, 'kelp');
  world.water(mote);
  world.tick(mote);
  mote.inventory['kelp'] = 7;
  mote.tickCount = 3;
  mote.lowThresholds = { kelp: 2 };

  const worldJson = JSON.parse(JSON.stringify(world.toJSON()));
  const moteJson = JSON.parse(JSON.stringify(mote.toJSON()));
  const w2 = World.fromJSON(worldJson);
  const m2 = Mote.fromJSON(moteJson);

  assert.deepEqual(w2.toJSON(), worldJson);
  assert.deepEqual(m2.toJSON(), moteJson);
  assert.equal(w2.credits, world.credits);
  assert.deepEqual([...w2.tech], [...world.tech]);
});

// --- growth tick order ------------------------------------------------------------------

test('growthTick: decay happens before growth within one tick', () => {
  const c = { plant: 'kelp' as const, growth: 0, moisture: 2 };
  growthTick([c]);
  assert.equal(c.moisture, 1);
  assert.equal(c.growth, 1);
});

test('growthTick: no water means no growth', () => {
  const c = { plant: 'kelp' as const, growth: 0, moisture: 0 };
  growthTick([c]);
  assert.equal(c.growth, 0);
  assert.equal(c.moisture, 0);
});

test('world.tick: moisture above waterNeed decays one per tick', () => {
  const { world, mote } = fresh();
  const cell = world.get(0, 0, 0)!;
  cell.plant = 'kelp';
  cell.growth = 0;
  cell.moisture = 1;
  world.tick(mote);
  assert.equal(cell.moisture, 1);
  assert.equal(cell.growth, 1);
  world.tick(mote);
  world.tick(mote);
  assert.equal(cell.growth, 3);
});

// --- events ----------------------------------------------------------------------------

test('world.tick: enqueues tick event with ticks counter', () => {
  const { world, mote } = fresh();
  world.tick(mote);
  assert.equal(mote.pending.length, 1);
  assert.equal(mote.pending[0].kind, 'tick');
  assert.equal((mote.pending[0].ctx as { ticks: number }).ticks, 1);
});

test('plant success enqueues plant event', () => {
  const { world, mote } = fresh();
  world.plant(mote, 'kelp');
  const ev = mote.pending.find((p) => p.kind === 'plant');
  assert.ok(ev);
  assert.equal(ev.ctx['crop'], 'kelp');
});

test('harvest success enqueues harvest event with amount', () => {
  const { world, mote } = fresh();
  world.plant(mote, 'kelp');
  for (let i = 0; i < 3; i++) {
    world.water(mote);
    world.tick(mote);
    world.harvest(mote);
  }
  const ev = mote.pending.filter((p) => p.kind === 'harvest').pop();
  assert.ok(ev);
  assert.equal(ev.ctx['amount'], 2);
  assert.equal(ev.ctx['crop'], 'kelp');
});

test('dispatch: events enqueued during a rule defer to next dispatch', () => {
  const mote = new Mote();
  const seen: string[] = [];
  mote.setRule('harvest', () => {
    seen.push('harvest1');
    mote.enqueue('harvest', { amount: 1 });
  });
  mote.enqueue('harvest', { amount: 1 });
  mote.dispatch((fn, ctx) => (fn as () => void)(ctx as never));
  assert.deepEqual(seen, ['harvest1']);
  assert.equal(mote.pending.length, 1);
  mote.dispatch((fn, ctx) => (fn as () => void)(ctx as never));
  assert.deepEqual(seen, ['harvest1', 'harvest1']);
});

test('dispatch: rule context is frozen', () => {
  const mote = new Mote();
  let frozen = false;
  mote.setRule('tick', (ctx) => {
    frozen = Object.isFrozen(ctx);
  });
  mote.enqueue('tick', { ticks: 1 });
  mote.dispatch((fn, ctx) => (fn as (c: unknown) => void)(ctx));
  assert.equal(frozen, true);
});

test('set_rule inside a rule throws', () => {
  const mote = new Mote();
  mote.setRule('tick', () => {
    mote.setRule('plant', () => {});
  });
  mote.enqueue('tick', { ticks: 1 });
  assert.throws(() => mote.dispatch((fn, ctx) => (fn as () => void)(ctx as never)), /not allowed inside a rule/);
});

test('set_rule unknown event throws', () => {
  const mote = new Mote();
  assert.throws(() => mote.setRule('bogus', () => {}), /unknown event/);
});

test('clear_rule removes binding, no error when absent', () => {
  const mote = new Mote();
  mote.setRule('plant', () => {});
  mote.clearRule('plant');
  assert.equal(mote.rules.size, 0);
  mote.clearRule('plant');
});

// --- move / sense / facing --------------------------------------------------------------

test('move: into walkable soil advances position', () => {
  const { world, mote } = fresh();
  mote.facing = 'south';
  assert.equal(mote.move(world, 'forward'), true);
  assert.equal(mote.y, 1);
  assert.equal(mote.x, 0);
  assert.equal(mote.facing, 'south');
  assert.equal(mote.position().y, 1);
});

test('move: all 16 facing x dir combinations', () => {
  const dirs = ['forward', 'back', 'left', 'right'];
  const facings = ['north', 'south', 'east', 'west'];
  const expected: Record<string, readonly [number, number]> = {
    'north:forward': [0, -1],
    'north:back': [0, 1],
    'north:left': [-1, 0],
    'north:right': [1, 0],
    'south:forward': [0, 1],
    'south:back': [0, -1],
    'south:left': [1, 0],
    'south:right': [-1, 0],
    'east:forward': [1, 0],
    'east:back': [-1, 0],
    'east:left': [0, -1],
    'east:right': [0, 1],
    'west:forward': [-1, 0],
    'west:back': [1, 0],
    'west:left': [0, 1],
    'west:right': [0, -1],
  };
  for (const f of facings) {
    for (const d of dirs) {
      const got = resolveDir(f as never, d);
      assert.deepEqual(got, expected[`${f}:${d}`], `${f}:${d}`);
    }
  }
});

test('move: invalid direction throws', () => {
  const mote = new Mote();
  const world = new World({ width: 3, height: 3 });
  assert.throws(() => mote.move(world, 'sideways'), /invalid direction/);
});

test('move: off-world edge returns false and enqueues blocked', () => {
  const { world, mote } = fresh(3);
  mote.x = 0;
  mote.y = 0;
  mote.facing = 'west';
  assert.equal(mote.move(world, 'forward'), false);
  assert.equal(mote.pending.some((p) => p.kind === 'blocked'), true);
  assert.equal(mote.x, 0);
});

test('move: into non-walkable water returns false + blocked', () => {
  const { world, mote } = fresh();
  const target = world.get(0, 1, 0)!;
  target.terrain = 'water_deep';
  mote.facing = 'south';
  assert.equal(mote.move(world, 'forward'), false);
  assert.equal(mote.x, 0);
  assert.equal(mote.y, 0);
  assert.ok(mote.pending.find((p) => p.kind === 'blocked'));
});

test('sense: returns neighbor terrain id, UNKNOWN past edge', () => {
  const { world, mote } = fresh();
  mote.facing = 'south';
  assert.equal(mote.sense(world, 'forward'), 'soil');
  mote.facing = 'west';
  assert.equal(mote.sense(world, 'forward'), 'UNKNOWN');
});

test('sense: reads rock neighbor', () => {
  const { world, mote } = fresh();
  world.get(0, 1, 0)!.terrain = 'rock';
  mote.facing = 'south';
  assert.equal(mote.sense(world, 'forward'), 'rock');
});

// --- ascend / descend --------------------------------------------------------------------

test('ascend/descend: false in Chapter 1 (allowVertical false)', () => {
  const { world, mote } = fresh();
  assert.equal(mote.ascend(world), false);
  assert.equal(mote.descend(world), false);
  world.allowVertical = true;
  world.set({ x: 0, y: 0, h: 1, terrain: 'soil', plant: null, growth: 0, moisture: 0 });
  assert.equal(mote.ascend(world), true);
  assert.equal(mote.h, 1);
  assert.equal(mote.descend(world), true);
  assert.equal(mote.h, 0);
});

// --- inventory ---------------------------------------------------------------------------

test('inventory: copy is detached from mote', () => {
  const mote = new Mote();
  mote.inventory['kelp'] = 3;
  const copy = mote.inventoryCopy();
  copy['kelp'] = 99;
  assert.equal(mote.inventory['kelp'], 3);
});

test('checkLowInventory: fires when count below threshold', () => {
  const mote = new Mote();
  mote.lowThresholds = { kelp: 4 };
  mote.inventory['kelp'] = 2;
  mote.checkLowInventory();
  const ev = mote.pending.find((p) => p.kind === 'low_inventory');
  assert.ok(ev);
  assert.equal(ev.ctx['item'], 'kelp');
  assert.equal(ev.ctx['count'], 2);
});

test('checkLowInventory: no event when at or above threshold', () => {
  const mote = new Mote();
  mote.lowThresholds = { kelp: 4 };
  mote.inventory['kelp'] = 4;
  mote.checkLowInventory();
  assert.equal(mote.pending.length, 0);
});

// --- misc plant/harvest guards -----------------------------------------------------------

test('plant: unknown crop id returns ""', () => {
  const { world, mote } = fresh();
  assert.equal(world.plant(mote, 'dragonfruit'), '');
});

test('plant: occupied cell returns ""', () => {
  const { world, mote } = fresh();
  world.plant(mote, 'kelp');
  assert.equal(world.plant(mote, 'kelp'), '');
  assert.equal(world.credits, 16);
});

test('plant: insufficient credits returns ""', () => {
  const { world, mote } = fresh();
  world.credits = 2;
  assert.equal(world.plant(mote, 'kelp'), '');
  assert.equal(world.credits, 2);
});

test('harvest: immature returns 0', () => {
  const { world, mote } = fresh();
  world.plant(mote, 'kelp');
  assert.equal(world.harvest(mote), 0);
});

test('harvest: empty cell returns 0', () => {
  const { world, mote } = fresh();
  assert.equal(world.harvest(mote), 0);
});

test('water: no plant returns false', () => {
  const { world, mote } = fresh();
  assert.equal(world.water(mote), false);
});

test('till: on non-tillable rock returns false', () => {
  const { world, mote } = fresh();
  world.get(0, 0, 0)!.terrain = 'rock';
  assert.equal(world.till(mote), false);
});

test('till: claimWater rule slot allows water claim', () => {
  const { world, mote } = fresh();
  world.get(0, 0, 0)!.terrain = 'water_deep';
  assert.equal(world.till(mote), false);
  world.rules.claimWater = () => true;
  assert.equal(world.till(mote), true);
  assert.equal(world.get(0, 0, 0)!.terrain, 'soil');
});

// --- wired builtins through Interp --------------------------------------------------------

test('wired: Loam program till+plant+cycle through Interp', () => {
  const world = new World({ width: 10, height: 10 });
  const mote = new Mote();
  const src = [
    "till()",
    "plant('kelp')",
    "for i in range(0, 3):",
    '    water()',
    '    wait()',
    '    r = harvest()',
    '    report(r)',
    '',
  ].join('\n');
  const interp = new Interp(parse(src), { world, mote });
  interp.run();
  assert.deepEqual(interp.reports, ['0', '0', '2']);
  assert.equal(mote.inventory['kelp'], 2);
});

test('wired: sense + move through Interp', () => {
  const world = new World({ width: 10, height: 10 });
  const mote = new Mote({ facing: 'east' });
  const src = ["t = sense('forward')", 'report(t)', "m = move('forward')", 'report(m)'].join('\n') + '\n';
  const interp = new Interp(parse(src), { world, mote });
  interp.run();
  assert.deepEqual(interp.reports, ['soil', 'True']);
  assert.equal(mote.x, 1);
});

test('wired: position() and inventory() through Interp', () => {
  const world = new World({ width: 5, height: 5 });
  const mote = new Mote();
  mote.inventory['kelp'] = 9;
  const src = ["p = position()", 'report(p)', "inv = inventory()", 'report(inv)'].join('\n') + '\n';
  const interp = new Interp(parse(src), { world, mote });
  interp.run();
  assert.equal(interp.reports[0], '{"x":0,"y":0,"h":0,"facing":"north"}');
  assert.equal(interp.reports[1], '{"kelp":9}');
  // mutating the returned copy does nothing
  const copy = mote.inventoryCopy();
  copy['kelp'] = 1;
  assert.equal(mote.inventory['kelp'], 9);
});

test('wired: set_rule + clear_rule through Interp', () => {
  const world = new World({ width: 5, height: 5 });
  const mote = new Mote();
  const src = [
    'def on_harvest(ctx):',
    '    report("got harvest")',
    "set_rule('harvest', on_harvest)",
    "clear_rule('harvest')",
    '',
  ].join('\n');
  const interp = new Interp(parse(src), { world, mote });
  interp.run();
  assert.equal(mote.rules.size, 0);
});

test('wired: Loam rule invoked via dispatch through callRule', () => {
  const world = new World({ width: 5, height: 5 });
  const mote = new Mote();
  const src = [
    'def on_tick(ctx):',
    '    report("tick rule fired")',
    "set_rule('tick', on_tick)",
    'wait()',
    '',
  ].join('\n');
  const interp = new Interp(parse(src), { world, mote });
  interp.run();
  mote.dispatch((fn, ctx) => interp.callRule(fn as never, ctx as never));
  assert.deepEqual(interp.reports, ['tick rule fired']);
});

test('wired: wait() drives world tick (growth advances)', () => {
  const world = new World({ width: 5, height: 5 });
  const mote = new Mote();
  const src = [
    "till()",
    "plant('kelp')",
    'water()',
    'wait()',
    'wait()',
    'wait()',
    'n = harvest()',
    'report(n)',
    '',
  ].join('\n');
  const interp = new Interp(parse(src), { world, mote });
  interp.run();
  assert.deepEqual(interp.reports, ['2']);
});

test('wired: report still works with world present', () => {
  const world = new World({ width: 3, height: 3 });
  const mote = new Mote();
  const interp = new Interp(parse("report('hello world')\n"), { world, mote });
  interp.run();
  assert.deepEqual(interp.reports, ['hello world']);
});

test('wired: phase 1 throw path preserved when world is null', () => {
  const interp = new Interp(parse("move('forward')\n"));
  assert.throws(() => interp.run(), /not available outside a world/);
});
