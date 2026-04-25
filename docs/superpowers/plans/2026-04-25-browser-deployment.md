# Browser Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Open Adventure TypeScript port into a pnpm monorepo with a `core` package (zero `node:*` imports, ESM-only, browser-consumable) and a `cli` package (Node CLI wrapper), preserving byte-identical terminal output across all 107 regression tests.

**Architecture:** Two phases. Phase 1 (Tasks 1–6) makes behavioral changes inside the existing `src/` tree: replace direct `process.*` calls with portable abstractions, refactor `save.ts` to expose pure helpers, introduce a `SaveStorage` adapter, and extract a `runGame` entry point. Phase 2 (Tasks 7–14) splits files into `packages/core` and `packages/cli`, wires up the workspace, adds the public API barrel, and locks in the boundary with a lint rule and a smoke test.

**Tech Stack:** TypeScript 5.7, ESM (Node 16 module), pnpm workspaces, Vitest for unit tests, existing `tests/regress.ts` runner for byte-identical output verification.

**Spec reference:** `docs/superpowers/specs/2026-04-25-browser-deployment-design.md`

---

## File Structure (final state after Task 14)

```
open-adventure-ts/
├── pnpm-workspace.yaml                   # NEW
├── package.json                          # Updated: workspace scripts only
├── tsconfig.base.json                    # NEW: shared compiler options
├── tsconfig.json                         # Updated: references core+cli
├── eslint.config.js                      # NEW: no-restricted-imports for core
├── vitest.config.ts                      # Updated: include packages/*/src/**/*.test.ts
├── tests/                                # Unchanged location (regression .log/.chk)
├── maps/                                 # Unchanged
├── scripts/
│   ├── regress.ts                        # Updated paths
│   ├── cross-compare.ts                  # Updated paths
│   └── fuzz-compare.ts                   # Updated paths
├── packages/
│   ├── core/
│   │   ├── package.json                  # NEW: @open-adventure/core
│   │   ├── tsconfig.json                 # NEW
│   │   ├── adventure.yaml                # MOVED from root
│   │   ├── scripts/
│   │   │   ├── make-dungeon.ts           # MOVED from scripts/
│   │   │   └── make-graph.ts             # MOVED from scripts/
│   │   └── src/
│   │       ├── index.ts                  # NEW: public API barrel
│   │       ├── dungeon.generated.ts      # MOVED
│   │       ├── dungeon.ts                # MOVED
│   │       ├── types.ts                  # MOVED + Settings rename, debugCallback
│   │       ├── init.ts                   # MOVED + io threaded in
│   │       ├── game-loop.ts              # MOVED
│   │       ├── actions.ts                # MOVED + storage threading
│   │       ├── movement.ts               # MOVED
│   │       ├── dwarves.ts                # MOVED
│   │       ├── format.ts                 # MOVED
│   │       ├── vocabulary.ts             # MOVED
│   │       ├── input.ts                  # MOVED + TerminateError replaces process.exit
│   │       ├── object-manipulation.ts    # MOVED
│   │       ├── rng.ts                    # MOVED + debugCallback replaces stderr
│   │       ├── score.ts                  # MOVED
│   │       ├── save.ts                   # MOVED + refactored
│   │       ├── save-pure.ts              # NEW: serializeGame, deserializeGame, summarizeSave
│   │       ├── run-game.ts               # NEW: runGame entry point
│   │       ├── test-io.ts                # NEW: ScriptIO promoted from io.ts
│   │       └── __tests__/
│   │           ├── save-pure.test.ts     # NEW
│   │           └── run-game.smoke.test.ts # NEW
│   └── cli/
│       ├── package.json                  # NEW: @open-adventure/cli
│       ├── tsconfig.json                 # NEW
│       └── src/
│           ├── main.ts                   # MOVED + slimmed to wire deps
│           ├── console-io.ts             # NEW: ConsoleIO split from io.ts
│           ├── node-storage.ts           # NEW: NodeFileStorage
│           ├── cheat.ts                  # MOVED from src/
│           └── __tests__/
│               └── node-storage.test.ts  # NEW
```

---

## Phase 1: Behavioral changes within current `src/`

### Task 1: Replace process.exit and direct stdio in core modules

This is the foundation for portability. We swap `process.exit(0)` for `throw new TerminateError(0)` (the established pattern), route the `oldstyle` "Initialising..." message through `io.print`, and route the `--debug` random-trace through a callback.

**Files:**
- Modify: `src/types.ts` (extend `Settings` interface)
- Modify: `src/input.ts` (lines 73, 112)
- Modify: `src/save.ts` (lines 92, 174)
- Modify: `src/init.ts` (line 151 + signature change)
- Modify: `src/rng.ts` (line 16)
- Modify: `src/main.ts` (call site for `initialise`)
- Modify: `src/cheat.ts` (call site for `initialise`)

- [ ] **Step 1: Extend Settings to carry the new debug callback**

In `src/types.ts`, add a field to the `Settings` interface (around line 323):

```typescript
export interface Settings {
  logfp: ((line: string) => void) | null;
  oldstyle: boolean;
  prompt: boolean;
  scriptLines: string[] | null;
  scriptIndex: number;
  debug: number;
  debugCallback: ((line: string) => void) | null;  // NEW
}
```

Update `createSettings()` in `src/init.ts` to initialise `debugCallback: null`.

- [ ] **Step 2: Replace process.exit in input.ts**

In `src/input.ts`, replace both occurrences:

```typescript
// Line 73 (silentYesOrNo) — was: process.exit(0);
throw new TerminateError(0);

// Line 112 (yesOrNo) — was: process.exit(0);
throw new TerminateError(0);
```

Add `TerminateError` to the existing import from `./types.js`.

- [ ] **Step 3: Replace process.exit in save.ts**

In `src/save.ts`, replace both occurrences:

```typescript
// Line ~92 (suspend, after successful save) — was: process.exit(0);
throw new TerminateError(0);

// Line ~174 (restore, on tampering) — was: process.exit(0);
throw new TerminateError(0);
```

Add `TerminateError` to the import from `./types.js`.

- [ ] **Step 4: Route the oldstyle init message through io.print**

In `src/init.ts`, change the `initialise()` signature to accept `io`:

```typescript
import type { GameState, GameIO, Settings } from "./types.js";

export function initialise(
  game: GameState,
  settings: Settings,
  io: GameIO,                // NEW
): number {
  if (settings.oldstyle) {
    io.print("Initialising...\n");   // was: process.stdout.write(...)
  }
  // ...rest unchanged
}
```

In `src/main.ts`, the call site is currently `const seedval = initialise(gameState, settings);`. Update it to `const seedval = initialise(gameState, settings, io);` — but `io` is constructed *after* `initialise` in current `main.ts`. Move IO construction up so it precedes the `initialise` call.

