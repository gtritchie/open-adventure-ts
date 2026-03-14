# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeScript port of [Open Adventure](https://gitlab.com/esr/open-adventure) (Colossal Cave Adventure 2.5). The goal is **byte-identical gameplay output** compared to the original C version. All 107 regression tests validate this by comparing stdout byte-for-byte against expected output.

The source code for the original Open Adventure is found in `../open-adventure` (relative to the project root).

## Commands

```bash
pnpm build                          # Compile TypeScript to dist/
pnpm typecheck                      # Type-check only (tsc --noEmit)
pnpm generate                       # Regenerate dungeon.generated.ts from adventure.yaml
pnpm generate:check                 # Verify generated data is up to date
pnpm test                           # Unit tests (vitest)
pnpm test:regress                   # All 107 regression tests (TAP output)
pnpm test:regress --test pitfall    # Single regression test by name
pnpm test:regress --update          # Regenerate .chk files from current output
pnpm generate:graph                 # Generate Graphviz DOT of dungeon map (stdout)
pnpm play                           # Play interactively
```

## Architecture

### Code Generation Pipeline

`adventure.yaml` → `scripts/make-dungeon.ts` → `src/dungeon.generated.ts`

The YAML file defines all game data (locations, objects, verbs, travel tables, hints). The generator produces TypeScript arrays, enums, and constants. **Never edit `dungeon.generated.ts` directly** — modify `adventure.yaml` and run `pnpm generate`.

### C-to-TypeScript Source Mapping

| C source | TypeScript |
|----------|-----------|
| `main.c` | `main.ts` (CLI entry) + `game-loop.ts` (turn processing) |
| `actions.c` | `actions.ts` (all verb handlers) |
| `move.c` | `movement.ts` (travel table lookup) |
| `dwarves.c` | `dwarves.ts` (dwarf AI, pirate logic) |
| `saveresume.c` | `save.ts` (JSON save/restore) |
| `misc.c` | `format.ts`, `vocabulary.ts`, `input.ts` |
| `init.c` | `init.ts` (state initialization) |
| `make_dungeon.py` | `scripts/make-dungeon.ts` |
| `make_graph.py` | `scripts/make-graph.ts` |

### Dependency Injection Pattern

The game loop uses a `GameLoopDeps` interface to avoid circular imports. `main.ts` wires up all adapters that normalize parameter orders between modules. When modifying function signatures in core modules, update the corresponding adapter in `main.ts`.

### Game Loop State Machine

`game-loop.ts` drives turns via phase codes (`GO_MOVE`, `GO_TOP`, `GO_CLEAROBJ`, `GO_CHECKHINT`, `GO_WORD2`, `GO_UNKNOWN`, `GO_DWARFWAKE`, `GO_TERMINATE`). Actions return a `PhaseCode` to control flow.

### I/O Abstraction

`GameIO` interface in `io.ts` has two implementations:
- `ConsoleIO` — production (handles TTY vs piped input differently)
- `ScriptIO` — test harness that captures output to a buffer

### Object Linking

Objects at locations use a linked-list via the `link[]` array matching C's scheme. Forward link: `link[i]`, backward: `link[NOBJECTS + i]`, head per location: `locs[loc].atloc`.

## Regression Tests

Tests live in `tests/` as paired files: `name.log` (input script) + `name.chk` (expected output). The runner feeds `.log` as stdin and diffs stdout against `.chk`.

Some tests are chained (e.g., `saveresume.1` through `saveresume.4`) and must run in order — test 1 creates a save file that test 2 reads.

The test runner auto-generates save file fixtures via `src/cheat.ts` before running.

## Cross-Comparison and Fuzz Testing

These scripts require the C `advent` binary built in `../open-adventure`. They compare TS output directly against the C binary (not `.chk` files), catching drift and edge-case divergences. **Run these after any gameplay change**, especially changes to action handlers, movement, or output formatting.

```bash
# Cross-compare: runs every .log test against both C and TS, diffs stdout
npx tsx scripts/cross-compare.ts              # All tests
npx tsx scripts/cross-compare.ts --test NAME  # Single test
npx tsx scripts/cross-compare.ts --verbose    # Show diffs on failure

# Fuzz testing: random command sequences compared C vs TS
npx tsx scripts/fuzz-compare.ts                    # 100 runs, 50 commands each
npx tsx scripts/fuzz-compare.ts --runs 500         # More runs
npx tsx scripts/fuzz-compare.ts --length 200       # Longer command sequences
npx tsx scripts/fuzz-compare.ts --seed 42          # Start from specific seed
npx tsx scripts/fuzz-compare.ts --verbose          # Show diffs on failure
npx tsx scripts/fuzz-compare.ts --repro 42         # Reproduce a single failing seed
```

Both produce TAP output. The fuzz tester uses deterministic seeds so failures are fully reproducible — use `--repro <seed>` to replay.

## Key Constraints

- **Byte-identical output**: Any change to game logic or formatting must preserve exact output matching the C version. Run `pnpm test:regress` after any gameplay change.
- **Deterministic RNG**: `rng.ts` implements an LCG with parameters `a=1093, c=221587, m=1048576` matching the C original exactly. Do not change.
- **Zero runtime dependencies**: All deps are dev-only. The compiled game has no external dependencies.
- **Save format version 31**: JSON-based (unlike C's binary format). Includes magic string and endian canary for compatibility.
