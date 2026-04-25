/*
 * Player movement - travel table lookup and condition evaluation.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import {
  TOTING,
  AT,
  FORCED,
  CNDBIT,
  COND_NOBACK,
  IS_FIXED,
  IS_FREE,
  BugType,
  CondType,
  DestType,
  SpeakType,
} from "./types.js";
import type { GameState, GameIO, Settings } from "./types.js";
import {
  NOBJECTS,
  Location,
  Obj,
  Motion,
  Msg,
  ObjState,
  objects,
  conditions,
  travel,
  tkey,
} from "./dungeon.js";

function traveleq(a: number, b: number): boolean {
  /* Are two travel entries equal for purposes of skip after failed condition? */
  return (
    travel[a]!.condtype === travel[b]!.condtype &&
    travel[a]!.condarg1 === travel[b]!.condarg1 &&
    travel[a]!.condarg2 === travel[b]!.condarg2 &&
    travel[a]!.desttype === travel[b]!.desttype &&
    travel[a]!.destval === travel[b]!.destval
  );
}

/**
 * Given the current location in game.loc, and a motion verb number in
 * "motion", put the new location in game.newloc. The current loc is saved
 * in game.oldloc in case he wants to retreat. The current game.oldloc is
 * saved in game.oldlc2, in case he dies.
 */
