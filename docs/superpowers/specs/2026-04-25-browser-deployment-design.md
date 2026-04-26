# Browser Deployment — Design

Date: 2026-04-25
Status: Draft, pending user review
Branch: `browser-deployment-design`

## Goal

Make Open Adventure (TypeScript port) playable in a browser while preserving the existing terminal CLI byte-for-byte. Player progress saves to browser storage. The web project that hosts the game (UI, page chrome, save panel) lives in a separate repository and consumes this codebase as an installable package.

Success criteria:
- All 107 regression tests still pass against the terminal CLI.
- A browser host can implement two small interfaces (`GameIO`, `SaveStorage`) and a session entry point to play the full game, including SAVE/RESUME, in a web page.
- The published `core` package contains zero `node:*` imports and zero runtime dependencies.

## Decisions summary

| Area | Choice |
|------|--------|
| Repo shape | Monorepo (pnpm workspaces): `packages/core`, `packages/cli` |
| Public loop model | Host-driven async: game owns the loop, awaits `io.readline()` |
| In-game save backend | `SaveStorage` adapter (Node→fs, browser→localStorage) |
| Pure save path | Export `serializeGame` / `deserializeGame` / `summarizeSave` for host-driven save UIs |
| Auto-save | Defer to host; expose `GameState` reference so host snapshots at any cadence |
| Distribution | ESM only, `.d.ts` declarations, no bundler in this repo |
| Web Worker | Out of scope; `runGame` works inside one unchanged if a host wants it |

## Repository structure

```
open-adventure-ts/                          (repo root)
├── pnpm-workspace.yaml                      (NEW)
├── package.json                             (root devDeps + workspace scripts)
├── tests/                                    (regression .log/.chk files — STAY)
├── maps/                                     (STAY)
├── upstream-sync.md, README.md, LICENSE     (STAY)
├── packages/
│   ├── core/                                 (@open-adventure/core)
│   │   ├── package.json                      (no runtime deps; ESM)
│   │   ├── tsconfig.json
│   │   ├── adventure.yaml                    (moved from root)
│   │   ├── scripts/
│   │   │   ├── make-dungeon.ts               (moved; writes ./src/dungeon.generated.ts)
│   │   │   └── make-graph.ts                 (moved)
│   │   └── src/
│   │       ├── index.ts                      (NEW: public API barrel)
│   │       ├── dungeon.generated.ts
│   │       ├── dungeon.ts, types.ts, init.ts
│   │       ├── game-loop.ts, actions.ts, movement.ts
│   │       ├── dwarves.ts, format.ts, vocabulary.ts
│   │       ├── input.ts, object-manipulation.ts
│   │       ├── rng.ts, score.ts
│   │       ├── save.ts                       (refactored — see "Save / restore")
│   │       └── test-io.ts                    (NEW: in-memory ScriptIO promoted)
│   └── cli/                                  (@open-adventure/cli)
│       ├── package.json                      (depends on core; bin: "advent")
│       ├── tsconfig.json
│       └── src/
│           ├── main.ts                       (today's main.ts, slimmed)
│           ├── console-io.ts                 (today's ConsoleIO)
│           ├── node-storage.ts               (NEW: NodeFileStorage)
│           └── cheat.ts                      (moved — Node-only test fixture)
└── scripts/
    ├── regress.ts                            (path updated → cli/dist/main.js)
    ├── cross-compare.ts, fuzz-compare.ts     (paths updated)
    └── ...
```

