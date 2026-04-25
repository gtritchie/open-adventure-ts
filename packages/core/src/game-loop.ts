/*
 * Game loop - command processing, location description, hints, and cave closing.
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
  OUTSIDE,
  INDEEP,
  OBJECT_IS_NOTFOUND,
  OBJECT_IS_FOUND,
  OBJECT_IS_STASHED,
  OBJECT_SET_FOUND,
  OBJECT_STASHIFY,
  PROP_STASHIFY,
  COND_LIT,
  COND_HBASE,
  COND_NOARRR,
  WARNTIME,
  BATTERYLIFE,
  PANICTIME,
  PIT_KILL_PROB,
  WORD_NOT_FOUND,
  WORD_EMPTY,
  IS_FREE,
  IS_FIXED,
  CommandState,
  PhaseCode,
  WordType,
  SpeechPart,
  SpeakType,
  BugType,
  STATE_FOUND,
  STATE_NOTFOUND,
  emptyCommandWord,
} from "./types.js";
import type {
  GameState,
  GameIO,
  Settings,
  Command,
  CommandWord,
} from "./types.js";
import {
  NOBJECTS,
  NHINTS,
  NTHRESHOLDS,
  NDWARVES,
  NLOCATIONS,
  Location,
  Obj,
  Motion,
  Action,
  Msg,
  ObjState,
  objects,
  locations,
  arbitraryMessages,
  conditions,
  hints,
  turnThresholds,
  obituaries,
  travel,
  tkey,
} from "./dungeon.js";
import { Termination } from "./types.js";

/**
 * Dependencies injected into the game loop to avoid circular imports and
 * allow composition of modules written by different agents.
 */
export interface GameLoopDeps {
  speak(io: GameIO, msg: string | null, ...args: unknown[]): void;
  rspeak(io: GameIO, game: GameState, msg: number, ...args: unknown[]): void;
  sspeak(io: GameIO, game: GameState, msg: number, ...args: unknown[]): void;
  pspeak(
    io: GameIO,
    game: GameState,
    obj: number,
    mode: number,
    blank: boolean,
    skip: number,
    ...args: unknown[]
  ): void;
  getCommandInput(
    game: GameState,
    settings: Settings,
    io: GameIO,
    command: Command,
  ): Promise<boolean>;
  clearCommand(game: GameState, command: Command): void;
  action(
    game: GameState,
    settings: Settings,
    io: GameIO,
    command: Command,
  ): Promise<PhaseCode>;
  move(game: GameState, obj: number, where: number): void;
  carry(game: GameState, obj: number, where: number): void;
  drop(game: GameState, obj: number, where: number): void;
  put(game: GameState, obj: number, where: number, pval: number): void;
  juggle(game: GameState, obj: number): void;
  stateChange(game: GameState, io: GameIO, obj: number, state: number): void;
  yesOrNo(
    io: GameIO,
    game: GameState,
    question: string | null,
    yesResponse: string | null,
    noResponse: string | null,
  ): Promise<boolean>;
  randrange(game: GameState, settings: Settings, range: number): number;
  PCT(game: GameState, settings: Settings, n: number): boolean;
  terminate(
    game: GameState,
    io: GameIO,
    mode: Termination,
    rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
    speak: (io: GameIO, msg: string | null, ...args: unknown[]) => void,
  ): never;
  playermove(
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
    stateChange: (game: GameState, io: GameIO, obj: number, state: number) => void,
    croak: () => Promise<void>,
    bug: (type: BugType, msg: string) => never,
    PCT: (game: GameState, settings: Settings, n: number) => boolean,
  ): Promise<void>;
  dwarfmove(
    game: GameState,
    settings: Settings,
    io: GameIO,
    rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
    move: (game: GameState, obj: number, where: number) => void,
    carry: (game: GameState, obj: number, where: number) => void,
    drop: (game: GameState, obj: number, where: number) => void,
    randrange: (game: GameState, settings: Settings, range: number) => number,
    PCT: (game: GameState, settings: Settings, n: number) => boolean,
  ): boolean;
  atdwrf(game: GameState, where: number): number;
  bug(type: BugType, msg: string): never;
}

