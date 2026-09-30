# SaltLight — Product Requirements Document

Status: design phase, pre-implementation.
Stack target: Vite + TypeScript, canvas 2.5D isometric, CodeMirror 6, Web Worker, IndexedDB.
Companion docs: [ARCHITECTURE.md](./ARCHITECTURE.md) (how), [DESIGN.md](./DESIGN.md) (what the player touches), [ROADMAP.md](./ROADMAP.md) (build order).

## 1. Problem

Programming games exist as teaching toys, and farming automation games exist as clickers. The overlap — "write a program, a machine does the work for you" — is thinly occupied, and the existing entries in that overlap are built around the *language* rather than the *system*:

- The player is a programmer doing puzzles, and the farm is a skin on top of a tutorial.
- Or the player is a farmer, and "programming" is a shallow set of pre-authored action buttons, not a real language.

Neither gives the player the feeling that matters: writing a small program and watching an autonomous agent carry it out over hours of simulated time, where the interesting decisions are loop structure, state, and resource routing.

## 2. Solution

SaltLight is a browser game where the player programs a small autonomous drone, the **Mote**, in a Python-like language called **Loam**, and the Mote farms a grid for them. The player never clicks the farm. They write code.

- The player writes Loam programs in an in-browser CodeMirror 6 editor.
- The program runs inside a custom interpreter in a Web Worker, one instruction batch at a time.
- The Mote carries out the program: it moves, tills, plants, waters, harvests, and stores inventory, autonomously and continuously.
- Harvested resources unlock technologies, which unlock crops, tiles, and drone capabilities.
- Programs can attach **rules** to events (`set_rule`), so the farm keeps running with no top-level loop at all.

Two chapters:

- **Chapter 1 — Sky Isles.** A small floating island. The scarce resource is *space*. The sea is an obstacle. You farm upward and the drone can only reach so much ground.
- **Chapter 2 — Deep Trench.** An ocean trench. The scarce resource is *information*. Water is not an obstacle, it is the space you must claim. Fog hides the grid, currents push the drone off course, depth runs on a negative `h` axis, and the crops are bioluminescent.

The chapter swap changes **data and rules, not code paths**: the elevation axis is the same `h` field with a sign flip and a wider range, terrain and crop definitions are lookup tables, and the only new runtime pieces are fog and current.

## 3. Target persona

Primary: a programmer who likes automation games and has 20–40 minute sessions, wants a satisfying "I wrote this, it works while I sleep" loop, and does not want to install a client.

Secondary: a beginner programmer who has seen Python basics and wants a project where the language is the toy — the game is a gentle on-ramp from variables to event-driven automation.

Explicitly not the persona: a player who wants combat, story branching, or an MMO.

## 4. Scope

### In scope

- Loam: Python-like language with int/float/bool/string, list, dict, arithmetic, comparison, `if`/`elif`/`else`, `while`, `for i in range(n)`, `break`, `continue`, `def`/`return`, globals, and a drone builtin library.
- A custom VM: tokenizer, parser, AST, generator-based interpreter with an instruction budget and a step debugger.
- Web Worker sandbox with pause / step / speed multiplier / hard instruction cap.
- 2.5D isometric canvas renderer with per-tile elevation, baked procedural sprites, painter sorting.
- 14-function Mote API (see section 8).
- Data-driven `TERRAIN` and `CROPS` tables.
- Chapter 1 progression: ~10 tutorial tasks, one programming concept each, then free play.
- Chapter 2: fog-of-war, ocean current, negative elevation, bioluminescent crops. Stretch goal.
- Save/load in IndexedDB, `.py` import/export of programs.
- Settings: speed, sprite detail, text size.

### Out of scope

- Any frontend framework. Render loop is canvas; editor is CodeMirror.
- WebGL, Three.js, or any GPU 3D. Elevation is a fake 2.5D projection.
- Image assets. Every sprite is drawn procedurally at boot.
- Embedding CPython or Pyodide.
- Multiplayer, accounts, cloud sync, monetization.
- Native/mobile app. Desktop browser only for the MVP.
- Mod workshop, Steam Workshop, or file-system watching.

## 5. Success criteria

Design phase gates, in priority order:

| # | Criterion | How it is measured |
|---|-----------|-------------------|
| S1 | A new player writes a working 3-line program and sees the Mote act on it within 60 seconds of page load. | Manual playtest with 3 cold-start players, no spoken help. |
| S2 | Tutorial task 4 (`while`) is completed by 80% of first-time players without external help. | Task completion telemetry kept in save data, or a written playtest log of 5 players. |
| S3 | The render loop holds 60 fps with a 40x40 visible grid and ~4,000 live tiles on a 2019-class laptop. | `requestAnimationFrame` frame-time histogram during a 5-minute farm run. |
| S4 | The interpreter test suite passes with `node --test` and covers every statement form and the instruction cap. | CI run, zero framework dependencies. |
| S5 | A player can export a program as `.py` and re-import it on another machine with identical behaviour. | Manual round-trip check. |
| S6 | An infinite loop in player code never freezes the tab. | Worker enforces a hard cap; a `while True: pass` test program raises `aborted` within the cap and the UI stays responsive. |
| S7 | Chapter 2 ships with no changes to the VM, the renderer, or the editor. | Diff of `src/vm/**`, `src/render/**`, `src/ui/editor.ts` between the Chapter 1 and Chapter 2 releases is empty. |

## 6. Competitive landscape

| Game | Genre | What the player does | Where SaltLight differs |
|------|-------|-----------------------|-------------------------|
| The Farmer Was Replaced | Programming farming | Write Python, drone farms a tile grid | SaltLight has an original world and language, an isometric 2.5D presentation, event-driven `set_rule` automation, and a second chapter that changes the information model rather than adding more rows |
| Melvor Idle | Incremental idle | Click, queue, optimise numbers | SaltLight is authored in code, not in menus |
| Factorio | Automation | Build and debug a factory | SaltLight is a single-agent scripting game with no build grid or logistics |
| Opus Magnum | Programming puzzle | Tile-program a machine | SaltLight is a persistent, open-ended farm, not a fixed puzzle |
| SIC-1 / Silicon Zeroes style puzzle games | Programming puzzle | Solve a bounded board | Out of scope: no fixed boards, no puzzle scoring |
| Minecraft Redstone / command blocks | Sandbox automation | Configure hidden systems | SaltLight is a real language, not a configuration UI |

SaltLight is a tribute to the programming-farming genre. It takes the genre convention — "a drone executes your program on a grid" — and every other asset, system, and name is original.

## 7. Two-chapter mechanic table

| Axis | Chapter 1 — Sky Isles | Chapter 2 — Deep Trench |
|------|----------------------|----------------------|
| Scarcity | Space: finite island, fixed tile budget | Information: fog radius hides everything beyond sensing range |
| Water | Obstacle. Mote cannot enter; falling in ends the run | The resource. Water cells are claimable space converted by `till()` |
| Elevation | `h` in a small non-negative range, mostly flat | `h` in a negative range, terrain stepped down into the trench |
| `sense(dir)` | Always returns the real terrain name | Returns `UNKNOWN` beyond the fog radius; mapping the grid requires movement |
| Drifting | None, the island is static | Ocean current pushes the Mote between turns, so paths need correction |
| Crops | Ordinary, warm palette | Bioluminescent, glow palette, light-emitting |
| Player loop | Optimise ops per harvest | Optimise sensing: explore cheaply, then farm what you mapped |
| Unlock condition | 10 tutorial tasks complete | Chapter 1 complete, then enter the trench |

Both chapters share one cell model, one `h` field, one drone API, and one renderer. Chapter 2 adds `src/game/rules/fog.ts` and `src/game/rules/current.ts` only.

## 8. Mote API surface

The complete builtin list, identical in this document, [ARCHITECTURE.md](./ARCHITECTURE.md), and [DESIGN.md](./DESIGN.md).

