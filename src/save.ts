/*
 * Saving and resuming - JSON-based save/restore.
 *
 * Port of saveresume.c.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { readFileSync, writeFileSync } from "node:fs";

import type { GameState, Settings, GameIO, SaveFile } from "./types.js";
import {
  PhaseCode,
  SAVE_VERSION,
  ADVENT_MAGIC,
  ENDIAN_MAGIC,
  LCG_M,
  STATE_NOTFOUND,
  PROP_IS_INVALID,
} from "./types.js";
import {
  NLOCATIONS,
  NOBJECTS,
  NDWARVES,
  NDEATHS,
  Location,
  Msg,
  objects,
  arbitraryMessages,
  MAX_STATE,
} from "./dungeon.js";
import { speak, rspeak } from "./format.js";
import { yesOrNo } from "./input.js";

/**
 * Build a SaveFile object from the current game state.
 * Port of savefile() from saveresume.c:32-44.
 */
export function savefile(game: GameState, version?: number): SaveFile {
  return {
    magic: ADVENT_MAGIC,
    version: version ?? SAVE_VERSION,
    canary: ENDIAN_MAGIC,
    game: structuredClone(game),
  };
}

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
  game.saved = game.saved + 5;

  for (;;) {
    const name = await io.readline("\nFile name: ");
    if (name === null) {
      return PhaseCode.GO_TOP;
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return PhaseCode.GO_TOP;
    }
    try {
      const save = savefile(game);
      writeFileSync(trimmed, JSON.stringify(save));
      break;
    } catch {
      io.print(`Can't open file ${trimmed}, try again.\n`);
    }
  }

  rspeak(game, io, Msg.RESUME_HELP);
  process.exit(0);
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

  for (;;) {
    const name = await io.readline("\nFile name: ");
    if (name === null) {
      return PhaseCode.GO_TOP;
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return PhaseCode.GO_TOP;
    }
    try {
      const data = readFileSync(trimmed, "utf-8");
      const save = JSON.parse(data) as SaveFile;
      return restore(save, game, io);
    } catch {
      io.print(`Can't open file ${trimmed}, try again.\n`);
    }
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
  if (save.magic !== ADVENT_MAGIC || save.canary !== ENDIAN_MAGIC) {
    rspeak(game, io, Msg.BAD_SAVE);
  } else if (save.version !== SAVE_VERSION) {
    rspeak(
      game,
      io,
      Msg.VERSION_SKEW,
      Math.trunc(save.version / 10),
      save.version % 10,
      Math.trunc(SAVE_VERSION / 10),
      SAVE_VERSION % 10,
    );
  } else if (!isValid(save.game)) {
    rspeak(game, io, Msg.SAVE_TAMPERING);
    process.exit(0);
  } else {
    Object.assign(game, save.game);
  }
  return PhaseCode.GO_TOP;
}

/**
 * Restore game from a file path (for -r command-line option).
 */
export function restoreFromFile(
  filepath: string,
  game: GameState,
  io: GameIO,
): PhaseCode {
  const data = readFileSync(filepath, "utf-8");
  const save = JSON.parse(data) as SaveFile;
  return restore(save, game, io);
}

/**
 * Validate game state from a save file.
 * Port of is_valid() from saveresume.c:177-269.
 */
export function isValid(valgame: GameState): boolean {
  /* Prevent division by zero */
  if (valgame.abbnum === 0) {
    return false;
  }

  /* Check for RNG overflow */
  if (valgame.lcgX >= LCG_M) {
    return false;
  }

  /* Bounds check for locations */
  if (
    valgame.chloc < -1 ||
    valgame.chloc > NLOCATIONS ||
    valgame.chloc2 < -1 ||
    valgame.chloc2 > NLOCATIONS ||
    valgame.loc < 0 ||
    valgame.loc > NLOCATIONS ||
    valgame.newloc < 0 ||
    valgame.newloc > NLOCATIONS ||
    valgame.oldloc < 0 ||
    valgame.oldloc > NLOCATIONS ||
    valgame.oldlc2 < 0 ||
    valgame.oldlc2 > NLOCATIONS
  ) {
    return false;
  }

  /* Bounds check for dwarf locations */
  for (let i = 0; i <= NDWARVES; i++) {
    if (
      valgame.dwarves[i]!.loc < -1 ||
      valgame.dwarves[i]!.loc > NLOCATIONS ||
      valgame.dwarves[i]!.oldloc < -1 ||
      valgame.dwarves[i]!.oldloc > NLOCATIONS
    ) {
      return false;
    }
  }

  /* Bounds check for object locations */
  for (let i = 0; i <= NOBJECTS; i++) {
    if (
      valgame.objects[i]!.place < -1 ||
      valgame.objects[i]!.place > NLOCATIONS ||
      valgame.objects[i]!.fixed < -1 ||
      valgame.objects[i]!.fixed > NLOCATIONS
    ) {
      return false;
    }
  }

  /* Bounds check for dwarves */
  if (
    valgame.dtotal < 0 ||
    valgame.dtotal > NDWARVES ||
    valgame.dkill < 0 ||
    valgame.dkill > NDWARVES
  ) {
    return false;
  }

  /* Validate that we didn't die too many times */
  if (valgame.numdie >= NDEATHS) {
    return false;
  }

  /* Recalculate tally, throw the towel if in disagreement */
  let tempTally = 0;
  for (let treasure = 1; treasure <= NOBJECTS; treasure++) {
    if (objects[treasure]!.isTreasure) {
      if (valgame.objects[treasure]!.prop === STATE_NOTFOUND) {
        ++tempTally;
      }
    }
  }
  if (tempTally !== valgame.tally) {
    return false;
  }

  /* Check that properties of objects aren't beyond expected */
  for (let obj = 0; obj <= NOBJECTS; obj++) {
    if (PROP_IS_INVALID(valgame.objects[obj]!.prop, MAX_STATE)) {
      return false;
    }
  }

  /* Check linked list values for objects in locations are in bounds */
  for (let loc = 0; loc <= NLOCATIONS; loc++) {
    if (
      valgame.locs[loc]!.atloc < 0 ||
      valgame.locs[loc]!.atloc > NOBJECTS * 2
    ) {
      return false;
    }
  }
  for (let obj = 0; obj <= NOBJECTS * 2; obj++) {
    if (valgame.link[obj]! < 0 || valgame.link[obj]! > NOBJECTS * 2) {
      return false;
    }
  }

  return true;
}