function isDarkHere(game: GameState): boolean {
  return (
    !CNDBIT(conditions, game.loc, COND_LIT) &&
    (game.objects[Obj.LAMP]!.prop === ObjState.LAMP_DARK ||
      !HERE(game, Obj.LAMP))
  );
}

function LIQUID(game: GameState): number {
  return game.objects[Obj.BOTTLE]!.prop === ObjState.WATER_BOTTLE
    ? Obj.WATER
    : game.objects[Obj.BOTTLE]!.prop === ObjState.OIL_BOTTLE
      ? Obj.OIL
      : Obj.NO_OBJECT;
}

function LIQLOC(loc: number): number {
  return CNDBIT(conditions, loc, 2) // COND_FLUID
    ? CNDBIT(conditions, loc, 1) // COND_OILY
      ? Obj.OIL
      : Obj.WATER
    : Obj.NO_OBJECT;
}

/* Check if this loc is eligible for any hints. If been here long enough,
 * display. Ignore "HINTS" < 4 (special stuff, see database notes). */
async function checkhints(
  game: GameState,
  settings: Settings,
  io: GameIO,
  deps: GameLoopDeps,
): Promise<void> {
  if (conditions[game.loc]! >= game.conds) {
    for (let hint = 0; hint < NHINTS; hint++) {
      if (game.hints[hint]!.used) {
        continue;
      }
      if (!CNDBIT(conditions, game.loc, hint + 1 + COND_HBASE)) {
        game.hints[hint]!.lc = -1;
      }
      ++game.hints[hint]!.lc;
      /* Come here if he's been int enough at required loc(s) for some
       * unused hint. */
      if (game.hints[hint]!.lc >= hints[hint]!.turns) {
        switch (hint) {
          case 0:
            /* cave */
            if (
              game.objects[Obj.GRATE]!.prop === ObjState.GRATE_CLOSED &&
              !HERE(game, Obj.KEYS)
            ) {
              break;
            }
            game.hints[hint]!.lc = 0;
            return;
          case 1:
            /* bird */
            if (
              game.objects[Obj.BIRD]!.place === game.loc &&
              TOTING(game, Obj.ROD) &&
              game.oldobj === Obj.BIRD
            ) {
              break;
            }
            return;
          case 2:
            /* snake */
            if (HERE(game, Obj.SNAKE) && !HERE(game, Obj.BIRD)) {
              break;
            }
            game.hints[hint]!.lc = 0;
            return;
          case 3:
            /* maze */
            if (
              game.locs[game.loc]!.atloc === Obj.NO_OBJECT &&
              game.locs[game.oldloc]!.atloc === Obj.NO_OBJECT &&
              game.locs[game.oldlc2]!.atloc === Obj.NO_OBJECT &&
              game.holdng > 1
            ) {
              break;
            }
            game.hints[hint]!.lc = 0;
            return;
          case 4:
            /* dark */
            if (
              !OBJECT_IS_NOTFOUND(game, Obj.EMERALD) &&
              OBJECT_IS_NOTFOUND(game, Obj.PYRAMID)
            ) {
              break;
            }
            game.hints[hint]!.lc = 0;
            return;
          case 5:
            /* witt */
            break;
          case 6:
            /* urn */
            if (game.dflag === 0) {
              break;
            }
            game.hints[hint]!.lc = 0;
            return;
          case 7:
            /* woods */
            if (
              game.locs[game.loc]!.atloc === Obj.NO_OBJECT &&
              game.locs[game.oldloc]!.atloc === Obj.NO_OBJECT &&
              game.locs[game.oldlc2]!.atloc === Obj.NO_OBJECT
            ) {
              break;
            }
            return;
          case 8: {
            /* ogre */
            const i = deps.atdwrf(game, game.loc);
            if (i < 0) {
              game.hints[hint]!.lc = 0;
              return;
            }
            if (HERE(game, Obj.OGRE) && i === 0) {
              break;
            }
            return;
          }
          case 9:
            /* jade */
            if (
              game.tally === 1 &&
              (OBJECT_IS_STASHED(game, Obj.JADE) ||
                OBJECT_IS_NOTFOUND(game, Obj.JADE))
            ) {
              break;
            }
            game.hints[hint]!.lc = 0;
            return;
          default:
            deps.bug(
              BugType.HINT_NUMBER_EXCEEDS_GOTO_LIST,
              "HINT_NUMBER_EXCEEDS_GOTO_LIST",
            );
        }

        /* Fall through to hint display */
        game.hints[hint]!.lc = 0;
        if (
          !(await deps.yesOrNo(
            io,
            game,
            hints[hint]!.question,
            arbitraryMessages[Msg.NO_MESSAGE]!,
            arbitraryMessages[Msg.OK_MAN]!,
          ))
        ) {
          return;
        }
        deps.rspeak(
          io,
          game,
          Msg.HINT_COST,
          hints[hint]!.penalty,
          hints[hint]!.penalty,
        );
        game.hints[hint]!.used = await deps.yesOrNo(
          io,
          game,
          arbitraryMessages[Msg.WANT_HINT]!,
          hints[hint]!.hint,
          arbitraryMessages[Msg.OK_MAN]!,
        );
        if (game.hints[hint]!.used && game.limit > WARNTIME) {
          game.limit += WARNTIME * hints[hint]!.penalty;
        }
      }
    }
  }
}

