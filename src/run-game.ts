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
import { createDeps } from "./deps.js";

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

  // Single outer try/catch covers every TerminateError-throwing site:
  // welcome yesOrNo (EOF before answer), restore (tampering), gameLoop, and
  // terminate. Any TerminateError becomes the exit code; anything else
  // propagates as a real error.
  try {
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
        restore(parsed, state, opts.io);
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
    await gameLoop(state, settings, opts.io, deps);
    terminate(state, opts.io, Termination.quitgame, deps.rspeak, deps.speak);
  } catch (err: unknown) {
    if (err instanceof TerminateError) return err.code;
    throw err;
  }
}