Rationales:
- `core` has zero `node:*` imports and zero runtime deps; browser bundlers consume it directly.
- `cli` owns everything Node-specific (`fs`, `readline`, `process.argv`, `process.exit`).
- Build-time scripts that use Node (`make-dungeon.ts`, `make-graph.ts`) live in `core/scripts/` because they only run during development and write into `core/src/`. They are not shipped.
- Regression tests stay at the repo root and drive the `cli` binary as a child process. Existing runners (`regress.ts`, `cross-compare.ts`, `fuzz-compare.ts`) need only path updates.
- `ScriptIO` (today's `io.ts`) is promoted to `core/src/test-io.ts` so it can be exported from `core` for in-process tests without dragging in Node.

## Public API of `core`

`core/src/index.ts` is the single public barrel. Hosts depend only on these names.

```typescript
// === I/O contracts that hosts implement ===
export interface GameIO {
  print(msg: string): void;
  readline(prompt: string): Promise<string | null>;   // null = EOF / quit
  readonly echoInput: boolean;                          // true = print echoes input back
}

export interface SaveStorage {
  read(name: string): Promise<string | null>;          // null = not found
  write(name: string, data: string): Promise<void>;
  // Optional helpers; hosts may implement or omit:
  list?(): Promise<string[]>;
  delete?(name: string): Promise<void>;
}

// === Session entry point ===
export interface RunGameOptions {
  io: GameIO;
  storage: SaveStorage;
  state?: GameState;                                    // host pre-creates → can snapshot
  settings?: Partial<GameSettings>;
  initialSave?: string;                                 // JSON; if present, restore + skip welcome
}
export async function runGame(opts: RunGameOptions): Promise<number>;
// Resolves with exit code (0 = quit normally, nonzero = abnormal).
// TerminateError is caught internally; never thrown to the host.

// === State + settings factories ===
export function createGameState(): GameState;
export function createSettings(overrides?: Partial<GameSettings>): GameSettings;

// === Pure save helpers (for host-driven save UIs) ===
export function serializeGame(state: GameState): string;          // returns JSON
export function deserializeGame(json: string): RestoreResult;
export function summarizeSave(jsonOrState: string | GameState): SaveSummary | { error: string };

// === Test helper (stable export for in-process tests) ===
export class ScriptIO implements GameIO { /* ... */ }

// === Types the host may need ===
export type { GameState, GameSettings, SaveFile, RestoreResult, SaveSummary };
```

`GameSettings` (renamed from internal `Settings`) drops `logfp` (replaced by `logCallback`) and `scriptLines`/`scriptIndex` (CLI-only concern; `cli/main.ts` builds `ScriptIO` from a script file directly).

`RestoreResult`:
```typescript
type RestoreResult =
  | { ok: true; state: GameState }
  | { ok: false;
      reason: 'bad-json' | 'bad-magic' | 'version-skew' | 'tampering';
      saveVersion?: number;
      expectedVersion?: number;
      message: string };
```

`SaveSummary`:
```typescript
interface SaveSummary {
  locationName: string;          // e.g. "Inside Building"
  score: number;                 // current score
  maxScore: number;              // e.g. 350
  treasuresFound: number;        // count
  treasuresTotal: number;        // count
  inventory: string[];           // object inventory names being carried
  phase: 'pre-cave' | 'in-cave' | 'closing' | 'closed';
  saveVersion: number;
  currentVersion: number;
  compatible: boolean;           // saveVersion === currentVersion
}
```

Internal modules (`actions`, `dwarves`, `movement`, etc.) are not advertised in `exports`. Hosts that reach into internals do so at their own risk.

## I/O contract details

Two semantic details a browser `GameIO` implementer must honor:

- `print(msg)` is synchronous-looking; no `await`. The game emits many `print` calls between input prompts (e.g., describing a room calls `print` repeatedly). Hosts typically buffer text and render on the next animation frame.
- `readline(prompt)` returns a `Promise<string | null>`. The host:
  - Renders `prompt` somewhere (or ignores it — when `settings.prompt = true` the engine emits `>` separately).
  - Resolves with the trimmed input line.
  - Resolves with `null` to signal EOF / session end (e.g., user closed a session). The game treats this as a clean termination.
- `echoInput` is `false` for typical browser hosts (the host renders user input in its own log; the engine should not re-emit it). The CLI uses `true` for piped/scripted input only.

Termination:
- Game logic throws `TerminateError(code)` to end. `runGame` catches it and resolves with `code`.
- `runGame` may resolve at any time after a `readline` returns (QUIT command, dwarf kill, normal end). The host should be ready for it.
- After resolution the host may call `runGame` again with a fresh `state` to start a new game.

## Cleanup in core (no API change)

- `process.exit(0)` in `input.ts` (two unreachable-in-CLI branches in `silentYesOrNo` and `yesOrNo`) → `throw new TerminateError(0)`. They become reachable in the browser if a host closes a session mid-yes/no; clean termination beats process kill.
- `process.exit(0)` in `save.ts` (after suspend writes; on tampering detected) → `throw new TerminateError(0)`. Both are real game-flow signals, not Node infrastructure.
- `process.stderr.write` debug log in `rng.ts:16` → a `settings` callback (exact name resolved in the implementation plan; see Open implementation questions).
- `process.stdout.write("Initialising...\n")` in `init.ts:151` → `io.print(...)`. Pass `io` through to `initialise()`.

## Save / restore refactor

`save.ts` today mixes pure serialization, the in-game prompt flow, and Node file I/O. Split into three layers:

### Pure layer (exported)

- `savefile(game, version?)` — unchanged.
- `serializeGame(state)` = `JSON.stringify(savefile(state))`.
- `deserializeGame(json)` — validates JSON, magic, version, canary, `isValid()`. Returns `RestoreResult`. **No IO, no `rspeak`, no exits.**
- `summarizeSave(jsonOrState)` — returns `SaveSummary` for save-list UIs (current location name, score, treasures found/total, inventory list, phase, version compatibility).
- `isValid(state)` — unchanged.

### In-game flow (in core, uses adapters)

```typescript
export async function suspend(game, settings, io, storage): Promise<PhaseCode> {
  // 1. Speak SUSPEND_WARNING
  // 2. yesOrNo confirmation, +5 turn penalty
  // 3. Loop: io.readline("\nFile name: ") → trim → storage.write(name, serializeGame(game))
  //    On error: io.print("Can't open file <name>, try again.\n"), continue
  // 4. rspeak RESUME_HELP
  // 5. throw new TerminateError(0)
}

export async function resume(game, settings, io, storage): Promise<PhaseCode> {
  // 1. Confirm abandon if game in progress
  // 2. Loop: io.readline("\nFile name: ") → storage.read(name)
  //    null → io.print("Can't open file <name>, try again.\n"), continue
  //    found → deserializeGame(json) → handle RestoreResult:
  //      ok=true       : Object.assign(game, result.state); return GO_TOP
  //      bad-magic     : rspeak BAD_SAVE; return GO_TOP
  //      bad-json      : rspeak BAD_SAVE; return GO_TOP
  //      version-skew  : rspeak VERSION_SKEW with version numbers; return GO_TOP
  //      tampering     : rspeak SAVE_TAMPERING; throw TerminateError(0)
}
```

Both `suspend` and `resume` gain a `storage: SaveStorage` parameter. The deps wiring in `cli/main.ts` (and the browser host) supplies it. `actions.ts` calls these in one or two places — adjust the call sites accordingly.

### Adapters

```typescript
// cli/src/node-storage.ts
export class NodeFileStorage implements SaveStorage {
  async read(name)   { try { return await fs.readFile(name, 'utf-8'); } catch { return null; } }
  async write(name, data) { await fs.writeFile(name, data); }
  async list()       { /* optional: list *.adv files in cwd */ }
  async delete(name) { await fs.unlink(name); }
}

// Browser host (in the separate web project, NOT this repo):
// class LocalStorageStorage implements SaveStorage { ... key prefix, JSON in localStorage ... }
```

CLI behavior preservation: `NodeFileStorage` treats `name` as a file path, matching today's `writeFileSync(name, ...)`. Terminal output around save/restore is unchanged — regression tests stay green.

`-r resumefile` CLI flag: today's `restoreFromFile()` becomes a small CLI-side function: read file, call `deserializeGame`, log structured failure to stderr or apply `Object.assign` on success.

## Build, distribution, tests

Build:
- Both packages emit ESM only. Today's tsconfig already targets ESM.
- Each package emits `.d.ts` and `.d.ts.map`.
- `core/package.json` `exports`: `"."` only → `./dist/index.js`. No deep paths.
- `core/package.json` `"sideEffects": false` for tree-shaking.
- `cli/package.json` keeps `"bin": { "advent": "./dist/main.js" }` and depends on `"@open-adventure/core": "workspace:*"`.
- No new bundler dependency in this repo. The web project owns bundling.

Tests:
- Regression tests stay at repo root, drive `packages/cli/dist/main.js`. `regress.ts` needs only a path update.
- `cross-compare.ts` and `fuzz-compare.ts`: same — point at the new CLI binary path.
- Vitest unit tests stay where they are; once core exists as a workspace package they import from `@open-adventure/core`.
- **Add one in-process core smoke test** using `ScriptIO` and a fake in-memory `SaveStorage`. Runs a short scripted session, asserts captured output. Catches accidental Node imports in core.

Lint guard:
- ESLint `no-restricted-imports` rule on `packages/core/`: forbid `node:*`, `fs`, `path`, `os`, `readline`, etc. Cheap regression insurance.

## Out of scope (explicitly)

- The web project itself — UI, splash, save panel, command history rendering, mobile layout. Separate repo.
- Web Worker deployment. Adventure does negligible computation. `runGame` works inside a worker unchanged if a future host wraps it in postMessage.
- Service worker / PWA / offline. Hosting concern.
- Streaming output animation (typewriter effect). Pure host concern; `print()` is synchronous and the host paces rendering.
- Multiplayer / shared sessions.
- Migrating away from the C-original "type a name" SAVE prompt. The web project can layer its own UI on top using `serializeGame` / `deserializeGame` / `summarizeSave`; the in-game SAVE/RESUME commands continue to work as today.

## Open implementation questions

These are deferred to the implementation plan, not blockers for this design:

- Exact name of the debug-log callback (`debugCallback` vs. folding into `logCallback`).
- Whether `ScriptIO` is exported from `index.ts` or from a side path like `@open-adventure/core/test`.
- Whether to introduce a workspace-level `tsconfig.base.json` for shared compiler options.
- Whether `cli`'s `package.json` `bin` name is `advent` (matches C) or something namespaced like `open-advent`.

## Migration sequence (high-level)

The implementation plan will detail this; rough order:

1. Add pnpm workspace config; create empty `packages/core` and `packages/cli` skeletons. CLI build still works from old paths during transition.
2. Move source files into `packages/core/src/` and `packages/cli/src/`. Adjust imports. CI green.
3. Create `core/src/index.ts` barrel with the public API. Re-export only what's listed above.
4. Replace `process.exit(0)` calls with `TerminateError`. Replace `process.stdout/stderr.write` outside of `cli/` with `io.print` / settings callbacks.
5. Refactor `save.ts`: extract pure layer (`serializeGame`, `deserializeGame`, `summarizeSave`); add `SaveStorage` parameter to `suspend`/`resume`; ripple through `actions.ts`.
6. Implement `NodeFileStorage` in `cli/`; wire it into `cli/main.ts`'s deps.
7. Add `runGame` wrapper exporting from `core`. CLI's `main.ts` becomes a thin caller of `runGame`.
8. Add core smoke test (in-process, fake IO + fake storage).
9. Add ESLint `no-restricted-imports` rule on core.
10. Update `regress.ts`, `cross-compare.ts`, `fuzz-compare.ts` for new paths. Run all 107 regression tests; confirm byte-identical.
