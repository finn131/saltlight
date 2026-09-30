# SaltLight — Architecture

Companion docs: [PRD.md](./PRD.md) (product scope), [DESIGN.md](./DESIGN.md) (language and content), [ROADMAP.md](./ROADMAP.md) (build order).

## 1. Design principles

1. **Data, not branches.** Every per-terrain and per-crop rule is a table row. Chapter 2 adds rows, not `if (chapter === 2)` branches.
2. **Never trust the main thread with a loop.** All Loam execution happens in a Web Worker. The main thread only draws and forwards input.
3. **Pixels are not logic.** Drone behaviour is debuggable in a terminal before a single pixel exists. See the ASCII debug view in [ROADMAP.md](./ROADMAP.md) between Phase 3 and Phase 4.
4. **Bake, then blit.** Sprites are rasterised once into offscreen canvases at boot. The render loop performs `drawImage` and nothing else.
5. **One cell model.** `h` is a signed integer. Chapter 2 flips the sign and extends the range. No new cell type, no new renderer.

## 2. Module and file map

```
SaltLight/
├── index.html                    Phase 0   canvas host, editor mount, settings root
├── package.json                  Phase 0   Vite + TypeScript, no framework deps
├── README.md
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md           this file
│   ├── ROADMAP.md
│   └── DESIGN.md
├── test/
│   └── interp.test.ts            Phase 1   assert-based, run by `node --test`
└── src/
    ├── main.ts                   Phase 0   boot: tables -> sprites -> worker -> loop
    ├── style.css                 Phase 0   layout, palette variables, panel chrome
    ├── vm/
    │   ├── tokenizer.ts          Phase 1   source text -> Token[]
    │   ├── parser.ts             Phase 1   Token[] -> Stmt[]/Expr[] AST
    │   ├── interp.ts             Phase 1   generator-based AST evaluator
    │   └── builtins.ts           Phase 1   Mote builtins, table-driven signatures
    ├── game/
    │   ├── world.ts              Phase 2   cell store, height buckets, mutation API
    │   ├── terrain.ts            Phase 2   TERRAIN table + type
    │   ├── crops.ts              Phase 2   CROPS table + growth tick
    │   ├── drone.ts              Phase 2   Mote state, event dispatch, rule slots
    │   └── rules/                          Phase 7 (stretch)
    │       ├── fog.ts            Phase 7   UNKNOWN beyond radius
    │       └── current.ts        Phase 7   per-tick drift
    ├── worker.ts                 Phase 3   worker entry: VM + protocol handler
    ├── render/
    │   ├── sprites.ts            Phase 4   procedural sprite bake to OffscreenCanvas
    │   ├── iso.ts                Phase 4   tile -> screen projection, draw order
    │   └── camera.ts             Phase 4   pan, zoom, visible-bounds culling
    └── ui/
        ├── editor.ts             Phase 5   CodeMirror 6, Loam mode, builtin completion
        ├── store.ts              Phase 5   IndexedDB: programs, world, settings
        └── filetools.ts          Phase 5   .py import/export
```

`src/vm/**` and `src/render/**` must not import from `src/game/rules/**`. Rules read world state and return modifiers; they never branch on chapter.

## 3. Data table contract

### `src/game/terrain.ts`

