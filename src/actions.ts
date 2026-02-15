/*
 * Actions for the dungeon-running code.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import type { GameState, Settings, GameIO, Command } from "./types.js";
import {
  PhaseCode,
  SpeakType,
  SpeechPart,
  WordType,
  ScoreBonus,
  Termination,
  INTRANSITIVE,
  CARRIED,
  INVLIMIT,
  PANICTIME,
  WORD_EMPTY,
  WORD_NOT_FOUND,
  IS_FIXED,
  IS_FREE,
  STATE_IN_CAVITY,
  TOTING,
  AT,
  HERE,
  CNDBIT,
  FOREST,
  OBJECT_IS_NOTFOUND,
  OBJECT_IS_FOUND,
  OBJECT_SET_FOUND,
  OBJECT_IS_STASHED,
  OBJECT_STATE_EQUALS,
  GSTONE,
  TerminateError,
  COND_LIT,
  COND_OILY,
  COND_FLUID,
} from "./types.js";
import {
  NOBJECTS,
  NDWARVES,
  BIRD_ENDSTATE,
  Location,
  Obj,
  Motion,
  Action,
  Msg,
  ObjState,
  locations,
  objects,
  actions,
  arbitraryMessages,
  conditions,
} from "./dungeon.js";
import { randrange, setSeed } from "./rng.js";
import {
  suspend as suspendSave,
  resume as resumeSave,
} from "./save.js";

// Format functions: (game, io, ...) parameter order
import { speak, rspeak, pspeak, sspeak, stateChange } from "./format.js";

// Object manipulation: (game, ...)
import { carry, drop, move, juggle, destroy, atdwrf } from "./object-manipulation.js";

// ── Helper macros translated to functions ──

function LIQUID(game: GameState): number {
  if (game.objects[Obj.BOTTLE]!.prop === ObjState.WATER_BOTTLE) return Obj.WATER;
  if (game.objects[Obj.BOTTLE]!.prop === ObjState.OIL_BOTTLE) return Obj.OIL;
  return Obj.NO_OBJECT;
}

function LIQLOC(loc: number): number {
  if (CNDBIT(conditions, loc, COND_FLUID)) {
    return CNDBIT(conditions, loc, COND_OILY) ? Obj.OIL : Obj.WATER;
  }
  return Obj.NO_OBJECT;
}

function IS_DARK_HERE(game: GameState): boolean {
  return (
    !CNDBIT(conditions, game.loc, COND_LIT) &&
    (game.objects[Obj.LAMP]!.prop === ObjState.LAMP_DARK || !HERE(game, Obj.LAMP))
  );
}

const PIRATE = NDWARVES;

// ── Score / Terminate stubs ──

function score(
  _game: GameState,
  _io: GameIO,
  _settings: Settings,
  _mode: Termination,
): number {
  // Stub - will be replaced with real implementation from score.ts
  return 0;
}

function terminate(
  game: GameState,
  io: GameIO,
  settings: Settings,
  mode: Termination,
): never {
  score(game, io, settings, mode);
  throw new TerminateError(0);
}

// ── I/O helpers (yes/no) ──

async function silentYesOrNo(
  io: GameIO,
): Promise<boolean> {
  const line = await io.readline("");
  if (line === null) return false;
  const word = line.trim().toLowerCase();
  return word.startsWith("y");
}

async function yesOrNo(
  game: GameState,
  io: GameIO,
  question: string | null,
  yesResponse: string | null,
  noResponse: string | null,
): Promise<boolean> {
  if (question !== null) {
    speak(game, io, question);
  }
  const result = await silentYesOrNo(io);
  if (result) {
    if (yesResponse !== null) {
      speak(game, io, yesResponse);
    }
  } else {
    if (noResponse !== null) {
      speak(game, io, noResponse);
    }
  }
  return result;
}

// ── Individual action handlers ──

function attack(
  game: GameState,
  io: GameIO,
  settings: Settings,
  command: Command,
): PhaseCode | Promise<PhaseCode> {
  const verb = command.verb;
  let obj = command.obj;

  if (obj === INTRANSITIVE) {
    let changes = 0;
    if (atdwrf(game, game.loc) > 0) {
      obj = Obj.DWARF;
      ++changes;
    }
    if (HERE(game, Obj.SNAKE)) {
      obj = Obj.SNAKE;
      ++changes;
    }
    if (AT(game, Obj.DRAGON) && game.objects[Obj.DRAGON]!.prop === ObjState.DRAGON_BARS) {
      obj = Obj.DRAGON;
      ++changes;
    }
    if (AT(game, Obj.TROLL)) {
      obj = Obj.TROLL;
      ++changes;
    }
    if (AT(game, Obj.OGRE)) {
      obj = Obj.OGRE;
      ++changes;
    }
    if (HERE(game, Obj.BEAR) && game.objects[Obj.BEAR]!.prop === ObjState.UNTAMED_BEAR) {
      obj = Obj.BEAR;
      ++changes;
    }
    if (obj === INTRANSITIVE) {
      if (HERE(game, Obj.BIRD) && verb !== Action.THROW) {
        obj = Obj.BIRD;
        ++changes;
      }
      if (HERE(game, Obj.VEND) && verb !== Action.THROW) {
        obj = Obj.VEND;
        ++changes;
      }
      if (HERE(game, Obj.CLAM) || HERE(game, Obj.OYSTER)) {
        obj = Obj.CLAM;
        ++changes;
      }
    }
    if (changes >= 2) {
      return PhaseCode.GO_UNKNOWN;
    }
  }

  if (obj === Obj.BIRD) {
    if (game.closed) {
      rspeak(game, io, Msg.UNHAPPY_BIRD);
    } else {
      destroy(game, Obj.BIRD);
      rspeak(game, io, Msg.BIRD_DEAD);
    }
    return PhaseCode.GO_CLEAROBJ;
  }
  if (obj === Obj.VEND) {
    stateChange(
      game,
      io,
      Obj.VEND,
      game.objects[Obj.VEND]!.prop === ObjState.VEND_BLOCKS
        ? ObjState.VEND_UNBLOCKS
        : ObjState.VEND_BLOCKS,
    );
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj === Obj.BEAR) {
    switch (game.objects[Obj.BEAR]!.prop) {
      case ObjState.UNTAMED_BEAR:
        rspeak(game, io, Msg.BEAR_HANDS);
        break;
      case ObjState.SITTING_BEAR:
        rspeak(game, io, Msg.BEAR_CONFUSED);
        break;
      case ObjState.CONTENTED_BEAR:
        rspeak(game, io, Msg.BEAR_CONFUSED);
        break;
      case ObjState.BEAR_DEAD:
        rspeak(game, io, Msg.ALREADY_DEAD);
        break;
    }
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj === Obj.DRAGON && game.objects[Obj.DRAGON]!.prop === ObjState.DRAGON_BARS) {
    rspeak(game, io, Msg.BARE_HANDS_QUERY);
    return silentYesOrNo(io).then((yes) => {
      if (!yes) {
        speak(game, io, arbitraryMessages[Msg.NASTY_DRAGON]!);
        return PhaseCode.GO_MOVE;
      }
      stateChange(game, io, Obj.DRAGON, ObjState.DRAGON_DEAD);
      game.objects[Obj.RUG]!.prop = ObjState.RUG_FLOOR;
      move(game, Obj.DRAGON + NOBJECTS, IS_FIXED);
      move(game, Obj.RUG + NOBJECTS, IS_FREE);
      move(game, Obj.DRAGON, Location.LOC_SECRET5);
      move(game, Obj.RUG, Location.LOC_SECRET5);
      drop(game, Obj.BLOOD, Location.LOC_SECRET5);
      for (let i = 1; i <= NOBJECTS; i++) {
        if (
          game.objects[i]!.place === objects[Obj.DRAGON]!.plac ||
          game.objects[i]!.place === objects[Obj.DRAGON]!.fixd
        ) {
          move(game, i, Location.LOC_SECRET5);
        }
      }
      game.loc = Location.LOC_SECRET5;
      return PhaseCode.GO_MOVE;
    });
  }

  if (obj === Obj.OGRE) {
    rspeak(game, io, Msg.OGRE_DODGE);
    if (atdwrf(game, game.loc) === 0) {
      return PhaseCode.GO_CLEAROBJ;
    }
    rspeak(game, io, Msg.KNIFE_THROWN);
    destroy(game, Obj.OGRE);
    let dwarves = 0;
    for (let i = 1; i < PIRATE; i++) {
      if (game.dwarves[i]!.loc === game.loc) {
        ++dwarves;
        game.dwarves[i]!.loc = Location.LOC_LONGWEST;
        game.dwarves[i]!.seen = 0;
      }
    }
    rspeak(game, io, dwarves > 1 ? Msg.OGRE_PANIC1 : Msg.OGRE_PANIC2);
    return PhaseCode.GO_CLEAROBJ;
  }

  switch (obj) {
    case INTRANSITIVE:
      rspeak(game, io, Msg.NO_TARGET);
      break;
    case Obj.CLAM:
    case Obj.OYSTER:
      rspeak(game, io, Msg.SHELL_IMPERVIOUS);
      break;
    case Obj.SNAKE:
      rspeak(game, io, Msg.SNAKE_WARNING);
      break;
    case Obj.DWARF:
      if (game.closed) {
        return PhaseCode.GO_DWARFWAKE;
      }
      rspeak(game, io, Msg.BARE_HANDS_QUERY);
      break;
    case Obj.DRAGON:
      rspeak(game, io, Msg.ALREADY_DEAD);
      break;
    case Obj.TROLL:
      rspeak(game, io, Msg.ROCKY_TROLL);
      break;
    default:
      speak(game, io, actions[verb]!.message);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function bigwords(
  game: GameState,
  io: GameIO,
  settings: Settings,
  id: number,
): PhaseCode {
  const foobar = Math.abs(game.foobar);

  if (
    foobar === WORD_EMPTY &&
    (id === Action.FIE || id === Action.FOE || id === Action.FOO || id === Action.FUM)
  ) {
    rspeak(game, io, Msg.NOTHING_HAPPENS);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (
    (foobar === WORD_EMPTY && id === Action.FEE) ||
    (foobar === Action.FEE && id === Action.FIE) ||
    (foobar === Action.FIE && id === Action.FOE) ||
    (foobar === Action.FOE && id === Action.FOO)
  ) {
    game.foobar = id;
    if (id !== Action.FOO) {
      rspeak(game, io, Msg.OK_MAN);
      return PhaseCode.GO_CLEAROBJ;
    }
    game.foobar = WORD_EMPTY;
    if (
      game.objects[Obj.EGGS]!.place === objects[Obj.EGGS]!.plac ||
      (TOTING(game, Obj.EGGS) && game.loc === objects[Obj.EGGS]!.plac)
    ) {
      rspeak(game, io, Msg.NOTHING_HAPPENS);
      return PhaseCode.GO_CLEAROBJ;
    } else {
      if (
        game.objects[Obj.EGGS]!.place === Location.LOC_NOWHERE &&
        game.objects[Obj.TROLL]!.place === Location.LOC_NOWHERE &&
        game.objects[Obj.TROLL]!.prop === ObjState.TROLL_UNPAID
      ) {
        game.objects[Obj.TROLL]!.prop = ObjState.TROLL_PAIDONCE;
      }
      if (HERE(game, Obj.EGGS)) {
        pspeak(game, io, Obj.EGGS, SpeakType.look, true, ObjState.EGGS_VANISHED);
      } else if (game.loc === objects[Obj.EGGS]!.plac) {
        pspeak(game, io, Obj.EGGS, SpeakType.look, true, ObjState.EGGS_HERE);
      } else {
        pspeak(game, io, Obj.EGGS, SpeakType.look, true, ObjState.EGGS_DONE);
      }
      move(game, Obj.EGGS, objects[Obj.EGGS]!.plac);
      return PhaseCode.GO_CLEAROBJ;
    }
  } else {
    if (settings.oldstyle || game.seenbigwords) {
      rspeak(game, io, Msg.START_OVER);
    } else {
      rspeak(game, io, Msg.WELL_POINTLESS);
    }
    game.foobar = WORD_EMPTY;
    return PhaseCode.GO_CLEAROBJ;
  }
}

function blast(
  game: GameState,
  io: GameIO,
  settings: Settings,
): void {
  if (OBJECT_IS_NOTFOUND(game, Obj.ROD2) || !game.closed) {
    rspeak(game, io, Msg.REQUIRES_DYNAMITE);
  } else {
    if (HERE(game, Obj.ROD2)) {
      game.bonus = ScoreBonus.splatter;
      rspeak(game, io, Msg.SPLATTER_MESSAGE);
    } else if (game.loc === Location.LOC_NE) {
      game.bonus = ScoreBonus.defeat;
      rspeak(game, io, Msg.DEFEAT_MESSAGE);
    } else {
      game.bonus = ScoreBonus.victory;
      rspeak(game, io, Msg.VICTORY_MESSAGE);
    }
    terminate(game, io, settings, Termination.endgame);
  }
}

function vbreak(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  switch (obj) {
    case Obj.MIRROR:
      if (game.closed) {
        stateChange(game, io, Obj.MIRROR, ObjState.MIRROR_BROKEN);
        return PhaseCode.GO_DWARFWAKE;
      } else {
        rspeak(game, io, Msg.TOO_FAR);
        break;
      }
    case Obj.VASE:
      if (game.objects[Obj.VASE]!.prop === ObjState.VASE_WHOLE) {
        if (TOTING(game, Obj.VASE)) {
          drop(game, Obj.VASE, game.loc);
        }
        stateChange(game, io, Obj.VASE, ObjState.VASE_BROKEN);
        game.objects[Obj.VASE]!.fixed = IS_FIXED;
        break;
      }
    // eslint-disable-next-line no-fallthrough
    default:
      speak(game, io, actions[verb]!.message);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function brief(
  game: GameState,
  io: GameIO,
): PhaseCode {
  game.abbnum = 10000;
  game.detail = 3;
  rspeak(game, io, Msg.BRIEF_CONFIRM);
  return PhaseCode.GO_CLEAROBJ;
}

function vcarry(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj === INTRANSITIVE) {
    if (
      game.locs[game.loc]!.atloc === Obj.NO_OBJECT ||
      game.link[game.locs[game.loc]!.atloc] !== 0 ||
      atdwrf(game, game.loc) > 0
    ) {
      return PhaseCode.GO_UNKNOWN;
    }
    obj = game.locs[game.loc]!.atloc;
  }

  if (TOTING(game, obj)) {
    speak(game, io, actions[verb]!.message);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj === Obj.MESSAG) {
    rspeak(game, io, Msg.REMOVE_MESSAGE);
    destroy(game, Obj.MESSAG);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (game.objects[obj]!.fixed !== IS_FREE) {
    switch (obj) {
      case Obj.PLANT:
        rspeak(
          game,
          io,
          game.objects[Obj.PLANT]!.prop === ObjState.PLANT_THIRSTY ||
            OBJECT_IS_STASHED(game, Obj.PLANT)
            ? Msg.DEEP_ROOTS
            : Msg.YOU_JOKING,
        );
        break;
      case Obj.BEAR:
        rspeak(
          game,
          io,
          game.objects[Obj.BEAR]!.prop === ObjState.SITTING_BEAR
            ? Msg.BEAR_CHAINED
            : Msg.YOU_JOKING,
        );
        break;
      case Obj.CHAIN:
        rspeak(
          game,
          io,
          game.objects[Obj.BEAR]!.prop !== ObjState.UNTAMED_BEAR
            ? Msg.STILL_LOCKED
            : Msg.YOU_JOKING,
        );
        break;
      case Obj.RUG:
        rspeak(
          game,
          io,
          game.objects[Obj.RUG]!.prop === ObjState.RUG_HOVER
            ? Msg.RUG_HOVERS
            : Msg.YOU_JOKING,
        );
        break;
      case Obj.URN:
        rspeak(game, io, Msg.URN_NOBUDGE);
        break;
      case Obj.CAVITY:
        rspeak(game, io, Msg.DOUGHNUT_HOLES);
        break;
      case Obj.BLOOD:
        rspeak(game, io, Msg.FEW_DROPS);
        break;
      case Obj.SIGN:
        rspeak(game, io, Msg.HAND_PASSTHROUGH);
        break;
      default:
        rspeak(game, io, Msg.YOU_JOKING);
    }
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj === Obj.WATER || obj === Obj.OIL) {
    if (!HERE(game, Obj.BOTTLE) || LIQUID(game) !== obj) {
      if (!TOTING(game, Obj.BOTTLE)) {
        rspeak(game, io, Msg.NO_CONTAINER);
        return PhaseCode.GO_CLEAROBJ;
      }
      if (game.objects[Obj.BOTTLE]!.prop === ObjState.EMPTY_BOTTLE) {
        return fill(game, io, verb, Obj.BOTTLE);
      } else {
        rspeak(game, io, Msg.BOTTLE_FULL);
      }
      return PhaseCode.GO_CLEAROBJ;
    }
    obj = Obj.BOTTLE;
  }

  if (game.holdng >= INVLIMIT) {
    rspeak(game, io, Msg.CARRY_LIMIT);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (
    obj === Obj.BIRD &&
    game.objects[Obj.BIRD]!.prop !== ObjState.BIRD_CAGED &&
    !OBJECT_IS_STASHED(game, Obj.BIRD)
  ) {
    if (game.objects[Obj.BIRD]!.prop === ObjState.BIRD_FOREST_UNCAGED) {
      destroy(game, Obj.BIRD);
      rspeak(game, io, Msg.BIRD_CRAP);
      return PhaseCode.GO_CLEAROBJ;
    }
    if (!TOTING(game, Obj.CAGE)) {
      rspeak(game, io, Msg.CANNOT_CARRY);
      return PhaseCode.GO_CLEAROBJ;
    }
    if (TOTING(game, Obj.ROD)) {
      rspeak(game, io, Msg.BIRD_EVADES);
      return PhaseCode.GO_CLEAROBJ;
    }
    game.objects[Obj.BIRD]!.prop = ObjState.BIRD_CAGED;
  }
  if (
    (obj === Obj.BIRD || obj === Obj.CAGE) &&
    OBJECT_STATE_EQUALS(game, Obj.BIRD, ObjState.BIRD_CAGED)
  ) {
    carry(game, Obj.BIRD + Obj.CAGE - obj, game.loc);
  }

  carry(game, obj, game.loc);

  if (obj === Obj.BOTTLE && LIQUID(game) !== Obj.NO_OBJECT) {
    game.objects[LIQUID(game)]!.place = CARRIED;
  }

  if (GSTONE(obj, Obj.EMERALD, Obj.RUBY, Obj.AMBER, Obj.SAPPH) && !OBJECT_IS_FOUND(game, obj)) {
    OBJECT_SET_FOUND(game, obj);
    game.objects[Obj.CAVITY]!.prop = ObjState.CAVITY_EMPTY;
  }
  rspeak(game, io, Msg.OK_MAN);
  return PhaseCode.GO_CLEAROBJ;
}

function chain(
  game: GameState,
  io: GameIO,
  verb: number,
): PhaseCode {
  if (verb !== Action.LOCK) {
    if (game.objects[Obj.BEAR]!.prop === ObjState.UNTAMED_BEAR) {
      rspeak(game, io, Msg.BEAR_BLOCKS);
      return PhaseCode.GO_CLEAROBJ;
    }
    if (game.objects[Obj.CHAIN]!.prop === ObjState.CHAIN_HEAP) {
      rspeak(game, io, Msg.ALREADY_UNLOCKED);
      return PhaseCode.GO_CLEAROBJ;
    }
    game.objects[Obj.CHAIN]!.prop = ObjState.CHAIN_HEAP;
    game.objects[Obj.CHAIN]!.fixed = IS_FREE;
    if (game.objects[Obj.BEAR]!.prop !== ObjState.BEAR_DEAD) {
      game.objects[Obj.BEAR]!.prop = ObjState.CONTENTED_BEAR;
    }

    switch (game.objects[Obj.BEAR]!.prop) {
      case ObjState.BEAR_DEAD:
        game.objects[Obj.BEAR]!.fixed = IS_FIXED;
        break;
      default:
        game.objects[Obj.BEAR]!.fixed = IS_FREE;
    }
    rspeak(game, io, Msg.CHAIN_UNLOCKED);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (game.objects[Obj.CHAIN]!.prop !== ObjState.CHAIN_HEAP) {
    rspeak(game, io, Msg.ALREADY_LOCKED);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (game.loc !== objects[Obj.CHAIN]!.plac) {
    rspeak(game, io, Msg.NO_LOCKSITE);
    return PhaseCode.GO_CLEAROBJ;
  }

  game.objects[Obj.CHAIN]!.prop = ObjState.CHAIN_FIXED;

  if (TOTING(game, Obj.CHAIN)) {
    drop(game, Obj.CHAIN, game.loc);
  }
  game.objects[Obj.CHAIN]!.fixed = IS_FIXED;

  rspeak(game, io, Msg.CHAIN_LOCKED);
  return PhaseCode.GO_CLEAROBJ;
}

function discard(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj === Obj.ROD && !TOTING(game, Obj.ROD) && TOTING(game, Obj.ROD2)) {
    obj = Obj.ROD2;
  }

  if (!TOTING(game, obj)) {
    speak(game, io, actions[verb]!.message);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (
    GSTONE(obj, Obj.EMERALD, Obj.RUBY, Obj.AMBER, Obj.SAPPH) &&
    AT(game, Obj.CAVITY) &&
    game.objects[Obj.CAVITY]!.prop !== ObjState.CAVITY_FULL
  ) {
    rspeak(game, io, Msg.GEM_FITS);
    game.objects[obj]!.prop = STATE_IN_CAVITY;
    game.objects[Obj.CAVITY]!.prop = ObjState.CAVITY_FULL;
    if (
      HERE(game, Obj.RUG) &&
      ((obj === Obj.EMERALD && game.objects[Obj.RUG]!.prop !== ObjState.RUG_HOVER) ||
        (obj === Obj.RUBY && game.objects[Obj.RUG]!.prop === ObjState.RUG_HOVER))
    ) {
      if (obj === Obj.RUBY) {
        rspeak(game, io, Msg.RUG_SETTLES);
      } else if (TOTING(game, Obj.RUG)) {
        rspeak(game, io, Msg.RUG_WIGGLES);
      } else {
        rspeak(game, io, Msg.RUG_RISES);
      }
      if (!TOTING(game, Obj.RUG) || obj === Obj.RUBY) {
        let k: number =
          game.objects[Obj.RUG]!.prop === ObjState.RUG_HOVER
            ? ObjState.RUG_FLOOR
            : ObjState.RUG_HOVER;
        game.objects[Obj.RUG]!.prop = k;
        if (k === ObjState.RUG_HOVER) {
          k = objects[Obj.SAPPH]!.plac;
        }
        move(game, Obj.RUG + NOBJECTS, k);
      }
    }
    drop(game, obj, game.loc);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj === Obj.COINS && HERE(game, Obj.VEND)) {
    destroy(game, Obj.COINS);
    drop(game, Obj.BATTERY, game.loc);
    pspeak(game, io, Obj.BATTERY, SpeakType.look, true, ObjState.FRESH_BATTERIES);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (LIQUID(game) === obj) {
    obj = Obj.BOTTLE;
  }
  if (obj === Obj.BOTTLE && LIQUID(game) !== Obj.NO_OBJECT) {
    game.objects[LIQUID(game)]!.place = Location.LOC_NOWHERE;
  }

  if (obj === Obj.BEAR && AT(game, Obj.TROLL)) {
    stateChange(game, io, Obj.TROLL, ObjState.TROLL_GONE);
    move(game, Obj.TROLL, Location.LOC_NOWHERE);
    move(game, Obj.TROLL + NOBJECTS, IS_FREE);
    move(game, Obj.TROLL2, objects[Obj.TROLL]!.plac);
    move(game, Obj.TROLL2 + NOBJECTS, objects[Obj.TROLL]!.fixd);
    juggle(game, Obj.CHASM);
    drop(game, obj, game.loc);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj === Obj.VASE) {
    if (game.loc !== objects[Obj.PILLOW]!.plac) {
      stateChange(
        game,
        io,
        Obj.VASE,
        AT(game, Obj.PILLOW) ? ObjState.VASE_WHOLE : ObjState.VASE_DROPPED,
      );
      if (game.objects[Obj.VASE]!.prop !== ObjState.VASE_WHOLE) {
        game.objects[Obj.VASE]!.fixed = IS_FIXED;
      }
      drop(game, obj, game.loc);
      return PhaseCode.GO_CLEAROBJ;
    }
  }

  if (obj === Obj.CAGE && game.objects[Obj.BIRD]!.prop === ObjState.BIRD_CAGED) {
    drop(game, Obj.BIRD, game.loc);
  }

  if (obj === Obj.BIRD) {
    if (AT(game, Obj.DRAGON) && game.objects[Obj.DRAGON]!.prop === ObjState.DRAGON_BARS) {
      rspeak(game, io, Msg.BIRD_BURNT);
      destroy(game, Obj.BIRD);
      return PhaseCode.GO_CLEAROBJ;
    }
    if (HERE(game, Obj.SNAKE)) {
      rspeak(game, io, Msg.BIRD_ATTACKS);
      if (game.closed) {
        return PhaseCode.GO_DWARFWAKE;
      }
      destroy(game, Obj.SNAKE);
      game.objects[Obj.SNAKE]!.prop = ObjState.SNAKE_CHASED;
    } else {
      rspeak(game, io, Msg.OK_MAN);
    }

    game.objects[Obj.BIRD]!.prop = FOREST(conditions, game.loc)
      ? ObjState.BIRD_FOREST_UNCAGED
      : ObjState.BIRD_UNCAGED;
    drop(game, obj, game.loc);
    return PhaseCode.GO_CLEAROBJ;
  }

  rspeak(game, io, Msg.OK_MAN);
  drop(game, obj, game.loc);
  return PhaseCode.GO_CLEAROBJ;
}

function drink(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (
    obj === INTRANSITIVE &&
    LIQLOC(game.loc) !== Obj.WATER &&
    (LIQUID(game) !== Obj.WATER || !HERE(game, Obj.BOTTLE))
  ) {
    return PhaseCode.GO_UNKNOWN;
  }

  if (obj === Obj.BLOOD) {
    destroy(game, Obj.BLOOD);
    stateChange(game, io, Obj.DRAGON, ObjState.DRAGON_BLOODLESS);
    game.blooded = true;
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj !== INTRANSITIVE && obj !== Obj.WATER) {
    rspeak(game, io, Msg.RIDICULOUS_ATTEMPT);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (LIQUID(game) === Obj.WATER && HERE(game, Obj.BOTTLE)) {
    game.objects[Obj.WATER]!.place = Location.LOC_NOWHERE;
    stateChange(game, io, Obj.BOTTLE, ObjState.EMPTY_BOTTLE);
    return PhaseCode.GO_CLEAROBJ;
  }

  speak(game, io, actions[verb]!.message);
  return PhaseCode.GO_CLEAROBJ;
}

function eat(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  switch (obj) {
    case INTRANSITIVE:
      if (!HERE(game, Obj.FOOD)) {
        return PhaseCode.GO_UNKNOWN;
      }
    // eslint-disable-next-line no-fallthrough
    case Obj.FOOD:
      destroy(game, Obj.FOOD);
      rspeak(game, io, Msg.THANKS_DELICIOUS);
      break;
    case Obj.BIRD:
    case Obj.SNAKE:
    case Obj.CLAM:
    case Obj.OYSTER:
    case Obj.DWARF:
    case Obj.DRAGON:
    case Obj.TROLL:
    case Obj.BEAR:
    case Obj.OGRE:
      rspeak(game, io, Msg.LOST_APPETITE);
      break;
    default:
      speak(game, io, actions[verb]!.message);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function extinguish(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj === INTRANSITIVE) {
    if (HERE(game, Obj.LAMP) && game.objects[Obj.LAMP]!.prop === ObjState.LAMP_BRIGHT) {
      obj = Obj.LAMP;
    }
    if (HERE(game, Obj.URN) && game.objects[Obj.URN]!.prop === ObjState.URN_LIT) {
      obj = Obj.URN;
    }
    if (obj === INTRANSITIVE) {
      return PhaseCode.GO_UNKNOWN;
    }
  }

  switch (obj) {
    case Obj.URN:
      if (game.objects[Obj.URN]!.prop !== ObjState.URN_EMPTY) {
        stateChange(game, io, Obj.URN, ObjState.URN_DARK);
      } else {
        pspeak(game, io, Obj.URN, SpeakType.change, true, ObjState.URN_DARK);
      }
      break;
    case Obj.LAMP:
      stateChange(game, io, Obj.LAMP, ObjState.LAMP_DARK);
      rspeak(game, io, IS_DARK_HERE(game) ? Msg.PITCH_DARK : Msg.NO_MESSAGE);
      break;
    case Obj.DRAGON:
    case Obj.VOLCANO:
      rspeak(game, io, Msg.BEYOND_POWER);
      break;
    default:
      speak(game, io, actions[verb]!.message);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function feed(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  switch (obj) {
    case Obj.BIRD:
      rspeak(game, io, Msg.BIRD_PINING);
      break;
    case Obj.DRAGON:
      if (game.objects[Obj.DRAGON]!.prop !== ObjState.DRAGON_BARS) {
        rspeak(game, io, Msg.RIDICULOUS_ATTEMPT);
      } else {
        rspeak(game, io, Msg.NOTHING_EDIBLE);
      }
      break;
    case Obj.SNAKE:
      if (!game.closed && HERE(game, Obj.BIRD)) {
        destroy(game, Obj.BIRD);
        rspeak(game, io, Msg.BIRD_DEVOURED);
      } else {
        rspeak(game, io, Msg.NOTHING_EDIBLE);
      }
      break;
    case Obj.TROLL:
      rspeak(game, io, Msg.TROLL_VICES);
      break;
    case Obj.DWARF:
      if (HERE(game, Obj.FOOD)) {
        game.dflag += 2;
        rspeak(game, io, Msg.REALLY_MAD);
      } else {
        speak(game, io, actions[verb]!.message);
      }
      break;
    case Obj.BEAR:
      if (game.objects[Obj.BEAR]!.prop === ObjState.BEAR_DEAD) {
        rspeak(game, io, Msg.RIDICULOUS_ATTEMPT);
        break;
      }
      if (game.objects[Obj.BEAR]!.prop === ObjState.UNTAMED_BEAR) {
        if (HERE(game, Obj.FOOD)) {
          destroy(game, Obj.FOOD);
          game.objects[Obj.AXE]!.fixed = IS_FREE;
          game.objects[Obj.AXE]!.prop = ObjState.AXE_HERE;
          stateChange(game, io, Obj.BEAR, ObjState.SITTING_BEAR);
        } else {
          rspeak(game, io, Msg.NOTHING_EDIBLE);
        }
        break;
      }
      speak(game, io, actions[verb]!.message);
      break;
    case Obj.OGRE:
      if (HERE(game, Obj.FOOD)) {
        rspeak(game, io, Msg.OGRE_FULL);
      } else {
        speak(game, io, actions[verb]!.message);
      }
      break;
    default:
      rspeak(game, io, Msg.AM_GAME);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function fill(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj === Obj.VASE) {
    if (LIQLOC(game.loc) === Obj.NO_OBJECT) {
      rspeak(game, io, Msg.FILL_INVALID);
      return PhaseCode.GO_CLEAROBJ;
    }
    if (!TOTING(game, Obj.VASE)) {
      rspeak(game, io, Msg.ARENT_CARRYING);
      return PhaseCode.GO_CLEAROBJ;
    }
    rspeak(game, io, Msg.SHATTER_VASE);
    game.objects[Obj.VASE]!.prop = ObjState.VASE_BROKEN;
    game.objects[Obj.VASE]!.fixed = IS_FIXED;
    drop(game, Obj.VASE, game.loc);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj === Obj.URN) {
    if (game.objects[Obj.URN]!.prop !== ObjState.URN_EMPTY) {
      rspeak(game, io, Msg.FULL_URN);
      return PhaseCode.GO_CLEAROBJ;
    }
    if (!HERE(game, Obj.BOTTLE)) {
      rspeak(game, io, Msg.FILL_INVALID);
      return PhaseCode.GO_CLEAROBJ;
    }
    const k = LIQUID(game);
    switch (k) {
      case Obj.WATER:
        game.objects[Obj.BOTTLE]!.prop = ObjState.EMPTY_BOTTLE;
        rspeak(game, io, Msg.WATER_URN);
        break;
      case Obj.OIL:
        game.objects[Obj.URN]!.prop = ObjState.URN_DARK;
        game.objects[Obj.BOTTLE]!.prop = ObjState.EMPTY_BOTTLE;
        rspeak(game, io, Msg.OIL_URN);
        break;
      case Obj.NO_OBJECT:
      default:
        rspeak(game, io, Msg.FILL_INVALID);
        return PhaseCode.GO_CLEAROBJ;
    }
    game.objects[k]!.place = Location.LOC_NOWHERE;
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj !== INTRANSITIVE && obj !== Obj.BOTTLE) {
    speak(game, io, actions[verb]!.message);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (obj === INTRANSITIVE && !HERE(game, Obj.BOTTLE)) {
    return PhaseCode.GO_UNKNOWN;
  }

  if (HERE(game, Obj.URN) && game.objects[Obj.URN]!.prop !== ObjState.URN_EMPTY) {
    rspeak(game, io, Msg.URN_NOPOUR);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (LIQUID(game) !== Obj.NO_OBJECT) {
    rspeak(game, io, Msg.BOTTLE_FULL);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (LIQLOC(game.loc) === Obj.NO_OBJECT) {
    rspeak(game, io, Msg.NO_LIQUID);
    return PhaseCode.GO_CLEAROBJ;
  }

  stateChange(
    game,
    io,
    Obj.BOTTLE,
    LIQLOC(game.loc) === Obj.OIL ? ObjState.OIL_BOTTLE : ObjState.WATER_BOTTLE,
  );
  if (TOTING(game, Obj.BOTTLE)) {
    game.objects[LIQUID(game)]!.place = CARRIED;
  }
  return PhaseCode.GO_CLEAROBJ;
}

function find(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (TOTING(game, obj)) {
    rspeak(game, io, Msg.ALREADY_CARRYING);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (game.closed) {
    rspeak(game, io, Msg.NEEDED_NEARBY);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (
    AT(game, obj) ||
    (LIQUID(game) === obj && AT(game, Obj.BOTTLE)) ||
    obj === LIQLOC(game.loc) ||
    (obj === Obj.DWARF && atdwrf(game, game.loc) > 0)
  ) {
    rspeak(game, io, Msg.YOU_HAVEIT);
    return PhaseCode.GO_CLEAROBJ;
  }

  speak(game, io, actions[verb]!.message);
  return PhaseCode.GO_CLEAROBJ;
}

function fly(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj === INTRANSITIVE) {
    if (!HERE(game, Obj.RUG)) {
      rspeak(game, io, Msg.FLAP_ARMS);
      return PhaseCode.GO_CLEAROBJ;
    }
    if (game.objects[Obj.RUG]!.prop !== ObjState.RUG_HOVER) {
      rspeak(game, io, Msg.RUG_NOTHING2);
      return PhaseCode.GO_CLEAROBJ;
    }
    obj = Obj.RUG;
  }

  if (obj !== Obj.RUG) {
    speak(game, io, actions[verb]!.message);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (game.objects[Obj.RUG]!.prop !== ObjState.RUG_HOVER) {
    rspeak(game, io, Msg.RUG_NOTHING1);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (game.loc === Location.LOC_CLIFF) {
    game.oldlc2 = game.oldloc;
    game.oldloc = game.loc;
    game.newloc = Location.LOC_LEDGE;
    rspeak(game, io, Msg.RUG_GOES);
  } else if (game.loc === Location.LOC_LEDGE) {
    game.oldlc2 = game.oldloc;
    game.oldloc = game.loc;
    game.newloc = Location.LOC_CLIFF;
    rspeak(game, io, Msg.RUG_RETURNS);
  } else {
    rspeak(game, io, Msg.NOTHING_HAPPENS);
  }
  return PhaseCode.GO_TERMINATE;
}

function inven(
  game: GameState,
  io: GameIO,
): PhaseCode {
  let empty = true;
  for (let i = 1; i <= NOBJECTS; i++) {
    if (i === Obj.BEAR || !TOTING(game, i)) {
      continue;
    }
    if (empty) {
      rspeak(game, io, Msg.NOW_HOLDING);
      empty = false;
    }
    pspeak(game, io, i, SpeakType.touch, false, -1);
  }
  if (TOTING(game, Obj.BEAR)) {
    rspeak(game, io, Msg.TAME_BEAR);
  }
  if (empty) {
    rspeak(game, io, Msg.NO_CARRY);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function light(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj === INTRANSITIVE) {
    let selects = 0;
    if (
      HERE(game, Obj.LAMP) &&
      game.objects[Obj.LAMP]!.prop === ObjState.LAMP_DARK &&
      game.limit >= 0
    ) {
      obj = Obj.LAMP;
      selects++;
    }
    if (HERE(game, Obj.URN) && game.objects[Obj.URN]!.prop === ObjState.URN_DARK) {
      obj = Obj.URN;
      selects++;
    }
    if (selects !== 1) {
      return PhaseCode.GO_UNKNOWN;
    }
  }

  switch (obj) {
    case Obj.URN:
      stateChange(
        game,
        io,
        Obj.URN,
        game.objects[Obj.URN]!.prop === ObjState.URN_EMPTY
          ? ObjState.URN_EMPTY
          : ObjState.URN_LIT,
      );
      break;
    case Obj.LAMP:
      if (game.limit < 0) {
        rspeak(game, io, Msg.LAMP_OUT);
        break;
      }
      stateChange(game, io, Obj.LAMP, ObjState.LAMP_BRIGHT);
      if (game.wzdark) {
        return PhaseCode.GO_TOP;
      }
      break;
    default:
      speak(game, io, actions[verb]!.message);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function listen(
  game: GameState,
  io: GameIO,
): PhaseCode {
  let soundlatch = false;
  const sound = locations[game.loc]!.sound;
  if (sound !== -1) {
    rspeak(game, io, sound);
    if (!locations[game.loc]!.loud) {
      rspeak(game, io, Msg.NO_MESSAGE);
    }
    soundlatch = true;
  }
  for (let i = 1; i <= NOBJECTS; i++) {
    if (
      !HERE(game, i) ||
      objects[i]!.sounds[0] === null ||
      OBJECT_IS_STASHED(game, i) ||
      OBJECT_IS_NOTFOUND(game, i)
    ) {
      continue;
    }
    let mi = game.objects[i]!.prop;
    if (i === Obj.BIRD) {
      mi += 3 * (game.blooded ? 1 : 0);
    }
    pspeak(game, io, i, SpeakType.hear, true, mi, game.zzword);
    rspeak(game, io, Msg.NO_MESSAGE);
    if (i === Obj.BIRD && mi === BIRD_ENDSTATE) {
      destroy(game, Obj.BIRD);
    }
    soundlatch = true;
  }
  if (!soundlatch) {
    rspeak(game, io, Msg.ALL_SILENT);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function lock(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj === INTRANSITIVE) {
    if (HERE(game, Obj.CLAM)) {
      obj = Obj.CLAM;
    }
    if (HERE(game, Obj.OYSTER)) {
      obj = Obj.OYSTER;
    }
    if (AT(game, Obj.DOOR)) {
      obj = Obj.DOOR;
    }
    if (AT(game, Obj.GRATE)) {
      obj = Obj.GRATE;
    }
    if (HERE(game, Obj.CHAIN)) {
      obj = Obj.CHAIN;
    }
    if (obj === INTRANSITIVE) {
      rspeak(game, io, Msg.NOTHING_LOCKED);
      return PhaseCode.GO_CLEAROBJ;
    }
  }

  switch (obj) {
    case Obj.CHAIN:
      if (HERE(game, Obj.KEYS)) {
        return chain(game, io, verb);
      } else {
        rspeak(game, io, Msg.NO_KEYS);
      }
      break;
    case Obj.GRATE:
      if (HERE(game, Obj.KEYS)) {
        if (game.closng) {
          rspeak(game, io, Msg.EXIT_CLOSED);
          if (!game.panic) {
            game.clock2 = PANICTIME;
          }
          game.panic = true;
        } else {
          stateChange(
            game,
            io,
            Obj.GRATE,
            verb === Action.LOCK ? ObjState.GRATE_CLOSED : ObjState.GRATE_OPEN,
          );
        }
      } else {
        rspeak(game, io, Msg.NO_KEYS);
      }
      break;
    case Obj.CLAM:
      if (verb === Action.LOCK) {
        rspeak(game, io, Msg.HUH_MAN);
      } else if (TOTING(game, Obj.CLAM)) {
        rspeak(game, io, Msg.DROP_CLAM);
      } else if (!TOTING(game, Obj.TRIDENT)) {
        rspeak(game, io, Msg.CLAM_OPENER);
      } else {
        destroy(game, Obj.CLAM);
        drop(game, Obj.OYSTER, game.loc);
        drop(game, Obj.PEARL, Location.LOC_CULDESAC);
        rspeak(game, io, Msg.PEARL_FALLS);
      }
      break;
    case Obj.OYSTER:
      if (verb === Action.LOCK) {
        rspeak(game, io, Msg.HUH_MAN);
      } else if (TOTING(game, Obj.OYSTER)) {
        rspeak(game, io, Msg.DROP_OYSTER);
      } else if (!TOTING(game, Obj.TRIDENT)) {
        rspeak(game, io, Msg.OYSTER_OPENER);
      } else {
        rspeak(game, io, Msg.OYSTER_OPENS);
      }
      break;
    case Obj.DOOR:
      rspeak(
        game,
        io,
        game.objects[Obj.DOOR]!.prop === ObjState.DOOR_UNRUSTED ? Msg.OK_MAN : Msg.RUSTY_DOOR,
      );
      break;
    case Obj.CAGE:
      rspeak(game, io, Msg.NO_LOCK);
      break;
    case Obj.KEYS:
      rspeak(game, io, Msg.CANNOT_UNLOCK);
      break;
    default:
      speak(game, io, actions[verb]!.message);
  }

  return PhaseCode.GO_CLEAROBJ;
}

function pour(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj === Obj.BOTTLE || obj === INTRANSITIVE) {
    obj = LIQUID(game);
  }
  if (obj === Obj.NO_OBJECT) {
    return PhaseCode.GO_UNKNOWN;
  }
  if (!TOTING(game, obj)) {
    speak(game, io, actions[verb]!.message);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (obj !== Obj.OIL && obj !== Obj.WATER) {
    rspeak(game, io, Msg.CANT_POUR);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (HERE(game, Obj.URN) && game.objects[Obj.URN]!.prop === ObjState.URN_EMPTY) {
    return fill(game, io, verb, Obj.URN);
  }
  game.objects[Obj.BOTTLE]!.prop = ObjState.EMPTY_BOTTLE;
  game.objects[obj]!.place = Location.LOC_NOWHERE;
  if (!(AT(game, Obj.PLANT) || AT(game, Obj.DOOR))) {
    rspeak(game, io, Msg.GROUND_WET);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (!AT(game, Obj.DOOR)) {
    if (obj === Obj.WATER) {
      stateChange(game, io, Obj.PLANT, (game.objects[Obj.PLANT]!.prop + 1) % 3);
      game.objects[Obj.PLANT2]!.prop = game.objects[Obj.PLANT]!.prop;
      return PhaseCode.GO_MOVE;
    } else {
      rspeak(game, io, Msg.SHAKING_LEAVES);
      return PhaseCode.GO_CLEAROBJ;
    }
  } else {
    stateChange(
      game,
      io,
      Obj.DOOR,
      obj === Obj.OIL ? ObjState.DOOR_UNRUSTED : ObjState.DOOR_RUSTED,
    );
    return PhaseCode.GO_CLEAROBJ;
  }
}

function quit(
  game: GameState,
  io: GameIO,
  settings: Settings,
): Promise<PhaseCode> {
  return yesOrNo(
    game,
    io,
    arbitraryMessages[Msg.REALLY_QUIT]!,
    arbitraryMessages[Msg.OK_MAN]!,
    arbitraryMessages[Msg.OK_MAN]!,
  ).then((yes) => {
    if (yes) {
      terminate(game, io, settings, Termination.quitgame);
    }
    return PhaseCode.GO_CLEAROBJ;
  });
}

function read(
  game: GameState,
  io: GameIO,
  settings: Settings,
  command: Command,
): PhaseCode | Promise<PhaseCode> {
  if (command.obj === INTRANSITIVE) {
    command.obj = Obj.NO_OBJECT;
    for (let i = 1; i <= NOBJECTS; i++) {
      if (
        HERE(game, i) &&
        objects[i]!.texts[0] !== null &&
        !OBJECT_IS_STASHED(game, i)
      ) {
        command.obj = command.obj * NOBJECTS + i;
      }
    }
    if (command.obj > NOBJECTS || command.obj === Obj.NO_OBJECT || IS_DARK_HERE(game)) {
      return PhaseCode.GO_UNKNOWN;
    }
  }

  if (IS_DARK_HERE(game)) {
    sspeak(game, io, Msg.NO_SEE, command.word[0].raw);
  } else if (command.obj === Obj.OYSTER) {
    if (!TOTING(game, Obj.OYSTER) || !game.closed) {
      rspeak(game, io, Msg.DONT_UNDERSTAND);
    } else if (!game.clshnt) {
      return yesOrNo(
        game,
        io,
        arbitraryMessages[Msg.CLUE_QUERY]!,
        arbitraryMessages[Msg.WAYOUT_CLUE]!,
        arbitraryMessages[Msg.OK_MAN]!,
      ).then((yes) => {
        game.clshnt = yes;
        return PhaseCode.GO_CLEAROBJ;
      });
    } else {
      pspeak(game, io, Obj.OYSTER, SpeakType.hear, true, 1);
    }
  } else if (
    objects[command.obj]!.texts[0] === null ||
    OBJECT_IS_NOTFOUND(game, command.obj)
  ) {
    speak(game, io, actions[command.verb]!.message);
  } else {
    pspeak(game, io, command.obj, SpeakType.study, true, game.objects[command.obj]!.prop);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function reservoir(
  game: GameState,
  io: GameIO,
): PhaseCode {
  if (!AT(game, Obj.RESER) && game.loc !== Location.LOC_RESBOTTOM) {
    rspeak(game, io, Msg.NOTHING_HAPPENS);
    return PhaseCode.GO_CLEAROBJ;
  } else {
    stateChange(
      game,
      io,
      Obj.RESER,
      game.objects[Obj.RESER]!.prop === ObjState.WATERS_PARTED
        ? ObjState.WATERS_UNPARTED
        : ObjState.WATERS_PARTED,
    );
    if (AT(game, Obj.RESER)) {
      return PhaseCode.GO_CLEAROBJ;
    } else {
      game.oldlc2 = game.loc;
      game.newloc = Location.LOC_NOWHERE;
      rspeak(game, io, Msg.NOT_BRIGHT);
      return PhaseCode.GO_TERMINATE;
    }
  }
}

function rub(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj === Obj.URN && game.objects[Obj.URN]!.prop === ObjState.URN_LIT) {
    destroy(game, Obj.URN);
    drop(game, Obj.AMBER, game.loc);
    game.objects[Obj.AMBER]!.prop = ObjState.AMBER_IN_ROCK;
    --game.tally;
    drop(game, Obj.CAVITY, game.loc);
    rspeak(game, io, Msg.URN_GENIES);
  } else if (obj !== Obj.LAMP) {
    rspeak(game, io, Msg.PECULIAR_NOTHING);
  } else {
    speak(game, io, actions[verb]!.message);
  }
  return PhaseCode.GO_CLEAROBJ;
}

function say(
  game: GameState,
  io: GameIO,
  settings: Settings,
  command: Command,
): PhaseCode {
  if (
    command.word[1].type === WordType.MOTION &&
    (command.word[1].id === Motion.XYZZY ||
      command.word[1].id === Motion.PLUGH ||
      command.word[1].id === Motion.PLOVER)
  ) {
    return PhaseCode.GO_WORD2;
  }
  if (command.word[1].type === WordType.ACTION && command.word[1].id === Action.PART) {
    return reservoir(game, io);
  }

  if (
    command.word[1].type === WordType.ACTION &&
    (command.word[1].id === Action.FEE ||
      command.word[1].id === Action.FIE ||
      command.word[1].id === Action.FOE ||
      command.word[1].id === Action.FOO ||
      command.word[1].id === Action.FUM ||
      command.word[1].id === Action.PART)
  ) {
    return bigwords(game, io, settings, command.word[1].id);
  }
  sspeak(game, io, Msg.OKEY_DOKEY, command.word[1].raw);
  return PhaseCode.GO_CLEAROBJ;
}

function throwSupport(
  game: GameState,
  io: GameIO,
  spk: number,
): PhaseCode {
  rspeak(game, io, spk);
  drop(game, Obj.AXE, game.loc);
  return PhaseCode.GO_MOVE;
}

function throwit(
  game: GameState,
  io: GameIO,
  settings: Settings,
  command: Command,
): PhaseCode | Promise<PhaseCode> {
  if (!TOTING(game, command.obj)) {
    speak(game, io, actions[command.verb]!.message);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (objects[command.obj]!.isTreasure && AT(game, Obj.TROLL)) {
    drop(game, command.obj, Location.LOC_NOWHERE);
    move(game, Obj.TROLL, Location.LOC_NOWHERE);
    move(game, Obj.TROLL + NOBJECTS, IS_FREE);
    drop(game, Obj.TROLL2, objects[Obj.TROLL]!.plac);
    drop(game, Obj.TROLL2 + NOBJECTS, objects[Obj.TROLL]!.fixd);
    juggle(game, Obj.CHASM);
    rspeak(game, io, Msg.TROLL_SATISFIED);
    return PhaseCode.GO_CLEAROBJ;
  }
  if (command.obj === Obj.FOOD && HERE(game, Obj.BEAR)) {
    command.obj = Obj.BEAR;
    return feed(game, io, command.verb, command.obj);
  }
  if (command.obj !== Obj.AXE) {
    return discard(game, io, command.verb, command.obj);
  } else {
    if (atdwrf(game, game.loc) <= 0) {
      if (AT(game, Obj.DRAGON) && game.objects[Obj.DRAGON]!.prop === ObjState.DRAGON_BARS) {
        return throwSupport(game, io, Msg.DRAGON_SCALES);
      }
      if (AT(game, Obj.TROLL)) {
        return throwSupport(game, io, Msg.TROLL_RETURNS);
      }
      if (AT(game, Obj.OGRE)) {
        return throwSupport(game, io, Msg.OGRE_DODGE);
      }
      if (HERE(game, Obj.BEAR) && game.objects[Obj.BEAR]!.prop === ObjState.UNTAMED_BEAR) {
        drop(game, Obj.AXE, game.loc);
        game.objects[Obj.AXE]!.fixed = IS_FIXED;
        juggle(game, Obj.BEAR);
        stateChange(game, io, Obj.AXE, ObjState.AXE_LOST);
        return PhaseCode.GO_CLEAROBJ;
      }
      command.obj = INTRANSITIVE;
      return attack(game, io, settings, command);
    }

    if (randrange(game, settings, NDWARVES + 1) < game.dflag) {
      return throwSupport(game, io, Msg.DWARF_DODGES);
    } else {
      const i = atdwrf(game, game.loc);
      game.dwarves[i]!.seen = 0;
      game.dwarves[i]!.loc = Location.LOC_NOWHERE;
      return throwSupport(
        game,
        io,
        ++game.dkill === 1 ? Msg.DWARF_SMOKE : Msg.KILLED_DWARF,
      );
    }
  }
}

function wake(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (obj !== Obj.DWARF || !game.closed) {
    speak(game, io, actions[verb]!.message);
    return PhaseCode.GO_CLEAROBJ;
  } else {
    rspeak(game, io, Msg.PROD_DWARF);
    return PhaseCode.GO_DWARFWAKE;
  }
}

function seed(
  game: GameState,
  io: GameIO,
  settings: Settings,
  verb: number,
  arg: string,
): PhaseCode {
  const seedval = parseInt(arg, 10);
  speak(game, io, actions[verb]!.message, seedval);
  setSeed(game, settings, seedval);
  --game.turns;
  return PhaseCode.GO_TOP;
}

function waste(
  game: GameState,
  io: GameIO,
  verb: number,
  turns: number,
): PhaseCode {
  game.limit -= turns;
  speak(game, io, actions[verb]!.message, game.limit);
  return PhaseCode.GO_TOP;
}

function wave(
  game: GameState,
  io: GameIO,
  verb: number,
  obj: number,
): PhaseCode {
  if (
    obj !== Obj.ROD ||
    !TOTING(game, obj) ||
    (!HERE(game, Obj.BIRD) && (game.closng || !AT(game, Obj.FISSURE)))
  ) {
    speak(
      game,
      io,
      !TOTING(game, obj) && (obj !== Obj.ROD || !TOTING(game, Obj.ROD2))
        ? arbitraryMessages[Msg.ARENT_CARRYING]!
        : actions[verb]!.message,
    );
    return PhaseCode.GO_CLEAROBJ;
  }

  if (
    game.objects[Obj.BIRD]!.prop === ObjState.BIRD_UNCAGED &&
    game.loc === game.objects[Obj.STEPS]!.place &&
    OBJECT_IS_NOTFOUND(game, Obj.JADE)
  ) {
    drop(game, Obj.JADE, game.loc);
    OBJECT_SET_FOUND(game, Obj.JADE);
    --game.tally;
    rspeak(game, io, Msg.NECKLACE_FLY);
    return PhaseCode.GO_CLEAROBJ;
  } else {
    if (game.closed) {
      rspeak(
        game,
        io,
        game.objects[Obj.BIRD]!.prop === ObjState.BIRD_CAGED ? Msg.CAGE_FLY : Msg.FREE_FLY,
      );
      return PhaseCode.GO_DWARFWAKE;
    }
    if (game.closng || !AT(game, Obj.FISSURE)) {
      rspeak(
        game,
        io,
        game.objects[Obj.BIRD]!.prop === ObjState.BIRD_CAGED ? Msg.CAGE_FLY : Msg.FREE_FLY,
      );
      return PhaseCode.GO_CLEAROBJ;
    }
    if (HERE(game, Obj.BIRD)) {
      rspeak(
        game,
        io,
        game.objects[Obj.BIRD]!.prop === ObjState.BIRD_CAGED ? Msg.CAGE_FLY : Msg.FREE_FLY,
      );
    }

    stateChange(
      game,
      io,
      Obj.FISSURE,
      game.objects[Obj.FISSURE]!.prop === ObjState.BRIDGED
        ? ObjState.UNBRIDGED
        : ObjState.BRIDGED,
    );
    return PhaseCode.GO_CLEAROBJ;
  }
}

// ── Save/Resume ──

async function suspend(
  game: GameState,
  settings: Settings,
  io: GameIO,
): Promise<PhaseCode> {
  return suspendSave(game, settings, io);
}

async function resumeGame(
  game: GameState,
  settings: Settings,
  io: GameIO,
): Promise<PhaseCode> {
  return resumeSave(game, settings, io);
}

// ── Main action dispatcher ──

export async function action(
  game: GameState,
  io: GameIO,
  settings: Settings,
  command: Command,
): Promise<PhaseCode> {
  if (actions[command.verb]!.noaction) {
    speak(game, io, actions[command.verb]!.message);
    return PhaseCode.GO_CLEAROBJ;
  }

  if (command.part === SpeechPart.unknown) {
    if (HERE(game, command.obj)) {
      // FALL THROUGH
    } else if (command.obj === Obj.DWARF && atdwrf(game, game.loc) > 0) {
      // FALL THROUGH
    } else if (
      !game.closed &&
      ((LIQUID(game) === command.obj && HERE(game, Obj.BOTTLE)) ||
        command.obj === LIQLOC(game.loc))
    ) {
      // FALL THROUGH
    } else if (
      command.obj === Obj.OIL &&
      HERE(game, Obj.URN) &&
      game.objects[Obj.URN]!.prop !== ObjState.URN_EMPTY
    ) {
      command.obj = Obj.URN;
    } else if (
      command.obj === Obj.PLANT &&
      AT(game, Obj.PLANT2) &&
      game.objects[Obj.PLANT2]!.prop !== ObjState.PLANT_THIRSTY
    ) {
      command.obj = Obj.PLANT2;
    } else if (command.obj === Obj.KNIFE && game.knfloc === game.loc) {
      game.knfloc = -1;
      rspeak(game, io, Msg.KNIVES_VANISH);
      return PhaseCode.GO_CLEAROBJ;
    } else if (command.obj === Obj.ROD && HERE(game, Obj.ROD2)) {
      command.obj = Obj.ROD2;
    } else if (
      (command.verb === Action.FIND || command.verb === Action.INVENTORY) &&
      (command.word[1].id === WORD_EMPTY || command.word[1].id === WORD_NOT_FOUND)
    ) {
      // FALL THROUGH
    } else {
      sspeak(game, io, Msg.NO_SEE, command.word[0].raw);
      return PhaseCode.GO_CLEAROBJ;
    }

    if (command.verb !== 0) {
      command.part = SpeechPart.transitive;
    }
  }

  switch (command.part) {
    case SpeechPart.intransitive:
      if (command.word[1].raw !== "" && command.verb !== Action.SAY) {
        return PhaseCode.GO_WORD2;
      }
      if (command.verb === Action.SAY) {
        command.obj = command.word[1].raw !== "" ? Obj.KEYS : Obj.NO_OBJECT;
      }
      if (command.obj === Obj.NO_OBJECT || command.obj === INTRANSITIVE) {
        switch (command.verb) {
          case Action.CARRY:
            return vcarry(game, io, command.verb, INTRANSITIVE);
          case Action.DROP:
            return PhaseCode.GO_UNKNOWN;
          case Action.SAY:
            return PhaseCode.GO_UNKNOWN;
          case Action.UNLOCK:
            return lock(game, io, command.verb, INTRANSITIVE);
          case Action.NOTHING:
            rspeak(game, io, Msg.OK_MAN);
            return PhaseCode.GO_CLEAROBJ;
          case Action.LOCK:
            return lock(game, io, command.verb, INTRANSITIVE);
          case Action.LIGHT:
            return light(game, io, command.verb, INTRANSITIVE);
          case Action.EXTINGUISH:
            return extinguish(game, io, command.verb, INTRANSITIVE);
          case Action.WAVE:
            return PhaseCode.GO_UNKNOWN;
          case Action.TAME:
            return PhaseCode.GO_UNKNOWN;
          case Action.GO:
            speak(game, io, actions[command.verb]!.message);
            return PhaseCode.GO_CLEAROBJ;
          case Action.ATTACK:
            command.obj = INTRANSITIVE;
            return attack(game, io, settings, command);
          case Action.POUR:
            return pour(game, io, command.verb, INTRANSITIVE);
          case Action.EAT:
            return eat(game, io, command.verb, INTRANSITIVE);
          case Action.DRINK:
            return drink(game, io, command.verb, INTRANSITIVE);
          case Action.RUB:
            return PhaseCode.GO_UNKNOWN;
          case Action.THROW:
            return PhaseCode.GO_UNKNOWN;
          case Action.QUIT:
            return quit(game, io, settings);
          case Action.FIND:
            return PhaseCode.GO_UNKNOWN;
          case Action.INVENTORY:
            return inven(game, io);
          case Action.FEED:
            return PhaseCode.GO_UNKNOWN;
          case Action.FILL:
            return fill(game, io, command.verb, INTRANSITIVE);
          case Action.BLAST:
            blast(game, io, settings);
            return PhaseCode.GO_CLEAROBJ;
          case Action.SCORE:
            score(game, io, settings, Termination.scoregame);
            return PhaseCode.GO_CLEAROBJ;
          case Action.FEE:
          case Action.FIE:
          case Action.FOE:
          case Action.FOO:
          case Action.FUM:
            return bigwords(game, io, settings, command.word[0].id);
          case Action.BRIEF:
            return brief(game, io);
          case Action.READ:
            command.obj = INTRANSITIVE;
            return read(game, io, settings, command);
          case Action.BREAK:
            return PhaseCode.GO_UNKNOWN;
          case Action.WAKE:
            return PhaseCode.GO_UNKNOWN;
          case Action.SAVE:
            return suspend(game, settings, io);
          case Action.RESUME:
            return resumeGame(game, settings, io);
          case Action.FLY:
            return fly(game, io, command.verb, INTRANSITIVE);
          case Action.LISTEN:
            return listen(game, io);
          case Action.PART:
            return reservoir(game, io);
          case Action.SEED:
          case Action.WASTE:
            rspeak(game, io, Msg.NUMERIC_REQUIRED);
            return PhaseCode.GO_TOP;
          default:
            throw new Error("BUG: INTRANSITIVE_ACTION_VERB_EXCEEDS_GOTO_LIST");
        }
      }
    // eslint-disable-next-line no-fallthrough
    case SpeechPart.transitive:
      switch (command.verb) {
        case Action.CARRY:
          return vcarry(game, io, command.verb, command.obj);
        case Action.DROP:
          return discard(game, io, command.verb, command.obj);
        case Action.SAY:
          return say(game, io, settings, command);
        case Action.UNLOCK:
          return lock(game, io, command.verb, command.obj);
        case Action.NOTHING:
          rspeak(game, io, Msg.OK_MAN);
          return PhaseCode.GO_CLEAROBJ;
        case Action.LOCK:
          return lock(game, io, command.verb, command.obj);
        case Action.LIGHT:
          return light(game, io, command.verb, command.obj);
        case Action.EXTINGUISH:
          return extinguish(game, io, command.verb, command.obj);
        case Action.WAVE:
          return wave(game, io, command.verb, command.obj);
        case Action.TAME:
          speak(game, io, actions[command.verb]!.message);
          return PhaseCode.GO_CLEAROBJ;
        case Action.GO:
          speak(game, io, actions[command.verb]!.message);
          return PhaseCode.GO_CLEAROBJ;
        case Action.ATTACK:
          return attack(game, io, settings, command);
        case Action.POUR:
          return pour(game, io, command.verb, command.obj);
        case Action.EAT:
          return eat(game, io, command.verb, command.obj);
        case Action.DRINK:
          return drink(game, io, command.verb, command.obj);
        case Action.RUB:
          return rub(game, io, command.verb, command.obj);
        case Action.THROW:
          return throwit(game, io, settings, command);
        case Action.QUIT:
          speak(game, io, actions[command.verb]!.message);
          return PhaseCode.GO_CLEAROBJ;
        case Action.FIND:
          return find(game, io, command.verb, command.obj);
        case Action.INVENTORY:
          return find(game, io, command.verb, command.obj);
        case Action.FEED:
          return feed(game, io, command.verb, command.obj);
        case Action.FILL:
          return fill(game, io, command.verb, command.obj);
        case Action.BLAST:
          blast(game, io, settings);
          return PhaseCode.GO_CLEAROBJ;
        case Action.SCORE:
          speak(game, io, actions[command.verb]!.message);
          return PhaseCode.GO_CLEAROBJ;
        case Action.FEE:
        case Action.FIE:
        case Action.FOE:
        case Action.FOO:
        case Action.FUM:
          speak(game, io, actions[command.verb]!.message);
          return PhaseCode.GO_CLEAROBJ;
        case Action.BRIEF:
          speak(game, io, actions[command.verb]!.message);
          return PhaseCode.GO_CLEAROBJ;
        case Action.READ:
          return read(game, io, settings, command);
        case Action.BREAK:
          return vbreak(game, io, command.verb, command.obj);
        case Action.WAKE:
          return wake(game, io, command.verb, command.obj);
        case Action.SAVE:
          speak(game, io, actions[command.verb]!.message);
          return PhaseCode.GO_CLEAROBJ;
        case Action.RESUME:
          speak(game, io, actions[command.verb]!.message);
          return PhaseCode.GO_CLEAROBJ;
        case Action.FLY:
          return fly(game, io, command.verb, command.obj);
        case Action.LISTEN:
          speak(game, io, actions[command.verb]!.message);
          return PhaseCode.GO_CLEAROBJ;
        case Action.PART:
          return reservoir(game, io);
        case Action.SEED:
          return seed(game, io, settings, command.verb, command.word[1].raw);
        case Action.WASTE:
          return waste(game, io, command.verb, parseInt(command.word[1].raw, 10));
        default:
          throw new Error("BUG: TRANSITIVE_ACTION_VERB_EXCEEDS_GOTO_LIST");
      }
    case SpeechPart.unknown:
      sspeak(game, io, Msg.WHAT_DO, command.word[0].raw);
      return PhaseCode.GO_CHECKHINT;
    default:
      throw new Error("BUG: SPEECHPART_NOT_TRANSITIVE_OR_INTRANSITIVE_OR_UNKNOWN");
  }
}
