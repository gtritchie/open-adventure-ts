/*
 * Dwarf AI - movement and pirate behavior.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import {
  TOTING,
  AT,
  HERE,
  FORCED,
  CNDBIT,
  INDEEP,
  OBJECT_IS_NOTFOUND,
  OBJECT_IS_FOUND,
  COND_NOARRR,
  COND_NOBACK,
  IS_FREE,
} from "./types.js";
import type { GameState, GameIO, Settings } from "./types.js";
import {
  NOBJECTS,
  NDWARVES,
  Location,
  Obj,
  Msg,
  ObjState,
  objects,
  conditions,
  travel,
  tkey,
} from "./dungeon.js";

const PIRATE = NDWARVES; // pirate is last dwarf
const DALTLC = Location.LOC_NUGGET; // alternate dwarf location

function spottedByPirate(
  game: GameState,
  settings: Settings,
  io: GameIO,
  i: number,
  rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
  move: (game: GameState, obj: number, where: number) => void,
  carry: (game: GameState, obj: number, where: number) => void,
  drop: (game: GameState, obj: number, where: number) => void,
  PCT: (game: GameState, settings: Settings, n: number) => boolean,
): boolean {
  if (i !== PIRATE) {
    return false;
  }

  /* The pirate's spotted him.  Pirate leaves him alone once we've
   * found chest. */
  if (
    game.loc === game.chloc ||
    !OBJECT_IS_NOTFOUND(game, Obj.CHEST)
  ) {
    return true;
  }

  let snarfed = 0;
  let movechest = false;
  let robplayer = false;
  for (let treasure = 1; treasure <= NOBJECTS; treasure++) {
    if (!objects[treasure]!.isTreasure) {
      continue;
    }
    /* Pirate won't take pyramid from plover room or dark room (too easy!). */
    if (
      treasure === Obj.PYRAMID &&
      (game.loc === objects[Obj.PYRAMID]!.plac ||
        game.loc === objects[Obj.EMERALD]!.plac)
    ) {
      continue;
    }
    if (TOTING(game, treasure) || HERE(game, treasure)) {
      ++snarfed;
    }
    if (TOTING(game, treasure)) {
      movechest = true;
      robplayer = true;
    }
  }

  /* Force chest placement before player finds last treasure */
  if (
    game.tally === 1 &&
    snarfed === 0 &&
    game.objects[Obj.CHEST]!.place === Location.LOC_NOWHERE &&
    HERE(game, Obj.LAMP) &&
    game.objects[Obj.LAMP]!.prop === ObjState.LAMP_BRIGHT
  ) {
    rspeak(io, game, Msg.PIRATE_SPOTTED);
    movechest = true;
  }

  /* Do things in this order (chest move before robbery) so chest is
   * listed last at the maze location. */
  if (movechest) {
    move(game, Obj.CHEST, game.chloc);
    move(game, Obj.MESSAG, game.chloc2);
    game.dwarves[PIRATE]!.loc = game.chloc;
    game.dwarves[PIRATE]!.oldloc = game.chloc;
    game.dwarves[PIRATE]!.seen = 0;
  } else {
    /* You might get a hint of the pirate's presence even if the
     * chest doesn't move... */
    if (
      game.dwarves[PIRATE]!.oldloc !== game.dwarves[PIRATE]!.loc &&
      PCT(game, settings, 20)
    ) {
      rspeak(io, game, Msg.PIRATE_RUSTLES);
    }
  }

  if (robplayer) {
    rspeak(io, game, Msg.PIRATE_POUNCES);
    for (let treasure = 1; treasure <= NOBJECTS; treasure++) {
      if (!objects[treasure]!.isTreasure) {
        continue;
      }
      if (
        !(
          treasure === Obj.PYRAMID &&
          (game.loc === objects[Obj.PYRAMID]!.plac ||
            game.loc === objects[Obj.EMERALD]!.plac)
        )
      ) {
        if (AT(game, treasure) && game.objects[treasure]!.fixed === IS_FREE) {
          carry(game, treasure, game.loc);
        }
        if (TOTING(game, treasure)) {
          drop(game, treasure, game.chloc);
        }
      }
    }
  }

  return true;
}

/**
 * Move dwarves. Returns true if player survives, false if killed by dwarf.
 */