In `src/cheat.ts` (line 44), the call site is `initialise(game, settings);`. The cheat utility never produces user-facing output from `initialise()` (it doesn't run in `oldstyle` mode), so a discard IO is appropriate. Use an inline `GameIO` literal — not `ScriptIO`. `ScriptIO` is a test-capture class; using it as a discard sink is misleading, and once Task 9 promotes `ScriptIO` into core's `test-io.ts`, having a CLI utility import a test-only export is a layering violation.

```typescript
import type { GameIO } from "./types.js";

// ...
const io: GameIO = {
  print(): void { /* discard */ },
  async readline(): Promise<string | null> { return null; },
  echoInput: false,
};
initialise(game, settings, io);
```

- [ ] **Step 5: Route the rng debug log through debugCallback**

In `src/rng.ts`, replace line 16:

```typescript
function getNextLcgValue(game: GameState, settings: Settings): number {
  const oldX = game.lcgX;
  game.lcgX = (LCG_A * game.lcgX + LCG_C) % LCG_M;
  if (settings.debug) {
    settings.debugCallback?.(`# random ${oldX}\n`);   // was: process.stderr.write(...)
  }
  return oldX;
}
```

- [ ] **Step 6: Wire CLI debug callback to stderr (only when -d is passed)**

In `src/main.ts`, fold the `debugCallback` assignment into the existing `if (vals.d)` block so the field stays `null` on non-debug runs (matching its `createSettings()` default and avoiding a misleading non-null state that consumers might check):

```typescript
if (vals.d) {
  settings.debug += 1;
  settings.debugCallback = (msg: string): void => {
    process.stderr.write(msg);
  };
}
```

This preserves CLI behavior exactly: today's `process.stderr.write` in `rng.ts` was guarded by `if (settings.debug)`, so it only fired with `-d`. The new path is identical.

- [ ] **Step 7: Run regression tests**

```bash
pnpm test:regress
```

Expected: all 107 tests pass with `# ok`. Any tampering or save-related test that previously hit `process.exit(0)` should now hit `TerminateError` and be caught by `main.ts`'s existing handler — output identical.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/input.ts src/save.ts src/init.ts src/rng.ts src/main.ts src/cheat.ts
git commit -m "Replace process.exit and direct stdio with portable abstractions"
```

---

### Task 2: Add SaveStorage interface and refactor suspend/resume to use it

Decouple save/restore from `node:fs`. Define a small `SaveStorage` interface, route `suspend` and `resume` through it. The CLI keeps file-based behavior via a thin adapter (added in Task 5).

**Files:**
- Modify: `src/types.ts` (add `SaveStorage` interface, add `storage` to `Settings`)
- Modify: `src/save.ts` (rewrite `suspend` and `resume` to use storage)
- Modify: `src/actions.ts` (no signature change — `storage` is read from `settings`)

- [ ] **Step 1: Define SaveStorage in types.ts**

Add to `src/types.ts`:

```typescript
export interface SaveStorage {
  read(name: string): Promise<string | null>;
  write(name: string, data: string): Promise<void>;
  list?(): Promise<string[]>;
  delete?(name: string): Promise<void>;
}
```

Add to the `Settings` interface:

```typescript
export interface Settings {
  // ...existing fields...
  storage: SaveStorage | null;
}
```

Update `createSettings()` in `src/init.ts` to initialise `storage: null`. Note: the CLI must set this before any save/restore call — if `null` at use time, throw a clear error.

- [ ] **Step 2: Rewrite suspend() to use settings.storage**

In `src/save.ts`, replace the file I/O block in `suspend` (currently `writeFileSync(trimmed, JSON.stringify(save))`):

```typescript
export async function suspend(
  game: GameState,
  settings: Settings,
  io: GameIO,
): Promise<PhaseCode> {
  rspeak(game, io, Msg.SUSPEND_WARNING);
  if (
    !(await yesOrNo(
      game, io, settings,
      arbitraryMessages[Msg.THIS_ACCEPTABLE]!,
      arbitraryMessages[Msg.OK_MAN]!,
      arbitraryMessages[Msg.OK_MAN]!,
    ))
  ) {
    return PhaseCode.GO_CLEAROBJ;
  }
  game.saved = game.saved + 5;

  if (settings.storage === null) {
    throw new Error("suspend(): settings.storage not configured");
  }

  for (;;) {
    const name = await io.readline("\nFile name: ");
    if (name === null) return PhaseCode.GO_TOP;
    const trimmed = name.trim();
    if (trimmed.length === 0) return PhaseCode.GO_TOP;
    try {
      await settings.storage.write(trimmed, JSON.stringify(savefile(game)));
      break;
    } catch {
      io.print(`Can't open file ${trimmed}, try again.\n`);
    }
  }

  rspeak(game, io, Msg.RESUME_HELP);
  throw new TerminateError(0);
}
```

Remove the `import { readFileSync, writeFileSync } from "node:fs";` from `save.ts` — it's no longer used (resume rewrite below also drops it).

- [ ] **Step 3: Rewrite resume() to use settings.storage**

```typescript
export async function resume(
  game: GameState,
  settings: Settings,
  io: GameIO,
): Promise<PhaseCode> {
  if (
    game.loc !== Location.LOC_START ||
    game.locs[Location.LOC_START]!.abbrev !== 1
  ) {
    rspeak(game, io, Msg.RESUME_ABANDON);
    if (
      !(await yesOrNo(
        game, io, settings,
        arbitraryMessages[Msg.THIS_ACCEPTABLE]!,
        arbitraryMessages[Msg.OK_MAN]!,
        arbitraryMessages[Msg.OK_MAN]!,
      ))
    ) {
      return PhaseCode.GO_CLEAROBJ;
    }
  }

  if (settings.storage === null) {
    throw new Error("resume(): settings.storage not configured");
  }

  for (;;) {
    const name = await io.readline("\nFile name: ");
    if (name === null) return PhaseCode.GO_TOP;
    const trimmed = name.trim();
    if (trimmed.length === 0) return PhaseCode.GO_TOP;
    const data = await settings.storage.read(trimmed);
    if (data === null) {
      io.print(`Can't open file ${trimmed}, try again.\n`);
      continue;
    }
    let save: SaveFile;
    try {
      save = JSON.parse(data) as SaveFile;
    } catch {
      rspeak(game, io, Msg.BAD_SAVE);
      return PhaseCode.GO_TOP;
    }
    return restore(save, game, io);
  }
}
```

- [ ] **Step 4: Leave restoreFromFile() alone for now**

`restoreFromFile()` still uses `readFileSync`. It's only called from `main.ts` for the `-r` flag. We'll move it to the CLI side in Task 7. For now, keep the import scoped:

```typescript
import { readFileSync } from "node:fs";

export function restoreFromFile(
  filepath: string,
  game: GameState,
  io: GameIO,
): PhaseCode {
  const data = readFileSync(filepath, "utf-8");
  const save = JSON.parse(data) as SaveFile;
  return restore(save, game, io);
}
```

(This is the only remaining `node:fs` usage in `save.ts` after this task.)

- [ ] **Step 5: Run regression tests**

```bash
pnpm test:regress
```

All 107 must pass. The save/resume test sequences (`saveresume.1`–`saveresume.4`, `badmagic`, `version_skew`, etc.) exercise this code path and prove the behavior is preserved.

This step will fail until Task 5 wires up `NodeFileStorage` — that's by design. Skip Step 5 here and run after Task 5.

Actually we need a temporary inline fix so this task ships green. Add to `src/main.ts` BEFORE `initialise()` is called:

```typescript
import { readFile, writeFile } from "node:fs/promises";

settings.storage = {
  async read(name) {
    try { return await readFile(name, "utf-8"); } catch { return null; }
  },
  async write(name, data) {
    await writeFile(name, data);
  },
};
```

This temporary inline storage will be replaced by `NodeFileStorage` in Task 5.

- [ ] **Step 6: Run regression tests with the temporary storage in place**

```bash
pnpm test:regress
```

Expected: all 107 pass.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/save.ts src/main.ts src/init.ts
git commit -m "Add SaveStorage interface; route suspend/resume through it"
```

---

### Task 3: Extract pure save helpers (serializeGame, deserializeGame)

`deserializeGame` returns a structured `RestoreResult` instead of calling `rspeak` and exiting. The in-game `restore()` keeps its existing message-emitting behavior but now delegates to `deserializeGame` for validation. This separation lets the future browser host build its own save UI.

**Files:**
- Create: `src/save-pure.ts`
- Modify: `src/types.ts` (add `RestoreResult` type)
- Modify: `src/save.ts` (refactor `restore()` to wrap `deserializeGame`)
- Create: `src/save-pure.test.ts`

- [ ] **Step 1: Add RestoreResult to types.ts**

```typescript
export type RestoreResult =
  | { ok: true; state: GameState }
  | { ok: false;
      reason: 'bad-json' | 'bad-magic' | 'version-skew' | 'tampering';
      saveVersion?: number;
      expectedVersion?: number;
      message: string };
```

- [ ] **Step 2: Write failing tests for deserializeGame**

