/*
 * Pure save/restore helpers — no IO, no exits.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import type { GameState, SaveFile, RestoreResult } from "./types.js";
import {
  ADVENT_MAGIC,
  ENDIAN_MAGIC,
  SAVE_VERSION,
  LCG_M,
  STATE_NOTFOUND,
  PROP_IS_INVALID,
} from "./types.js";
import {
  NLOCATIONS,
  NOBJECTS,
  NDWARVES,
  NDEATHS,
  objects,
  MAX_STATE,
} from "./dungeon.js";

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

export function serializeGame(state: GameState): string {
  return JSON.stringify(savefile(state));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function deserializeGame(json: string): RestoreResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: "bad-json", message: "Save file is not valid JSON." };
  }
  if (!isObject(raw)) {
    return { ok: false, reason: "bad-magic", message: "Save file is not an Open Adventure save." };
  }
  const save = raw as Partial<SaveFile>;
  if (
    save.magic !== ADVENT_MAGIC ||
    save.canary !== ENDIAN_MAGIC ||
    typeof save.version !== "number"
  ) {
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
  if (!isObject(save.game)) {
    return { ok: false, reason: "tampering", message: "Save file failed integrity check." };
  }
  // isValid() dereferences nested arrays (dwarves, objects, locs, link) without
  // shape-checking them, so a header-valid payload with a partial game object
  // can throw instead of returning false. Catch here to honour the contract
  // that deserializeGame never throws.
  let valid = false;
  try {
    valid = isValid(save.game as GameState);
  } catch {
    valid = false;
  }
  if (!valid) {
    return { ok: false, reason: "tampering", message: "Save file failed integrity check." };
  }
  return { ok: true, state: save.game as GameState };
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
