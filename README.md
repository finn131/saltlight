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
- CodeMirror 6 for the editor, with autocompletion driven by the runtime builtin table.
- IndexedDB for saves, `.py` import/export for programs.
- `node --test` with one assert-based interpreter test file. No test framework.

## Running the project

**Status: design phase. None of the commands below work yet.** They describe the intended workflow, set by the phase plan in [docs/ROADMAP.md](docs/ROADMAP.md).

```bash
npm install        # Phase 0
npm run dev        # Vite dev server
npm run build      # Type-check and bundle to dist/
npm test           # node --test test/interp.test.ts
```

The scaffold does not exist yet. Phase 0 creates `index.html`, `package.json`, `src/main.ts`, and `src/style.css`; the VM arrives in Phase 1.

## Current state

Design complete, implementation not started. The four documents above are the specification: PRD for scope, architecture for structure, roadmap for build order, design for the language and the world.

Phase 6 is the MVP. Phase 7, the Deep Trench, is a stretch goal gated on the requirement that the VM, renderer, and editor stay unchanged between the two chapters.
