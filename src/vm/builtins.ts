import { RuntimeError } from './interp';

export interface BuiltinDef {
  name: string;
  arity: [number, number];
  signature: string;
  doc: string;
  chapter: 1 | 2;
}

export const BUILTINS: BuiltinDef[] = [
  { name: 'move', arity: [1, 1], signature: 'move(dir)', doc: 'Step one tile in a relative direction. Returns bool.', chapter: 1 },
  { name: 'descend', arity: [0, 0], signature: 'descend()', doc: 'Move down one elevation level at the current (x, y). Chapter 2 only.', chapter: 2 },
  { name: 'ascend', arity: [0, 0], signature: 'ascend()', doc: 'Move up one elevation level at the current (x, y). Chapter 2 only.', chapter: 2 },
  { name: 'sense', arity: [1, 1], signature: 'sense(dir)', doc: 'Terrain id of the neighbouring tile, or UNKNOWN past the fog radius.', chapter: 1 },
  { name: 'till', arity: [0, 0], signature: 'till()', doc: 'Convert the current cell to plantable ground.', chapter: 1 },
  { name: 'plant', arity: [1, 1], signature: 'plant(crop)', doc: 'Plant a crop id at the current cell. Returns the crop id, or empty string on failure.', chapter: 1 },
  { name: 'harvest', arity: [0, 0], signature: 'harvest()', doc: 'Harvest a mature plant at the current cell. Returns the units gained.', chapter: 1 },
  { name: 'water', arity: [0, 0], signature: 'water()', doc: 'Irrigate the current cell, adding one growth step of moisture.', chapter: 1 },
  { name: 'wait', arity: [0, 0], signature: 'wait()', doc: 'Consume one tick without acting.', chapter: 1 },
  { name: 'position', arity: [0, 0], signature: 'position()', doc: 'Dict snapshot of the Mote: {x, y, h, facing}.', chapter: 1 },
  { name: 'inventory', arity: [0, 0], signature: 'inventory()', doc: "Copy of the Mote's item counts.", chapter: 1 },
  { name: 'set_rule', arity: [2, 2], signature: 'set_rule(event, fn)', doc: 'Bind a function to a Mote event, replacing any previous binding.', chapter: 1 },
  { name: 'clear_rule', arity: [1, 1], signature: 'clear_rule(event)', doc: 'Remove the binding for an event.', chapter: 1 },
  { name: 'report', arity: [0, Infinity], signature: 'report(text)', doc: 'Print to the in-game console panel.', chapter: 1 },
];

export interface BuiltinContext {
  reports: string[];
  mote: unknown;
  world: unknown;
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function makeNotAvailable(name: string): (...args: unknown[]) => never {
  return function (..._args: unknown[]): never {
    throw new Error(`${name} is not available outside a world`);
  };
}

function wrapArity(def: BuiltinDef, fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
  const [min, max] = def.arity;
  return function (...args: unknown[]): unknown {
    const given = args.length;
    if (given < min || given > max) {
      let expected: string;
      if (min === max) expected = String(min);
      else if (max === Infinity) expected = `at least ${min}`;
      else expected = `${min} to ${max}`;
      const argWord = expected === '1' ? 'argument' : 'arguments';
      const wasWere = given === 1 ? 'was' : 'were';
      throw new RuntimeError(`${def.name}() takes ${expected} ${argWord} but ${given} ${wasWere} given`, 0);
    }
    return fn(...args);
  };
}

export function makeBuiltins(ctx: BuiltinContext): Record<string, (...args: unknown[]) => unknown> {
  const out: Record<string, (...args: unknown[]) => unknown> = {};

  for (const def of BUILTINS) {
    if (def.name === 'report') {
      const reportFn = function (...args: unknown[]): void {
        const line = args.map(stringify).join(' ');
        ctx.reports.push(line);
        if (ctx.reports.length > 200) ctx.reports.shift();
      };
      out[def.name] = wrapArity(def, reportFn);
    } else {
      out[def.name] = wrapArity(def, makeNotAvailable(def.name));
    }
  }
  return out;
}