Create `src/save-pure.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { serializeGame, deserializeGame } from "./save-pure.js";
import { createGameState } from "./init.js";

describe("serializeGame / deserializeGame", () => {
  it("round-trips a fresh game state", () => {
    const state = createGameState();
    const json = serializeGame(state);
    const result = deserializeGame(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.lcgX).toBe(state.lcgX);
      expect(result.state.loc).toBe(state.loc);
    }
  });

  it("rejects malformed JSON with bad-json reason", () => {
    const result = deserializeGame("{not json");
    expect(result).toMatchObject({ ok: false, reason: "bad-json" });
  });

  it("rejects bad magic", () => {
    const json = JSON.stringify({ magic: "wrong", version: 31, canary: 2317, game: createGameState() });
    const result = deserializeGame(json);
    expect(result).toMatchObject({ ok: false, reason: "bad-magic" });
  });

  it("rejects version skew with version numbers in result", () => {
    const json = JSON.stringify({ magic: "open-adventure\n", version: 30, canary: 2317, game: createGameState() });
    const result = deserializeGame(json);
    expect(result).toMatchObject({ ok: false, reason: "version-skew", saveVersion: 30, expectedVersion: 31 });
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
pnpm test src/save-pure.test.ts
```

Expected: FAIL — `Cannot find module ./save-pure.js`.

- [ ] **Step 4: Implement save-pure.ts**

```typescript
/*
 * Pure save/restore helpers — no IO, no exits.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import type { GameState, SaveFile, RestoreResult } from "./types.js";
import { ADVENT_MAGIC, ENDIAN_MAGIC, SAVE_VERSION } from "./types.js";
import { isValid, savefile } from "./save.js";

export function serializeGame(state: GameState): string {
  return JSON.stringify(savefile(state));
}

export function deserializeGame(json: string): RestoreResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: "bad-json", message: "Save file is not valid JSON." };
  }
  const save = raw as SaveFile;
  if (save.magic !== ADVENT_MAGIC || save.canary !== ENDIAN_MAGIC) {
    return { ok: false, reason: "bad-magic", message: "Save file is not an Open Adventure save." };
  }
  if (save.version !== SAVE_VERSION) {
    return {
      ok: false,
      reason: "version-skew",
      saveVersion: save.version,
      expectedVersion: SAVE_VERSION,
      message: `Save was version ${save.version}; expected ${SAVE_VERSION}.`,
    };
  }
  if (!isValid(save.game)) {
    return { ok: false, reason: "tampering", message: "Save file failed integrity check." };
  }
  return { ok: true, state: save.game };
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
pnpm test src/save-pure.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Refactor restore() in save.ts to delegate to deserializeGame**

`restore()` (currently in `save.ts`) keeps its responsibility to emit `rspeak` messages, but defers validation to `deserializeGame`:

```typescript
export function restore(
  save: SaveFile,
  game: GameState,
  io: GameIO,
): PhaseCode {
  const json = JSON.stringify(save);  // we already have the SaveFile object
  const result = deserializeGame(json);
  if (result.ok) {
    Object.assign(game, result.state);
    return PhaseCode.GO_TOP;
  }
  switch (result.reason) {
    case "bad-magic":
    case "bad-json":
      rspeak(game, io, Msg.BAD_SAVE);
      break;
    case "version-skew":
      rspeak(
        game, io, Msg.VERSION_SKEW,
        Math.trunc(result.saveVersion! / 10),
        result.saveVersion! % 10,
        Math.trunc(result.expectedVersion! / 10),
        result.expectedVersion! % 10,
      );
      break;
    case "tampering":
      rspeak(game, io, Msg.SAVE_TAMPERING);
      throw new TerminateError(0);
  }
  return PhaseCode.GO_TOP;
}
```

Add the import: `import { deserializeGame } from "./save-pure.js";`

- [ ] **Step 7: Run regression tests**

```bash
pnpm test:regress
```

All 107 must pass — `badmagic`, `cheat_savetamper`, and any version-skew test exercise this path.

- [ ] **Step 8: Commit**

```bash
git add src/save-pure.ts src/save-pure.test.ts src/types.ts src/save.ts
git commit -m "Extract pure save helpers (serializeGame, deserializeGame)"
```

---

### Task 4: Add summarizeSave for save-list UIs

A pure helper that returns display-ready metadata derived from `GameState`. Browser hosts use this to render a save picker without importing core internals.

**Files:**
- Modify: `src/save-pure.ts` (add `summarizeSave`)
- Modify: `src/types.ts` (add `SaveSummary` type)
- Modify: `src/score.ts` (extract `computeScore`)
- Create: `src/save-summary.test.ts`

- [ ] **Step 1: Add SaveSummary to types.ts**

```typescript
export interface SaveSummary {
  locationName: string;
  score: number;
  maxScore: number;
  treasuresFound: number;
  treasuresTotal: number;
  inventory: string[];
  phase: 'pre-cave' | 'in-cave' | 'closing' | 'closed';
  saveVersion: number;
  currentVersion: number;
  compatible: boolean;
}
```

- [ ] **Step 2: Write failing tests for summarizeSave**

Create `src/save-summary.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { serializeGame, summarizeSave } from "./save-pure.js";
import { createGameState } from "./init.js";

describe("summarizeSave", () => {
  it("returns a populated summary for a fresh game", () => {
    const state = createGameState();
    const summary = summarizeSave(state);
    if ("error" in summary) throw new Error(summary.error);
    expect(typeof summary.locationName).toBe("string");
    expect(summary.locationName.length).toBeGreaterThan(0);
    expect(summary.score).toBeGreaterThanOrEqual(0);
    expect(summary.maxScore).toBeGreaterThan(0);
    expect(summary.treasuresFound).toBe(0);
    expect(summary.treasuresTotal).toBeGreaterThan(0);
    expect(Array.isArray(summary.inventory)).toBe(true);
    expect(summary.phase).toBe("pre-cave");
    expect(summary.compatible).toBe(true);
  });

  it("accepts a JSON string", () => {
    const json = serializeGame(createGameState());
    const summary = summarizeSave(json);
    expect("error" in summary).toBe(false);
  });

  it("returns an error on bad JSON", () => {
    const summary = summarizeSave("{not json");
    expect(summary).toMatchObject({ error: expect.any(String) });
  });
});
```

- [ ] **Step 3: Extract computeScore from score.ts**

Today's `score.ts` has a `score()` function that mixes scoring math with a conditional `rspeak` side effect (when `mode === scoregame`) and writes to a module-level `mxscor`. Extract the pure math:

```typescript
// Add to src/score.ts:
export interface ScoreBreakdown {
  points: number;
  max: number;
}

export function computeScore(game: GameState, mode: Termination): ScoreBreakdown {
  let points = 0;
  let max = 0;

  // Treasures (lines 45-68 of current score())
  for (let i = 1; i <= NOBJECTS; i++) {
    if (!objects[i]!.isTreasure) continue;
    if (objects[i]!.inventory !== null) {
      let k = 12;
      if (i === Obj.CHEST) k = 14;
      if (i > Obj.CHEST) k = 16;
      if (!OBJECT_IS_STASHED(game, i) && !OBJECT_IS_NOTFOUND(game, i)) points += 2;
      if (
        game.objects[i]!.place === Location.LOC_BUILDING &&
        OBJECT_IS_FOUND(game, i)
      ) {
        points += k - 2;
      }
      max += k;
    }
  }

  // Survival, milestones, bonuses (lines 71-103)
  points += (NDEATHS - game.numdie) * 10;
  max += NDEATHS * 10;
  if (mode === Termination.endgame) points += 4;
  max += 4;
  if (game.dflag !== 0) points += 25;
  max += 25;
  if (game.closng) points += 25;
  max += 25;
  if (game.closed) {
    if (game.bonus === 0) points += 10;
    if (game.bonus === 1) points += 25;
    if (game.bonus === 2) points += 30;
    if (game.bonus === 3) points += 45;
  }
  max += 45;

  // Witt's End magazine (lines 106-109)
  if (game.objects[Obj.MAGAZINE]!.place === Location.LOC_WITTSEND) points += 1;
  max += 1;

  // Round it off
  points += 2;
  max += 2;

  // Deductions (lines 116-127)
  for (let i = 0; i < NHINTS; i++) {
    if (game.hints[i]!.used) points -= hints[i]!.penalty;
  }
  if (game.novice) points -= 5;
  if (game.clshnt) points -= 10;
  points = points - game.trnluz - game.saved;

  return { points, max };
}
```

Then refactor the existing `score()` to delegate:

```typescript
export function score(game, io, mode, rspeak, speak): number {
  const { points, max } = computeScore(game, mode);
  mxscor = max;  // keep module-level for terminate()'s subsequent reads
  if (mode === Termination.scoregame) {
    rspeak(io, game, Msg.GARNERED_POINTS, points, max, game.turns, game.turns);
  }
  return points;
}
```

The behavior of `score()` and `terminate()` is unchanged. `computeScore` is the pure version `summarizeSave` will call.

- [ ] **Step 4: Implement summarizeSave**

Add to `src/save-pure.ts`:

```typescript
import { CARRIED, Termination, SAVE_VERSION, OUTSIDE, type SaveSummary } from "./types.js";
import { locations, objects, conditions, NOBJECTS } from "./dungeon.js";
import { computeScore } from "./score.js";