```ts
export type TerrainId =
  | 'soil' | 'grass' | 'rock' | 'sand'
  | 'water_shallow' | 'water_deep'
  | 'ledge' | 'vent';

export interface TerrainDef {
  id: TerrainId;
  name: string;
  /** Mote may occupy this cell. */
  walkable: boolean;
  /** till() may convert this cell to plantable ground. */
  tillable: boolean;
  /** Counts as water for growth, irrigation, and chapter gating. */
  isWater: boolean;
  /** Blocks line of sight for sense() and fog seeding. */
  blocksSight: boolean;
  /** Visual footprint, resolved by the sprite baker. */
  sprite: 'flat' | 'slope' | 'rock' | 'void' | 'plant';
  /** Fill colour, used when the cell is exposed by till() or harvest. */
  fill: string;
  /** Optional tint applied on top of the baked sprite in Chapter 2. */
  glow?: string;
}

export const TERRAIN: Record<TerrainId, TerrainDef> = {
  soil: {
    id: 'soil', name: 'Soil',
    walkable: true, tillable: true, isWater: false, blocksSight: false,
    sprite: 'flat', fill: '#5b4636',
  },
  water_deep: {
    id: 'water_deep', name: 'Deep water',
    walkable: false, tillable: false, isWater: true, blocksSight: false,
    sprite: 'void', fill: '#12324a', glow: '#1d5f7a',
  },
  rock: {
    id: 'rock', name: 'Rock',
    walkable: true, tillable: false, isWater: false, blocksSight: true,
    sprite: 'rock', fill: '#6a6f78',
  },
  vent: {
    id: 'vent', name: 'Hydrothermal vent',
    walkable: true, tillable: false, isWater: false, blocksSight: false,
    sprite: 'plant', fill: '#2a1f2c', glow: '#ff7a3d',
  },
  // grass, sand, ledge, water_shallow follow the same shape
};
```

### `src/game/crops.ts`

```ts
export type CropId = 'kelp' | 'glasswort' | 'lantern_pearl' | 'glowcap';

export interface CropDef {
  id: CropId;
  name: string;
  /** Seed cost in credits. */
  seedCost: number;
  /** Water units required per growth step. */
  waterNeed: number;
  /** Growth steps required to reach harvestable. */
  growthSteps: number;
  /** Units added to inventory on harvest. */
  yieldAmount: number;
  /** Where this crop may be planted. */
  plantableOn: TerrainId[];
  /** Unlock predicate, evaluated by the tech tree, not by the VM. */
  unlock: { tech: string | null };
  /** Baked sprite tints; glow is additive and pulses in Chapter 2. */
  colors: { body: string; tip: string; glow?: string };
}

export const CROPS: Record<CropId, CropDef> = {
  kelp: {
    id: 'kelp', name: 'Kelp',
    seedCost: 4, waterNeed: 1, growthSteps: 3, yieldAmount: 2,
    plantableOn: ['soil'],
    unlock: { tech: null },
    colors: { body: '#3f7d4e', tip: '#8fd694' },
  },
  glasswort: {
    id: 'glasswort', name: 'Glasswort',
    seedCost: 12, waterNeed: 2, growthSteps: 5, yieldAmount: 5,
    plantableOn: ['soil', 'water_shallow'],
    unlock: { tech: 'glasswort_drying' },
    colors: { body: '#9ad5c0', tip: '#e8fff6', glow: '#b6f2ff' },
  },
  // lantern_pearl, glowcap follow the same shape
};
```

### Why tables

Chapter 2 requires: new terrain (`water_deep` flooding, `vent` warmth, `ledge` blocking), new crops with bioluminescence, a claim-into-water rule, and a glow render flag. With tables that is 5 rows in `terrain.ts`, 2 rows in `crops.ts`, and a `glow` field read by the baker. With switch statements it is a rewrite of every comparison in the VM-facing world layer, and every one of them is a place a bug can hide.

The only chapter branch in the codebase is permitted inside the two rule modules in `src/game/rules/`.

## 4. VM design

Four stages, all in `src/vm/`.

### Tokenizer — `tokenizer.ts`

Hand-written single-pass scanner. Emits `Token` records with `{ type, value, line, col }` so every runtime error can point at a source location.

Token types: `NUM`, `STR`, `NAME`, `KEYWORD`, `OP`, `NEWLINE`, `INDENT`, `DEDENT`, `EOF`.

- Numbers: `int` and `float`, no scientific notation, no hex.
- Strings: single or double quoted, `\n` `\t` `\\` `\"` escapes only.
- Keywords: `if elif else while for in range def return break continue and or not True False None pass`.
- Operators: `+ - * / // % ** == != < <= > >= = += -= *= /= ( ) [ ] { } , : .`.
- Indentation: spaces only, 4-space level, tab characters rejected with a located error.

### Parser — `parser.ts`

Recursive descent producing a typed AST. No evaluation happens here.

