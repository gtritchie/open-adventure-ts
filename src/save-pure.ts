/*
 * Pure save/restore helpers — no IO, no exits.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import type { GameState, SaveFile, RestoreResult } from "./types.js";
import { ADVENT_MAGIC, ENDIAN_MAGIC, SAVE_VERSION } from "./types.js";
import { isValid, savefile } from "./save.js";

export function serializeGame(state: GameState): string {
  return JSON.stringify(savefile(state));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function deserializeGame(json: string): RestoreResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: "bad-json", message: "Save file is not valid JSON." };
  }
  if (!isObject(raw)) {
    return { ok: false, reason: "bad-magic", message: "Save file is not an Open Adventure save." };
  }
  const save = raw as Partial<SaveFile>;
  if (
    save.magic !== ADVENT_MAGIC ||
    save.canary !== ENDIAN_MAGIC ||
    typeof save.version !== "number"
  ) {
    return { ok: false, reason: "bad-magic", message: "Save file is not an Open Adventure save." };
  }
  if (save.version !== SAVE_VERSION) {
    return {
      ok: false,
      reason: "version-skew",
      saveVersion: save.version,
      expectedVersion: SAVE_VERSION,
      message: `Save was version ${save.version}; expected ${SAVE_VERSION}.`,
    };
  }
  if (!isObject(save.game)) {
    return { ok: false, reason: "tampering", message: "Save file failed integrity check." };
  }
  // isValid() dereferences nested arrays (dwarves, objects, locs, link) without
  // shape-checking them, so a header-valid payload with a partial game object
  // can throw instead of returning false. Catch here to honour the contract
  // that deserializeGame never throws.
  let valid = false;
  try {
    valid = isValid(save.game as GameState);
  } catch {
    valid = false;
  }
  if (!valid) {
    return { ok: false, reason: "tampering", message: "Save file failed integrity check." };
  }
  return { ok: true, state: save.game as GameState };
}