export function summarizeSave(jsonOrState: string | GameState): SaveSummary | { error: string } {
  let state: GameState;
  let saveVersion = SAVE_VERSION;
  if (typeof jsonOrState === "string") {
    const result = deserializeGame(jsonOrState);
    if (!result.ok) {
      return { error: result.message };
    }
    state = result.state;
    // Re-parse to recover the version field (deserializeGame discards it on success).
    const raw = JSON.parse(jsonOrState) as { version?: number };
    if (typeof raw.version === "number") saveVersion = raw.version;
  } else {
    state = jsonOrState;
  }

  const loc = locations[state.loc];
  // LocationData has `description.small` (terse) and `description.big` (full).
  // Prefer the small/short form for picker UIs; fall back to big, then to a numeric label.
  const locationName =
    loc?.description.small ?? loc?.description.big ?? `loc#${state.loc}`;

  let treasuresTotal = 0;
  for (let i = 1; i <= NOBJECTS; i++) {
    if (objects[i]!.isTreasure) treasuresTotal++;
  }
  const treasuresFound = treasuresTotal - state.tally;

  const inventory: string[] = [];
  for (let i = 1; i <= NOBJECTS; i++) {
    if (state.objects[i]?.place === CARRIED) {
      const inv = objects[i]?.inventory;
      if (inv) inventory.push(inv);
    }
  }

  // Phase derived from condition bits, not enum ordering. Enum order isn't a
  // reliable indoor/outdoor signal — above-ground locations like LOC_VALLEY
  // and LOC_FOREST* sit after LOC_BUILDING in the generated enum.
  let phase: SaveSummary["phase"];
  if (state.closed) phase = "closed";
  else if (state.closng) phase = "closing";
  else if (OUTSIDE(conditions, state.loc)) phase = "pre-cave";
  else phase = "in-cave";

  const { points, max } = computeScore(state, Termination.endgame);

  return {
    locationName,
    score: points,
    maxScore: max,
    treasuresFound,
    treasuresTotal,
    inventory,
    phase,
    saveVersion,
    currentVersion: SAVE_VERSION,
    compatible: saveVersion === SAVE_VERSION,
  };
}
```

Verification notes:
- `LocationData` in `types.ts` defines `description.small` and `description.big` (both nullable strings). Code above uses these names directly.
- `OUTSIDE(conditions, loc)` (defined in `types.ts`) checks `COND_ABOVE` and `COND_FOREST` bits — true for any above-ground location, so it correctly classifies `LOC_VALLEY`, `LOC_FOREST*`, the building's exterior, etc. as `pre-cave`.
- `conditions` is the runtime conditions array exported from `dungeon.ts` (re-exported from `dungeon.generated.ts`). It's mutable in some game flows; reading it for a snapshot summary is safe because `summarizeSave` is invoked outside the game loop.

- [ ] **Step 5: Run tests to confirm they pass**

```bash
pnpm test src/save-summary.test.ts
```

Expected: 3 tests pass. If `computeScore` extraction proves non-trivial, see the note above.

- [ ] **Step 6: Run regression tests (no behavior change expected)**

```bash
pnpm test:regress
```

All 107 must pass.

- [ ] **Step 7: Commit**

```bash
git add src/save-pure.ts src/save-summary.test.ts src/types.ts src/score.ts
git commit -m "Add summarizeSave for save-list UIs"
```

---

### Task 5: Implement NodeFileStorage and replace inline storage in main.ts

Replace the temporary inline storage (added in Task 2) with a properly-named class. Lives in `src/` for now; moves to `cli/` in Task 10.

**Files:**
- Create: `src/node-storage.ts`
- Modify: `src/main.ts`
- Create: `src/node-storage.test.ts`

- [ ] **Step 1: Write failing tests for NodeFileStorage**

Create `src/node-storage.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeFileStorage } from "./node-storage.js";