| Builtin | Returns | Semantics |
|---------|---------|-----------|
| `move(dir)` | `bool` | Step one tile in a relative direction. `False` if blocked by terrain, edge, or fog-revealed void. |
| `descend()` | `bool` | Move down one elevation level at the current `(x, y)`. Chapter 2 only. |
| `ascend()` | `bool` | Move up one elevation level at the current `(x, y)`. Chapter 2 only. |
| `sense(dir)` | `str` | Terrain id of the neighbouring tile, or `UNKNOWN` past the fog radius. |
| `till()` | `bool` | Convert the current cell to plantable ground. Converts soil, and in Chapter 2 claims water. |
| `plant(crop)` | `str` | Plant a crop id at the current cell. Returns the crop id, or `""` on failure. |
| `harvest()` | `int` | Harvest a mature plant at the current cell. Returns the units gained, `0` otherwise. |
| `water()` | `bool` | Irrigate the current cell, adding one growth step of moisture. |
| `wait()` | `None` | Consume one tick without acting. |
| `position()` | `dict` | `{"x": int, "y": int, "h": int, "facing": str}`. |
| `inventory()` | `dict` | Copy of the Mote's item counts. Mutating the copy does nothing. |
| `set_rule(event, fn)` | `None` | Bind a function to a Mote event, replacing any previous binding. |
| `clear_rule(event)` | `None` | Remove the binding for an event. |
| `report(text)` | `None` | Print to the in-game console panel. |

Events accepted by `set_rule`: `harvest`, `plant`, `low_inventory`, `blocked`, `tick`.

## 9. Legal and ethical boundary

The rule SaltLight holds: **mechanics are imitated, everything else is original.**

Imitated, because a mechanic is a genre convention:

- Writing a program in a Python-like language that an agent executes.
- A drone that autonomously works a grid.
- Resources unlocking technology.
- A top-level loop as the primary automation idiom.

Original, and never copied:

- The name SaltLight, the name Loam, the name Mote.
- World fiction: sky isles and a bioluminescent trench, with original lore text.
- Art direction: procedurally drawn low-poly flat-color sprites. No assets taken from any other work.
- The `sense()` / `UNKNOWN` information-degradation mechanic, which is the genre's actual differentiator and is not present in the reference title.
- `set_rule` event-driven automation as a first-class alternative to a main loop.
- Chapter structure, progression order, tutorial task sequence, and difficulty curve.
- All code, all text, all generated sprites.

No reference to any third-party game, character, world, or asset appears in the repository, in the art, or in the marketing copy. SaltLight is described publicly as an original work in the programming-farming genre, never as a clone or a port.

## 10. Non-goals

- Not a Python implementation. Loam omits `class`, `import`, `try`, `lambda`, and comprehensions, permanently.
- Not a general scripting host. No filesystem, no network, no eval of player-supplied host objects.
- Not a 3D game. Isometric 2D only.
- Not a survival game. There is no hunger, no threat, no fail state in Chapter 1.
- Not a live-service game. No accounts, no telemetry upload, no backend.
- Not multi-language. The UI and docs are English.

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Player writes an infinite loop and the tab freezes | High if uncapped | High | Worker runs the VM; hard instruction cap aborts the run and reports `aborted`; the main thread never blocks on the interpreter. |
| A new player cannot write Loam and bounces in the first 5 minutes | Medium | High | Tutorial tasks isolate one concept each; builtins autocomplete in the editor; the first three tasks are copy-and-tweak. |
| Procedural sprites look cheap and undermine the tone | Medium | Medium | Flat-color low-poly with a fixed 8-color palette per material and baked drop shadows; art direction is pinned in [DESIGN.md](./DESIGN.md) before Phase 4. |
| Chapter 2 doubles the design surface and stalls the project | Medium | High | Chapter 2 is a stretch goal gated on the S7 gate; fog and current are each one module with one rule interface. |
| Scope creep into a full language (classes, imports) | Medium | Medium | Exclusions are written into the spec; PRs adding syntax to the tokenizer get rejected against [DESIGN.md](./DESIGN.md). |
| Isometric painter sorting produces visible artifacts on tall neighbours | Medium | Low | Sort key is `(x + y)` then `h`; chapter elevation ranges are kept shallow; known limits are documented in [ARCHITECTURE.md](./ARCHITECTURE.md). |
| Performance collapses with 10,000+ tiles | Low | Medium | Sprites baked to offscreen canvases at boot so the render loop is blits only; the visible grid is capped by camera bounds. |

## 12. Cross-references

- Architecture, module map, VM design, worker protocol: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Loam grammar, drone semantics, world model, chapter design, palette: [DESIGN.md](./DESIGN.md)
- Phase plan, acceptance criteria, risk register: [ROADMAP.md](./ROADMAP.md)