function describeLocation(
  game: GameState,
  settings: Settings,
  io: GameIO,
  deps: GameLoopDeps,
): void {
  /* Describe the location to the user */
  let msg: string | null = locations[game.loc]!.description.small;

  if (
    game.locs[game.loc]!.abbrev % game.abbnum === 0 ||
    msg === null
  ) {
    msg = locations[game.loc]!.description.big;
  }

  if (!FORCED(conditions, game.loc) && isDarkHere(game)) {
    msg = arbitraryMessages[Msg.PITCH_DARK]!;
  }

  if (TOTING(game, Obj.BEAR)) {
    deps.rspeak(io, game, Msg.TAME_BEAR);
  }

  deps.speak(io, msg);

  if (
    game.loc === Location.LOC_Y2 &&
    deps.PCT(game, settings, 25) &&
    !game.closng
  ) {
    deps.rspeak(io, game, Msg.SAYS_PLUGH);
  }
}

function listobjects(
  game: GameState,
  io: GameIO,
  deps: GameLoopDeps,
): void {
  /* Print out descriptions of objects at this location. */
  if (!isDarkHere(game)) {
    ++game.locs[game.loc]!.abbrev;
    for (
      let i = game.locs[game.loc]!.atloc;
      i !== 0;
      i = game.link[i]!
    ) {
      let obj = i;
      if (obj > NOBJECTS) {
        obj = obj - NOBJECTS;
      }
      if (obj === Obj.STEPS && TOTING(game, Obj.NUGGET)) {
        continue;
      }
      if (OBJECT_IS_STASHED(game, obj) || OBJECT_IS_NOTFOUND(game, obj)) {
        if (game.closed) {
          continue;
        }
        OBJECT_SET_FOUND(game, obj);
        if (obj === Obj.RUG) {
          game.objects[Obj.RUG]!.prop = ObjState.RUG_DRAGON;
        }
        if (obj === Obj.CHAIN) {
          game.objects[Obj.CHAIN]!.prop = ObjState.CHAINING_BEAR;
        }
        if (obj === Obj.EGGS) {
          game.seenbigwords = true;
        }
        --game.tally;
      }
      let kk = game.objects[obj]!.prop;
      if (obj === Obj.STEPS) {
        kk =
          game.loc === game.objects[Obj.STEPS]!.fixed
            ? ObjState.STEPS_UP
            : ObjState.STEPS_DOWN;
      }
      deps.pspeak(io, game, obj, SpeakType.look, true, kk);
    }
  }
}

