/*
 * Vocabulary - word lookup and command parsing.
 *
 * Port of vocabulary functions from misc.c:380-601.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import type {
  GameState,
  GameIO,
  Settings,
  Command,
  WordType,
} from "./types.js";
import {
  TOKLEN,
  WORD_NOT_FOUND,
  WORD_EMPTY,
  WordType as WT,
  CommandState,
  SpeechPart,
} from "./types.js";
import {
  NMOTIONS,
  NOBJECTS,
  NACTIONS,
  motions,
  objects,
  actions,
  ignore,
  Action,
  Msg,
  Obj,
} from "./dungeon.js";
import { rspeak } from "./format.js";
import { getInput } from "./input.js";

/**
 * Port of get_motion_vocab_id() from misc.c:380-395.
 * Returns the first motion index that has 'word' as one of its words.
 */
function getMotionVocabId(word: string, settings: Settings): number {
  for (let i = 0; i < NMOTIONS; i++) {
    const m = motions[i]!;
    for (let j = 0; j < m.words.n; j++) {
      if (
        word.toLowerCase().substring(0, TOKLEN) ===
          m.words.strs[j]!.toLowerCase().substring(0, TOKLEN) &&
        (word.length > 1 ||
          !ignore.includes(word[0]!) ||
          !settings.oldstyle)
      ) {
        return i;
      }
    }
  }
  return WORD_NOT_FOUND;
}

/**
 * Port of get_object_vocab_id() from misc.c:397-411.
 * Returns the first object index that has 'word' as one of its words.
 */
function getObjectVocabId(word: string): number {
  for (let i = 0; i < NOBJECTS + 1; i++) {
    const o = objects[i]!;
    for (let j = 0; j < o.words.n; j++) {
      if (
        word.toLowerCase().substring(0, TOKLEN) ===
        o.words.strs[j]!.toLowerCase().substring(0, TOKLEN)
      ) {
        return i;
      }
    }
  }
  return WORD_NOT_FOUND;
}

/**
 * Port of get_action_vocab_id() from misc.c:413-428.
 * Returns the first action index that has 'word' as one of its words.
 */
function getActionVocabId(word: string, settings: Settings): number {
  for (let i = 0; i < NACTIONS; i++) {
    const a = actions[i]!;
    for (let j = 0; j < a.words.n; j++) {
      if (
        word.toLowerCase().substring(0, TOKLEN) ===
          a.words.strs[j]!.toLowerCase().substring(0, TOKLEN) &&
        (word.length > 1 ||
          !ignore.includes(word[0]!) ||
          !settings.oldstyle)
      ) {
        return i;
      }
    }
  }
  return WORD_NOT_FOUND;
}

/**
 * Port of is_valid_int() from misc.c:430-454.
 */
function isValidInt(str: string): boolean {
  let s = str;
  if (s.startsWith("-")) {
    s = s.substring(1);
  }
  if (s.length === 0) {
    return false;
  }
  for (let i = 0; i < s.length; i++) {
    if (s[i]! < "0" || s[i]! > "9") {
      return false;
    }
  }
  return true;
}

/**
 * Port of get_vocab_metadata() from misc.c:456-507.
 * Populates id and type for a word.
 */
export function getVocabMetadata(
  word: string,
  game: GameState,
  settings: Settings,
): { id: number; type: WordType } {
  if (word === "") {
    return { id: WORD_EMPTY, type: WT.NO_WORD_TYPE };
  }

  let refNum: number;

  refNum = getMotionVocabId(word, settings);
  if (refNum !== WORD_NOT_FOUND) {
    return { id: refNum, type: WT.MOTION };
  }

  refNum = getObjectVocabId(word);
  if (refNum !== WORD_NOT_FOUND) {
    return { id: refNum, type: WT.OBJECT };
  }

  refNum = getActionVocabId(word, settings);
  if (refNum !== WORD_NOT_FOUND && refNum !== Action.PART) {
    return { id: refNum, type: WT.ACTION };
  }

  // Check for the reservoir magic word
  if (word.toLowerCase() === game.zzword.toLowerCase()) {
    return { id: Action.PART, type: WT.ACTION };
  }

  // Check words that are actually numbers
  if (isValidInt(word)) {
    return { id: WORD_EMPTY, type: WT.NUMERIC };
  }

  return { id: WORD_NOT_FOUND, type: WT.NO_WORD_TYPE };
}

/**
 * Port of tokenize() from misc.c:509-557.
 * Parses raw input into command words.
 */
export function tokenize(
  raw: string,
  cmd: Command,
  game: GameState,
  settings: Settings,
): void {
  // Split the raw input into words
  const parts = raw.trim().split(/\s+/);
  const word0raw = parts[0] ?? "";
  const word1raw = parts[1] ?? "";

  // In oldstyle mode, uppercase and truncate
  const TRUNCLEN = TOKLEN + TOKLEN;
  let w0 = word0raw;
  let w1 = word1raw;
  if (settings.oldstyle) {
    w0 = w0.substring(0, TRUNCLEN).toUpperCase();
    w1 = w1.substring(0, TRUNCLEN).toUpperCase();
  }

  cmd.word[0].raw = w0;
  cmd.word[1].raw = w1;

  // Populate command with parsed vocabulary metadata
  const meta0 = getVocabMetadata(cmd.word[0].raw, game, settings);
  cmd.word[0].id = meta0.id;
  cmd.word[0].type = meta0.type;

  const meta1 = getVocabMetadata(cmd.word[1].raw, game, settings);
  cmd.word[1].id = meta1.id;
  cmd.word[1].type = meta1.type;

  cmd.state = CommandState.TOKENIZED;
}

/**
 * Count words in a string (separated by spaces/tabs).
 * Port of word_count() from misc.c:213-232.
 */
function wordCount(str: string): number {
  const parts = str.trim().split(/[\s\t]+/);
  if (parts.length === 1 && parts[0] === "") {
    return 0;
  }
  return parts.length;
}

/**
 * Port of get_command_input() from misc.c:559-601.
 * Gets user input, parses and maps to command.
 */
export async function getCommandInput(
  command: Command,
  game: GameState,
  io: GameIO,
  settings: Settings,
): Promise<boolean> {
  for (;;) {
    const input = await getInput(game, io, settings);
    if (input === null) {
      return false;
    }
    if (wordCount(input) > 2) {
      rspeak(game, io, Msg.TWO_WORDS);
      continue;
    }
    if (input !== "") {
      tokenize(input, command, game, settings);
      command.state = CommandState.GIVEN;
      return true;
    }
  }
}

/**
 * Port of clear_command() from misc.c:603-610.
 * Resets the state of the command to empty.
 */
export function clearCommand(cmd: Command, game: GameState): void {
  cmd.verb = Action.ACT_NULL;
  cmd.part = SpeechPart.unknown;
  game.oldobj = cmd.obj;
  cmd.obj = Obj.NO_OBJECT;
  cmd.state = CommandState.EMPTY;
}
