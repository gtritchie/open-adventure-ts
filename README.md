# Open Adventure (TypeScript)

A TypeScript/Node.js port of [Open Adventure](https://gitlab.com/esr/open-adventure), which is itself a forward-port of Colossal Cave Adventure 2.5 (Crowther & Woods, 1995). The goal is byte-identical gameplay output compared to the C original.

## Prerequisites

- Node.js 24 or later
- pnpm

## Getting Started

```bash
# Install dependencies
pnpm install

# Play the game
pnpm play

# Or equivalently:
npx tsx src/main.ts
```

### Command-line options

```
-o        Old-style mode (no prompt, no stripping of articles)
-r FILE   Resume from a saved game file
-l FILE   Log input to a file
```

You can also pipe input from a file:

```bash
npx tsx src/main.ts < script.txt
```

## Development

```bash
# Type-check
pnpm typecheck

# Run unit tests
pnpm test

# Run all 107 regression tests (TAP output)
pnpm test:regress

# Run a single regression test
npx tsx scripts/regress.ts --test pitfall

# Regenerate dungeon data from adventure.yaml
pnpm generate

# Verify generated dungeon data is up to date
pnpm generate:check
```

## Project Structure

```
src/
  main.ts              CLI entry point
  types.ts             Interfaces, enums, constants
  dungeon.ts           Re-exports from generated data
  dungeon.generated.ts Generated game data (from adventure.yaml)
  actions.ts           All verb action handlers
  game-loop.ts         Main game loop and phase dispatch
  movement.ts          Travel table lookup and player movement
  dwarves.ts           Dwarf AI and pirate logic
  input.ts             Input handling, yes/no prompts
  io.ts                GameIO interface, ConsoleIO, ScriptIO
  format.ts            Message formatting (speak, rspeak, pspeak)
  vocabulary.ts        Word lookup
  object-manipulation.ts  Carry, drop, move, destroy
  init.ts              Game state initialization
  save.ts              Save/resume (JSON format)
  score.ts             Scoring and endgame
  cheat.ts             Test utility for generating save files
  rng.ts               Deterministic LCG PRNG
scripts/
  make-dungeon.ts      Code generator (reads adventure.yaml)
  regress.ts           Regression test runner
tests/
  *.log                Test input scripts
  *.chk                Expected output (compared byte-for-byte)
```

## License

BSD-2-Clause, following the original.