function preprocessCommand(
  game: GameState,
  io: GameIO,
  command: Command,
  deps: GameLoopDeps,
): boolean {
  if (
    command.word[0].type === WordType.MOTION &&
    command.word[0].id === Motion.ENTER &&
    (command.word[1].id === Motion.STREAM || command.word[1].id === Obj.WATER)
  ) {
    if (LIQLOC(game.loc) === Obj.WATER) {
      deps.rspeak(io, game, Msg.FEET_WET);
    } else {
      deps.rspeak(io, game, Msg.WHERE_QUERY);
    }
  } else {
    if (command.word[0].type === WordType.OBJECT) {
      /* From OV to VO form */
      if (command.word[1].type === WordType.ACTION) {
        const stage: CommandWord = { ...command.word[0] };
        command.word[0] = { ...command.word[1] };
        command.word[1] = stage;
      }

      if (command.word[0].id === Obj.GRATE) {
        command.word[0] = { ...command.word[0], type: WordType.MOTION };
        if (
          game.loc === Location.LOC_START ||
          game.loc === Location.LOC_VALLEY ||
          game.loc === Location.LOC_SLIT
        ) {
          command.word[0] = { ...command.word[0], id: Motion.DEPRESSION };
        }
        if (
          game.loc === Location.LOC_COBBLE ||
          game.loc === Location.LOC_DEBRIS ||
          game.loc === Location.LOC_AWKWARD ||
          game.loc === Location.LOC_BIRDCHAMBER ||
          game.loc === Location.LOC_PITTOP
        ) {
          command.word[0] = { ...command.word[0], id: Motion.ENTRANCE };
        }
      }
      if (
        (command.word[0].id === Obj.WATER ||
          command.word[0].id === Obj.OIL) &&
        (command.word[1].id === Obj.PLANT || command.word[1].id === Obj.DOOR)
      ) {
        if (AT(game, command.word[1].id)) {
          command.word[1] = { ...command.word[0] };
          command.word[0] = {
            ...command.word[0],
            id: Action.POUR,
            type: WordType.ACTION,
            raw: "pour",
          };
        }
      }
      if (
        command.word[0].id === Obj.CAGE &&
        command.word[1].id === Obj.BIRD &&
        HERE(game, Obj.CAGE) &&
        HERE(game, Obj.BIRD)
      ) {
        command.word[0] = {
          ...command.word[0],
          id: Action.CARRY,
          type: WordType.ACTION,
        };
      }
    }

    /* If no word type is given for the first word, we assume it's a motion. */
    if (command.word[0].type === WordType.NO_WORD_TYPE) {
      command.word[0] = { ...command.word[0], type: WordType.MOTION };
    }

    command.state = CommandState.PREPROCESSED;
    return true;
  }
  return false;
}

function lampcheck(
  game: GameState,
  io: GameIO,
  deps: GameLoopDeps,
): void {
  /* Check game limit and lamp timers */
  if (game.objects[Obj.LAMP]!.prop === ObjState.LAMP_BRIGHT) {
    --game.limit;
  }

  /* Another way we can force an end to things is by having the lamp give
   * out. When it gets close, we come here to warn him. */
  if (game.limit <= WARNTIME) {
    if (
      HERE(game, Obj.BATTERY) &&
      game.objects[Obj.BATTERY]!.prop === ObjState.FRESH_BATTERIES &&
      HERE(game, Obj.LAMP)
    ) {
      deps.rspeak(io, game, Msg.REPLACE_BATTERIES);
      game.objects[Obj.BATTERY]!.prop = ObjState.DEAD_BATTERIES;
      game.limit += BATTERYLIFE;
      game.lmwarn = false;
    } else if (!game.lmwarn && HERE(game, Obj.LAMP)) {
      game.lmwarn = true;
      if (game.objects[Obj.BATTERY]!.prop === ObjState.DEAD_BATTERIES) {
        deps.rspeak(io, game, Msg.MISSING_BATTERIES);
      } else if (
        game.objects[Obj.BATTERY]!.place === Location.LOC_NOWHERE
      ) {
        deps.rspeak(io, game, Msg.LAMP_DIM);
      } else {
        deps.rspeak(io, game, Msg.GET_BATTERIES);
      }
    }
  }
  if (game.limit === 0) {
    game.limit = -1;
    game.objects[Obj.LAMP]!.prop = ObjState.LAMP_DARK;
    if (HERE(game, Obj.LAMP)) {
      deps.rspeak(io, game, Msg.LAMP_OUT);
    }
  }
}