describe("NodeFileStorage", () => {
  let dir: string;
  let storage: NodeFileStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "advent-store-"));
    storage = new NodeFileStorage();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads a file by path", async () => {
    const path = join(dir, "foo.adv");
    await storage.write(path, "hello");
    expect(await storage.read(path)).toBe("hello");
  });

  it("returns null when reading a missing file", async () => {
    expect(await storage.read(join(dir, "missing.adv"))).toBe(null);
  });

  it("delete removes the file", async () => {
    const path = join(dir, "doomed.adv");
    await storage.write(path, "data");
    await storage.delete!(path);
    expect(await storage.read(path)).toBe(null);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
pnpm test src/node-storage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement NodeFileStorage**

Create `src/node-storage.ts`:

```typescript
/*
 * NodeFileStorage — SaveStorage adapter backed by node:fs.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import type { SaveStorage } from "./types.js";

export class NodeFileStorage implements SaveStorage {
  async read(name: string): Promise<string | null> {
    try {
      return await readFile(name, "utf-8");
    } catch {
      return null;
    }
  }

  async write(name: string, data: string): Promise<void> {
    await writeFile(name, data);
  }

  async delete(name: string): Promise<void> {
    await unlink(name);
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm test src/node-storage.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Replace temporary inline storage in main.ts**

In `src/main.ts`, remove the inline storage object added in Task 2 and the `node:fs/promises` import that supported it. Replace with:

```typescript
import { NodeFileStorage } from "./node-storage.js";

// ...inside main() after createSettings():
settings.storage = new NodeFileStorage();
```

- [ ] **Step 6: Run regression tests**

```bash
pnpm test:regress
```

All 107 must pass.

- [ ] **Step 7: Commit**

```bash
git add src/node-storage.ts src/node-storage.test.ts src/main.ts
git commit -m "Add NodeFileStorage adapter; replace inline storage"
```

---

### Task 6: Extract runGame from main.ts

Pull the orchestration block out of `main.ts` (welcome-or-restore + `gameLoop` + terminate handling) into a new `runGame` function. `main.ts` becomes a thin shell that parses CLI flags, builds adapters, and delegates.

**Files:**
- Create: `src/run-game.ts`
- Create: `src/deps.ts`
- Modify: `src/main.ts`
- Modify: `src/save.ts` (remove unused `restoreFromFile`)

- [ ] **Step 1: Create run-game.ts with the runGame function**

```typescript
/*
 * runGame — host-driven session entry point.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import type { GameState, GameIO, Settings, SaveStorage, SaveFile } from "./types.js";
import { TerminateError, Termination, NOVICELIMIT } from "./types.js";
import { Msg, arbitraryMessages } from "./dungeon.js";
import { createGameState, createSettings, initialise } from "./init.js";
import { gameLoop } from "./game-loop.js";
import { yesOrNo } from "./input.js";
import { restore } from "./save.js";
import { terminate } from "./score.js";
import { rspeak } from "./format.js";
import { createDeps } from "./deps.js";  // see Step 2 below

export interface RunGameOptions {
  io: GameIO;
  storage: SaveStorage;
  state?: GameState;
  settings?: Partial<Settings>;
  initialSave?: string;
}

export async function runGame(opts: RunGameOptions): Promise<number> {
  const state = opts.state ?? createGameState();
  const settings = createSettings();
  Object.assign(settings, opts.settings ?? {});
  settings.storage = opts.storage;

  const seedval = initialise(state, settings, opts.io);

  if (opts.initialSave !== undefined) {
    // Mirror today's restoreFromFile + restore() behavior so the CLI -r flag
    // and any browser host providing initialSave produce identical messages
    // for bad-magic / version-skew / tampering. No welcome flow runs when
    // initialSave is provided, regardless of restore success/failure.
    let parsed: SaveFile | null = null;
    try {
      parsed = JSON.parse(opts.initialSave) as SaveFile;
    } catch {
      // Browser-friendly: emit the same BAD_SAVE message the in-game RESUME
      // flow uses for bad JSON, then continue from initial state. The CLI's
      // -r flag pre-validates JSON in main.ts to preserve today's strict
      // crash-on-bad-JSON semantics, so this branch is browser-only in
      // practice.
      rspeak(state, opts.io, Msg.BAD_SAVE);
    }
    if (parsed !== null) {
      // restore() emits rspeak messages for bad-magic / version-skew and
      // throws TerminateError on tampering — caught by the outer try/catch.
      try {
        restore(parsed, state, opts.io);
      } catch (err: unknown) {
        if (err instanceof TerminateError) return err.code;
        throw err;
      }
    }
  } else {
    state.novice = await yesOrNo(
      state, opts.io, settings,
      arbitraryMessages[Msg.WELCOME_YOU]!,
      arbitraryMessages[Msg.CAVE_NEARBY]!,
      arbitraryMessages[Msg.NO_MESSAGE]!,
    );
    if (state.novice) state.limit = NOVICELIMIT;
  }

  if (settings.logfp) settings.logfp(`seed ${seedval}`);

  const deps = createDeps(state, settings);

  try {
    await gameLoop(state, settings, opts.io, deps);
  } catch (err: unknown) {
    if (err instanceof TerminateError) return err.code;
    throw err;
  }

  try {
    terminate(state, opts.io, Termination.quitgame, deps.rspeak, deps.speak);
  } catch (err: unknown) {
    if (err instanceof TerminateError) return err.code;
    throw err;
  }
  return 0;
}
```

- [ ] **Step 2: Extract createDeps into its own module**

Move the `createDeps()` function from `src/main.ts` into a new `src/deps.ts`. The function body is unchanged; only its location moves. This breaks a circular dependency (`run-game.ts` needs `createDeps`, `createDeps` needs almost everything).

```typescript
// src/deps.ts
/*
 * GameLoopDeps wiring — adapter functions normalising parameter orders.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import type { GameState, Settings, GameIO, Command } from "./types.js";
import {
  PhaseCode, Termination, BugType, type SpeakType,
} from "./types.js";
import type { GameLoopDeps } from "./game-loop.js";
// ...all the imports currently in main.ts that createDeps needs...

export function createDeps(gameRef: GameState, settings: Settings): GameLoopDeps {
  // ...identical body to today's createDeps in main.ts...
}
```

- [ ] **Step 3: Slim main.ts down to argv parsing + adapter wiring**

`src/main.ts` becomes:

```typescript
/*
 * CLI entry point.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import { writeFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { TerminateError } from "./types.js";
import { ConsoleIO, ScriptIO } from "./io.js";
import { runGame } from "./run-game.js";
import { NodeFileStorage } from "./node-storage.js";

async function main(): Promise<void> {
  const { values: vals, positionals } = parseArgs({
    strict: true,
    allowPositionals: true,
    options: {
      l: { type: "string" },
      o: { type: "boolean" },
      r: { type: "string" },
      d: { type: "boolean" },
    },
  });

  const settingsOverrides: Record<string, unknown> = {};
  if (vals.d) settingsOverrides.debug = 1;
  if (vals.o) {
    settingsOverrides.oldstyle = true;
    settingsOverrides.prompt = false;
  }

  // Logging
  if (vals.l !== undefined) {
    const logfilename = vals.l;
    const logLines: string[] = [];
    settingsOverrides.logfp = (line: string): void => {
      logLines.push(line);
      try { writeFileSync(logfilename, logLines.join("\n") + "\n"); } catch { /* ignore */ }
    };
  }

  // Debug callback
  settingsOverrides.debugCallback = (msg: string): void => {
    process.stderr.write(msg);
  };

  // Resume file (-r)
  let initialSave: string | undefined;
  if (vals.r !== undefined) {
    try {
      initialSave = readFileSync(vals.r, "utf-8");
    } catch {
      process.stderr.write(`advent: can't open save file ${vals.r} for read\n`);
      process.exit(1);
    }
    // Preserve today's CLI -r strictness: today's restoreFromFile() lets
    // JSON.parse throw, which exits via main().catch with stderr + exit 1.
    // runGame's initialSave path is intentionally graceful for browser hosts
    // (rspeak BAD_SAVE + continue); CLI keeps the strict crash semantics.
    try {
      JSON.parse(initialSave);
    } catch (err: unknown) {
      process.stderr.write(String(err) + "\n");
      process.exit(1);
    }
  }

  // Script files (positional args)
  let io;
  if (positionals.length > 0) {
    const allLines: string[] = [];
    for (const scriptFile of positionals) {
      if (scriptFile === "-") continue;
      try {
        allLines.push(...readFileSync(scriptFile, "utf-8").split("\n"));
      } catch {
        process.stderr.write(`Can't open script ${scriptFile}\n`);
      }
    }
    if (allLines.length > 0) {
      io = new ScriptIO(allLines, {} as never);
    }
  }
  if (io === undefined) io = new ConsoleIO({} as never);

  const exitCode = await runGame({
    io,
    storage: new NodeFileStorage(),
    settings: settingsOverrides,
    initialSave,
  });

  if (io instanceof ConsoleIO) io.close();
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  if (err instanceof TerminateError) process.exit(err.code);
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
```

Note: the `{} as never` casts above are deliberate — `ConsoleIO`/`ScriptIO` constructors take `Settings`, but in this main they don't actually use it for anything that matters here. Verify against the constructors and clean up if they need real fields.

- [ ] **Step 4: Remove restoreFromFile from save.ts**

`runGame` now handles `initialSave` deserialization via `deserializeGame`, and `main.ts` reads the file directly with `readFileSync`. The legacy `restoreFromFile()` function is no longer called. Delete it from `src/save.ts`:

```typescript
// Remove the entire restoreFromFile() function and its `import { readFileSync } from "node:fs";` line.
```

After this step, `src/save.ts` has zero `node:*` imports — required for moving it into core in Task 8.

- [ ] **Step 5: Run regression tests**

```bash
pnpm test:regress
```

All 107 must pass — `main.ts` is now a thin shell, `runGame` does the real orchestration. The `-r` flag still works because `main.ts` reads the save file and forwards the JSON to `runGame` as `initialSave`.

- [ ] **Step 6: Commit**

```bash
git add src/run-game.ts src/deps.ts src/main.ts src/save.ts
git commit -m "Extract runGame entry point from main.ts"
```

---

## Phase 2: Restructure into pnpm workspace

### Task 7: Set up pnpm workspace skeleton

No file moves — just create the workspace config and empty package skeletons. `src/` continues to compile and run as it does today.

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `tsconfig.base.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": false,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create packages/core/package.json**

```json
{
  "name": "@open-adventure/core",
  "version": "1.0.0",
  "description": "Open Adventure game engine — platform-agnostic core",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "sideEffects": false,
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "generate": "tsx scripts/make-dungeon.ts",
    "generate:check": "tsx scripts/make-dungeon.ts --check",
    "test": "vitest run"
  },
  "license": "BSD-2-Clause"
}
```

