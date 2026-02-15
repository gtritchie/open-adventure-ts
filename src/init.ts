/*
 * Game initialization - port of initialise() from init.c.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import type {
  GameState,
  Settings,
  LocationState,
  DwarfState,
  ObjectState,
  HintState,
} from "./types.js";
import {
  WORD_EMPTY,
  GAMELIMIT,
  WARNTIME,
  FLASHTIME,
  COND_FORCED,
  COND_HBASE,
  ScoreBonus,
  setbit,
  OBJECT_SET_FOUND,
  OBJECT_SET_NOT_FOUND,
} from "./types.js";
import {
  NLOCATIONS,
  NOBJECTS,
  NDWARVES,
  NHINTS,
  objects,
  locations,
  travel,
  tkey,
  conditions,
  dwarflocs,
  Location,
  Motion,
} from "./dungeon.js";
import { setSeed } from "./rng.js";
import { drop } from "./object-manipulation.js";

/**
 * Create a fresh GameState with the default initial values.
 * Port of the static game initializer from init.c:19-27.
 */
export function createGameState(): GameState {
  // Create location state array
  const locs: LocationState[] = [];
  for (let i = 0; i <= NLOCATIONS; i++) {
    locs.push({ abbrev: 0, atloc: 0 });
  }

  // Create dwarf state array
  const dwarves: DwarfState[] = [];
  for (let i = 0; i <= NDWARVES; i++) {
    dwarves.push({ seen: 0, loc: 0, oldloc: 0 });
  }

  // Create object state array
  const objectStates: ObjectState[] = [];
  for (let i = 0; i <= NOBJECTS; i++) {
    objectStates.push({ fixed: 0, prop: 0, place: 0 });
  }

  // Create hint state array
  const hints: HintState[] = [];
  for (let i = 0; i < NHINTS; i++) {
    hints.push({ used: false, lc: 0 });
  }

  // Create link array
  const link: number[] = [];
  for (let i = 0; i <= NOBJECTS * 2; i++) {
    link.push(0);
  }

  return {
    lcgX: 0,
    abbnum: 5,
    bonus: ScoreBonus.none,
    chloc: Location.LOC_MAZEEND12,
    chloc2: Location.LOC_DEADEND13,
    clock1: WARNTIME,
    clock2: FLASHTIME,
    clshnt: false,
    closed: false,
    closng: false,
    lmwarn: false,
    novice: false,
    panic: false,
    wzdark: false,
    blooded: false,
    conds: 0,
    detail: 0,
    dflag: 0,
    dkill: 0,
    dtotal: 0,
    foobar: WORD_EMPTY,
    holdng: 0,
    igo: 0,
    iwest: 0,
    knfloc: 0,
    limit: GAMELIMIT,
    loc: Location.LOC_START,
    newloc: Location.LOC_START,
    numdie: 0,
    oldloc: 0,
    oldlc2: 0,
    oldobj: 0,
    saved: 0,
    tally: 0,
    thresh: 0,
    seenbigwords: false,
    trnluz: 0,
    turns: 0,
    zzword: "",
    locs,
    dwarves,
    objects: objectStates,
    hints,
    link,
  };
}

/**
 * Create default settings.
 */
export function createSettings(): Settings {
  return {
    logfp: null,
    oldstyle: false,
    prompt: true,
    scriptLines: null,
    scriptIndex: 0,
    debug: 0,
  };
}

/**
 * Port of initialise() from init.c:29-96.
 * Sets up the game state: seeds RNG, places objects, sets up dwarves,
 * computes COND_FORCED bits.
 *
 * Returns the seed value used.
 */
export function initialise(game: GameState, settings: Settings): number {
  if (settings.oldstyle) {
    process.stdout.write("Initialising...\n");
  }

  const seedval = Math.trunc(Math.random() * 2147483647);
  setSeed(game, settings, seedval);

  // Set up dwarf locations
  for (let i = 1; i <= NDWARVES; i++) {
    game.dwarves[i]!.loc = dwarflocs[i - 1]!;
  }

  // Set all objects to LOC_NOWHERE initially
  for (let i = 1; i <= NOBJECTS; i++) {
    game.objects[i]!.place = Location.LOC_NOWHERE;
  }

  // Compute COND_FORCED bits
  for (let i = 1; i <= NLOCATIONS; i++) {
    const loc = locations[i];
    if (loc !== undefined && !(loc.description.big === null || tkey[i] === 0)) {
      const k = tkey[i]!;
      const t = travel[k];
      if (t !== undefined && t.motion === Motion.HERE) {
        conditions[i] = (conditions[i] ?? 0) | (1 << COND_FORCED);
      }
    }
  }

  // Set up atloc and link arrays.
  // Drop objects in reverse order so they end up in the right order.
  // Two-placed objects first.
  for (let i = NOBJECTS; i >= 1; i--) {
    if (objects[i]!.fixd > 0) {
      drop(game, i + NOBJECTS, objects[i]!.fixd);
      drop(game, i, objects[i]!.plac);
    }
  }

  // Then single-placed objects, also in reverse order.
  for (let i = 1; i <= NOBJECTS; i++) {
    const k = NOBJECTS + 1 - i;
    game.objects[k]!.fixed = objects[k]!.fixd;
    if (objects[k]!.plac !== 0 && objects[k]!.fixd <= 0) {
      drop(game, k, objects[k]!.plac);
    }
  }

  // Set treasure props: STATE_NOTFOUND for treasures, STATE_FOUND for non-treasures.
  for (let object = 1; object <= NOBJECTS; object++) {
    if (objects[object]!.isTreasure) {
      ++game.tally;
      if (objects[object]!.inventory !== null) {
        OBJECT_SET_NOT_FOUND(game, object);
      }
    } else {
      OBJECT_SET_FOUND(game, object);
    }
  }

  game.conds = setbit(COND_HBASE);

  return seedval;
}
