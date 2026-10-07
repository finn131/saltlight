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

const { TASKS, runTask, evaluateTask, analyze } = await import('../src/game/tasks.ts');
const { parse } = await import('../src/vm/parser.ts');

for (const task of TASKS) {
  test(`task ${task.id} (${task.name}): reference pass program passes`, () => {
    const { passed, trace } = evaluateTask(task, task.referencePass);
    assert.equal(trace.parseError, null, 'no parse error');
    assert.equal(passed, true, `expected pass; ops=${trace.opsUsed} moves=${trace.moves} rules=${JSON.stringify(trace.ruleFires)}`);
  });

  test(`task ${task.id} (${task.name}): reference fail program fails`, () => {
    const { passed } = evaluateTask(task, task.referenceFail);
    assert.equal(passed, false, 'expected fail');
  });
}

test('runTask: parse error is reported and never advances', () => {
  const t = runTask('def broken(:\n    pass\n');
  assert.ok(t.parseError, 'parseError set');
  assert.equal(t.opsUsed, 0);
});

test('runTask: infinite loop aborts instead of hanging', () => {
  const t = runTask('while True:\n    pass\n', { hardCap: 5000 });
  assert.equal(t.aborted, true);
});

test('runTask: moves counts successful moves only', () => {
  const t = runTask("move('back')\nmove('forward')\nmove('forward')\n");
  assert.equal(t.moves, 2, 'back then two forwards: two succeed');
});

test('analyze: detects top-level loop vs loop inside a def', () => {
  const top = analyze(parse('while True:\n    pass\n'));
  assert.equal(top.topLevelLoop, true);
  const inner = analyze(parse('def f():\n    while True:\n        pass\n'));
  assert.equal(inner.topLevelLoop, false);
  assert.equal(inner.hasDef, true);
});

test('analyze: composition flag needs a peer call inside a loop in a def', () => {
  const composed = analyze(parse('def a():\n    return 1\ndef b():\n    for i in range(0, 2):\n        a()\n'));
  assert.equal(composed.defCallsFunctionInsideLoop, true);
  const notComposed = analyze(parse('def b():\n    for i in range(0, 2):\n        report(i)\n'));
  assert.equal(notComposed.defCallsFunctionInsideLoop, false);
});

test('task 9: fires a harvest rule with no top-level loop', () => {
  const task = TASKS.find((t) => t.id === 9);
  const { trace, passed } = evaluateTask(task, task.referencePass);
  assert.equal(trace.features.topLevelLoop, false, 'no top-level loop');
  assert.ok((trace.ruleFires['harvest'] ?? 0) >= 3, `harvest rule fired ${trace.ruleFires['harvest']} times`);
  assert.equal(passed, true);
});

for (const task of TASKS) {
  test(`starter for task ${task.id} (${task.name}) passes its own check`, () => {
    const { passed, trace } = evaluateTask(task, task.starter);
    assert.equal(trace.parseError, null, 'starter parses');
    assert.equal(passed, true, `starter fails its own check; ops=${trace.opsUsed} moves=${trace.moves} rules=${JSON.stringify(trace.ruleFires)}`);
  });
}

for (const task of TASKS) {
  if (task.id === 1) continue;
  test(`trivial program does not pass task ${task.id} (${task.name})`, () => {
    for (const trivial of ['pass\n', 'x = 1\n', "report('hello')\n"]) {
      const { passed } = evaluateTask(task, trivial);
      assert.equal(passed, false, `'${trivial.trim()}' must not pass task ${task.id}`);
    }
  });
}