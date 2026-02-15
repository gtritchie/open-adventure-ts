/*
 * Random number generator - LCG PRNG matching the C implementation exactly.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { LCG_A, LCG_C, LCG_M, TOKLEN } from "./types.js";
import type { GameState, Settings } from "./types.js";

function getNextLcgValue(game: GameState, settings: Settings): number {
  const oldX = game.lcgX;
  game.lcgX = (LCG_A * game.lcgX + LCG_C) % LCG_M;
  if (settings.debug) {
    // Match C: printf("# random %d\n", old_x);
    process.stderr.write(`# random ${oldX}\n`);
  }
  return oldX;
}

export function randrange(
  game: GameState,
  settings: Settings,
  range: number,
): number {
  return Math.trunc((range * getNextLcgValue(game, settings)) / LCG_M);
}

export function setSeed(game: GameState, settings: Settings, seedval: number): void {
  game.lcgX = seedval % LCG_M;
  if (game.lcgX < 0) {
    game.lcgX = LCG_M + game.lcgX;
  }
  // Generate the zzword (magic word from bird)
  let zzword = "";
  for (let i = 0; i < TOKLEN; i++) {
    zzword += String.fromCharCode("A".charCodeAt(0) + randrange(game, settings, 26));
  }
  // Force second char to apostrophe
  zzword = zzword[0]! + "'" + zzword.slice(2);
  game.zzword = zzword;
}