export async function playermove(
  game: GameState,
  settings: Settings,
  io: GameIO,
  motion: number,
  rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
  pspeak: (
    io: GameIO,
    game: GameState,
    obj: number,
    mode: number,
    blank: boolean,
    skip: number,
    ...args: unknown[]
  ) => void,
  move: (game: GameState, obj: number, where: number) => void,
  drop: (game: GameState, obj: number, where: number) => void,
  juggle: (game: GameState, obj: number) => void,
  stateChange: (
    game: GameState,
    io: GameIO,
    obj: number,
    state: number,
  ) => void,
  croak: () => Promise<void>,
  bug: (type: BugType, msg: string) => never,
  PCT: (game: GameState, settings: Settings, n: number) => boolean,
): Promise<void> {
  let travelEntry = tkey[game.loc]!;
  game.newloc = game.loc;
  if (travelEntry === 0) {
    bug(
      BugType.LOCATION_HAS_NO_TRAVEL_ENTRIES,
      "LOCATION_HAS_NO_TRAVEL_ENTRIES",
    );
  }
  if (motion === Motion.NUL) {
    return;
  } else if (motion === Motion.BACK) {
    /* Handle "go back". Look for verb which goes from game.loc to
     * game.oldloc, or to game.oldlc2 if game.oldloc has forced-motion. */
    motion = game.oldloc;
    if (FORCED(conditions, motion)) {
      motion = game.oldlc2;
    }
    game.oldlc2 = game.oldloc;
    game.oldloc = game.loc;
    if (CNDBIT(conditions, game.loc, COND_NOBACK)) {
      rspeak(io, game, Msg.TWIST_TURN);
      return;
    }
    if (motion === game.loc) {
      rspeak(io, game, Msg.FORGOT_PATH);
      return;
    }

    let teTmp = 0;
    for (;;) {
      const desttype = travel[travelEntry]!.desttype;
      const scratchloc = travel[travelEntry]!.destval;
      if (desttype !== DestType.dest_goto || scratchloc !== motion) {
        if (desttype === DestType.dest_goto) {
          if (
            FORCED(conditions, scratchloc) &&
            travel[tkey[scratchloc]!]!.destval === motion
          ) {
            teTmp = travelEntry;
          }
        }
        if (!travel[travelEntry]!.stop) {
          ++travelEntry;
          continue;
        }
        /* we've reached the end of travel entries for game.loc */
        travelEntry = teTmp;
        if (travelEntry === 0) {
          rspeak(io, game, Msg.NOT_CONNECTED);
          return;
        }
      }

      motion = travel[travelEntry]!.motion;
      travelEntry = tkey[game.loc]!;
      break; /* fall through to ordinary travel */
    }
  } else if (motion === Motion.LOOK) {
    /* Look. Can't give more detail. Pretend it wasn't dark so he
     * won't fall into a pit while staring into the gloom. */
    if (game.detail < 3) {
      rspeak(io, game, Msg.NO_MORE_DETAIL);
    }
    ++game.detail;
    game.wzdark = false;
    game.locs[game.loc]!.abbrev = 0;
    return;
  } else if (motion === Motion.CAVE) {
    /* Cave. Different messages depending on whether above ground. */
    const isOutside =
      CNDBIT(conditions, game.loc, 5) || // COND_ABOVE
      CNDBIT(conditions, game.loc, 7); // COND_FOREST (OUTSIDE macro)
    rspeak(
      io,
      game,
      isOutside && game.loc !== Location.LOC_GRATE
        ? Msg.FOLLOW_STREAM
        : Msg.NEED_DETAIL,
    );
    return;
  } else {
    /* none of the specials */
    game.oldlc2 = game.oldloc;
    game.oldloc = game.loc;
  }

  /* Look for a way to fulfil the motion verb passed in - travelEntry
   * indexes the beginning of the motion entries for here (game.loc). */
  for (;;) {
    if (
      travel[travelEntry]!.motion === Motion.HERE ||
      travel[travelEntry]!.motion === motion
    ) {
      break;
    }
    if (travel[travelEntry]!.stop) {
      /* Couldn't find an entry matching the motion word passed in. */
      switch (motion) {
        case Motion.EAST:
        case Motion.WEST:
        case Motion.SOUTH:
        case Motion.NORTH:
        case Motion.NE:
        case Motion.NW:
        case Motion.SW:
        case Motion.SE:
        case Motion.UP:
        case Motion.DOWN:
          rspeak(io, game, Msg.BAD_DIRECTION);
          break;
        case Motion.FORWARD:
        case Motion.LEFT:
        case Motion.RIGHT:
          rspeak(io, game, Msg.UNSURE_FACING);
          break;
        case Motion.OUTSIDE:
        case Motion.INSIDE:
          rspeak(io, game, Msg.NO_INOUT_HERE);
          break;
        case Motion.XYZZY:
        case Motion.PLUGH:
          rspeak(io, game, Msg.NOTHING_HAPPENS);
          break;
        case Motion.CRAWL:
          rspeak(io, game, Msg.WHICH_WAY);
          break;
        default:
          rspeak(io, game, Msg.CANT_APPLY);
      }
      return;
    }
    ++travelEntry;
  }

  /* We've found a destination that goes with the motion verb.
   * Next we need to check any conditional(s) on this destination, and
   * possibly on following entries. */

  /* L12 loop */
  for (;;) {
    for (;;) {
      const condtype = travel[travelEntry]!.condtype;
      const condarg1 = travel[travelEntry]!.condarg1;
      const condarg2 = travel[travelEntry]!.condarg2;
      let conditionMet = false;
      if (condtype < CondType.cond_not) {
        /* YAML N and [pct N] conditionals */
        if (
          condtype === CondType.cond_goto ||
          condtype === CondType.cond_pct
        ) {
          if (condarg1 === 0 || PCT(game, settings, condarg1)) {
            conditionMet = true;
          }
        } else if (
          /* YAML [with OBJ] clause */
          TOTING(game, condarg1) ||
          (condtype === CondType.cond_with && AT(game, condarg1))
        ) {
          conditionMet = true;
        }
      } else if (game.objects[condarg1]!.prop !== condarg2) {
        conditionMet = true;
      }

      if (conditionMet) {
        break;
      }

      /* We arrive here on conditional failure.
       * Skip to next non-matching destination */
      let teTmp = travelEntry;
      do {
        if (travel[teTmp]!.stop) {
          bug(
            BugType.CONDITIONAL_TRAVEL_ENTRY_WITH_NO_ALTERATION,
            "CONDITIONAL_TRAVEL_ENTRY_WITH_NO_ALTERATION",
          );
        }
        ++teTmp;
      } while (traveleq(travelEntry, teTmp));
      travelEntry = teTmp;
    }

    /* Found an eligible rule, now execute it */
    const desttype = travel[travelEntry]!.desttype;
    game.newloc = travel[travelEntry]!.destval;
    if (desttype === DestType.dest_goto) {
      return;
    }

    if (desttype === DestType.dest_speak) {
      /* Execute a speak rule */
      rspeak(io, game, game.newloc);
      game.newloc = game.loc;
      return;
    } else {
      /* dest_special */
      switch (game.newloc) {
        case 1: {
          /* Special travel 1. Plover-alcove passage.
           * Can carry only emerald. */
          game.newloc =
            game.loc === Location.LOC_PLOVER
              ? Location.LOC_ALCOVE
              : Location.LOC_PLOVER;
          if (
            game.holdng > 1 ||
            (game.holdng === 1 && !TOTING(game, Obj.EMERALD))
          ) {
            game.newloc = game.loc;
            rspeak(io, game, Msg.MUST_DROP);
          }
          return;
        }
        case 2: {
          /* Special travel 2. Plover transport.
           * Drop the emerald, then skip to next alt. */
          drop(game, Obj.EMERALD, game.loc);
          let teTmp = travelEntry;
          do {
            if (travel[teTmp]!.stop) {
              bug(
                BugType.CONDITIONAL_TRAVEL_ENTRY_WITH_NO_ALTERATION,
                "CONDITIONAL_TRAVEL_ENTRY_WITH_NO_ALTERATION",
              );
            }
            ++teTmp;
          } while (traveleq(travelEntry, teTmp));
          travelEntry = teTmp;
          continue; /* goto L12 */
        }
        case 3: {
          /* Special travel 3. Troll bridge. */
          if (game.objects[Obj.TROLL]!.prop === ObjState.TROLL_PAIDONCE) {
            pspeak(
              io,
              game,
              Obj.TROLL,
              SpeakType.look,
              true,
              ObjState.TROLL_PAIDONCE,
            );
            game.objects[Obj.TROLL]!.prop = ObjState.TROLL_UNPAID;
            move(game, Obj.TROLL2, Location.LOC_NOWHERE); // DESTROY
            move(game, Obj.TROLL2 + NOBJECTS, IS_FREE);
            move(game, Obj.TROLL, objects[Obj.TROLL]!.plac);
            move(game, Obj.TROLL + NOBJECTS, objects[Obj.TROLL]!.fixd);
            juggle(game, Obj.CHASM);
            game.newloc = game.loc;
            return;
          } else {
            game.newloc =
              objects[Obj.TROLL]!.plac +
              objects[Obj.TROLL]!.fixd -
              game.loc;
            if (game.objects[Obj.TROLL]!.prop === ObjState.TROLL_UNPAID) {
              game.objects[Obj.TROLL]!.prop = ObjState.TROLL_PAIDONCE;
            }
            if (!TOTING(game, Obj.BEAR)) {
              return;
            }
            stateChange(game, io, Obj.CHASM, ObjState.BRIDGE_WRECKED);
            game.objects[Obj.TROLL]!.prop = ObjState.TROLL_GONE;
            drop(game, Obj.BEAR, game.newloc);
            game.objects[Obj.BEAR]!.fixed = IS_FIXED;
            game.objects[Obj.BEAR]!.prop = ObjState.BEAR_DEAD;
            game.oldlc2 = game.newloc;
            await croak();
            return;
          }
        }
        default:
          bug(
            BugType.SPECIAL_TRAVEL_500_GT_L_GT_300_EXCEEDS_GOTO_LIST,
            "SPECIAL_TRAVEL_500_GT_L_GT_300_EXCEEDS_GOTO_LIST",
          );
      }
    }
    break; /* Leave L12 loop */
  }
}
