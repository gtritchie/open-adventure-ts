/*
 * Input handling - get_input, yes_or_no, silent_yes_or_no.
 *
 * Port of input functions from misc.c:234-376.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import type { GameState, GameIO, Settings } from "./types.js";
import { PROMPT } from "./types.js";
import { speak, rspeak } from "./format.js";
import { Msg } from "./dungeon.js";

/**
 * Port of get_input() from misc.c:234-273.
 * Gets a line of input, skipping comments (lines starting with #).
 * Prints a blank line before the prompt.
 */
export async function getInput(
  game: GameState,
  io: GameIO,
  settings: Settings,
): Promise<string | null> {
  const inputPrompt = settings.prompt ? PROMPT : "";

  // Print a blank line
  io.print("\n");

  for (;;) {
    const input = await io.readline(inputPrompt);

    if (input === null) {
      return null;
    }

    // Ignore comments
    if (input.startsWith("#")) {
      continue;
    }

    // Strip trailing newlines
    const stripped = input.replace(/\n+$/, "");

    return stripped;
  }
}

/**
 * Port of silent_yes_or_no() from misc.c:275-320.
 * Asks for yes/no without speaking a question first.
 */
export async function silentYesOrNo(
  game: GameState,
  io: GameIO,
  settings: Settings,
): Promise<boolean> {
  for (;;) {
    const reply = await getInput(game, io, settings);
    if (reply === null) {
      // Should be unreachable in normal operation
      process.exit(0);
    }
    if (reply.length === 0) {
      rspeak(game, io, Msg.PLEASE_ANSWER);
      continue;
    }

    // Extract first word and lowercase it
    // C uses strncmp("yes", firstword, 3) etc., so "yesterday" matches "yes"
    const firstword = reply.trim().split(/\s+/)[0]!.toLowerCase();

    if (firstword[0] === "y") {
      return true;
    } else if (firstword[0] === "n") {
      return false;
    } else {
      rspeak(game, io, Msg.PLEASE_ANSWER);
    }
  }
}

/**
 * Port of yes_or_no() from misc.c:322-376.
 * Speaks a question, waits for yes/no, speaks appropriate response.
 */
export async function yesOrNo(
  game: GameState,
  io: GameIO,
  settings: Settings,
  question: string | null,
  yesResponse: string | null,
  noResponse: string | null,
): Promise<boolean> {
  for (;;) {
    speak(game, io, question);

    const reply = await getInput(game, io, settings);
    if (reply === null) {
      // Should be unreachable in normal operation
      process.exit(0);
    }

    if (reply.length === 0) {
      rspeak(game, io, Msg.PLEASE_ANSWER);
      continue;
    }

    // Extract first word and lowercase it
    // C uses strncmp("yes", firstword, 3) etc.
    const firstword = reply.trim().split(/\s+/)[0]!.toLowerCase();

    if (firstword[0] === "y") {
      speak(game, io, yesResponse);
      return true;
    } else if (firstword[0] === "n") {
      speak(game, io, noResponse);
      return false;
    } else {
      rspeak(game, io, Msg.PLEASE_ANSWER);
    }
  }
}