```ts
export type Stmt =
  | { kind: 'assign'; target: Expr; value: Expr; line: number }
  | { kind: 'if'; branches: { test: Expr; body: Stmt[] }[]; orelse: Stmt[] | null; line: number }
  | { kind: 'while'; test: Expr; body: Stmt[]; line: number }
  | { kind: 'for'; name: string; from: Expr; to: Expr; body: Stmt[]; line: number }
  | { kind: 'def'; name: string; params: string[]; body: Stmt[]; line: number }
  | { kind: 'return'; value: Expr | null; line: number }
  | { kind: 'break' | 'continue'; line: number }
  | { kind: 'pass'; line: number }
  | { kind: 'expr'; value: Expr; line: number };

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'none' }
  | { kind: 'name'; id: string; line: number }
  | { kind: 'binop'; op: string; left: Expr; right: Expr; line: number }
  | { kind: 'unop'; op: string; operand: Expr; line: number }
  | { kind: 'call'; callee: Expr; args: Expr[]; line: number }
  | { kind: 'index'; target: Expr; index: Expr; line: number }
  | { kind: 'member'; target: Expr; name: string; line: number }
  | { kind: 'list'; items: Expr[]; line: number }
  | { kind: 'dict'; entries: [Expr, Expr][]; line: number };
```

Unsupported syntax produces `ParseError` with line and column rather than being silently ignored. Rejected constructs are listed in [DESIGN.md](./DESIGN.md).

### Interpreter — `interp.ts`

Generator-based tree walk. Every `exec` is a generator; the driver pulls from the root generator.

```ts
export const OPS_PER_SLICE = 200_000;   // interpreter ops between yields to the driver

export class Interp {
  private ops = 0;
  private root: Generator<void, void, void> | null = null;

  /** Runs up to OPS_PER_SLICE ops. Returns 'slice' | 'done'. */
  step(): 'slice' | 'done' {
    if (!this.root) return 'done';
    const start = this.ops;
    while (this.ops - start < OPS_PER_SLICE) {
      const r = this.root.next();
      if (r.done) { this.root = null; return 'done'; }
    }
    return 'slice';
  }
}
```

Design consequences:

- **Instruction budget.** `ops` increments on every statement and every expression node visit. The worker compares the budget against a hard cap (`HARD_OP_CAP = 50_000_000`) and aborts with `aborted` if a run exceeds it. An infinite loop costs a worker, never the tab.
- **Step debugger.** `step()` runs exactly one slice. A single call is one debugger step, so the inspector can show `pc` (current AST node) and the current locals between slices.
- **Cancellation.** The driver checks a `paused` flag between slices, so `pause` takes effect within `OPS_PER_SLICE` ops.
- **Speed multiplier.** The worker maps `setSpeed` to a tick period: `0` (paused), then `{0.25, 0.5, 1, 2, 4, 8}`. Multiplier scales the interval between slices, not the ops per slice, so slow-motion stays inspectable.

The interpreter is dependency-free and runs identically in Node and in the browser, which is what makes `node --test` viable.

### `builtins.ts`

Builtins are registered from a table so the editor, the completion provider, and the runtime cannot disagree.

```ts
export interface BuiltinDef {
  name: string;
  arity: [number, number];   // min args, max args
  signature: string;         // shown in completion
  doc: string;               // one line, shown in completion
  chapter: 1 | 2;            // 2 means Chapter 2 only
}

export const BUILTINS: BuiltinDef[] = [ /* the 14 Mote builtins */ ];
```

## 5. Mote builtin semantics

Runtime implementation lives in `src/vm/builtins.ts`; the authoritative prose contract is in [DESIGN.md](./DESIGN.md). The runtime signature list:

