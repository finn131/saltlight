# SaltLight — Roadmap

Companion docs: [PRD.md](./PRD.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [DESIGN.md](./DESIGN.md).

Delivery model: one phase at a time, each closing only when every acceptance criterion is observed. Phases 0–6 are the MVP. Phase 7 is a stretch goal, gated on PRD success criterion S7.

## Phase 0 — Scaffold

**Goal.** A Vite + TypeScript project that boots, renders an empty isometric grid, and has a build and test command that works.

**Deliverables.**

- `index.html` with three mount points: `#grid-canvas`, `#editor`, `#panels`.
- `package.json` with `dev`, `build`, `preview`, `test` scripts and Vite + TypeScript as the only runtime dependencies.
- `src/main.ts`: boot sequence that builds the camera, starts the animation loop, and draws an empty grid.
- `src/style.css`: layout, CSS custom properties for the palette, panel chrome.

**Acceptance criteria.**

1. `npm install && npm run dev` serves the page with no console errors.
2. `npm run build` produces a `dist/` bundle with no TypeScript errors.
3. A 20x20 flat grid renders at 60 fps with a visible diamond pattern and correct elevation offset when a test set of cells is given non-zero `h`.
4. `npm test` runs and reports zero tests, exiting cleanly, so later phases have a harness.
5. `src/vm/**`, `src/render/**`, and `src/game/**` do not exist yet, and `index.html` does not load any framework.

**Depends on.** Nothing.

## Phase 1 — Loam VM

**Goal.** Text in, values out, fully testable in Node with no browser.

**Deliverables.**

- `src/vm/tokenizer.ts`
- `src/vm/parser.ts`
- `src/vm/interp.ts`
- `src/vm/builtins.ts` (declarations and the arithmetic-safe stubs; world-touching builtins throw `not available outside a world` until Phase 2)
- `test/interp.test.ts`

**Acceptance criteria.**

1. `node --test test/interp.test.ts` passes every case listed in [ARCHITECTURE.md](./ARCHITECTURE.md) section 9.
2. `while True: pass` aborts with an op count instead of hanging, verified by the test suite with a wall-clock bound under 5 seconds.
3. A `TokenizeError` and a `ParseError` each report a correct line and column for a source file with the error on line 12.
4. Tabs in source produce a located error, not silent reindentation.
5. `class`, `import`, `try`, `lambda`, and list comprehensions each produce a located `ParseError`.
6. `step()` returns `'slice'` while work remains and `'done'` when the program finishes, with the slice boundary at `OPS_PER_SLICE`.

**Depends on.** Phase 0.

## Phase 2 — World model

**Goal.** A headless world that the VM can mutate: cells, terrain, crops, and the Mote.

**Deliverables.**

- `src/game/terrain.ts` with the `TERRAIN` table and the `TerrainDef` interface.
- `src/game/crops.ts` with the `CROPS` table and the growth tick.
- `src/game/world.ts` with the cell store, height buckets, and a mutation API used by the builtins.
- `src/game/drone.ts` with Mote state, event dispatch, and the rule slots for `harvest`, `plant`, `low_inventory`, `blocked`, `tick`.

**Acceptance criteria.**

1. Creating a 10x10 world and calling `till()` then `plant('kelp')` then `harvest()` three times yields `2` on the third call and `0` on the first two.
2. `plant('glasswort')` on locked tech returns `""` and deducts no credit.
3. `plant('kelp')` on rock returns `""`.
4. `water()` beyond `CROPS.kelp.waterNeed` clamps instead of accumulating.
5. `set_rule('harvest', fn)` replaces an existing binding rather than stacking a second rule.
6. Adding a terrain or crop row to the table makes it usable by `plant()` and by rendering with no change to `world.ts` or `drone.ts`.
7. The whole world can be serialised to JSON and restored to an identical state.

**Depends on.** Phase 1.

## Phase 3 — Worker sandbox

**Goal.** Loam runs off the main thread, with pause, step, speed, and a hard cap.

**Deliverables.**

- `src/worker.ts` hosting the tokenizer, parser, interpreter, world, and Mote, with the message protocol from [ARCHITECTURE.md](./ARCHITECTURE.md) section 6.
- The main-thread wrapper that constructs the worker and exposes `run`, `pause`, `resume`, `step`, `setSpeed`, `snapshot`.
- `init`, `ready`, `started`, `aborted`, `error` handled end to end.

**Acceptance criteria.**

1. A `run` message with a program containing `while True: pass` produces an `aborted` message with `reason: 'op_cap'`, and the page remains scrollable and clickable throughout.
2. `pause` takes effect within `OPS_PER_SLICE` ops; the UI reflects the paused state within one animation frame.
3. `step` advances exactly one slice and returns a `stepped` message containing the current line and a locals snapshot.
4. `setSpeed` with each of `0.25, 0.5, 1, 2, 4, 8` changes the observed tick rate, measured over 100 ticks.
5. A `tick` message contains only changed cells, verified by asserting that a program doing `wait()` and nothing else produces zero `CellDelta` records.
6. A syntax error produces an `error` message with the correct line, col, and `phase: 'parse'`, and no run starts.
7. Killing and respawning the worker loses no program source, because program text lives on the main thread.

**Depends on.** Phase 2.

## Phase 3.5 — ASCII debug view (throwaway)

**Goal.** Find drone logic bugs in text, before any pixels exist.

**Rationale.** Between the worker and the renderer there is a working simulation with no way to see it. Building the renderer first means debugging logic through visual artefacts, which is slow and hides causes. This is a throwaway view: it exists for the duration of Phase 3 debugging and is deleted when Phase 4 lands.

**Deliverables.**

- A `?debug=1` query flag that renders the world as text into a `<pre>` panel instead of a canvas.
- ASCII keys per terrain id and per crop growth stage.

**Acceptance criteria.**

1. With `?debug=1`, a program that plants, waters, waits, and harvests produces an interpretable text grid showing crop growth over time.
2. A program that walks off the edge of the island shows the blocked event in the text log.
3. The flag does not exist after Phase 4 merges, verified by searching the source for `debug=1` returning no render path.

**Depends on.** Phase 3. Blocks Phase 4.

## Phase 4 — 2.5D isometric render

**Goal.** The world visible and readable at 60 fps, with no image files in the repository.

**Deliverables.**

- `src/render/sprites.ts` baking all sprites to `OffscreenCanvas` at boot.
- `src/render/iso.ts` with `project` and `drawOrder`.
- `src/render/camera.ts` with pan, zoom, and visible-bounds culling.
- Integration with the worker `tick` stream.

**Acceptance criteria.**

1. `grep -rE '\.(png|jpg|jpeg|webp|gif|svg)$'` over the repository returns nothing, and the repository contains no image assets of any format.
2. A 40x40 grid with 4,000 visible tiles holds 60 fps over a 5-minute measured run, per PRD criterion S3.
3. The render loop contains no `beginPath`, `arc`, or colour-string construction; it performs only `drawImage` calls, verified by code inspection.
4. Cells at `h = 0`, `h = 1`, and `h = -3` project to the correct screen offsets, including negative heights.
5. Sorting by `(x + y)` then `h` shows no visible overdraw artifacts in the Chapter 1 island.
6. A `glow` field on a crop or terrain adds the additive pass, demonstrated with a `lantern_pearl` cell.
7. Panning to the world edge culls correctly: no draw calls for off-screen cells.

**Depends on.** Phase 3.5.

## Phase 5 — Editor, storage, files

**Goal.** The player writes Loam in the browser and keeps it.

**Deliverables.**

- `src/ui/editor.ts` with CodeMirror 6, a Python-ish language mode, and autocompletion driven by `BUILTINS` in `src/vm/builtins.ts`.
- `src/ui/store.ts` with the three IndexedDB stores from [ARCHITECTURE.md](./ARCHITECTURE.md) section 8.
- `src/ui/filetools.ts` with `.py` export and import.

**Acceptance criteria.**

1. Typing `sen` shows a completion for `sense(dir)`, sourced from the runtime builtin table, with no duplicated list.
2. Saving, reloading the page, and reopening restores the exact program text, including indentation.
3. Export writes a file whose name matches the program name with a `.py` extension; importing it on a fresh profile produces byte-identical source.
4. Importing a file never executes it. The program runs only on an explicit Run.
5. Settings survive a reload.
6. An autosave interrupted by a page close mid-write leaves the previous world intact, because the write is a single transaction.

**Depends on.** Phase 4.

## Phase 6 — Meta layer and Chapter 1

**Goal.** A shippable vertical slice: tutorial, economy, progression, save, settings.

**Deliverables.**

- Resource and upgrade definitions: credits, seeds, harvest yield, movement budget, inventory capacity.
- The ~10 tutorial tasks specified in [DESIGN.md](./DESIGN.md) section 5, each gated on a real observable program behaviour.
- Task panel, resource panel, and the console panel for `report()` output.
- Settings panel: speed, zoom, text scale, sprite detail.
- Full save/load wiring and a reset-world action.

**Acceptance criteria.**

1. A new save opens on tutorial task 1 with the editor focused and a `report('hello')` program already loaded.
2. Each task advances only when its program produces the specified observable effect, verified by running the check program and inspecting world state, not by the player clicking Next.
3. Completing task 10 unlocks free play and the Chapter 2 entry point.
4. An upgrade that increases harvest yield is reflected in the next `harvest()` return value.
5. Reloading mid-task restores the task, the program, the world, and the inventory exactly.
6. Reset world returns the player to task 1 with an empty inventory and a new seed.
7. The entire slice is playable with no reference to the ASCII debug view.

**Depends on.** Phase 5.

## Phase 7 — Chapter 2, Deep Trench (stretch)

**Goal.** A second chapter that ships without touching the VM, the renderer, or the editor.

**Entry gate.** Phase 6 accepted, and PRD criterion S7 verified: `git diff` of `src/vm/**`, `src/render/**`, and `src/ui/editor.ts` between the Chapter 1 and Chapter 2 tags is empty.

**Deliverables.**

- `src/game/rules/fog.ts`: radius-based reveal, `sense()` returning `UNKNOWN` past the radius.
- `src/game/rules/current.ts`: per-tick drift applied inside `move()`.
- New `TERRAIN` rows: `water_deep` flooding behaviour, `vent`, `ledge`.
- New `CROPS` rows: `lantern_pearl`, `glowcap`, both with `glow` palettes.
- Chapter 2 world generation with `h` in a negative range.
- Chapter 2 task set focused on mapping under uncertainty.

**Acceptance criteria.**

1. `sense('forward')` returns `UNKNOWN` at a distance greater than the fog radius and the correct terrain id within it.
2. The Mote cannot farm a cell it has never sensed; planting there fails with a terrain mismatch, not a silent success.
3. `current` moves the Mote off its intended path in a reproducible way, and a program that reads `position()` and corrects can hold a route.
4. Water cells are claimable with `till()` and become plantable ground.
5. Negative `h` values render correctly with no change to `src/render/iso.ts`.
6. The diff gate above still passes: the only changed files under `src/` are `src/game/rules/**`, `src/game/terrain.ts`, `src/game/crops.ts`, and the chapter 2 task definitions.

**Depends on.** Phase 6.

## Risk register

| ID | Risk | Phase where it bites | Mitigation | Trigger to escalate |
|----|------|----------------------|------------|---------------------|
| R1 | Infinite loop freezes the tab | 1, 3 | Worker isolation, `HARD_OP_CAP`, `aborted` message | Tab becomes unresponsive during any test run |
| R2 | Grammar creep toward Python | 1 | Exclusions enforced by parse errors and by review against [DESIGN.md](./DESIGN.md) | Any PR adds `class`, `import`, `try`, `lambda`, or comprehension syntax |
| R3 | Logic bugs are hard to find once pixels exist | 3 to 4 | ASCII debug view between 3 and 4; deleted at Phase 4 | More than one full day spent on a logic bug with no textual repro |
| R4 | Isometric sorting artifacts on tall terrain | 4 | Shallow Chapter 1 elevation; sort comparator is one function | A visible artifact appears on the Chapter 1 island |
| R5 | Baked sprite atlas grows past memory budget | 4 | Bake once, key by terrain/stage, cap stages at 5 per crop | Atlas exceeds roughly 64 MB in the browser profiler |
| R6 | CodeMirror bundle weight slows first load | 5 | Bundle only the language mode actually used, not the full Python package | First load exceeds roughly 2 seconds on a throttled profile |
| R7 | IndexedDB data loss on interrupted write | 5, 6 | Single-transaction writes, previous state retained on failure | A reload restores an older world than the one before the reload |
| R8 | Beginner players bounce at task 4 | 6 | One concept per task, autocomplete, first three tasks are copy-and-tweaks | Fewer than 80% of first-time players clear task 4 unaided |
| R9 | Chapter 2 doubles the design surface and stalls the project | 7 | Marked stretch; entry gate requires Phase 6 accepted | Phase 6 slips by more than one phase |
| R10 | Scope creep toward a general scripting host | 1 to 7 | No `eval`, no host object exposure, no filesystem or network access in the VM | Any builtin is added that exposes a host capability |

## Dependency chain

```
0 scaffold
  -> 1 vm
    -> 2 world
      -> 3 worker
        -> 3.5 ascii debug view
          -> 4 render
            -> 5 editor + storage
              -> 6 meta + chapter 1   [MVP]
                -> 7 chapter 2        [stretch]
```
