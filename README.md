# Open Adventure (TypeScript)

A TypeScript/Node.js port of [Open Adventure](https://gitlab.com/esr/open-adventure), which is itself a forward-port of Colossal Cave Adventure 2.5 (Crowther & Woods, 1995). The goal is byte-identical gameplay output compared to the C original.

## Packages

This repository is a pnpm workspace with two packages:

- **`@open-adventure/core`** — platform-agnostic game engine. Zero `node:*` imports (lint-enforced). Exports a host-driven `runGame()` entry point, factories, and pure save helpers (`serializeGame`, `deserializeGame`, `summarizeSave`). Browser projects can depend on this package directly.
- **`@open-adventure/cli`** — Node.js CLI wrapper. Provides `ConsoleIO` (terminal I/O via `node:readline`) and `NodeFileStorage` (file-based saves), wires them into `runGame`, and exposes the `advent` binary.

## Prerequisites

- Node.js 24 or later
- pnpm (the repo is a pnpm workspace)

## Getting Started

```bash
pnpm install    # install workspace dependencies
pnpm play       # play the game in the terminal
```

### Command-line options

```
-o        Old-style mode (no prompt, no stripping of articles)
-r FILE   Resume from a saved game file
-l FILE   Log input to a file
-d        Enable debug output (random-trace to stderr)
```

You can also pipe input from a file:

```bash
pnpm play < script.txt
```

## Hosting `@open-adventure/core` from a browser

A browser host implements two small interfaces and calls `runGame`:

```typescript
import { runGame, type GameIO, type SaveStorage } from "@open-adventure/core";

class BrowserIO implements GameIO {
  readonly echoInput = false;
  print(msg: string): void { /* append to a DOM log */ }
  async readline(prompt: string): Promise<string | null> {
    /* return a Promise that resolves when the user submits a line */
  }
}

class LocalStorageStorage implements SaveStorage {
  async read(name: string): Promise<string | null> {
    return localStorage.getItem(`adventure:${name}`);
  }
  async write(name: string, data: string): Promise<void> {
    localStorage.setItem(`adventure:${name}`, data);
  }
}

const exitCode = await runGame({
  io: new BrowserIO(),
  storage: new LocalStorageStorage(),
});
```

`runGame` returns when the game ends (player quits, dwarf kill, normal endgame). Hosts can also use the pure helpers directly to build save-picker UIs:

```typescript
import { serializeGame, deserializeGame, summarizeSave } from "@open-adventure/core";

const json = serializeGame(state);                  // → JSON string
const result = deserializeGame(json);               // → { ok, state } | { ok: false, reason, ... }
const summary = summarizeSave(json);                // → location/score/inventory/phase metadata
```

## Development

```bash
pnpm build              # compile both packages to packages/*/dist
pnpm typecheck          # type-check both packages and root scripts
pnpm test               # run unit tests (vitest)
pnpm lint               # ESLint (enforces no node:* imports in core)

pnpm test:regress       # run all 107 regression tests (TAP output)
npx tsx scripts/regress.ts --test pitfall   # run a single regression test

pnpm generate           # regenerate dungeon.generated.ts from adventure.yaml
pnpm generate:check     # verify generated dungeon data is up to date
pnpm generate:graph     # Graphviz DOT of the dungeon map (stdout)
```

The development scripts that consume `@open-adventure/core` (`typecheck`, `test`, `test:regress`, `play`) automatically build core first via `pnpm build:core` so a clean checkout works without a manual setup step.

## Cross-checking against the C reference

These scripts compare TypeScript output directly against the original C `advent` binary built in `../open-adventure`. Run them after any gameplay change.

```bash
# Diff every regression .log against both implementations
npx tsx scripts/cross-compare.ts

# Random command sequences, deterministic seeds for reproducibility
npx tsx scripts/fuzz-compare.ts
```

## Project Structure

```
packages/
  core/                              @open-adventure/core (browser-portable)
    adventure.yaml                   Game data source
    scripts/
      make-dungeon.ts                Code generator (reads adventure.yaml)
      make-graph.ts                  Graphviz DOT generator
    src/
      index.ts                       Public API barrel
      types.ts                       Interfaces, enums, constants
      dungeon.ts                     Re-exports from generated data
      dungeon.generated.ts           Generated game data
      run-game.ts                    runGame() entry point
      deps.ts                        GameLoopDeps wiring
      game-loop.ts                   Main game loop and phase dispatch
      actions.ts                     All verb action handlers
      movement.ts                    Travel table lookup and player movement
      dwarves.ts                     Dwarf AI and pirate logic
      input.ts                       Input handling, yes/no prompts
      format.ts                      Message formatting (speak, rspeak, pspeak)
      vocabulary.ts                  Word lookup
      object-manipulation.ts         Carry, drop, move, juggle
      init.ts                        Game state initialization
      save.ts                        In-game suspend/resume verbs
      save-pure.ts                   Pure save helpers + savefile + isValid
      score.ts                       Scoring (computeScore + terminate)
      rng.ts                         Deterministic LCG PRNG
      test-io.ts                     ScriptIO (in-memory GameIO for tests)
  cli/                               @open-adventure/cli (Node.js)
    src/
      main.ts                        CLI entry (parses argv, calls runGame)
      console-io.ts                  ConsoleIO (node:readline)
      node-storage.ts                NodeFileStorage (SaveStorage on node:fs)
      cheat.ts                       Test fixture generator
scripts/
  regress.ts                         Regression test runner
  cross-compare.ts                   Diff TS output against the C reference binary
  fuzz-compare.ts                    Random-input comparison against the C reference binary
tests/
  *.log / *.chk                      Regression test inputs and expected outputs
maps/                                Pre-rendered SVG dungeon maps
```

## License

BSD-2-Clause, following the original.
