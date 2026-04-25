/*
 * Pure save/restore helpers — no IO, no exits.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import type { GameState, SaveFile, RestoreResult, SaveSummary } from "./types.js";
import {
  ADVENT_MAGIC,
  ENDIAN_MAGIC,
  SAVE_VERSION,
  LCG_M,
  STATE_NOTFOUND,
  PROP_IS_INVALID,
  CARRIED,
  OUTSIDE,
  Termination,
} from "./types.js";
import {
  NLOCATIONS,
  NOBJECTS,
  NDWARVES,
  NDEATHS,
  objects,
  locations,
  conditions,
  MAX_STATE,
} from "./dungeon.js";
import { computeScore } from "./score.js";

/**
 * Build a SaveFile object from the current game state.
 * Port of savefile() from saveresume.c:32-44.
 */
export function savefile(game: GameState, version?: number): SaveFile {
  return {
    magic: ADVENT_MAGIC,
    version: version ?? SAVE_VERSION,
    canary: ENDIAN_MAGIC,
    game: structuredClone(game),
  };
}

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

/**
 * Validate game state from a save file.
 * Port of is_valid() from saveresume.c:177-269.
 */
export function isValid(valgame: GameState): boolean {
  /* Prevent division by zero */
  if (valgame.abbnum === 0) {
    return false;
  }

  /* Check for RNG overflow */
  if (valgame.lcgX >= LCG_M) {
    return false;
  }

  /* Bounds check for locations */
  if (
    valgame.chloc < -1 ||
    valgame.chloc > NLOCATIONS ||
    valgame.chloc2 < -1 ||
    valgame.chloc2 > NLOCATIONS ||
    valgame.loc < 0 ||
    valgame.loc > NLOCATIONS ||
    valgame.newloc < 0 ||
    valgame.newloc > NLOCATIONS ||
    valgame.oldloc < 0 ||
    valgame.oldloc > NLOCATIONS ||
    valgame.oldlc2 < 0 ||
    valgame.oldlc2 > NLOCATIONS
  ) {
    return false;
  }

  /* Bounds check for dwarf locations */
  for (let i = 0; i <= NDWARVES; i++) {
    if (
      valgame.dwarves[i]!.loc < -1 ||
      valgame.dwarves[i]!.loc > NLOCATIONS ||
      valgame.dwarves[i]!.oldloc < -1 ||
      valgame.dwarves[i]!.oldloc > NLOCATIONS
    ) {
      return false;
    }
  }

  /* Bounds check for object locations */
  for (let i = 0; i <= NOBJECTS; i++) {
    if (
      valgame.objects[i]!.place < -1 ||
      valgame.objects[i]!.place > NLOCATIONS ||
      valgame.objects[i]!.fixed < -1 ||
      valgame.objects[i]!.fixed > NLOCATIONS
    ) {
      return false;
    }
  }

  /* Bounds check for dwarves */
  if (
    valgame.dtotal < 0 ||
    valgame.dtotal > NDWARVES ||
    valgame.dkill < 0 ||
    valgame.dkill > NDWARVES
  ) {
    return false;
  }

  /* Validate that we didn't die too many times */
  if (valgame.numdie >= NDEATHS) {
    return false;
  }

  /* Recalculate tally, throw the towel if in disagreement */
  let tempTally = 0;
  for (let treasure = 1; treasure <= NOBJECTS; treasure++) {
    if (objects[treasure]!.isTreasure) {
      if (valgame.objects[treasure]!.prop === STATE_NOTFOUND) {
        ++tempTally;
      }
    }
  }
  if (tempTally !== valgame.tally) {
    return false;
  }

  /* Check that properties of objects aren't beyond expected */
  for (let obj = 0; obj <= NOBJECTS; obj++) {
    if (PROP_IS_INVALID(valgame.objects[obj]!.prop, MAX_STATE)) {
      return false;
    }
  }

  /* Check linked list values for objects in locations are in bounds */
  for (let loc = 0; loc <= NLOCATIONS; loc++) {
    if (
      valgame.locs[loc]!.atloc < 0 ||
      valgame.locs[loc]!.atloc > NOBJECTS * 2
    ) {
      return false;
    }
  }
  for (let obj = 0; obj <= NOBJECTS * 2; obj++) {
    if (valgame.link[obj]! < 0 || valgame.link[obj]! > NOBJECTS * 2) {
      return false;
    }
  }

  return true;
}