export function dwarfmove(
  game: GameState,
  settings: Settings,
  io: GameIO,
  rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
  move: (game: GameState, obj: number, where: number) => void,
  carry: (game: GameState, obj: number, where: number) => void,
  drop: (game: GameState, obj: number, where: number) => void,
  randrange: (game: GameState, settings: Settings, range: number) => number,
  PCT: (game: GameState, settings: Settings, n: number) => boolean,
): boolean {
  const tk: number[] = new Array<number>(21).fill(0);

  /* First off, don't let the dwarves follow him into a pit or a wall.
   * Activate the whole mess the first time he gets as far as the Hall of
   * Mists (what INDEEP() tests). If game.newloc is forbidden to pirate,
   * bypass dwarf stuff. */
  if (
    game.loc === Location.LOC_NOWHERE ||
    FORCED(conditions, game.loc) ||
    CNDBIT(conditions, game.newloc, COND_NOARRR)
  ) {
    return true;
  }

  /* Dwarf activity level ratchets up */
  if (game.dflag === 0) {
    if (INDEEP(conditions, game.loc)) {
      game.dflag = 1;
    }
    return true;
  }

  /* When we encounter the first dwarf, we kill 0, 1, or 2 of the 5 dwarves.
   * If any of the survivors is at game.loc, replace him with the alternate. */
  if (game.dflag === 1) {
    if (
      !INDEEP(conditions, game.loc) ||
      (PCT(game, settings, 95) &&
        (!CNDBIT(conditions, game.loc, COND_NOBACK) || PCT(game, settings, 85)))
    ) {
      return true;
    }
    game.dflag = 2;
    for (let i = 1; i <= 2; i++) {
      const j = 1 + randrange(game, settings, NDWARVES - 1);
      if (PCT(game, settings, 50)) {
        game.dwarves[j]!.loc = 0;
      }
    }

    /* Alternate initial loc for dwarf, in case one of them starts out on
     * top of the adventurer. */
    for (let i = 1; i <= NDWARVES - 1; i++) {
      if (game.dwarves[i]!.loc === game.loc) {
        game.dwarves[i]!.loc = DALTLC;
      }
      game.dwarves[i]!.oldloc = game.dwarves[i]!.loc;
    }
    rspeak(io, game, Msg.DWARF_RAN);
    drop(game, Obj.AXE, game.loc);
    return true;
  }

  /* Things are in full swing. Move each dwarf at random, except if he's
   * seen us he sticks with us. */
  game.dtotal = 0;
  let attack = 0;
  let stick = 0;
  for (let i = 1; i <= NDWARVES; i++) {
    if (game.dwarves[i]!.loc === 0) {
      continue;
    }
    /* Fill tk array with all the places this dwarf might go. */
    let j = 1;
    let kk = tkey[game.dwarves[i]!.loc]!;
    if (kk !== 0) {
      do {
        const desttype = travel[kk]!.desttype;
        game.newloc = travel[kk]!.destval;
        /* Have we avoided a dwarf encounter? */
        if (desttype !== 0) {
          // not dest_goto
          // continue
        } else if (!INDEEP(conditions, game.newloc)) {
          // continue
        } else if (game.newloc === game.dwarves[i]!.oldloc) {
          // continue
        } else if (j > 1 && game.newloc === tk[j - 1]) {
          // continue
        } else if (j >= tk.length - 1) {
          // continue
        } else if (game.newloc === game.dwarves[i]!.loc) {
          // continue
        } else if (FORCED(conditions, game.newloc)) {
          // continue
        } else if (
          i === PIRATE &&
          CNDBIT(conditions, game.newloc, COND_NOARRR)
        ) {
          // continue
        } else if (travel[kk]!.nodwarves) {
          // continue
        } else {
          tk[j++] = game.newloc;
        }
      } while (!travel[kk++]!.stop);
    }
    tk[j] = game.dwarves[i]!.oldloc;
    if (j >= 2) {
      --j;
    }
    j = 1 + randrange(game, settings, j);
    game.dwarves[i]!.oldloc = game.dwarves[i]!.loc;
    game.dwarves[i]!.loc = tk[j]!;
    game.dwarves[i]!.seen =
      (game.dwarves[i]!.seen && INDEEP(conditions, game.loc)) ||
      game.dwarves[i]!.loc === game.loc ||
      game.dwarves[i]!.oldloc === game.loc
        ? 1
        : 0;
    if (!game.dwarves[i]!.seen) {
      continue;
    }
    game.dwarves[i]!.loc = game.loc;
    if (spottedByPirate(game, settings, io, i, rspeak, move, carry, drop, PCT)) {
      continue;
    }
    /* This threatening little dwarf is in the room with him! */
    ++game.dtotal;
    if (game.dwarves[i]!.oldloc === game.dwarves[i]!.loc) {
      ++attack;
      if (game.knfloc >= Location.LOC_NOWHERE) {
        game.knfloc = game.loc;
      }
      if (randrange(game, settings, 1000) < 95 * (game.dflag - 2)) {
        ++stick;
      }
    }
  }

  /* Now we know what's happening. Let's tell the poor sucker about it. */
  if (game.dtotal === 0) {
    return true;
  }
  rspeak(
    io,
    game,
    game.dtotal === 1 ? Msg.DWARF_SINGLE : Msg.DWARF_PACK,
    game.dtotal,
  );
  if (attack === 0) {
    return true;
  }
  if (game.dflag === 2) {
    game.dflag = 3;
  }
  if (attack > 1) {
    rspeak(io, game, Msg.THROWN_KNIVES, attack);
    rspeak(
      io,
      game,
      stick > 1 ? Msg.MULTIPLE_HITS : stick === 1 ? Msg.ONE_HIT : Msg.NONE_HIT,
      stick,
    );
  } else {
    rspeak(io, game, Msg.KNIFE_THROWN);
    rspeak(io, game, stick ? Msg.GETS_YOU : Msg.MISSES_YOU);
  }
  if (stick === 0) {
    return true;
  }
  game.oldlc2 = game.loc;
  return false;
}

/**
 * Return the index of first dwarf at the given location, zero if no dwarf is
 * there (or if dwarves not active yet), -1 if all dwarves are dead. Ignore
 * the pirate (6th dwarf).
 */
export function atdwrf(game: GameState, where: number): number {
  let at = 0;
  if (game.dflag < 2) {
    return at;
  }
  at = -1;
  for (let i = 1; i <= NDWARVES - 1; i++) {
    if (game.dwarves[i]!.loc === where) {
      return i;
    }
    if (game.dwarves[i]!.loc !== 0) {
      at = 0;
    }
  }
  return at;
}
