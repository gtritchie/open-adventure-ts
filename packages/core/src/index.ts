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