| Builtin | Runtime behaviour |
|---------|-------------------|
| `move(dir)` | Rotate the facing vector, test the target cell against `TERRAIN[t].walkable` and world bounds, apply `current` drift if the rule is active, commit the move, emit a `move` event. Returns `bool`. |
| `descend()` | `h - 1` at the current `(x, y)`. Rejected when the target height has no terrain. `False` in Chapter 1. |
| `ascend()` | `h + 1`, same checks. `False` in Chapter 1. |
| `sense(dir)` | Read the neighbour's `TerrainId`; if the fog rule reports it as unknown, return the literal string `UNKNOWN`. Never throws. |
| `till()` | Set the current cell to `soil`. Legal only when `TERRAIN[current].tillable` or the terrain is water in Chapter 2. |
| `plant(crop)` | Look up `CROPS[crop]`. Reject unknown crop, locked tech, unplantable terrain, occupied cell, or missing credit. Sets `plant`, `growth = 0`, and subtracts `seedCost`. Returns the crop id or `""`. |
| `harvest()` | If `growth >= CROPS[plant].growthSteps`, clear the plant, add `yieldAmount` to inventory, fire the `harvest` event, return the amount. Otherwise return `0`. |
| `water()` | Add one moisture unit to the current cell, capped at the crop's `waterNeed`. |
| `wait()` | Consume one tick. Yields to the scheduler so other rules and the growth tick can run. |
| `position()` | Return a fresh dict snapshot: `{x, y, h, facing}`. |
| `inventory()` | Return a deep copy of the item table. Mutations are discarded by design. |
| `set_rule(event, fn)` | Store `fn` in the event slot, replacing any previous binding. Requires a `def`-defined callable. |
| `clear_rule(event)` | Remove the binding. No error if absent. |
| `report(text)` | Append to the console buffer, capped at 200 entries. |

Rule dispatch: after each `wait()`-bounded tick the world advances growth, then `drone.ts` calls every bound rule with a read-only context dict. Rules cannot start other rules. A rule that raises propagates the error to the worker and aborts the run with a source location.

## 6. Worker protocol

One worker, one message channel, typed in `src/worker.ts` and mirrored by the main-thread wrapper.

### Main thread to worker

| Message | Payload | Effect |
|---------|---------|--------|
| `init` | `{ seed, world, inventory, tech }` | Load a saved world into the interpreter runtime. |
| `run` | `{ source, programId }` | Tokenize, parse, install globals, start the generator. Clears the prior run first. |
| `pause` | — | Stop advancing after the current slice. |
| `resume` | — | Continue advancing. |
| `step` | `{ slices? }` | Advance exactly `slices` (default 1) slices while paused. |
| `setSpeed` | `{ multiplier: 0 \| 0.25 \| 0.5 \| 1 \| 2 \| 4 \| 8 }` | Set the tick interval. `0` is equivalent to `pause`. |
| `snapshot` | `{ requestId }` | Reply with the full observable state. |

### Worker to main thread

| Message | Payload | Raised when |
|---------|---------|-------------|
| `ready` | `{ version }` | After `init` completes. |
| `started` | `{ programId }` | A `run` message parsed and began. |
| `tick` | `{ n, cells: CellDelta[] }` | One simulation step, carrying only changed cells. |
| `event` | `{ kind, x, y, h, data }` | A Mote event fired. |
| `console` | `{ lines: string[] }` | `report()` output. |
| `stepped` | `{ pc, line, locals }` | After a `step` message, for the debugger view. |
| `paused` / `resumed` | — | Acknowledgement of `pause` / `resume`. |
| `snapshot` | `{ requestId, world, mote, inventory, pc, line, locals }` | Reply to `snapshot`. |
| `error` | `{ message, line, col, phase: 'tokenize' \| 'parse' \| 'runtime' }` | Any failure. The run is stopped. |
| `aborted` | `{ reason: 'op_cap', ops }` | Hard instruction cap reached. The run is stopped. |

The worker never posts a full world every tick. `tick` carries `CellDelta` records so the main thread patches only what changed:

```ts
export interface CellDelta {
  x: number; y: number; h: number;
  terrain?: TerrainId;
  plant?: CropId | null;
  growth?: number;
  moisture?: number;
}
```

## 7. Render pipeline

Three modules, run in order every animation frame: `camera.ts` -> `iso.ts` -> blit.

### Projection — `src/render/iso.ts`

```
TILE_W = 64        // full width of a top-face diamond
TILE_H = 32        // full height of a top-face diamond
TILE_Z = 16        // pixels of vertical offset per elevation level

screenX = (x - y) * (TILE_W / 2)
screenY = (x + y) * (TILE_H / 2) - h * TILE_Z
```

`h` is a signed integer, so Chapter 2 needs no projection change: a trench floor at `h = -6` simply draws lower on screen. `iso.ts` exposes:

