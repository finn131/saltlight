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

const { loamCompletions } = await import('../src/ui/completion.ts');
const { BUILTINS } = await import('../src/vm/builtins.ts');

test('acceptance 1: typing "sen" offers sense(dir) sourced from BUILTINS', () => {
  const results = loamCompletions('sen');
  assert.ok(results.length >= 1, 'at least one match');
  const sense = results.find((r) => r.label.startsWith('sense('));
  assert.ok(sense, 'sense(dir) is offered');
  assert.equal(sense.info, BUILTINS.find((b) => b.name === 'sense').doc, 'doc comes from the runtime table');
});

test('completion: "sen" does not offer unrelated builtins', () => {
  const labels = loamCompletions('sen').map((r) => r.label);
  assert.ok(labels.some((l) => l.startsWith('sense(')));
  assert.ok(!labels.some((l) => l.startsWith('move(')), 'move is not a "sen" prefix match');
});

test('completion: empty prefix offers every builtin, no duplicates', () => {
  const all = loamCompletions('', 100);
  assert.equal(all.length, BUILTINS.length, 'one completion per builtin');
  const names = all.map((r) => r.apply);
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
});

test('completion: every builtin name is reachable by its own prefix', () => {
  for (const b of BUILTINS) {
    const found = loamCompletions(b.name.slice(0, 3)).some((r) => r.apply === b.name);
    assert.ok(found, `${b.name} reachable by prefix`);
  }
});

test('completion: chapter-2 builtins are tagged', () => {
  const descend = loamCompletions('descend').find((r) => r.apply === 'descend');
  assert.ok(descend);
  assert.equal(descend.detail, 'chapter 2');
  const move = loamCompletions('move').find((r) => r.apply === 'move');
  assert.equal(move.detail, 'builtin');
});