function closecheck(
  game: GameState,
  settings: Settings,
  io: GameIO,
  deps: GameLoopDeps,
): boolean {
  /* If a turn threshold has been met, apply penalties and tell the player. */
  for (let i = 0; i < NTHRESHOLDS; ++i) {
    if (game.turns === turnThresholds[i]!.threshold + 1) {
      game.trnluz += turnThresholds[i]!.pointLoss;
      deps.speak(io, turnThresholds[i]!.message);
    }
  }

  /* Don't tick game.clock1 unless well into cave (and not at Y2). */
  if (
    game.tally === 0 &&
    INDEEP(conditions, game.loc) &&
    game.loc !== Location.LOC_Y2
  ) {
    --game.clock1;
  }

  /* When the first warning comes, we lock the grate, destroy the bridge,
   * kill all the dwarves (and the pirate), remove the troll and bear
   * (unless dead), and set "closng" to true. */
  if (game.clock1 === 0) {
    game.objects[Obj.GRATE]!.prop = ObjState.GRATE_CLOSED;
    game.objects[Obj.FISSURE]!.prop = ObjState.UNBRIDGED;
    for (let i = 1; i <= NDWARVES; i++) {
      game.dwarves[i]!.seen = 0;
      game.dwarves[i]!.loc = Location.LOC_NOWHERE;
    }
    deps.move(game, Obj.TROLL, Location.LOC_NOWHERE); // DESTROY(TROLL)
    deps.move(game, Obj.TROLL + NOBJECTS, IS_FREE);
    deps.move(game, Obj.TROLL2, objects[Obj.TROLL]!.plac);
    deps.move(game, Obj.TROLL2 + NOBJECTS, objects[Obj.TROLL]!.fixd);
    deps.juggle(game, Obj.CHASM);
    if (game.objects[Obj.BEAR]!.prop !== ObjState.BEAR_DEAD) {
      deps.move(game, Obj.BEAR, Location.LOC_NOWHERE); // DESTROY(BEAR)
    }
    game.objects[Obj.CHAIN]!.prop = ObjState.CHAIN_HEAP;
    game.objects[Obj.CHAIN]!.fixed = IS_FREE;
    game.objects[Obj.AXE]!.prop = ObjState.AXE_HERE;
    game.objects[Obj.AXE]!.fixed = IS_FREE;
    deps.rspeak(io, game, Msg.CAVE_CLOSING);
    game.clock1 = -1;
    game.closng = true;
    return game.closed;
  } else if (game.clock1 < 0) {
    --game.clock2;
  }
  if (game.clock2 === 0) {
    /* Once he's panicked, and clock2 has run out, we come here to set up
     * the storage room. */
    deps.put(game, Obj.BOTTLE, Location.LOC_NE, ObjState.EMPTY_BOTTLE);
    deps.put(game, Obj.PLANT, Location.LOC_NE, ObjState.PLANT_THIRSTY);
    deps.put(game, Obj.OYSTER, Location.LOC_NE, STATE_FOUND);
    deps.put(game, Obj.LAMP, Location.LOC_NE, ObjState.LAMP_DARK);
    deps.put(game, Obj.ROD, Location.LOC_NE, STATE_FOUND);
    deps.put(game, Obj.DWARF, Location.LOC_NE, STATE_FOUND);
    game.loc = Location.LOC_NE;
    game.oldloc = Location.LOC_NE;
    game.newloc = Location.LOC_NE;
    /* Leave the grate with normal (non-negative) property. Reuse sign. */
    deps.move(game, Obj.GRATE, Location.LOC_SW);
    deps.move(game, Obj.SIGN, Location.LOC_SW);
    game.objects[Obj.SIGN]!.prop = ObjState.ENDGAME_SIGN;
    deps.put(game, Obj.SNAKE, Location.LOC_SW, ObjState.SNAKE_CHASED);
    deps.put(game, Obj.BIRD, Location.LOC_SW, ObjState.BIRD_CAGED);
    deps.put(game, Obj.CAGE, Location.LOC_SW, STATE_FOUND);
    deps.put(game, Obj.ROD2, Location.LOC_SW, STATE_FOUND);
    deps.put(game, Obj.PILLOW, Location.LOC_SW, STATE_FOUND);

    deps.put(game, Obj.MIRROR, Location.LOC_NE, STATE_FOUND);
    game.objects[Obj.MIRROR]!.fixed = Location.LOC_SW;

    for (let i = 1; i <= NOBJECTS; i++) {
      if (TOTING(game, i)) {
        deps.move(game, i, Location.LOC_NOWHERE); // DESTROY
      }
    }

    deps.rspeak(io, game, Msg.CAVE_CLOSED);
    game.closed = true;
    return game.closed;
  }

  lampcheck(game, io, deps);
  return false;
}

