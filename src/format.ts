/*
 * Message formatting - port of vspeak() from misc.c.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import type { GameState, GameIO } from "./types.js";
import { SpeakType, INSIDE } from "./types.js";
import {
  objects,
  arbitraryMessages,
  conditions,
  Location,
} from "./dungeon.js";

export const VERSION = "1.20";

/**
 * Core formatting engine - port of vspeak() from misc.c:37-147.
 * Handles %d, %s, %S (plural), %V (version).
 * Also performs "floor" -> "ground" substitution when OUTSIDE.
 */
export function vspeak(
  game: GameState,
  io: GameIO,
  msg: string | null,
  blank: boolean,
  args: (string | number)[],
): void {
  if (msg === null || msg === undefined) {
    return;
  }
  if (msg.length === 0) {
    return;
  }

  if (blank) {
    io.print("\n");
  }

  let rendered = "";
  let pluralize = false;
  let argIndex = 0;

  for (let i = 0; i < msg.length; i++) {
    if (msg[i] !== "%") {
      // "floor" -> "ground" substitution when not INSIDE (i.e., outside)
      // C: !INSIDE(game.loc) means OUTSIDE and not at LOC_BUILDING
      if (
        msg.substring(i, i + 5) === "floor" &&
        (msg[i + 5] === " " || msg[i + 5] === "." || i + 5 >= msg.length) &&
        !INSIDE(conditions, game.loc, Location.LOC_BUILDING)
      ) {
        rendered += "ground";
        i += 4; // skip "floor", loop will increment i
      } else {
        rendered += msg[i];
      }
    } else {
      i++;
      if (i >= msg.length) {
        break;
      }

      // Integer specifier
      if (msg[i] === "d") {
        const arg = args[argIndex++] as number;
        rendered += String(arg);
        pluralize = arg !== 1;
      }

      // Unmodified string specifier
      if (msg[i] === "s") {
        const arg = args[argIndex++] as string;
        rendered += arg;
      }

      // Singular/plural specifier
      if (msg[i] === "S") {
        if (pluralize) {
          rendered += "s";
        }
      }

      // Version specifier
      if (msg[i] === "V") {
        rendered += VERSION;
      }
    }
  }

  io.print(rendered + "\n");
}

/**
 * speak() - print a blank line then the message.
 * Port of speak() from misc.c:149-155.
 */
export function speak(
  game: GameState,
  io: GameIO,
  msg: string | null,
  ...args: (string | number)[]
): void {
  vspeak(game, io, msg, true, args);
}

/**
 * rspeak() - speak arbitrary_messages[i].
 * Port of rspeak() from misc.c:195-201.
 */
export function rspeak(
  game: GameState,
  io: GameIO,
  i: number,
  ...args: (string | number)[]
): void {
  vspeak(game, io, arbitraryMessages[i] ?? null, true, args);
}

/**
 * sspeak() - speak arbitrary_messages[i] with printf-style formatting.
 * Port of sspeak() from misc.c:157-165.
 * Unlike rspeak/speak, this uses vprintf directly in C (no floor/ground
 * substitution). We reproduce by doing simple %d/%s replacement.
 */
export function sspeak(
  game: GameState,
  io: GameIO,
  msgIndex: number,
  ...args: (string | number)[]
): void {
  const msg = arbitraryMessages[msgIndex] ?? "";
  io.print("\n");
  // Simple printf-style replacement (no floor/ground, no %S/%V)
  let argIndex = 0;
  let rendered = "";
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] === "%" && i + 1 < msg.length) {
      i++;
      if (msg[i] === "d") {
        rendered += String(args[argIndex++]);
      } else if (msg[i] === "s") {
        rendered += String(args[argIndex++]);
      } else {
        rendered += "%" + msg[i];
      }
    } else {
      rendered += msg[i];
    }
  }
  io.print(rendered + "\n");
}

/**
 * pspeak() - speak an object message by mode.
 * Port of pspeak() from misc.c:167-193.
 */
export function pspeak(
  game: GameState,
  io: GameIO,
  obj: number,
  mode: SpeakType,
  blank: boolean,
  skip: number,
  ...args: (string | number)[]
): void {
  const o = objects[obj];
  if (o === undefined) {
    return;
  }
  switch (mode) {
    case SpeakType.touch:
      vspeak(game, io, o.inventory, blank, args);
      break;
    case SpeakType.look:
      vspeak(game, io, o.descriptions[skip] ?? null, blank, args);
      break;
    case SpeakType.hear:
      vspeak(game, io, o.sounds[skip] ?? null, blank, args);
      break;
    case SpeakType.study:
      vspeak(game, io, o.texts[skip] ?? null, blank, args);
      break;
    case SpeakType.change:
      vspeak(game, io, o.changes[skip] ?? null, blank, args);
      break;
  }
}

/**
 * state_change() - change object state and speak the change message.
 * Port of state_change() from misc.c:788-793.
 */
export function stateChange(
  game: GameState,
  io: GameIO,
  obj: number,
  state: number,
): void {
  game.objects[obj]!.prop = state;
  pspeak(game, io, obj, SpeakType.change, true, state);
}