- [ ] **Step 4: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/**/__tests__/**"]
}
```

- [ ] **Step 5: Create packages/cli/package.json**

```json
{
  "name": "@open-adventure/cli",
  "version": "1.0.0",
  "description": "Open Adventure terminal CLI",
  "type": "module",
  "bin": { "advent": "./dist/main.js" },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "play": "tsx src/main.ts"
  },
  "dependencies": {
    "@open-adventure/core": "workspace:*"
  },
  "license": "BSD-2-Clause"
}
```

- [ ] **Step 6: Create packages/cli/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/**/__tests__/**"]
}
```

- [ ] **Step 7: Update root package.json**

Add `"private": true` so pnpm treats the root as a workspace root (not a publishable package). Leave the script bodies pointing at the LEGACY paths (`tsc`, `tsx scripts/make-dungeon.ts`, `tsx src/main.ts`, etc.) — the empty packages have no source yet, so delegating to them now would break `pnpm build`, `pnpm generate`, and `pnpm play`. Tasks 8 and 10 re-delegate each script as the corresponding source files move.

```json
{
  "name": "open-adventure-ts",
  "version": "1.0.0",
  "description": "TypeScript port of Open Adventure (Colossal Cave Adventure 2.5)",
  "type": "module",
  "private": true,
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "generate": "tsx scripts/make-dungeon.ts",
    "generate:check": "tsx scripts/make-dungeon.ts --check",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:regress": "tsx scripts/regress.ts",
    "generate:graph": "tsx scripts/make-graph.ts",
    "play": "tsx src/main.ts"
  },
  "devDependencies": {
    "@types/js-yaml": "4.0.9",
    "@types/node": "22.13.4",
    "js-yaml": "4.1.0",
    "tsx": "4.19.3",
    "typescript": "5.7.3",
    "vitest": "3.0.5"
  },
  "license": "BSD-2-Clause"
}
```

The end-state delegated form (after Tasks 8 and 10 complete) is:

```json
"scripts": {
  "build": "pnpm -r build",
  "typecheck": "pnpm -r typecheck",
  "generate": "pnpm --filter @open-adventure/core generate",
  "generate:check": "pnpm --filter @open-adventure/core generate:check",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:regress": "tsx scripts/regress.ts",
  "generate:graph": "pnpm --filter @open-adventure/core exec tsx scripts/make-graph.ts",
  "play": "pnpm --filter @open-adventure/cli play"
}
```

- [ ] **Step 8: Run pnpm install to register workspace**

```bash
pnpm install
```

Expected: completes without errors. The empty packages don't have anything to build yet.

- [ ] **Step 9: Verify nothing else broke**

```bash
pnpm test:regress
```

Expected: all 107 still pass — `regress.ts` still drives the old `src/main.ts` since no files moved.

- [ ] **Step 10: Commit**

```bash
git add pnpm-workspace.yaml tsconfig.base.json packages/ package.json pnpm-lock.yaml
git commit -m "Add pnpm workspace skeleton with empty core/cli packages"
```

---

### Task 8: Move source files into packages/core/src/

Use `git mv` for everything that belongs to core. CLI files move in Task 10. `io.ts` stays in `src/` for now (Task 9 promotes ScriptIO into core; Task 10 moves ConsoleIO into cli and deletes the original).

**Files moved:**
- All of `src/*.ts` EXCEPT `main.ts`, `cheat.ts`, `io.ts`
- `adventure.yaml` → `packages/core/adventure.yaml`
- `scripts/make-dungeon.ts` → `packages/core/scripts/make-dungeon.ts`
- `scripts/make-graph.ts` → `packages/core/scripts/make-graph.ts`

- [ ] **Step 1: Move core source files with git mv**

```bash
mkdir -p packages/core/src packages/core/scripts
git mv src/dungeon.generated.ts packages/core/src/
git mv src/dungeon.ts packages/core/src/
git mv src/types.ts packages/core/src/
git mv src/init.ts packages/core/src/
git mv src/game-loop.ts packages/core/src/
git mv src/actions.ts packages/core/src/
git mv src/movement.ts packages/core/src/
git mv src/dwarves.ts packages/core/src/
git mv src/format.ts packages/core/src/
git mv src/vocabulary.ts packages/core/src/
git mv src/input.ts packages/core/src/
git mv src/object-manipulation.ts packages/core/src/
git mv src/rng.ts packages/core/src/
git mv src/score.ts packages/core/src/
git mv src/save.ts packages/core/src/
git mv src/save-pure.ts packages/core/src/
git mv src/save-pure.test.ts packages/core/src/
git mv src/save-summary.test.ts packages/core/src/
git mv src/run-game.ts packages/core/src/
git mv src/deps.ts packages/core/src/
```

- [ ] **Step 2: Move adventure.yaml and build-time scripts**

```bash
git mv adventure.yaml packages/core/adventure.yaml
git mv scripts/make-dungeon.ts packages/core/scripts/make-dungeon.ts
git mv scripts/make-graph.ts packages/core/scripts/make-graph.ts
```

- [ ] **Step 3: Update internal references in make-dungeon.ts**

The script reads `adventure.yaml` and writes `dungeon.generated.ts`. Inside `packages/core/scripts/make-dungeon.ts`, paths that were rooted at the repo root become rooted at `packages/core/`:

```typescript
// Update path constants — examples:
const YAML_PATH = resolve(import.meta.dirname!, "..", "adventure.yaml");
const OUT_PATH = resolve(import.meta.dirname!, "..", "src", "dungeon.generated.ts");
```

(Inspect the existing file and update any `resolve(..., "..")` calls so they point at `packages/core/` instead of repo root.)

- [ ] **Step 4: Verify core builds**

```bash
pnpm --filter @open-adventure/core build
```

Expected: TypeScript compiles cleanly. (Cli still references the old `src/` paths — its build will fail until Task 10. Don't run root `pnpm build` yet.)

- [ ] **Step 5: Verify core tests pass**

```bash
pnpm --filter @open-adventure/core test
```

Expected: vitest finds `save-pure.test.ts` and `save-summary.test.ts` under `packages/core/src/`, both pass.

- [ ] **Step 6: Re-delegate root scripts that target moved sources**

The legacy `tsx scripts/make-dungeon.ts` form no longer works — the script and its yaml input live under `packages/core/` now. Update the relevant entries in root `package.json`:

```json
"generate": "pnpm --filter @open-adventure/core generate",
"generate:check": "pnpm --filter @open-adventure/core generate:check",
"generate:graph": "pnpm --filter @open-adventure/core exec tsx scripts/make-graph.ts",
```

Leave `build`, `typecheck`, and `play` pointing at legacy paths for one more task — `pnpm -r build` would still fail in `cli` (no source until Task 10), and `tsx src/main.ts` is still where the CLI entry lives. Task 10 finishes the script-delegation transition.

- [ ] **Step 7: Commit**

```bash
git add packages/core/ src/ adventure.yaml scripts/ package.json -A
git commit -m "Move core source files into packages/core/"
```

---

### Task 9: Create core public API barrel (index.ts)

Add the barrel BEFORE the CLI move (Task 10) — Task 10's CLI files import from `@open-adventure/core`, so the barrel must already exist and resolve. The barrel also promotes `ScriptIO` into core (via a new `test-io.ts`) so it's available as a public export.

`Settings` is exported under both its original name (so internal-style consumers like the CLI keep working) and `GameSettings` (the public-facing alias the spec describes for browser hosts).

**Files:**
- Create: `packages/core/src/test-io.ts` (ScriptIO promoted from `src/io.ts`)
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Promote ScriptIO into core/src/test-io.ts**

Create `packages/core/src/test-io.ts`:

```typescript
/*
 * ScriptIO - in-memory GameIO for tests and scripted playback.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import type { GameIO, Settings } from "./types.js";

export class ScriptIO implements GameIO {
  private lines: readonly string[];
  private index: number;
  private outputBuffer: string[];
  readonly echoInput: boolean = true;

  constructor(lines: readonly string[], _settings: Settings) {
    this.lines = lines;
    this.index = 0;
    this.outputBuffer = [];
  }

  print(msg: string): void {
    this.outputBuffer.push(msg);
  }

  async readline(_prompt: string): Promise<string | null> {
    if (this.index >= this.lines.length) return null;
    return this.lines[this.index++]!;
  }

  getOutput(): string {
    return this.outputBuffer.join("");
  }

  getOutputLines(): string[] {
    return this.getOutput().split("\n");
  }
}
```

(The ConsoleIO half of `src/io.ts` stays put for now — Task 10 moves it into `packages/cli/src/console-io.ts`. `src/io.ts` will still have ConsoleIO, plus an unused ScriptIO definition that gets deleted in Task 10.)

- [ ] **Step 2: Write packages/core/src/index.ts**

```typescript
/*
 * Public API for @open-adventure/core.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

// Session entry point
export { runGame, type RunGameOptions } from "./run-game.js";

// State + settings factories
export { createGameState, createSettings, initialise } from "./init.js";

// Pure save helpers
export { serializeGame, deserializeGame, summarizeSave, savefile } from "./save-pure.js";

// In-memory IO for tests/hosts that want it
export { ScriptIO } from "./test-io.js";

// Public types
export type {
  GameIO,
  SaveStorage,
  GameState,
  SaveFile,
  RestoreResult,
  SaveSummary,
} from "./types.js";

// Settings is exported under both names: the original (used by the CLI and
// other internal-style consumers) and GameSettings (the public-facing alias
// the spec describes for browser hosts).
export type { Settings, Settings as GameSettings } from "./types.js";

// TerminateError is exposed so hosts can recognise it if it leaks via custom IO
export { TerminateError } from "./types.js";
```

- [ ] **Step 3: Build core**

```bash
pnpm --filter @open-adventure/core build
```

Expected: clean build, `packages/core/dist/index.js` and `packages/core/dist/index.d.ts` produced.

(CLI is still at `src/` — its build remains broken from Task 8 until Task 10 moves the files. That's by design.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/test-io.ts packages/core/src/index.ts
git commit -m "Add core public API barrel and promote ScriptIO into core"
```

---

### Task 10: Split io.ts and move CLI files into packages/cli/src/

With the core barrel now in place (Task 9), the remaining CLI files can move and switch their imports to `@open-adventure/core`.

**Files:**
- Create: `packages/cli/src/console-io.ts` (extracted ConsoleIO)
- Move: `src/main.ts` → `packages/cli/src/main.ts`
- Move: `src/cheat.ts` → `packages/cli/src/cheat.ts`
- Move: `src/node-storage.ts` → `packages/cli/src/node-storage.ts`
- Move: `src/node-storage.test.ts` → `packages/cli/src/node-storage.test.ts`
- Delete: `src/io.ts` (ConsoleIO moved out; ScriptIO already promoted in Task 9)
- Delete: `src/` (empty after this task)

- [ ] **Step 1: Extract ConsoleIO into cli/src/console-io.ts**

```bash
mkdir -p packages/cli/src
```

Create `packages/cli/src/console-io.ts` with the ConsoleIO body from `src/io.ts`:

```typescript
/*
 * ConsoleIO - production GameIO using node:readline/promises.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import { createInterface, type Interface } from "node:readline/promises";
import type { GameIO, Settings } from "@open-adventure/core";

export class ConsoleIO implements GameIO {
  private rl: Interface;
  readonly echoInput: boolean;
  private isTTY: boolean;
  private lineIterator: AsyncIterableIterator<string> | null = null;

  constructor(_settings: Settings) {
    this.isTTY = process.stdin.isTTY === true;
    this.echoInput = !this.isTTY;
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: this.isTTY,
    });
    if (!this.isTTY) {
      this.lineIterator = this.rl[Symbol.asyncIterator]();
    }
  }

  print(msg: string): void {
    process.stdout.write(msg);
  }

  async readline(prompt: string): Promise<string | null> {
    try {
      if (this.isTTY) {
        return await this.rl.question(prompt);
      } else {
        const result = await this.lineIterator!.next();
        if (result.done) {
          process.stdout.write(prompt);
          return null;
        }
        return result.value;
      }
    } catch {
      return null;
    }
  }

  close(): void {
    this.rl.close();
  }
}
```

- [ ] **Step 2: Move main.ts, cheat.ts, node-storage.ts to cli**

```bash
git mv src/main.ts packages/cli/src/main.ts
git mv src/cheat.ts packages/cli/src/cheat.ts
git mv src/node-storage.ts packages/cli/src/node-storage.ts
git mv src/node-storage.test.ts packages/cli/src/node-storage.test.ts
git rm src/io.ts
```

(After this, `src/` is empty; `git status` should show it gone or empty. If empty dir lingers, `rmdir src`.)

- [ ] **Step 3: Update imports in cli files to use @open-adventure/core**

In `packages/cli/src/main.ts`, replace internal imports with package imports. The exact lines depend on what main.ts uses after Task 6's slimming — work through every `from "./X.js"` and replace `./X.js` with `@open-adventure/core` if the target moved into core. Typical result:

```typescript
import type { GameIO, Settings, GameState } from "@open-adventure/core";
import { TerminateError, runGame, ScriptIO } from "@open-adventure/core";
import { ConsoleIO } from "./console-io.js";
import { NodeFileStorage } from "./node-storage.js";
```

In `packages/cli/src/cheat.ts`, replace internal imports the same way. After Task 3 the current cheat.ts imports `createGameState`, `createSettings`, `initialise` from `./init.js` and `savefile` from `./save.js` (which itself re-exports `savefile` from `./save-pure.js`). All of those move to `@open-adventure/core`:

```typescript
import {
  createGameState,
  createSettings,
  initialise,
  savefile,
} from "@open-adventure/core";
```

(Note: cheat.ts no longer imports `ScriptIO` from `./io.js` — Task 1's review removed that in favour of an inline discard `GameIO` literal.)

In `packages/cli/src/node-storage.ts`, change:

```typescript
// was: import type { SaveStorage } from "./types.js";
import type { SaveStorage } from "@open-adventure/core";
```

- [ ] **Step 4: Update vitest config to find tests in packages**

In root `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Build core (cli depends on its dist)**

```bash
pnpm --filter @open-adventure/core build
```

Expected: clean build (idempotent — already built in Task 9).

- [ ] **Step 6: Build cli**

```bash
pnpm --filter @open-adventure/cli build
```

Expected: clean build. Imports of `@open-adventure/core` resolve to the just-built `dist/`.

- [ ] **Step 7: Run unit tests**

```bash
pnpm test
```

Expected: `save-pure.test.ts`, `save-summary.test.ts`, `node-storage.test.ts` all pass.

- [ ] **Step 8: Re-delegate the remaining root scripts**

CLI source now lives in `packages/cli/src/` and both packages have buildable source. Switch the remaining root scripts to the workspace-delegated form:

```json
"build": "pnpm -r build",
"typecheck": "pnpm -r typecheck",
"play": "pnpm --filter @open-adventure/cli play"
```

After this step, `package.json` matches the end-state form documented in Task 7.

- [ ] **Step 9: Commit**

```bash
git add packages/ src/ vitest.config.ts package.json -A
git commit -m "Split io.ts; move CLI files into packages/cli/"
```

---

### Task 11: Update root tooling scripts to point at the new CLI binary

`scripts/regress.ts`, `scripts/cross-compare.ts`, and `scripts/fuzz-compare.ts` reference `src/main.ts` and `src/cheat.ts`. Update paths to the new locations.

**Files:**
- Modify: `scripts/regress.ts`
- Modify: `scripts/cross-compare.ts`
- Modify: `scripts/fuzz-compare.ts`

- [ ] **Step 1: Update scripts/regress.ts paths**

In `scripts/regress.ts`, replace:

```typescript
// was:
const MAIN_TS = join(ROOT, "src", "main.ts");
const CHEAT_TS = join(ROOT, "src", "cheat.ts");

// now:
const MAIN_TS = join(ROOT, "packages", "cli", "src", "main.ts");
const CHEAT_TS = join(ROOT, "packages", "cli", "src", "cheat.ts");
```

- [ ] **Step 2: Update scripts/cross-compare.ts paths**

```typescript
// was:
const MAIN_TS = join(ROOT, "src", "main.ts");
// now:
const MAIN_TS = join(ROOT, "packages", "cli", "src", "main.ts");
```

(Repeat for any other `src/` references in the file.)

- [ ] **Step 3: Update scripts/fuzz-compare.ts paths**

Same pattern — update the `MAIN_TS` constant (and any others) to point at `packages/cli/src/main.ts`.

- [ ] **Step 4: Run regression tests**

```bash
pnpm test:regress
```

Expected: all 107 pass. **This is the critical milestone for the whole refactor** — proves byte-identical CLI output is preserved across the move.

- [ ] **Step 5: Run a single cross-compare test as a smoke check**

```bash
npx tsx scripts/cross-compare.ts --test pitfall
```

Expected: `# ok` on the cross-compare test (assumes C `advent` binary is built in `../open-adventure`).

- [ ] **Step 6: Commit**

```bash
git add scripts/regress.ts scripts/cross-compare.ts scripts/fuzz-compare.ts
git commit -m "Update tooling scripts to reference packages/cli paths"
```

---

### Task 12: Add core in-process smoke test

A vitest test that exercises `runGame` end-to-end with `ScriptIO` and an in-memory `SaveStorage`. Catches accidental Node imports in core (would fail to import `@open-adventure/core` without `node:*`).

**Files:**
- Create: `packages/core/src/__tests__/run-game.smoke.test.ts`

- [ ] **Step 1: Write the smoke test**

```typescript
import { describe, it, expect } from "vitest";
import { runGame, ScriptIO, type SaveStorage } from "../index.js";

class MemoryStorage implements SaveStorage {
  private data = new Map<string, string>();
  async read(name: string): Promise<string | null> {
    return this.data.get(name) ?? null;
  }
  async write(name: string, data: string): Promise<void> {
    this.data.set(name, data);
  }
}

describe("runGame smoke", () => {
  it("plays a brief scripted session and quits", async () => {
    const lines = [
      "no",       // not a novice
      "in",       // enter building
      "take lamp",
      "quit",
      "yes",      // confirm quit
    ];
    const io = new ScriptIO(lines, {} as never);
    const storage = new MemoryStorage();

    const exitCode = await runGame({ io, storage });
    expect(exitCode).toBe(0);

    const out = io.getOutput();
    // Output should contain the welcome and the building description.
    expect(out).toContain("Welcome");
    expect(out).toContain("building");
    expect(out.length).toBeGreaterThan(100);
  });

  it("auto-resumes when initialSave is provided", async () => {
    const io = new ScriptIO(["quit", "yes"], {} as never);
    const storage = new MemoryStorage();

    // Build a save by running a partial session
    const setupIO = new ScriptIO(["no", "in", "save"], {} as never);
    const setupStorage = new MemoryStorage();
    // Pre-populate the save
    setupStorage.write("slot1", JSON.stringify({
      magic: "open-adventure\n",
      version: 31,
      canary: 2317,
      game: (await import("../init.js")).createGameState(),
    }));

    const json = await setupStorage.read("slot1");
    expect(json).not.toBeNull();

    const exitCode = await runGame({ io, storage, initialSave: json! });
    expect(exitCode).toBe(0);
    // No "Welcome" greeting — initialSave skipped the welcome flow
    expect(io.getOutput()).not.toContain("Welcome to Adventure");
  });
});
```

- [ ] **Step 2: Run the smoke test**

```bash
pnpm --filter @open-adventure/core test
```

Expected: both smoke tests pass. If the second test is fragile due to scripted input not matching what the game expects, simplify it — the first test is the must-pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/run-game.smoke.test.ts
git commit -m "Add in-process smoke test for runGame"
```

---

### Task 13: Add ESLint rule forbidding node:* imports in core

Cheap regression insurance. Any future `node:fs` snuck into core fails lint.

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (add eslint dev deps)

- [ ] **Step 1: Install ESLint and TypeScript plugin**

```bash
pnpm add -D -w eslint typescript-eslint
```

(Use the latest stable versions; verify with `npm view eslint version` and `npm view typescript-eslint version`.)

- [ ] **Step 2: Create eslint.config.js (flat config)**

```javascript
import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommended,
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*"], message: "Core must not import Node built-ins. Move Node-specific code to packages/cli." },
            { group: ["fs", "path", "os", "readline", "child_process", "stream"], message: "Core must not import Node built-ins. Use the bare 'node:' specifier in cli code." },
          ],
        },
      ],
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/dungeon.generated.ts"],
  },
];
```

- [ ] **Step 3: Add lint script to root package.json**

```json
{
  "scripts": {
    "lint": "eslint packages"
  }
}
```

- [ ] **Step 4: Run lint to confirm core is clean**

```bash
pnpm lint
```

Expected: zero errors. (If anything is flagged, the cleanup tasks 1–6 missed something — fix and re-commit.)

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js package.json pnpm-lock.yaml
git commit -m "Add ESLint rule forbidding node:* imports in core"
```

---

### Task 14: Final verification pass

End-to-end check that everything works in the new layout.

- [ ] **Step 1: Clean build from scratch**

```bash
rm -rf packages/*/dist
pnpm build
```

Expected: both packages build cleanly.

- [ ] **Step 2: Type-check both packages**

```bash
pnpm typecheck
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Run all unit tests**