/**
 * "You're dead, Jim." - Handle death and reincarnation.
 */
async function croak(
  game: GameState,
  settings: Settings,
  io: GameIO,
  deps: GameLoopDeps,
): Promise<void> {
  const query = obituaries[game.numdie]!.query;
  const yesResponse = obituaries[game.numdie]!.yesResponse;

  ++game.numdie;

  if (game.closng) {
    /* He died during closing time. No resurrection. */
    deps.rspeak(io, game, Msg.DEATH_CLOSING);
    deps.terminate(game, io, Termination.endgame, deps.rspeak, deps.speak);
  } else if (
    !(await deps.yesOrNo(
      io,
      game,
      query,
      yesResponse,
      arbitraryMessages[Msg.OK_MAN]!,
    )) ||
    game.numdie === obituaries.length
  ) {
    deps.terminate(game, io, Termination.endgame, deps.rspeak, deps.speak);
  } else {
    /* If player wishes to continue, empty liquids, turn off lamp,
     * drop all items where he died. */
    game.objects[Obj.WATER]!.place = Location.LOC_NOWHERE;
    game.objects[Obj.OIL]!.place = Location.LOC_NOWHERE;
    if (TOTING(game, Obj.LAMP)) {
      game.objects[Obj.LAMP]!.prop = ObjState.LAMP_DARK;
    }
    for (let j = 1; j <= NOBJECTS; j++) {
      const i = NOBJECTS + 1 - j;
      if (TOTING(game, i)) {
        /* Always leave lamp where it's accessible aboveground */
        deps.drop(
          game,
          i,
          i === Obj.LAMP ? Location.LOC_START : game.oldlc2,
        );
      }
    }
    game.oldloc = game.loc = game.newloc = Location.LOC_BUILDING;
  }
}

/**
 * Execute the move to the new location and dwarf movement.
 */
async function doMove(
  game: GameState,
  settings: Settings,
  io: GameIO,
  deps: GameLoopDeps,
): Promise<boolean> {
  /* Can't leave cave once it's closing (except by main office). */
  if (
    OUTSIDE(conditions, game.newloc) &&
    game.newloc !== 0 &&
    game.closng
  ) {
    deps.rspeak(io, game, Msg.EXIT_CLOSED);
    game.newloc = game.loc;
    if (!game.panic) {
      game.clock2 = PANICTIME;
    }
    game.panic = true;
  }

  /* See if a dwarf has seen him and has come from where he wants to go.
   * If so, the dwarf's blocking his way. */
  if (
    game.newloc !== game.loc &&
    !FORCED(conditions, game.loc) &&
    !CNDBIT(conditions, game.loc, COND_NOARRR)
  ) {
    for (let i = 1; i <= NDWARVES - 1; i++) {
      if (
        game.dwarves[i]!.oldloc === game.newloc &&
        game.dwarves[i]!.seen
      ) {
        game.newloc = game.loc;
        deps.rspeak(io, game, Msg.DWARF_BLOCK);
        break;
      }
    }
  }
  game.loc = game.newloc;

  if (
    !deps.dwarfmove(
      game,
      settings,
      io,
      deps.rspeak,
      deps.move,
      deps.carry,
      deps.drop,
      deps.randrange,
      deps.PCT,
    )
  ) {
    await croak(game, settings, io, deps);
  }

  if (game.loc === Location.LOC_NOWHERE) {
    await croak(game, settings, io, deps);
  }

  /* The easiest way to get killed is to fall into a pit in pitch darkness. */
  if (
    !FORCED(conditions, game.loc) &&
    isDarkHere(game) &&
    game.wzdark &&
    deps.PCT(game, settings, PIT_KILL_PROB)
  ) {
    deps.rspeak(io, game, Msg.PIT_FALL);
    game.oldlc2 = game.loc;
    await croak(game, settings, io, deps);
    return false;
  }

  return true;
}

/**
 * Get and execute a command. Returns true to continue the game loop,
 * false to end it.
 */