export function summarizeSave(
  jsonOrState: string | GameState,
): SaveSummary | { error: string } {
  let state: GameState;
  let saveVersion = SAVE_VERSION;

  if (typeof jsonOrState === "string") {
    // Step 1: parse JSON
    let raw: unknown;
    try {
      raw = JSON.parse(jsonOrState);
    } catch {
      return { error: "Save file is not valid JSON." };
    }

    // Step 2: verify it's a non-null object
    if (!isObject(raw)) {
      return { error: "Save file is not an Open Adventure save." };
    }

    // Step 3: read header fields
    const header = raw as Record<string, unknown>;
    const magic = header["magic"];
    const canary = header["canary"];
    const version = header["version"];

    // Step 4: verify magic/canary/version type
    if (magic !== ADVENT_MAGIC || canary !== ENDIAN_MAGIC || typeof version !== "number") {
      return { error: "Save file is not an Open Adventure save." };
    }

    // Step 5: version-skew returns partial summary with compatible: false
    if (version !== SAVE_VERSION) {
      return {
        locationName: "(incompatible save)",
        score: 0,
        maxScore: 0,
        treasuresFound: 0,
        treasuresTotal: 0,
        inventory: [],
        phase: "pre-cave",
        saveVersion: version,
        currentVersion: SAVE_VERSION,
        compatible: false,
      };
    }

    // Step 6: full validation via deserializeGame
    const result = deserializeGame(jsonOrState);
    if (!result.ok) {
      return { error: result.message };
    }
    state = result.state;
    saveVersion = version;
  } else {
    state = jsonOrState;
  }

  const loc = locations[state.loc];
  // Prefer the short/terse form for picker UIs; fall back to big, then numeric label.
  const locationName =
    loc?.description.small ?? loc?.description.big ?? `loc#${state.loc}`;

  let treasuresTotal = 0;
  let treasuresNotFound = 0;
  for (let i = 1; i <= NOBJECTS; i++) {
    if (objects[i]!.isTreasure) {
      treasuresTotal++;
      // STATE_NOTFOUND (-1) means the treasure hasn't been encountered yet.
      // We count directly from props rather than relying on state.tally because
      // tally is only valid after initialise() runs.
      if (state.objects[i]!.prop === STATE_NOTFOUND) {
        treasuresNotFound++;
      }
    }
  }
  const treasuresFound = treasuresTotal - treasuresNotFound;

  const inventory: string[] = [];
  for (let i = 1; i <= NOBJECTS; i++) {
    if (state.objects[i]?.place === CARRIED) {
      const inv = objects[i]?.inventory;
      if (inv) inventory.push(inv);
    }
  }

  // Phase derived from condition bits — enum ordering is not a reliable
  // indoor/outdoor signal since above-ground locations like LOC_VALLEY and
  // LOC_FOREST* sit after LOC_BUILDING in the generated enum.
  let phase: SaveSummary["phase"];
  if (state.closed) phase = "closed";
  else if (state.closng) phase = "closing";
  else if (OUTSIDE(conditions, state.loc)) phase = "pre-cave";
  else phase = "in-cave";

  const { points, max } = computeScore(state, Termination.scoregame);

  return {
    locationName,
    score: points,
    maxScore: max,
    treasuresFound,
    treasuresTotal,
    inventory,
    phase,
    saveVersion,
    currentVersion: SAVE_VERSION,
    compatible: saveVersion === SAVE_VERSION,
  };
}