```ts
export function project(x: number, y: number, h: number): { sx: number; sy: number };
export function drawOrder(a: Cell, b: Cell): number;   // painter comparator
```

### Painter sort

```ts
export function drawOrder(a: Cell, b: Cell): number {
  const da = a.x + a.y;
  const db = b.x + b.y;
  if (da !== db) return da - db;
  return a.h - b.h;
}
```

Ties on `(x + y)` occur on the two anti-diagonals; `h` breaks them. For each cell in sorted order, draw the top diamond, then the left face and right face for the drop to `h - 1`, then the plant sprite offset upward by `TILE_Z * growthStage`.

Known ceiling: a tall column can occlude a shorter cell that sorts earlier on the same diagonal. Chapter 1 keeps elevation shallow enough that it does not appear; the fix, if a future chapter needs it, is a per-column sort with a depth key, not a rewrite.

### Bake — `src/render/sprites.ts`

At boot, for every `TerrainId`, `CropId`, and growth stage, draw the sprite once into an `OffscreenCanvas`:

```ts
export type SpriteAtlas = Record<string, OffscreenCanvas>;

export function bakeSprites(): SpriteAtlas;   // called once from main.ts
```

Terrain sprites are flat-colour diamonds plus 2-4 shading faces. Crop sprites are 3-5 stacked quads, tinted from `CROPS[].colors`, with an additive glow pass when `glow` is present. The render loop then performs only:

```ts
ctx.drawImage(atlas[key], sx - anchorX, sy - anchorY);
```

No per-frame path construction, no per-frame colour parsing.

### Camera — `src/render/camera.ts`

Pan by drag, zoom by wheel between 0.75x and 3x, clamped to the world bounds. The camera computes the visible integer tile rectangle each frame and the render loop iterates only that rectangle, which bounds the work regardless of world size.

## 8. Save strategy

`src/ui/store.ts`, IndexedDB, one database, three object stores. No backend, no cloud.

| Store | Key | Contents |
|-------|-----|----------|
| `programs` | `id` | `{ id, name, source, updatedAt }` |
| `world` | `'current'` | `{ seed, chapter, tasks[], upgrades[], credits, inventory, mote }` |
| `settings` | `'current'` | `{ speedMultiplier, zoom, textScale, spriteDetail }` |

Autosave writes the world store on a 10-second debounce and on `visibilitychange`. Programs are saved on explicit save and on editor blur.

`src/ui/filetools.ts` handles interchange, replacing the file-watcher and Workshop story of comparable games:

- **Export**: build the source as a `Blob`, create an object URL, trigger a download as `<name>.py`.
- **Import**: `<input type="file" accept=".py">`, `File.text()`, load into a new program entry. The imported file is never executed until the player presses Run.

Programs are plain text. A `.py` file exported from SaltLight is valid Loam and invalid Python, which is intentional: the syntax is a Python subset, not Python.

## 9. Test strategy

`test/interp.test.ts`, assert-based, run by the Node test runner with no framework:

```bash
node --test test/interp.test.ts
```

Coverage targets, all of which must pass before a phase is closed:

- Arithmetic, precedence, integer vs float division, `//`, `%`, `**`.
- Strings, escaping, and string repetition.
- Lists, dicts, indexing, assignment into an index.
- `if` / `elif` / `else`, including fallthrough behaviour.
- `while` with `break` and `continue`.
- `for` over `range` with an explicit stop value.
- `def` / `return`, recursion, and a missing-return path returning `None`.
- Globals read and write from inside a function.
- `TokenizeError` and `ParseError` carry a line number.
- The instruction cap aborts a `while True: pass` program and reports the op count.

Worker protocol and rendering have no automated tests in the MVP; they are covered by the ASCII debug view and by the acceptance criteria in [ROADMAP.md](./ROADMAP.md).

## 10. Cross-references

- Product scope, competitive boundary, chapter table: [PRD.md](./PRD.md)
- Loam grammar, drone semantics, world model, palette: [DESIGN.md](./DESIGN.md)
- Phase-by-phase build order and acceptance criteria: [ROADMAP.md](./ROADMAP.md)