```bash
pnpm test
```

Expected: all unit tests pass (save-pure, save-summary, node-storage, run-game.smoke).

- [ ] **Step 4: Run all 107 regression tests**

```bash
pnpm test:regress
```

Expected: all 107 tests pass with `# ok`. This is the byte-identical-output guarantee.

- [ ] **Step 5: Run lint**

```bash
pnpm lint
```

Expected: zero errors. Core has no Node imports.

- [ ] **Step 6: Run a small cross-compare batch (if C binary available)**

```bash
npx tsx scripts/cross-compare.ts --test pitfall
npx tsx scripts/cross-compare.ts --test saveresume.1
```

Expected: both pass.

- [ ] **Step 7: Run a small fuzz batch**

```bash
npx tsx scripts/fuzz-compare.ts --runs 10
```

Expected: 10 random sessions match between TS and C.

- [ ] **Step 8: Commit any leftover changes (likely none)**

```bash
git status
# If clean, no commit needed. If anything is dangling, commit it.
```

- [ ] **Step 9: Open a PR**

The branch is `browser-deployment-design`. Use the standard PR command per the repo's workflow.

```bash
git push -u origin browser-deployment-design
gh pr create --title "Browser deployment: split into core+cli packages" --body "$(cat <<'EOF'
## Summary
- Restructure into pnpm workspace with `@open-adventure/core` and `@open-adventure/cli`.
- Core has zero `node:*` imports; consumable from a browser bundler.
- Add `SaveStorage` adapter, `serializeGame` / `deserializeGame` / `summarizeSave` pure helpers, and `runGame` host-driven entry point.
- CLI behavior preserved: all 107 regression tests pass byte-identical.

See `docs/superpowers/specs/2026-04-25-browser-deployment-design.md` for design.

## Test plan
- [x] `pnpm build` clean
- [x] `pnpm typecheck` clean
- [x] `pnpm test` (unit tests) green
- [x] `pnpm test:regress` (107 regression tests) green
- [x] `pnpm lint` (no node imports in core) green
- [x] `cross-compare.ts` sample tests green
- [x] `fuzz-compare.ts --runs 10` green
EOF
)"
```

---

## Notes for the implementer

- **Don't skip the regression suite between tasks.** The whole point is byte-identical preservation. Run `pnpm test:regress` after every task that changes behavior or paths.
- **`saveresume.*` tests are chained.** The test runner already orders them. If a single `saveresume` test fails after a save-related change, run them as a chain to debug.
- **Keep commits one-logical-change.** The plan ends each task with a single commit; resist bundling.
- **If `score.ts` extraction (Task 4) proves messy**, defer the score field in `SaveSummary` to a follow-up rather than blocking the rest of the refactor.
- **Branch:** all work happens on `browser-deployment-design` (already created during spec authoring). Don't switch back to `main` mid-implementation.
