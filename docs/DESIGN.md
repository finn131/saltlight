# SaltLight — Design

Companion docs: [PRD.md](./PRD.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [ROADMAP.md](./ROADMAP.md).

## 1. The language: Loam

Loam is a Python-like language written by the player for the Mote. It is a deliberate subset, not a Python implementation.

### 1.1 Grammar

```ebnf
program        := statement* EOF

statement      := assign_stmt
                | if_stmt
                | while_stmt
                | for_stmt
                | def_stmt
                | return_stmt
                | break_stmt
                | continue_stmt
                | pass_stmt
                | expr_stmt

assign_stmt    := target '=' expr NEWLINE
                | target aug_op expr NEWLINE
target         := NAME '[' expr ']'
                | NAME '.' NAME
                | NAME

if_stmt        := 'if' expr ':' NEWLINE INDENT statement+ DEDENT
                  ( 'elif' expr ':' NEWLINE INDENT statement+ DEDENT )*
                  [ 'else' ':' NEWLINE INDENT statement+ DEDENT ]

while_stmt     := 'while' expr ':' NEWLINE INDENT statement+ DEDENT
for_stmt       := 'for' NAME 'in' 'range' '(' expr ',' expr ')' ':' NEWLINE
                  INDENT statement+ DEDENT
def_stmt       := 'def' NAME '(' [ NAME (',' NAME)* ] ')' ':' NEWLINE
                  INDENT statement+ DEDENT
return_stmt    := 'return' [ expr ] NEWLINE

expr           := or_expr
or_expr        := and_expr ( 'or' and_expr )*
and_expr       := not_expr ( 'and' not_expr )*
not_expr       := 'not' not_expr | comparison
comparison     := arith ( ( '==' | '!=' | '<' | '<=' | '>' | '>=' ) arith )*
arith          := term ( ('+' | '-') term )*
term           := factor ( ('*' | '/' | '//' | '%') factor )*
factor         := ('-' | '+') factor | power
power          := atom [ '**' factor ]
atom           := NUMBER | STRING | 'True' | 'False' | 'None'
                | NAME
                | call
                | subscript
                | member
                | list_lit
                | dict_lit
                | '(' expr ')'

call           := NAME '(' [ expr (',' expr)* ] ')'
subscript      := atom '[' expr ']'
member         := atom '.' NAME
list_lit       := '[' [ expr (',' expr)* ] ']'
dict_lit       := '{' [ expr ':' expr (',' expr ':' expr)* ] '}'
```

### 1.2 Supported features

| Feature | Notes |
|---------|-------|
| `int` and `float` | `3`, `3.0`, `0.5`. `int / int` yields `float`; `//` yields `int` for ints. |
| `bool` | `True`, `False`. Comparison and `and`/`or`/`not` produce bools. |
| `str` | Single or double quotes, escapes `\n` `\t` `\\` `\"` `\'`. `+` concatenates, `* int` repeats. |
| `None` | Returned by a bare `return`, a fall-through function end, and `clear_rule`. |
| `list` | Literal, indexing, `len`-style use through `inventory()`, append only via the world API. Negative indices allowed. |
| `dict` | Literal, indexing, key iteration is out of scope; `position()` and `inventory()` return dicts. |
| Arithmetic | `+ - * / // % **`, unary `-` and `+`. |
| Comparison | `== != < <= > >=`, chained. |
| Logic | `and`, `or`, `not` with short-circuit evaluation. |
| `if` / `elif` / `else` | Full chain, first match wins, no fallthrough. |
| `while` | With `break` and `continue`. |
| `for` | `for i in range(a, b)`, `b` exclusive, both args required for MVP. |
| `def` / `return` | Positional parameters, recursion supported. |
| Globals | Read and write from inside functions. |
| Assignment | `=`, `+=`, `-=`, `*=`, `/=`, into variables, list indices, and `inventory()` is read-only by design. |
| `pass` | No-op. |

### 1.3 Deliberate exclusions

| Excluded | Why |
|----------|-----|
| `class` | Object orientation has no payoff in a grid game and multiplies the runtime state surface. The Mote is the only object the player needs. |
| `import` / `require` | No filesystem, no network, no plugins. The builtin table is the whole world. |
| `try` / `except` / `finally` | Errors should stop the run with a line number, not be swallowed. A silent catch hides the bug the step debugger exists to find. |
| `lambda` | Anonymous functions are not needed when `def` plus `set_rule` already covers event handling. |
| List/dict comprehensions | Syntactic sugar that the parser would have to support twice. `for` loops are the thing being taught. |
| `with` | No context managers. |
| Slices (`a[1:3]`) | Not needed; two indices are enough for inventory bookkeeping. |
| `*args` / `**kwargs` | Positional parameters cover every rule shape. |
| `yield` / generators | Would complicate the generator-based interpreter. |

Each exclusion is enforced: writing the construct produces a located `ParseError`, not a silent misbehaviour. Adding any of them is out of scope for the project's life.

## 2. The Mote

The Mote is the in-game drone. It holds position, facing, inventory, and a set of rule slots. The player never clicks the farm; every action the Mote takes comes from a running Loam program.

### 2.1 API

The list is identical in [PRD.md](./PRD.md) section 8 and [ARCHITECTURE.md](./ARCHITECTURE.md) section 5.

| Builtin | Signature | Returns | Semantics |
|---------|-----------|---------|-----------|
| `move` | `move(dir)` | `bool` | Step one tile. `dir` is relative to facing: `'forward'`, `'back'`, `'left'`, `'right'`. `False` when the target is not walkable, is off-world, or would enter fog-hidden void. |
| `descend` | `descend()` | `bool` | Move to `h - 1` at the current `(x, y)`. `False` in Chapter 1, and whenever the target height has no terrain. |
| `ascend` | `ascend()` | `bool` | Move to `h + 1` at the current `(x, y)`. Same failure conditions. |
| `sense` | `sense(dir)` | `str` | Terrain id of the neighbour in `dir`, or the literal `'UNKNOWN'`. Never raises. |
| `till` | `till()` | `bool` | Convert the current cell to plantable ground. Legal on `tillable` terrain, and on water in Chapter 2. |
| `plant` | `plant(crop)` | `str` | Plant a crop id. Returns the crop id on success, `''` on any failure: unknown id, locked tech, wrong terrain, occupied cell, insufficient credit. |
| `harvest` | `harvest()` | `int` | Harvest a mature plant. Returns the units added, `0` if the cell is empty or immature. |
| `water` | `water()` | `bool` | Add one moisture unit, capped at the crop's `waterNeed`. |
| `wait` | `wait()` | `None` | Consume one tick. The scheduling point: growth advances and rules fire around it. |
| `position` | `position()` | `dict` | Fresh snapshot `{x, y, h, facing}`. Mutating it does nothing. |
| `inventory` | `inventory()` | `dict` | Deep copy of the item table. Read-only by design. |
| `set_rule` | `set_rule(event, fn)` | `None` | Bind a `def`-defined function to a Mote event, replacing any previous binding. |
| `clear_rule` | `clear_rule(event)` | `None` | Unbind. No error when unbound. |
| `report` | `report(text)` | `None` | Print to the console panel. Any value is stringified. |

### 2.2 Events

`set_rule` accepts exactly these five:

| Event | Fires when | Context keys |
|-------|-----------|--------------|
| `harvest` | `harvest()` returns more than zero | `amount`, `crop`, `x`, `y`, `h` |
| `plant` | `plant()` succeeds | `crop`, `x`, `y`, `h` |
| `low_inventory` | Inventory of any tracked item falls below its upgrade threshold | `item`, `count` |
| `blocked` | A `move` was refused | `dir`, `x`, `y`, `h` |
| `tick` | Every simulation tick, after growth advances | `x`, `y`, `h`, `ticks` |

Rules receive one read-only `dict`. A rule may not call `set_rule` or `clear_rule`. A rule that raises stops the run with the offending source line.

### 2.3 `sense(dir)` in detail

`sense` is the differentiator. In Chapter 1 it is a convenience: the island is small and fully known, so `sense` is a readability aid that returns the true terrain id of a neighbour.

In Chapter 2 it is the core information constraint:

- Everything farther than the fog radius returns `'UNKNOWN'`, regardless of what is really there.
- `sense` never raises and never returns `None`. It returns a `str`, always.
- Because `UNKNOWN` is a plain string, a player who forgets to check it will compare `UNKNOWN` against a crop's `plantableOn` list and get a clean failure rather than a crash. That is deliberate: the game should teach through a failed `plant()` returning `''`, not through a stack trace.
- Mapping is therefore an act of movement. A program that senses in a loop, logs results with `report`, and returns home has performed a survey; a program that assumes a uniform island has not.

## 3. World model

### 3.1 Cell

```ts
export interface Cell {
  x: number;
  y: number;
  h: number;          // signed elevation; Chapter 1 non-negative, Chapter 2 negative
  terrain: TerrainId;
  plant: CropId | null;
  growth: number;     // steps completed, compared against CROPS[].growthSteps
  moisture: number;   // water units present, capped at CROPS[].waterNeed
}
```

`h` is the single axis that carries the chapter switch. Chapter 2 does not add a depth field; it extends `h` downward into negative values and widens the world rectangle. The renderer, the VM, and the editor are unaware of the difference.

### 3.2 Elevation

- The world is a set of height layers over an `(x, y)` rectangle. Not every `(x, y, h)` has a cell.
- Movement between adjacent cells at different heights is legal only when the step is exactly one level. `move()` refuses a two-level drop and refuses stepping up.
- `ascend()` and `descend()` move vertically at the same `(x, y)`.
- Chapter 1 island: heights 0 to 2, mostly 0, with a raised rim.
- Chapter 2 trench: heights 0 down to roughly -8, descending away from the entry ledge, with `vent` tiles that read as locally warm.

### 3.3 Irrigation and growth

One growth tick per simulation tick, in this order:

1. Every cell's `moisture` decays by 1 if it is above the crop's `waterNeed`.
2. Every planted cell with `growth < growthSteps` and `moisture >= waterNeed` advances `growth` by 1.
3. Rule events fire, in binding order, with the contexts in section 2.2.

A crop is harvestable when `growth >= growthSteps`. Over-watering a cell is a no-op; the cost of a mistake is capped. Under-watering is the real cost: growth stalls and the crop stays immature.

### 3.4 Resources and unlocks

- **Credits** are earned by harvesting and spent on seeds and upgrades.
- Upgrades are the progression spine: yield multiplier, growth speed, movement budget, inventory capacity, sensing radius (Chapter 2), and current resistance (Chapter 2).
- Upgrades are gated behind harvested totals, not behind a currency sink alone, so a slow player advances at the same rate as a fast one.

## 4. Chapter 1: Sky Isles

A small floating island above a sea. The constraint is space. Every tile the Mote can reach is a tile it cannot use twice, and the rim is rock.

- 22x22 island footprint, heights 0 to 2, rock rim, water below.
- No failure state. A blocked program costs nothing but time.
- 10 tutorial tasks, then free play.
- Water is an obstacle: `move` into it returns `False` and fires the `blocked` event.

## 5. Chapter 1 tutorial tasks

One programming concept per task. Each is gated on an observable program behaviour, never on a Next button.

| # | Task name | Concept introduced | Observable completion condition |
|---|-----------|--------------------|----------------------------------|
| 1 | Say something | Variables and `report` | `report()` output contains the player's chosen text |
| 2 | Look before you leap | `sense` and `if` | The program branched on a `sense` result and the correct branch ran |
| 3 | Do not stop | `while` | The Mote moved at least 10 tiles from a `while` loop |
| 4 | Count your steps | Loop counters and budget | A `while` loop terminated on a counter condition without hitting the abort cap |
| 5 | A fixed number of times | `for` over `range` | A `for` loop completed its full range and the tally matched the range size |
| 6 | Name the motion | `def` and `return` | A user-defined function was called at least three times and returned a value |
| 7 | One farm, one function | Composition | A function containing a loop called another function that also loops |
| 8 | Do not carry everything | Dicts and `inventory()` | The program branched on an `inventory()` key and skipped a plant when full |
| 9 | Let the rules run | `set_rule` | A `harvest` rule fired at least three times with no top-level loop in the program |
| 10 | The tight island | Optimisation | A full farm cycle completes in fewer operations than the naive version by at least 40% |

Task 9 is the pivot of the game. Up to that point the player writes a main loop. After it, the game asks whether they understand the difference between a program and a system.

## 6. Chapter 2: Deep Trench

The same game with the information model inverted.

| Change | Effect |
|--------|--------|
| World | A trench descending from a ledge, `h` from 0 down to about -8 |
| Fog | A radius around the Mote. `sense` returns `UNKNOWN` outside it. |
| Current | A per-tick drift in one direction that varies by depth band. Applied inside `move`. |
| Water | The resource. Water cells are the space to be claimed; `till()` converts them to plantable ground. |
| Crops | `lantern_pearl` and `glowcap`, both with `glow` palettes, plus `glasswort` unlocked from the wetter tiles |
| Terrain | `vent` as a locally warm tile that dries adjacent crops faster, `ledge` as an impassable wall |
| Task set | Mapping, not farming. The player first surveys, then exploits the survey. |

Why the inversion is the point: in Chapter 1 the player is optimising a known space and running out of it. In Chapter 2 the player cannot run out of space and cannot trust what they have not seen. The optimal Chapter 1 program is a maximum-throughput farmer. The optimal Chapter 2 program is a surveyor that farms cheaply what it already mapped, because every un-sensed tile is an assumption.

The design dependency is that the same API serves both. `sense`, `move`, `till`, `plant`, `harvest`, `position` are unchanged. Only `descend` and `ascend` become useful, and sensing becomes a cost rather than a convenience.

## 7. Tone and palette

### 7.1 Tone

Quiet, procedural, slightly lonely. The world does not talk to the player. The Mote does not have a face. The narration is field notes: short, observational, technical, present tense. Nothing winks at the camera, and nothing explains the joke.

The arc of the fiction is inversion, matching the arc of the mechanics: Chapter 1 is a small bright thing above a lot of emptiness, Chapter 2 is a large dark thing with a few small bright things in it.

### 7.2 Palette direction

Flat colours, low-poly facets, no gradients except one additive glow pass. All sprites are drawn procedurally at boot, so the palette is enforced by hex constants in code rather than by asset files.

Chapter 1, Sky Isles:

| Role | Hex |
|------|-----|
| Sky, upper | `#cfe3ee` |
| Sky, lower | `#9fc2d4` |
| Sea, deep | `#2a4d63` |
| Sea, surface | `#4a7d95` |
| Soil | `#5b4636` |
| Tilled soil | `#3f3125` |
| Grass | `#6f8f5a` |
| Rock, top / left / right | `#7b8087` / `#5f646a` / `#494d52` |
| Crop body / tip | `#3f7d4e` / `#8fd694` |
| UI panel / border | `#1b2026` / `#3b4650` |
| UI text / accent | `#e6edf3` / `#f2c14e` |

Chapter 2, Deep Trench:

| Role | Hex |
|------|-----|
| Water, deep | `#0a1a26` |
| Water, mid | `#12324a` |
| Trench floor | `#1b2b33` |
| Vent glow | `#ff7a3d` |
| Crop glow, pearl | `#b6f2ff` |
| Crop glow, cap | `#c58bff` |
| Rock in low light | `#3a434a` |
| UI panel / accent | `#10161c` / `#4fd6c4` |

Two rules hold across both: a material is never more than three shades of its own hue, and glow is the only additive element, so bioluminescence reads as the only light source in Chapter 2.

## 8. Cross-references

- Product scope, competitive landscape, legal boundary: [PRD.md](./PRD.md)
- Module map, VM internals, worker protocol, render math: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Phase order and acceptance criteria: [ROADMAP.md](./ROADMAP.md)
