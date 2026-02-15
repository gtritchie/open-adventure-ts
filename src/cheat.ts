/*
 * 'cheat' is a tool for generating save game files to test states that ought
 * not happen. It leverages initialise() and savefile(), so we know we're
 * always outputting save files that the game can import.
 *
 * Port of cheat.c.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { writeFileSync } from "node:fs";

import { createGameState, createSettings, initialise } from "./init.js";
import { savefile } from "./save.js";

const usage = `Usage: cheat [-d numdie] [-l lifetime] [-s numsaves] [-t turns] [-v version] -o savefilename
        -d number of deaths. Integer.
        -l lifetime of lamp in turns. Integer.
        -s number of saves. Integer.
        -t number of turns. Integer.
        -v version number of save format.
        -o required. File name of save game to write.`;

function main(): void {
  // Manual arg parsing to handle negative numbers (parseArgs rejects them)
  const argv = process.argv.slice(2);
  const vals: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-d" || arg === "-l" || arg === "-s" || arg === "-t" || arg === "-v" || arg === "-o") {
      const val = argv[++i];
      if (val === undefined) {
        process.stderr.write(`Missing value for ${arg}\n`);
        process.exit(1);
      }
      vals[arg.slice(1)] = val;
    }
  }

  // Initialize game variables
  const game = createGameState();
  const settings = createSettings();
  initialise(game, settings);

  // We're generating a saved game, so saved once by default
  game.saved = 1;

  let version: number | undefined;

  if (vals["d"] !== undefined) {
    game.numdie = parseInt(vals["d"], 10);
    process.stdout.write(`cheat: game.numdie = ${game.numdie}\n`);
  }
  if (vals["l"] !== undefined) {
    game.limit = parseInt(vals["l"], 10);
    process.stdout.write(`cheat: game.limit = ${game.limit}\n`);
  }
  if (vals["s"] !== undefined) {
    game.saved = parseInt(vals["s"], 10);
    process.stdout.write(`cheat: game.saved = ${game.saved}\n`);
  }
  if (vals["t"] !== undefined) {
    game.turns = parseInt(vals["t"], 10);
    process.stdout.write(`cheat: game.turns = ${game.turns}\n`);
  }
  if (vals["v"] !== undefined) {
    version = parseInt(vals["v"], 10);
    process.stdout.write(`cheat: version = ${version}\n`);
  }

  const savefilename = vals["o"];

  // Save filename required; the point of cheat is to generate a save file
  if (savefilename === undefined) {
    process.stderr.write(usage + "\n");
    process.stderr.write("ERROR: filename required\n");
    process.exit(1);
  }

  try {
    const save = savefile(game, version);
    writeFileSync(savefilename, JSON.stringify(save));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Can't open file ${savefilename}. ${msg}\n`);
    process.exit(1);
  }

  process.stdout.write(`cheat: ${savefilename} created.\n`);
}

main();
