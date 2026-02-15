/*
 * Object manipulation - carry, drop, move, put, juggle, destroy.
 *
 * Port of linked-list object management from misc.c:612-715.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import type { GameState } from "./types.js";
import { CARRIED, OBJECT_STASHIFY } from "./types.js";
import { NOBJECTS, Location, Obj } from "./dungeon.js";

/**
 * Port of carry() from misc.c:654-687.
 * Start toting an object, removing it from the list of things at its
 * former location. Increment holdng unless it was already being toted.
 * If object > NOBJECTS (moving "fixed" second loc), don't change
 * game.place or game.holdng.
 */
export function carry(game: GameState, object: number, where: number): void {
  if (object <= NOBJECTS) {
    if (game.objects[object]!.place === CARRIED) {
      return;
    }
    game.objects[object]!.place = CARRIED;

    // Bird is weightless when caged - don't count it
    if (object !== Obj.BIRD) {
      ++game.holdng;
    }
  }

  if (game.locs[where]!.atloc === object) {
    game.locs[where]!.atloc = game.link[object]!;
    return;
  }

  let temp = game.locs[where]!.atloc;
  while (game.link[temp]! !== object) {
    temp = game.link[temp]!;
  }
  game.link[temp] = game.link[object]!;
}

/**
 * Port of drop() from misc.c:689-715.
 * Place an object at a given loc, prefixing it onto the game atloc list.
 * Decrement game.holdng if the object was being toted.
 * No state change on the object.
 */
export function drop(game: GameState, object: number, where: number): void {
  if (object > NOBJECTS) {
    game.objects[object - NOBJECTS]!.fixed = where;
  } else {
    if (game.objects[object]!.place === CARRIED) {
      // Bird is weightless - don't decrement
      if (object !== Obj.BIRD) {
        --game.holdng;
      }
    }
    game.objects[object]!.place = where;
  }

  if (where === Location.LOC_NOWHERE || where === CARRIED) {
    return;
  }

  game.link[object] = game.locs[where]!.atloc;
  game.locs[where]!.atloc = object;
}

/**
 * Port of move() from misc.c:624-642.
 * Place any object anywhere by picking it up and dropping it.
 * May already be toting, in which case the carry is a no-op.
 * Mustn't pick up objects which are not at any loc, since carry wants
 * to remove objects from game atloc chains.
 */
export function move(game: GameState, object: number, where: number): void {
  let from: number;

  if (object > NOBJECTS) {
    from = game.objects[object - NOBJECTS]!.fixed;
  } else {
    from = game.objects[object]!.place;
  }

  if (from !== Location.LOC_NOWHERE && from !== CARRIED) {
    carry(game, object, from);
  }
  drop(game, object, where);
}

/**
 * Port of put() from misc.c:644-652.
 * Same as move(), except the object is stashed and can no longer be picked up.
 */
export function put(
  game: GameState,
  object: number,
  where: number,
  pval: number,
): void {
  move(game, object, where);
  OBJECT_STASHIFY(game, object, pval);
}

/**
 * Port of juggle() from misc.c:612-622.
 * Juggle an object by picking it up and putting it down again.
 * Purpose: get the object to the front of the chain at its loc.
 */
export function juggle(game: GameState, object: number): void {
  const i = game.objects[object]!.place;
  const j = game.objects[object]!.fixed;
  move(game, object, i);
  move(game, object + NOBJECTS, j);
}

/**
 * DESTROY macro equivalent - move object to LOC_NOWHERE.
 */
export function destroy(game: GameState, object: number): void {
  move(game, object, Location.LOC_NOWHERE);
}

/**
 * Port of atdwrf() from misc.c:717-737.
 * Return index of first dwarf at given location, 0 if no dwarf there
 * (or dwarves not active yet), -1 if all dwarves are dead.
 * Ignores the pirate (6th dwarf).
 */
export function atdwrf(game: GameState, where: number): number {
  let at = 0;
  if (game.dflag < 2) {
    return at;
  }
  at = -1;
  for (let i = 1; i <= 5; i++) {
    // NDWARVES - 1 = 5
    if (game.dwarves[i]!.loc === where) {
      return i;
    }
    if (game.dwarves[i]!.loc !== 0) {
      at = 0;
    }
  }
  return at;
}
