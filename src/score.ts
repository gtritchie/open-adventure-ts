/*
 * Scoring and wrap-up.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import {
  Termination,
  OBJECT_IS_STASHED,
  OBJECT_IS_NOTFOUND,
  OBJECT_IS_FOUND,
  TerminateError,
} from "./types.js";
import type { GameState, GameIO, Settings } from "./types.js";
import {
  NOBJECTS,
  NHINTS,
  NCLASSES,
  NDEATHS,
  Location,
  Obj,
  objects,
  hints,
  classes,
  arbitraryMessages,
  Msg,
} from "./dungeon.js";

// Module-level mxscor, matching the C static variable
let mxscor = 0;

export function score(
  game: GameState,
  io: GameIO,
  mode: Termination,
  rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
  speak: (io: GameIO, msg: string | null, ...args: unknown[]) => void,
): number {
  let points = 0;
  mxscor = 0;

  /*  First tally up the treasures.  Must be in building and not broken.
   *  Give the poor guy 2 points just for finding each treasure. */
  for (let i = 1; i <= NOBJECTS; i++) {
    if (!objects[i]!.isTreasure) {
      continue;
    }
    if (objects[i]!.inventory !== null) {
      let k = 12;
      if (i === Obj.CHEST) {
        k = 14;
      }
      if (i > Obj.CHEST) {
        k = 16;
      }
      if (!OBJECT_IS_STASHED(game, i) && !OBJECT_IS_NOTFOUND(game, i)) {
        points += 2;
      }
      if (
        game.objects[i]!.place === Location.LOC_BUILDING &&
        OBJECT_IS_FOUND(game, i)
      ) {
        points += k - 2;
      }
      mxscor += k;
    }
  }

  /*  Now look at how he finished and how far he got. */
  points += (NDEATHS - game.numdie) * 10;
  mxscor += NDEATHS * 10;
  if (mode === Termination.endgame) {
    points += 4;
  }
  mxscor += 4;
  if (game.dflag !== 0) {
    points += 25;
  }
  mxscor += 25;
  if (game.closng) {
    points += 25;
  }
  mxscor += 25;
  if (game.closed) {
    if (game.bonus === 0) {
      // none
      points += 10;
    }
    if (game.bonus === 1) {
      // splatter
      points += 25;
    }
    if (game.bonus === 2) {
      // defeat
      points += 30;
    }
    if (game.bonus === 3) {
      // victory
      points += 45;
    }
  }
  mxscor += 45;

  /* Did he come to Witt's End as he should? */
  if (game.objects[Obj.MAGAZINE]!.place === Location.LOC_WITTSEND) {
    points += 1;
  }
  mxscor += 1;

  /* Round it off. */
  points += 2;
  mxscor += 2;

  /* Deduct for hints/turns/saves. */
  for (let i = 0; i < NHINTS; i++) {
    if (game.hints[i]!.used) {
      points -= hints[i]!.penalty;
    }
  }
  if (game.novice) {
    points -= 5;
  }
  if (game.clshnt) {
    points -= 10;
  }
  points = points - game.trnluz - game.saved;

  /* Return to score command if that's where we came from. */
  if (mode === Termination.scoregame) {
    rspeak(io, game, Msg.GARNERED_POINTS, points, mxscor, game.turns, game.turns);
  }

  return points;
}

export function terminate(
  game: GameState,
  io: GameIO,
  mode: Termination,
  rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
  speak: (io: GameIO, msg: string | null, ...args: unknown[]) => void,
): never {
  const points = score(game, io, mode, rspeak, speak);

  if (points + game.trnluz + 1 >= mxscor && game.trnluz !== 0) {
    rspeak(io, game, Msg.TOOK_LONG);
  }
  if (points + game.saved + 1 >= mxscor && game.saved !== 0) {
    rspeak(io, game, Msg.WITHOUT_SUSPENDS);
  }
  rspeak(io, game, Msg.TOTAL_SCORE, points, mxscor, game.turns, game.turns);
  for (let i = 1; i <= NCLASSES; i++) {
    if (classes[i]!.threshold >= points) {
      speak(io, classes[i]!.message);
      if (i < NCLASSES) {
        const nxt = classes[i]!.threshold + 1 - points;
        rspeak(io, game, Msg.NEXT_HIGHER, nxt, nxt);
      } else {
        rspeak(io, game, Msg.NO_HIGHER);
      }
      throw new TerminateError(0);
    }
  }
  rspeak(io, game, Msg.OFF_SCALE);
  throw new TerminateError(0);
}