async function doCommand(
  game: GameState,
  settings: Settings,
  io: GameIO,
  deps: GameLoopDeps,
): Promise<boolean> {
  const command: Command = {
    part: SpeechPart.unknown,
    word: [emptyCommandWord(), emptyCommandWord()],
    verb: Action.ACT_NULL,
    obj: Obj.NO_OBJECT,
    state: CommandState.EMPTY,
  };
  deps.clearCommand(game, command);

  /* Describe the current location and (maybe) get next command. */
  while (command.state !== CommandState.EXECUTED) {
    describeLocation(game, settings, io, deps);

    if (FORCED(conditions, game.loc)) {
      await deps.playermove(
        game,
        settings,
        io,
        Motion.HERE,
        deps.rspeak,
        deps.pspeak,
        deps.move,
        deps.drop,
        deps.juggle,
        deps.stateChange,
        async () => croak(game, settings, io, deps),
        deps.bug,
        deps.PCT,
      );
      return true;
    }

    listobjects(game, io, deps);

    /* Command not yet given; keep getting commands from user until valid
     * command is both given and executed. */
    deps.clearCommand(game, command);
    while (command.state <= CommandState.GIVEN) {
      if (game.closed) {
        /* If closing time, check for any stashed objects being toted and
         * unstash them. */
        if (
          (OBJECT_IS_NOTFOUND(game, Obj.OYSTER) ||
            OBJECT_IS_STASHED(game, Obj.OYSTER)) &&
          TOTING(game, Obj.OYSTER)
        ) {
          deps.pspeak(io, game, Obj.OYSTER, SpeakType.look, true, 1);
        }
        for (let i = 1; i <= NOBJECTS; i++) {
          if (
            TOTING(game, i) &&
            (OBJECT_IS_NOTFOUND(game, i) || OBJECT_IS_STASHED(game, i))
          ) {
            OBJECT_STASHIFY(game, i, game.objects[i]!.prop);
          }
        }
      }

      /* Check to see if the room is dark. */
      game.wzdark = isDarkHere(game);

      /* If the knife is not here it permanently disappears. */
      if (game.knfloc > Location.LOC_NOWHERE && game.knfloc !== game.loc) {
        game.knfloc = Location.LOC_NOWHERE;
      }

      /* Check some for hints, get input from user, increment turn,
       * and pre-process commands. Keep going until pre-processing is done. */
      while (command.state < CommandState.PREPROCESSED) {
        await checkhints(game, settings, io, deps);

        /* Get command input from user */
        if (!(await deps.getCommandInput(game, settings, io, command))) {
          return false;
        }

        /* Every input, check "foobar" flag. If zero, nothing's going on.
         * If pos, make neg. If neg, he skipped a word, so make it zero. */
        game.foobar =
          game.foobar > WORD_EMPTY ? -game.foobar : WORD_EMPTY;

        ++game.turns;
        preprocessCommand(game, io, command, deps);
      }

      /* check if game is closed, and exit if it is */
      if (closecheck(game, settings, io, deps)) {
        return true;
      }

      /* loop until all words in command are processed */
      while (command.state === CommandState.PREPROCESSED) {
        command.state = CommandState.PROCESSING;

        if (command.word[0].id === WORD_NOT_FOUND) {
          /* Gee, I don't understand. */
          deps.sspeak(io, game, Msg.DONT_KNOW, command.word[0].raw);
          deps.clearCommand(game, command);
          continue;
        }

        /* Give user hints of shortcuts */
        if (command.word[0].raw.toLowerCase().startsWith("west")) {
          if (++game.iwest === 10) {
            deps.rspeak(io, game, Msg.W_IS_WEST);
          }
        }
        if (
          command.word[0].raw.toLowerCase().startsWith("go") &&
          command.word[1].id !== WORD_EMPTY
        ) {
          if (++game.igo === 10) {
            deps.rspeak(io, game, Msg.GO_UNNEEDED);
          }
        }

        switch (command.word[0].type) {
          case WordType.MOTION:
            await deps.playermove(
              game,
              settings,
              io,
              command.word[0].id,
              deps.rspeak,
              deps.pspeak,
              deps.move,
              deps.drop,
              deps.juggle,
              deps.stateChange,
              async () => croak(game, settings, io, deps),
              deps.bug,
              deps.PCT,
            );
            command.state = CommandState.EXECUTED;
            continue;
          case WordType.OBJECT:
            command.part = SpeechPart.unknown;
            command.obj = command.word[0].id;
            break;
          case WordType.ACTION:
            if (command.word[1].type === WordType.NUMERIC) {
              command.part = SpeechPart.transitive;
            } else {
              command.part = SpeechPart.intransitive;
            }
            command.verb = command.word[0].id;
            break;
          case WordType.NUMERIC:
            if (!settings.oldstyle) {
              deps.sspeak(io, game, Msg.DONT_KNOW, command.word[0].raw);
              deps.clearCommand(game, command);
              continue;
            }
            break;
          default:
            deps.bug(
              BugType.VOCABULARY_TYPE_N_OVER_1000_NOT_BETWEEN_0_AND_3,
              "VOCABULARY_TYPE_N_OVER_1000_NOT_BETWEEN_0_AND_3",
            );
        }

        const phaseCode = await deps.action(game, settings, io, command);
        switch (phaseCode) {
          case PhaseCode.GO_TERMINATE:
            command.state = CommandState.EXECUTED;
            break;
          case PhaseCode.GO_MOVE:
            await deps.playermove(
              game,
              settings,
              io,
              Motion.NUL,
              deps.rspeak,
              deps.pspeak,
              deps.move,
              deps.drop,
              deps.juggle,
              deps.stateChange,
              async () => croak(game, settings, io, deps),
              deps.bug,
              deps.PCT,
            );
            command.state = CommandState.EXECUTED;
            break;
          case PhaseCode.GO_WORD2:
            /* Get second word for analysis. */
            command.word[0] = { ...command.word[1] };
            command.word[1] = emptyCommandWord();
            command.state = CommandState.PREPROCESSED;
            break;
          case PhaseCode.GO_UNKNOWN: {
            /* Random intransitive verbs come here. Clear obj just in case. */
            const raw0 = command.word[0].raw;
            const capitalized =
              raw0.charAt(0).toUpperCase() + raw0.slice(1);
            command.word[0] = { ...command.word[0], raw: capitalized };
            deps.sspeak(io, game, Msg.DO_WHAT, command.word[0].raw);
            command.obj = Obj.NO_OBJECT;
            /* object cleared; we need to go back to the preprocessing step */
            command.state = CommandState.GIVEN;
            break;
          }
          case PhaseCode.GO_CHECKHINT:
            command.state = CommandState.GIVEN;
            break;
          case PhaseCode.GO_DWARFWAKE:
            /* Oh dear, he's disturbed the dwarves. */
            deps.rspeak(io, game, Msg.DWARVES_AWAKEN);
            deps.terminate(
              game,
              io,
              Termination.endgame,
              deps.rspeak,
              deps.speak,
            );
            break; // unreachable but needed for TS
          case PhaseCode.GO_CLEAROBJ:
            deps.clearCommand(game, command);
            break;
          case PhaseCode.GO_TOP:
            break;
          default:
            deps.bug(
              BugType.ACTION_RETURNED_PHASE_CODE_BEYOND_END_OF_SWITCH,
              "ACTION_RETURNED_PHASE_CODE_BEYOND_END_OF_SWITCH",
            );
        }
      } /* while command has not been fully processed */
    } /* while command is not yet given */
  } /* while command is not executed */

  /* command completely executed; we return true. */
  return true;
}

/**
 * Main game loop. Call this after initialisation to run the game.
 * On game over (quit/death/win), the deps.terminate() function throws
 * TerminateError, which the caller should catch.
 */
export async function gameLoop(
  game: GameState,
  settings: Settings,
  io: GameIO,
  deps: GameLoopDeps,
): Promise<void> {
  /* interpret commands until EOF or interrupt */
  for (;;) {
    // if we're supposed to move, move
    if (!(await doMove(game, settings, io, deps))) {
      continue;
    }

    // get command
    if (!(await doCommand(game, settings, io, deps))) {
      break;
    }
  }
  /* show score and exit */
  deps.terminate(game, io, Termination.quitgame, deps.rspeak, deps.speak);
}
