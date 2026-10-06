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

const { WorkerRuntime, PROTOCOL_VERSION } = await import('../src/workerProtocol.ts');
const { WorkerClient } = await import('../src/workerClient.ts');
const { World } = await import('../src/game/world.ts');
const { Mote } = await import('../src/game/drone.ts');

function makeClock() {
  let now = 0;
  let seq = 1;
  const timers = new Map();
  const delays = [];
  return {
    scheduler: {
      setTimeout(h, ms) {
        const id = seq++;
        timers.set(id, { at: now + ms, h });
        delays.push(ms);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    pending: () => timers.size,
    delays,
    advance(ms) {
      now += ms;
      for (;;) {
        let bestId = null;
        let best = null;
        for (const [id, t] of timers) {
          if (t.at <= now && (best === null || t.at < best.at)) {
            bestId = id;
            best = t;
          }
        }
        if (!best) break;
        timers.delete(bestId);
        best.h();
      }
    },
  };
}

function createRuntime(hardCap) {
  const clock = makeClock();
  const msgs = [];
  const opts = { scheduler: clock.scheduler };
  if (hardCap !== undefined) opts.hardCap = hardCap;
  const rt = new WorkerRuntime((m) => msgs.push(m), opts);
  return { rt, msgs, clock };
}

function freshWorld(size = 10) {
  return { world: new World({ width: size, height: size }), mote: new Mote() };
}

function initAndRun(rt, source) {
  const { world, mote } = freshWorld();
  rt.handle({ type: 'init', world: world.toJSON(), mote: mote.toJSON() });
  rt.handle({ type: 'run', source, programId: 'p1' });
}

test('acceptance 1: while True aborts with op_cap', () => {
  const { rt, msgs } = createRuntime(10000);
  initAndRun(rt, 'while True:\n    pass\n');
  rt.handle({ type: 'step', slices: 1000 });
  const abort = msgs.find((m) => m.type === 'aborted');
  assert.ok(abort, 'expected aborted message');
  assert.equal(abort.reason, 'op_cap');
  assert.ok(abort.ops > 10000, 'ops exceeds cap');
});

test('acceptance 2: pause clears the scheduled timer', () => {
  const { rt, msgs, clock } = createRuntime();
  initAndRun(rt, 'i = 0\nwhile i < 1000000:\n    i += 1\n');
  assert.equal(clock.pending(), 1, 'run schedules exactly one timer');
  clock.advance(16);
  assert.equal(clock.pending(), 1, 'rescheduled after the slice');
  const before = msgs.length;
  rt.handle({ type: 'pause' });
  assert.equal(clock.pending(), 0, 'pause clears the timer');
  assert.equal(msgs[msgs.length - 1].type, 'paused');
  clock.advance(100000);
  assert.equal(msgs.length, before + 1, 'no activity after pause');
});

test('acceptance 3: step returns line and locals', () => {
  const { rt, msgs } = createRuntime();
  initAndRun(rt, 'x = 1\ny = 2\nz = x + y\n');
  rt.handle({ type: 'step', slices: 1 });
  const stepped = msgs.find((m) => m.type === 'stepped');
  assert.ok(stepped, 'expected stepped');
  assert.ok(typeof stepped.line === 'number');
  assert.ok(stepped.line >= 1, 'line points at an executed statement');
  assert.equal(stepped.locals['z'], 3, 'locals snapshot reflects executed statements');
});

test('acceptance 4: setSpeed changes tick rate over 100 ticks', () => {
  const speeds = [0.25, 0.5, 1, 2, 4, 8];
  const perSpeed = new Map();
  for (const s of speeds) {
    const { rt, clock } = createRuntime();
    const { world, mote } = freshWorld();
    rt.handle({ type: 'init', world: world.toJSON(), mote: mote.toJSON() });
    rt.handle({ type: 'setSpeed', multiplier: s });
    rt.handle({ type: 'run', source: 'pass\n', programId: 'p1' });
    clock.delays.length = 0;
    for (let k = 0; k < 200 && clock.delays.length < 100; k++) clock.advance(1000);
    const observed = clock.delays.slice(0, 100);
    const expected = rt.intervalFor(s);
    assert.ok(observed.length > 0, `speed ${s}: ticks observed`);
    assert.ok(observed.every((d) => d === expected), `speed ${s}: delays equal intervalFor(${s})`);
    perSpeed.set(s, 100 * expected);
  }
  assert.equal(new Set(speeds.map((s) => createRuntime().rt.intervalFor(s))).size, 6, 'six distinct intervals');
  assert.ok(perSpeed.get(0.25) > perSpeed.get(8), '0.25x takes longer than 8x for 100 ticks');
  assert.ok(perSpeed.get(8) < perSpeed.get(1), '8x faster than 1x');
});

test('acceptance 5: wait() only produces zero CellDelta', () => {
  const { rt, msgs } = createRuntime();
  initAndRun(rt, 'wait()\nwait()\nwait()\n');
  rt.handle({ type: 'step', slices: 10 });
  const nonEmpty = msgs.filter((m) => m.type === 'tick' && m.cells && m.cells.length > 0);
  assert.equal(nonEmpty.length, 0, 'wait() alone must not produce cell deltas');
});

test('acceptance 6: syntax error reports line, col, phase parse and does not start', () => {
  const { rt, msgs } = createRuntime();
  const { world, mote } = freshWorld();
  rt.handle({ type: 'init', world: world.toJSON(), mote: mote.toJSON() });
  rt.handle({ type: 'run', source: 'def broken(:\n    pass\n', programId: 'p1' });
  const err = msgs.find((m) => m.type === 'error');
  assert.ok(err, 'expected error');
  assert.ok(err.line > 0, 'line > 0');
  assert.ok(err.col > 0, 'col > 0');
  assert.equal(err.phase, 'parse');
  assert.equal(msgs.find((m) => m.type === 'started'), undefined, 'no run started');
});

function makeFakeWorker() {
  const messages = [];
  return {
    messages,
    onmessage: null,
    terminated: false,
    postMessage(m) {
      messages.push(m);
    },
    terminate() {
      this.terminated = true;
    },
  };
}

test('acceptance 7: WorkerClient keeps source across a worker restart', () => {
  const workers = [];
  const client = new WorkerClient({}, () => {
    const w = makeFakeWorker();
    workers.push(w);
    return w;
  });
  const source = 'def f(a):\n    return a + 1\n';
  client.run(source, 'prog-1');
  assert.equal(client.getSource(), source, 'source stored on the main thread');
  client.restart();
  assert.equal(workers.length, 2, 'restart spawned a new worker');
  assert.equal(workers[0].terminated, true, 'old worker terminated');
  assert.equal(client.getSource(), source, 'source survives restart');
});

test('ready message includes the protocol version', () => {
  const { rt, msgs } = createRuntime();
  const { world, mote } = freshWorld();
  rt.handle({ type: 'init', world: world.toJSON(), mote: mote.toJSON() });
  const ready = msgs.find((m) => m.type === 'ready');
  assert.ok(ready, 'expected ready');
  assert.equal(ready.version, PROTOCOL_VERSION);
});

test('snapshot returns world and mote JSON', () => {
  const { rt, msgs } = createRuntime();
  const { world, mote } = freshWorld();
  rt.handle({ type: 'init', world: world.toJSON(), mote: mote.toJSON() });
  rt.handle({ type: 'snapshot', requestId: 'r1' });
  const snap = msgs.find((m) => m.type === 'snapshot');
  assert.ok(snap, 'expected snapshot');
  assert.equal(snap.requestId, 'r1');
  assert.equal(typeof snap.world, 'object');
  assert.equal(typeof snap.mote, 'object');
  assert.equal(typeof snap.locals, 'object');
});

test('full run: plant, water and tick produce cell deltas', () => {
  const { rt, msgs } = createRuntime();
  initAndRun(rt, "till()\nplant('kelp')\nwater()\nwait()\nwater()\nwait()\nwater()\nwait()\nharvest()\n");
  rt.handle({ type: 'step', slices: 50 });
  const ticks = msgs.filter((m) => m.type === 'tick' && m.cells && m.cells.length > 0);
  assert.ok(ticks.length > 0, 'expected cell deltas');
  const cells = ticks.flatMap((t) => t.cells);
  assert.ok(cells.some((c) => c.growth !== undefined || c.moisture !== undefined || c.plant !== undefined));
});

test('event: harvest posts an event message', () => {
  const { rt, msgs } = createRuntime();
  initAndRun(rt, "till()\nplant('kelp')\nwater()\nwait()\nwater()\nwait()\nwater()\nwait()\nh = harvest()\nreport(h)\n");
  rt.handle({ type: 'step', slices: 100 });
  const harvest = msgs.filter((m) => m.type === 'event').find((e) => e.kind === 'harvest');
  assert.ok(harvest, 'expected harvest event');
  assert.equal(harvest.data['amount'], 2, 'kelp yield is 2');
  assert.ok(msgs.some((m) => m.type === 'console' && m.lines.includes('2')), 'report reached the console');
});

test('tick carries the mote position', () => {
  const { rt, msgs } = createRuntime();
  // till() changes a cell, so a tick is guaranteed; the tick must also carry the mote.
  initAndRun(rt, 'till()\n');
  rt.handle({ type: 'step', slices: 5 });
  const ticks = msgs.filter((m) => m.type === 'tick');
  assert.ok(ticks.length > 0, 'at least one tick posted');
  const last = ticks[ticks.length - 1];
  assert.equal(typeof last.mote.x, 'number');
  assert.equal(typeof last.mote.y, 'number');
  assert.equal(typeof last.mote.h, 'number');
  assert.equal(typeof last.mote.facing, 'string');
});

test('tick reports the mote after move()', () => {
  const { rt, msgs } = createRuntime();
  const { world, mote } = freshWorld();
  rt.handle({ type: 'init', world: world.toJSON(), mote: mote.toJSON() });
  rt.handle({ type: 'run', source: "move('back')\n", programId: 'p1' });
  rt.handle({ type: 'step', slices: 10 });
  const ticks = msgs.filter((m) => m.type === 'tick');
  assert.ok(ticks.some((t) => t.mote.y === 1), 'mote moved south from (0,0)');
});

test('rule: worker dispatch handles rules without throwing', () => {
  const { rt, msgs } = createRuntime();
  const src = [
    'def onHarvest(ctx):',
    "    report('rule saw harvest')",
    "set_rule('harvest', onHarvest)",
    "till()",
    "plant('kelp')",
    'water()',
    'wait()',
    'water()',
    'wait()',
    'water()',
    'wait()',
    'harvest()',
    '',
  ].join('\n');
  initAndRun(rt, src);
  rt.handle({ type: 'step', slices: 200 });
  assert.equal(msgs.filter((m) => m.type === 'error').length, 0, 'no errors during rule dispatch');
});

test('step advances exactly one slice and posts one stepped message', () => {
  const { rt, msgs } = createRuntime();
  initAndRun(rt, 'x = 0\nfor i in range(0, 1000000):\n    x += 1\n');
  rt.handle({ type: 'step', slices: 1 });
  assert.equal(msgs.filter((m) => m.type === 'stepped').length, 1);
  rt.handle({ type: 'step', slices: 1 });
  assert.equal(msgs.filter((m) => m.type === 'stepped').length, 2);
});