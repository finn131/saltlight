# SaltLight

A browser game about writing a program and letting a drone do the farming.

You write Loam, a Python-like language, and the Mote — a small autonomous drone — carries it out on a grid while you watch. No clicking the farm. No build menus. The interesting decisions are loop structure, state, and resource routing. Harvested resources unlock technology, and the chapter 1 island runs out of space before you run out of ideas.

Chapter 2 puts the same drone in a deep-sea trench, where the scarce resource is information: fog hides everything past `sense()`, an ocean current pushes you off course, and the elevation axis runs negative. The same fourteen builtins, the same renderer, the same interpreter. Only the data and two rule modules change.

Original work in the programming-farming genre. A tribute to the convention, not a clone: original theme, lore, art, language, and progression.

## Documentation

| Document | Contents |
|----------|----------|
| [docs/PRD.md](docs/PRD.md) | Problem, solution, persona, scope, success criteria, competitive landscape, chapter mechanics, legal boundary, non-goals, risks |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module and file map, data-table contract, VM design, drone builtins, worker protocol, render pipeline, save strategy |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases 0–7 with deliverables and testable acceptance criteria, plus the risk register |
| [docs/DESIGN.md](docs/DESIGN.md) | Loam grammar and exclusions, full drone API, world model, tutorial tasks, Chapter 2 design, tone and palette |

## Tech stack

- Vite + TypeScript. No frontend framework.
- Canvas 2.5D isometric renderer, painter-sorted, sprites baked procedurally at boot. No WebGL, no image files.
- Custom Loam VM: tokenizer, parser, AST, generator-based interpreter with an instruction budget and a step debugger.
- Web Worker sandbox with pause, step, speed multiplier, and a hard instruction cap.
- CodeMirror 6 for the editor, highlighted from the same tokenizer the parser uses.
- IndexedDB for saves, `.py` import/export for programs.
- `node --test` with assert-based tests. No test framework.

## Running the project

```bash
npm install        # Vite + TypeScript + CodeMirror
npm run dev        # Vite dev server
npm run build      # Type-check and bundle to dist/
npm test           # node --test, 216 cases
npm run gate:s7    # Chapter 2 diff gate: VM, renderer and editor unchanged
```

## Current state

Both chapters are implemented. `src/vm` holds the language, `src/game` the world and the two chapters, `src/render` the isometric renderer, `src/ui` the editor and storage, and `src/worker*` the sandbox. The ten tutorial tasks gate on observable program behaviour: pressing Check runs the player's program headlessly and advances only when the trace shows the intended effect. Completing task 10 unlocks free play.

Chapter 2 is data-only. `src/game/rules/fog.ts` and `src/game/rules/current.ts` plug into rule slots on the world, so the VM, the renderer and the editor are untouched; `npm run gate:s7` proves it between the `chapter-1` and `chapter-2` tags.

Two things are not automated and need a browser: the 60fps frame-rate target over a five-minute farm run, and visual inspection of painter-sort artefacts and overdraw. Everything else has a test.