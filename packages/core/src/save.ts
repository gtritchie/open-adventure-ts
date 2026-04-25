/*
 * Saving and resuming - JSON-based save/restore.
 *
 * Port of saveresume.c.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import type { GameState, Settings, GameIO, SaveFile } from "./types.js";
import { deserializeGame, savefile, isValid } from "./save-pure.js";
import { PhaseCode, TerminateError } from "./types.js";
import { Location, Msg, arbitraryMessages } from "./dungeon.js";
import { rspeak } from "./format.js";
import { yesOrNo } from "./input.js";

// Re-export the pure helpers so existing call sites that import them from
// "./save.js" continue to resolve. cheat.ts in particular imports savefile
// from here today; Task 9's barrel migrates that to the public package path.
export { savefile, isValid };

/**
 * Suspend the game - offer to save with a turn penalty.
 * Port of suspend() from saveresume.c:67-109.
 */
export async function suspend(
  game: GameState,
  settings: Settings,
  io: GameIO,
): Promise<PhaseCode> {
  rspeak(game, io, Msg.SUSPEND_WARNING);
  if (
    !(await yesOrNo(
      game,
      io,
      settings,
      arbitraryMessages[Msg.THIS_ACCEPTABLE]!,
      arbitraryMessages[Msg.OK_MAN]!,
      arbitraryMessages[Msg.OK_MAN]!,
    ))
  ) {
    return PhaseCode.GO_CLEAROBJ;
  }
  if (settings.storage === null) {
    throw new Error("suspend(): settings.storage not configured");
  }
  game.saved = game.saved + 5;

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

/**
 * Resume a saved game from a file interactively.
 * Port of resume() from saveresume.c:111-149.
 */
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
        game,
        io,
        settings,
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
      // Not valid JSON — treat as bad magic
      rspeak(game, io, Msg.BAD_SAVE);
      return PhaseCode.GO_TOP;
    }
    return restore(save, game, io);
  }
}

/**
 * Restore game state from a save file.
 * Port of restore() from saveresume.c:151-175.
 */
export function restore(
  save: SaveFile,
  game: GameState,
  io: GameIO,
): PhaseCode {
  const result = deserializeGame(JSON.stringify(save));
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
        game,
        io,
        Msg.VERSION_SKEW,
        Math.trunc(result.saveVersion / 10),
        result.saveVersion % 10,
        Math.trunc(result.expectedVersion / 10),
        result.expectedVersion % 10,
      );
      break;
    case "tampering":
      rspeak(game, io, Msg.SAVE_TAMPERING);
      throw new TerminateError(0);
  }
  return PhaseCode.GO_TOP;
}
