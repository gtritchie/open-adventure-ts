/*
 * Dungeon data - re-exports generated data and provides mutable conditions.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

export {
  // Constants
  NLOCATIONS,
  NOBJECTS,
  NHINTS,
  NCLASSES,
  NDEATHS,
  NTHRESHOLDS,
  NMOTIONS,
  NACTIONS,
  NTRAVEL,
  NKEYS,
  BIRD_ENDSTATE,
  NDWARVES,
  MAX_STATE,
  // Enum-like ref objects
  Location,
  Obj,
  Motion,
  Action,
  Msg,
  // Object state constants
  ObjState,
  // Data arrays
  locations,
  objects,
  arbitraryMessages,
  classes,
  turnThresholds,
  obituaries,
  hints,
  motions,
  actions,
  travel,
  tkey,
  dwarflocs,
  ignore,
  // Mutable conditions
  conditions,
  // Type re-exports
  type DungeonData,
} from "./dungeon.generated.js";
