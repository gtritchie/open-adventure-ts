/*
 * Dungeon types, constants, and macros.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

// LCG PRNG parameters tested against Knuth vol. 2
export const LCG_A = 1093;
export const LCG_C = 221587;
export const LCG_M = 1048576;

export const LINESIZE = 1024;
export const TOKLEN = 5;
export const INVLIMIT = 7;
export const INTRANSITIVE = -1;
export const GAMELIMIT = 330;
export const NOVICELIMIT = 1000;
export const WARNTIME = 30;
export const FLASHTIME = 50;
export const PANICTIME = 15;
export const BATTERYLIFE = 2500;
export const WORD_NOT_FOUND = -1;
export const WORD_EMPTY = 0;
export const PIT_KILL_PROB = 35;
export const CARRIED = -1;
export const PROMPT = "> ";

// Special object-state values
export const STATE_NOTFOUND = -1;
export const STATE_FOUND = 0;
export const STATE_IN_CAVITY = 1;

// Special fixed object-state values
export const IS_FIXED = -1;
export const IS_FREE = 0;

// Sound constant
export const SILENT = -1;

// Save format
export const SAVE_VERSION = 31;
export const ADVENT_MAGIC = "open-adventure\n";
export const ENDIAN_MAGIC = 2317;

// ── Enums ──

export const BugType = {
  SPECIAL_TRAVEL_500_GT_L_GT_300_EXCEEDS_GOTO_LIST: 0,
  VOCABULARY_TYPE_N_OVER_1000_NOT_BETWEEN_0_AND_3: 1,
  INTRANSITIVE_ACTION_VERB_EXCEEDS_GOTO_LIST: 2,
  TRANSITIVE_ACTION_VERB_EXCEEDS_GOTO_LIST: 3,
  CONDITIONAL_TRAVEL_ENTRY_WITH_NO_ALTERATION: 4,
  LOCATION_HAS_NO_TRAVEL_ENTRIES: 5,
  HINT_NUMBER_EXCEEDS_GOTO_LIST: 6,
  SPEECHPART_NOT_TRANSITIVE_OR_INTRANSITIVE_OR_UNKNOWN: 7,
  ACTION_RETURNED_PHASE_CODE_BEYOND_END_OF_SWITCH: 8,
} as const;
export type BugType = (typeof BugType)[keyof typeof BugType];

export const SpeakType = {
  touch: 0,
  look: 1,
  hear: 2,
  study: 3,
  change: 4,
} as const;
export type SpeakType = (typeof SpeakType)[keyof typeof SpeakType];

export const Termination = {
  endgame: 0,
  quitgame: 1,
  scoregame: 2,
} as const;
export type Termination = (typeof Termination)[keyof typeof Termination];

export const SpeechPart = {
  unknown: 0,
  intransitive: 1,
  transitive: 2,
} as const;
export type SpeechPart = (typeof SpeechPart)[keyof typeof SpeechPart];

export const WordType = {
  NO_WORD_TYPE: 0,
  MOTION: 1,
  OBJECT: 2,
  ACTION: 3,
  NUMERIC: 4,
} as const;
export type WordType = (typeof WordType)[keyof typeof WordType];

export const ScoreBonus = {
  none: 0,
  splatter: 1,
  defeat: 2,
  victory: 3,
} as const;
export type ScoreBonus = (typeof ScoreBonus)[keyof typeof ScoreBonus];

export const PhaseCode = {
  GO_TERMINATE: 0,
  GO_MOVE: 1,
  GO_TOP: 2,
  GO_CLEAROBJ: 3,
  GO_CHECKHINT: 4,
  GO_WORD2: 5,
  GO_UNKNOWN: 6,
  GO_DWARFWAKE: 7,
} as const;
export type PhaseCode = (typeof PhaseCode)[keyof typeof PhaseCode];

export const CommandState = {
  EMPTY: 0,
  RAW: 1,
  TOKENIZED: 2,
  GIVEN: 3,
  PREPROCESSED: 4,
  PROCESSING: 5,
  EXECUTED: 6,
} as const;
export type CommandState = (typeof CommandState)[keyof typeof CommandState];

export const CondType = {
  cond_goto: 0,
  cond_pct: 1,
  cond_carry: 2,
  cond_with: 3,
  cond_not: 4,
} as const;
export type CondType = (typeof CondType)[keyof typeof CondType];

export const DestType = {
  dest_goto: 0,
  dest_special: 1,
  dest_speak: 2,
} as const;
export type DestType = (typeof DestType)[keyof typeof DestType];

// ── Condition bits ──

export const COND_LIT = 0;
export const COND_OILY = 1;
export const COND_FLUID = 2;
export const COND_NOARRR = 3;
export const COND_NOBACK = 4;
export const COND_ABOVE = 5;
export const COND_DEEP = 6;
export const COND_FOREST = 7;
export const COND_FORCED = 8;
export const COND_ALLDIFFERENT = 9;
export const COND_ALLALIKE = 10;
export const COND_HBASE = 11;
export const COND_HCAVE = 12;
export const COND_HBIRD = 13;
export const COND_HSNAKE = 14;
export const COND_HMAZE = 15;
export const COND_HDARK = 16;
export const COND_HWITT = 17;
export const COND_HCLIFF = 18;
export const COND_HWOODS = 19;
export const COND_HOGRE = 20;
export const COND_HJADE = 21;

// ── Data structure types (matching dungeon.h structs) ──

export interface StringGroup {
  readonly strs: readonly string[];
  readonly n: number;
}

export interface ObjectData {
  readonly words: StringGroup;
  readonly inventory: string | null;
  readonly plac: number;
  readonly fixd: number;
  readonly isTreasure: boolean;
  readonly descriptions: readonly (string | null)[];
  readonly sounds: readonly (string | null)[];
  readonly texts: readonly (string | null)[];
  readonly changes: readonly (string | null)[];
}

export interface LocationData {
  readonly description: {
    readonly small: string | null;
    readonly big: string | null;
  };
  readonly sound: number;
  readonly loud: boolean;
}

export interface Obituary {
  readonly query: string;
  readonly yesResponse: string;
}

export interface TurnThreshold {
  readonly threshold: number;
  readonly pointLoss: number;
  readonly message: string;
}

export interface ClassMessage {
  readonly threshold: number;
  readonly message: string | null;
}

export interface HintData {
  readonly number: number;
  readonly turns: number;
  readonly penalty: number;
  readonly question: string;
  readonly hint: string;
}

export interface MotionData {
  readonly words: StringGroup;
}

export interface ActionData {
  readonly words: StringGroup;
  readonly message: string | null;
  readonly noaction: boolean;
}

export interface TravelOp {
  readonly motion: number;
  readonly condtype: number;
  readonly condarg1: number;
  readonly condarg2: number;
  readonly desttype: DestType;
  readonly destval: number;
  readonly nodwarves: boolean;
  readonly stop: boolean;
}

// ── Game state types ──

export interface LocationState {
  abbrev: number;
  atloc: number;
}

export interface DwarfState {
  seen: number;
  loc: number;
  oldloc: number;
}

export interface ObjectState {
  fixed: number;
  prop: number;
  place: number;
}

export interface HintState {
  used: boolean;
  lc: number;
}

export interface CommandWord {
  raw: string;
  id: number;
  type: WordType;
}

export interface Command {
  part: SpeechPart;
  word: [CommandWord, CommandWord];
  verb: number;
  obj: number;
  state: CommandState;
}

export interface GameState {
  lcgX: number;
  abbnum: number;
  bonus: ScoreBonus;
  chloc: number;
  chloc2: number;
  clock1: number;
  clock2: number;
  clshnt: boolean;
  closed: boolean;
  closng: boolean;
  lmwarn: boolean;
  novice: boolean;
  panic: boolean;
  wzdark: boolean;
  blooded: boolean;
  conds: number;
  detail: number;
  dflag: number;
  dkill: number;
  dtotal: number;
  foobar: number;
  holdng: number;
  igo: number;
  iwest: number;
  knfloc: number;
  limit: number;
  loc: number;
  newloc: number;
  numdie: number;
  oldloc: number;
  oldlc2: number;
  oldobj: number;
  saved: number;
  tally: number;
  thresh: number;
  seenbigwords: boolean;
  trnluz: number;
  turns: number;
  zzword: string;
  locs: LocationState[];
  dwarves: DwarfState[];
  objects: ObjectState[];
  hints: HintState[];
  link: number[];
}

export interface Settings {
  logfp: ((line: string) => void) | null;
  oldstyle: boolean;
  prompt: boolean;
  scriptLines: string[] | null;
  scriptIndex: number;
  debug: number;
}

export interface SaveFile {
  magic: string;
  version: number;
  canary: number;
  game: GameState;
}

// ── GameIO interface ──

export interface GameIO {
  print(msg: string): void;
  readline(prompt: string): Promise<string | null>;
}

// ── TerminateError: used instead of process.exit() in game logic ──

export class TerminateError extends Error {
  constructor(
    public readonly code: number,
  ) {
    super(`Game terminated with code ${code}`);
    this.name = "TerminateError";
  }
}

// ── Predicate functions (C macros) ──

import {
  NOBJECTS,
  NLOCATIONS,
  type DungeonData,
} from "./dungeon.js";

export function TOTING(game: GameState, obj: number): boolean {
  return game.objects[obj]!.place === CARRIED;
}

export function AT(game: GameState, obj: number): boolean {
  return (
    game.objects[obj]!.place === game.loc ||
    game.objects[obj]!.fixed === game.loc
  );
}

export function HERE(game: GameState, obj: number): boolean {
  return AT(game, obj) || TOTING(game, obj);
}

export function setbit(bit: number): number {
  return 1 << bit;
}

export function tstbit(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}

export function CNDBIT(
  conditions: number[],
  loc: number,
  bit: number,
): boolean {
  return tstbit(conditions[loc]!, bit);
}

export function FORCED(conditions: number[], loc: number): boolean {
  return CNDBIT(conditions, loc, COND_FORCED);
}

export function FOREST(conditions: number[], loc: number): boolean {
  return CNDBIT(conditions, loc, COND_FOREST);
}

export function OUTSIDE(conditions: number[], loc: number): boolean {
  return (
    CNDBIT(conditions, loc, COND_ABOVE) || FOREST(conditions, loc)
  );
}

export function INSIDE(
  conditions: number[],
  loc: number,
  LOC_BUILDING: number,
): boolean {
  return !OUTSIDE(conditions, loc) || loc === LOC_BUILDING;
}

export function INDEEP(conditions: number[], loc: number): boolean {
  return CNDBIT(conditions, loc, COND_DEEP);
}

export function PROP_STASHIFY(n: number): number {
  return -1 - n;
}

export function PROP_IS_INVALID(val: number, maxState: number): boolean {
  return val < -maxState - 1 || val > maxState;
}

export function OBJECT_IS_NOTFOUND(game: GameState, obj: number): boolean {
  return game.objects[obj]!.prop === STATE_NOTFOUND;
}

export function OBJECT_IS_FOUND(game: GameState, obj: number): boolean {
  return game.objects[obj]!.prop === STATE_FOUND;
}

export function OBJECT_SET_FOUND(game: GameState, obj: number): void {
  game.objects[obj]!.prop = STATE_FOUND;
}

export function OBJECT_SET_NOT_FOUND(game: GameState, obj: number): void {
  game.objects[obj]!.prop = STATE_NOTFOUND;
}

export function OBJECT_IS_STASHED(game: GameState, obj: number): boolean {
  return game.objects[obj]!.prop < STATE_NOTFOUND;
}

export function OBJECT_STASHIFY(
  game: GameState,
  obj: number,
  pval: number,
): void {
  game.objects[obj]!.prop = PROP_STASHIFY(pval);
}

export function OBJECT_STATE_EQUALS(
  game: GameState,
  obj: number,
  pval: number,
): boolean {
  return (
    game.objects[obj]!.prop === pval ||
    game.objects[obj]!.prop === PROP_STASHIFY(pval)
  );
}

export function GSTONE(
  obj: number,
  EMERALD: number,
  RUBY: number,
  AMBER: number,
  SAPPH: number,
): boolean {
  return obj === EMERALD || obj === RUBY || obj === AMBER || obj === SAPPH;
}

export function PCT(game: GameState, randrange: (game: GameState, range: number) => number, n: number): boolean {
  return randrange(game, 100) < n;
}

export function emptyCommandWord(): CommandWord {
  return {
    raw: "",
    id: WORD_EMPTY,
    type: WordType.NO_WORD_TYPE,
  };
}

export function makeCommand(): Command {
  return {
    part: SpeechPart.unknown,
    word: [emptyCommandWord(), emptyCommandWord()],
    verb: 0, // ACT_NULL
    obj: 0, // NO_OBJECT
    state: CommandState.EMPTY,
  };
}
