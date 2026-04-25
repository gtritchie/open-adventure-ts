/*
 * Wire up GameLoopDeps adapters.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import type { GameState, Settings, GameIO, Command } from "./types.js";
import { PhaseCode, BugType, type SpeakType, Termination } from "./types.js";
import {
  speak as fmtSpeak,
  rspeak as fmtRspeak,
  sspeak as fmtSspeak,
  pspeak as fmtPspeak,
  stateChange as fmtStateChange,
} from "./format.js";
import { yesOrNo as inputYesOrNo } from "./input.js";
import {
  getCommandInput as vocabGetCommandInput,
  clearCommand as vocabClearCommand,
} from "./vocabulary.js";
import { action as actionsFn } from "./actions.js";
import {
  move as objMove,
  carry as objCarry,
  drop as objDrop,
  put as objPut,
  juggle as objJuggle,
  atdwrf as objAtdwrf,
} from "./object-manipulation.js";
import { playermove as mvPlayermove } from "./movement.js";
import { dwarfmove as dwDwarfmove } from "./dwarves.js";
import { randrange as rngRandrange } from "./rng.js";
import { terminate as scoreTerminate } from "./score.js";
import { type GameLoopDeps } from "./game-loop.js";

/**
 * Wire up GameLoopDeps adapters.
 * The deps interface uses a standardized parameter order for the game loop,
 * which may differ from the actual function signatures.
 */
export function createDeps(gameRef: GameState, settings: Settings): GameLoopDeps {
  const deps: GameLoopDeps = {
    speak(io: GameIO, msg: string | null, ...args: unknown[]): void {
      fmtSpeak(gameRef, io, msg, ...(args as (string | number)[]));
    },
    rspeak(io: GameIO, game: GameState, msg: number, ...args: unknown[]): void {
      fmtRspeak(game, io, msg, ...(args as (string | number)[]));
    },
    sspeak(io: GameIO, game: GameState, msg: number, ...args: unknown[]): void {
      fmtSspeak(game, io, msg, ...(args as (string | number)[]));
    },
    pspeak(
      io: GameIO,
      game: GameState,
      obj: number,
      mode: number,
      blank: boolean,
      skip: number,
      ...args: unknown[]
    ): void {
      fmtPspeak(
        game,
        io,
        obj,
        mode as SpeakType,
        blank,
        skip,
        ...(args as (string | number)[]),
      );
    },
    async getCommandInput(
      game: GameState,
      _settings: Settings,
      io: GameIO,
      command: Command,
    ): Promise<boolean> {
      return vocabGetCommandInput(command, game, io, settings);
    },
    clearCommand(game: GameState, command: Command): void {
      vocabClearCommand(command, game);
    },
    async action(
      game: GameState,
      _settings: Settings,
      io: GameIO,
      command: Command,
    ): Promise<PhaseCode> {
      return actionsFn(game, io, settings, command);
    },
    move(game: GameState, obj: number, where: number): void {
      objMove(game, obj, where);
    },
    carry(game: GameState, obj: number, where: number): void {
      objCarry(game, obj, where);
    },
    drop(game: GameState, obj: number, where: number): void {
      objDrop(game, obj, where);
    },
    put(game: GameState, obj: number, where: number, pval: number): void {
      objPut(game, obj, where, pval);
    },
    juggle(game: GameState, obj: number): void {
      objJuggle(game, obj);
    },
    stateChange(game: GameState, io: GameIO, obj: number, state: number): void {
      fmtStateChange(game, io, obj, state);
    },
    async yesOrNo(
      io: GameIO,
      game: GameState,
      question: string | null,
      yesResponse: string | null,
      noResponse: string | null,
    ): Promise<boolean> {
      return inputYesOrNo(game, io, settings, question, yesResponse, noResponse);
    },
    randrange(game: GameState, _settings: Settings, range: number): number {
      return rngRandrange(game, settings, range);
    },
    PCT(game: GameState, _settings: Settings, n: number): boolean {
      return rngRandrange(game, settings, 100) < n;
    },
    terminate(
      game: GameState,
      io: GameIO,
      mode: Termination,
      _rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
      _speak: (io: GameIO, msg: string | null, ...args: unknown[]) => void,
    ): never {
      scoreTerminate(game, io, mode, deps.rspeak, deps.speak);
    },
    async playermove(
      game: GameState,
      _settings: Settings,
      io: GameIO,
      motion: number,
      _rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
      _pspeak: (
        io: GameIO,
        game: GameState,
        obj: number,
        mode: number,
        blank: boolean,
        skip: number,
        ...args: unknown[]
      ) => void,
      _move: (game: GameState, obj: number, where: number) => void,
      _drop: (game: GameState, obj: number, where: number) => void,
      _juggle: (game: GameState, obj: number) => void,
      _stateChange: (game: GameState, io: GameIO, obj: number, state: number) => void,
      croak: () => Promise<void>,
      _bug: (type: BugType, msg: string) => never,
      _PCT: (game: GameState, settings: Settings, n: number) => boolean,
    ): Promise<void> {
      return mvPlayermove(
        game,
        settings,
        io,
        motion,
        deps.rspeak,
        deps.pspeak,
        deps.move,
        deps.drop,
        deps.juggle,
        deps.stateChange,
        croak,
        deps.bug,
        deps.PCT,
      );
    },
    dwarfmove(
      game: GameState,
      _settings: Settings,
      io: GameIO,
      _rspeak: (io: GameIO, game: GameState, msg: number, ...args: unknown[]) => void,
      _move: (game: GameState, obj: number, where: number) => void,
      _carry: (game: GameState, obj: number, where: number) => void,
      _drop: (game: GameState, obj: number, where: number) => void,
      _randrange: (game: GameState, settings: Settings, range: number) => number,
      _PCT: (game: GameState, settings: Settings, n: number) => boolean,
    ): boolean {
      return dwDwarfmove(
        game,
        settings,
        io,
        deps.rspeak,
        deps.move,
        deps.carry,
        deps.drop,
        deps.randrange,
        deps.PCT,
      );
    },
    atdwrf(game: GameState, where: number): number {
      return objAtdwrf(game, where);
    },
    bug(type: BugType, msg: string): never {
      throw new Error(`BUG ${type}: ${msg}`);
    },
  };

  return deps;
}
