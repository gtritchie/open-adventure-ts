#!/usr/bin/env tsx
/*
 * Dungeon data generator - reads adventure.yaml and emits dungeon.generated.ts
 *
 * Port of make_dungeon.py from the C open-adventure project.
 *
 * SPDX-FileCopyrightText: (C) Eric S. Raymond <esr@thyrsus.com>
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const YAML_PATH = resolve(ROOT, "adventure.yaml");
const OUTPUT_PATH = resolve(ROOT, "src/dungeon.generated.ts");

// ── YAML parsing helpers ──
// js-yaml loads YAML ordered mappings as arrays of single-key objects:
//   [{LOC_NOWHERE: {...}}, {LOC_START: {...}}, ...]
// We need to convert these to [name, data] pairs.

function toPair<T>(obj: Record<string, T>): [string, T] {
  const keys = Object.keys(obj);
  return [keys[0]!, obj[keys[0]!]!];
}

function toPairs<T>(arr: Record<string, T>[]): [string, T][] {
  return arr.map(toPair);
}

// ── Types for YAML data ──

interface YamlLocation {
  description: { short: string | null; long: string | null };
  conditions?: Record<string, boolean>;
  hints?: { name: string }[];
  sound?: string;
  loud?: boolean;
  travel?: YamlTravelRule[];
}

interface YamlTravelRule {
  verbs: string[];
  action: [string, ...unknown[]];
  cond?: unknown[] | null;
}

interface YamlObject {
  words?: string[];
  inventory: string | null;
  locations?: string | [string, number | string];
  immovable?: boolean;
  treasure?: boolean;
  descriptions: (string | null)[] | null;
  states?: string[];
  sounds?: (string | null)[] | null;
  texts?: (string | null)[] | null;
  changes?: (string | null)[] | null;
}

interface YamlMotion {
  words: string[] | null;
  oldstyle?: boolean;
}

interface YamlAction {
  words: string[] | null;
  message: string | null;
  noaction?: boolean;
  oldstyle?: boolean;
}

interface YamlClass {
  threshold: number;
  message: string;
}

interface YamlTurnThreshold {
  threshold: number;
  point_loss: number;
  message: string;
}

interface YamlObituary {
  query: string;
  yes_response: string;
}

interface YamlHintWrapper {
  hint: {
    name: string;
    number: number;
    turns: number;
    penalty: number;
    question: string;
    hint: string;
  };
}

// Raw YAML shape before we normalize it
interface YamlDbRaw {
  locations: Record<string, YamlLocation>[];
  objects: Record<string, YamlObject>[];
  motions: Record<string, YamlMotion>[];
  actions: Record<string, YamlAction>[];
  arbitrary_messages: Record<string, string | null>[];
  classes: YamlClass[];
  turn_thresholds: YamlTurnThreshold[];
  obituaries: YamlObituary[];
  hints: YamlHintWrapper[];
  dwarflocs: string[];
}

// ── Helpers ──

function makeTsString(s: string | null | undefined): string {
  if (s == null) return "null";
  // Convert literal escape sequences from YAML single-quoted strings
  // to actual characters (C string literals auto-interpret these).
  s = s.replace(/\\n/g, "\n");
  s = s.replace(/\\t/g, "\t");
  // Now escape for TS string literal output
  s = s.replace(/\\/g, "\\\\");
  s = s.replace(/"/g, '\\"');
  s = s.replace(/\n/g, "\\n");
  s = s.replace(/\t/g, "\\t");
  return `"${s}"`;
}

// ── Travel table compilation ──

interface TravelEntry {
  locIndex: number;
  locName: string;
  motion: string;
  condtype: string;
  condarg1: string | number;
  condarg2: string | number;
  desttype: string;
  destval: string;
  nodwarves: boolean;
  stop: boolean;
}

function buildTravel(
  locs: [string, YamlLocation][],
  objs: [string, YamlObject][],
  motionPairs: [string, YamlMotion][],
  msgnames: string[],
  locnames: string[],
  objnames: string[],
  motionnames: string[],
): { travel: TravelEntry[]; tkey: number[] } {
  // Build verb map: word -> motion index
  const verbmap: Record<string, number> = {};
  for (let i = 0; i < motionPairs.length; i++) {
    const words = motionPairs[i]![1].words;
    if (words) {
      for (const word of words) {
        verbmap[word.toUpperCase()] = i;
      }
    }
  }

  function dencode(action: unknown[], name: string): number {
    if (action[0] === "goto") {
      const idx = locnames.indexOf(action[1] as string);
      if (idx === -1) {
        throw new Error(`Unknown location ${action[1]} in goto clause of ${name}`);
      }
      return idx;
    } else if (action[0] === "special") {
      return 300 + (action[1] as number);
    } else if (action[0] === "speak") {
      const idx = msgnames.indexOf(action[1] as string);
      if (idx === -1) {
        throw new Error(`Unknown message ${action[1]} in speak clause of ${name}`);
      }
      return 500 + idx;
    }
    throw new Error(`Unknown action type ${action[0]}`);
  }

  function cencode(cond: unknown[] | null | undefined, name: string): number {
    if (cond == null) return 0;
    if (cond.length === 1 && cond[0] === "nodwarves") return 100;
    if (cond[0] === "pct") return cond[1] as number;
    if (cond[0] === "carry") {
      const idx = objnames.indexOf(cond[1] as string);
      if (idx === -1) {
        throw new Error(`Unknown object ${cond[1]} in carry clause of ${name}`);
      }
      return 100 + idx;
    }
    if (cond[0] === "with") {
      const idx = objnames.indexOf(cond[1] as string);
      if (idx === -1) {
        throw new Error(`Unknown object ${cond[1]} in with clause of ${name}`);
      }
      return 200 + idx;
    }
    if (cond[0] === "not") {
      const obj = objnames.indexOf(cond[1] as string);
      if (obj === -1) {
        throw new Error(`Unknown object ${cond[1]} in not clause of ${name}`);
      }
      let state: number;
      if (typeof cond[2] === "number") {
        state = cond[2];
      } else {
        const objData = objs[obj]![1];
        const states = objData.states ?? [];
        const stateIdx = states.indexOf(cond[2] as string);
        if (stateIdx !== -1) {
          state = stateIdx;
        } else {
          // Search descriptions
          let found = false;
          state = 0;
          if (objData.descriptions) {
            for (let i = 0; i < objData.descriptions.length; i++) {
              const desc = objData.descriptions[i];
              if (Array.isArray(desc) && desc[0] === cond[2]) {
                state = i;
                found = true;
                break;
              }
            }
          }
          if (!found) {
            throw new Error(`Unmatched state symbol ${cond[2]} in not clause of ${name}`);
          }
        }
      }
      return 300 + obj + 100 * state;
    }
    throw new Error(`Unknown condition type: ${JSON.stringify(cond)}`);
  }

  // Phase 1: compile YAML to section 3 intermediate format
  const ltravel: (string | number)[][] = [];
  for (let i = 0; i < locs.length; i++) {
    const [name, loc] = locs[i]!;
    if (loc.travel) {
      for (const rule of loc.travel) {
        const tt: (string | number)[] = [i];
        const dest = dencode(rule.action, name) + 1000 * cencode(rule.cond, name);
        tt.push(dest);
        for (const verb of rule.verbs) {
          const motIdx = verbmap[verb];
          if (motIdx === undefined) {
            throw new Error(`Unknown verb "${verb}" in travel rules of ${name}`);
          }
          tt.push(motionnames[motIdx]!.toUpperCase());
        }
        if (rule.verbs.length === 0) {
          tt.push(1); // Magic dummy entry for null rules
        }
        ltravel.push(tt);
      }
    }
  }

  // Phase 2: compile to runtime travel array format
  const travel: TravelEntry[] = [
    {
      locIndex: 0,
      locName: "LOC_NOWHERE",
      motion: "0",
      condtype: "CondType.cond_goto",
      condarg1: 0,
      condarg2: 0,
      desttype: "DestType.dest_goto",
      destval: "Location.LOC_NOWHERE",
      nodwarves: false,
      stop: false,
    },
  ];
  const tkey: number[] = [0];
  let oldloc = 0;

  while (ltravel.length > 0) {
    const rule = ltravel.shift()!;
    const loc = rule.shift()! as number;
    const newloc = rule.shift()! as number;

    if (loc !== oldloc) {
      tkey.push(travel.length);
      oldloc = loc;
    } else if (travel.length > 0) {
      travel[travel.length - 1]!.stop = !travel[travel.length - 1]!.stop;
    }

    while (rule.length > 0) {
      const cond = Math.trunc(newloc / 1000);
      const nodwarves = cond === 100;

      let condtype: string;
      let condarg1: string | number;
      let condarg2: string | number;

      if (cond === 0) {
        condtype = "CondType.cond_goto";
        condarg1 = 0;
        condarg2 = 0;
      } else if (cond < 100) {
        condtype = "CondType.cond_pct";
        condarg1 = cond;
        condarg2 = 0;
      } else if (cond === 100) {
        condtype = "CondType.cond_goto";
        condarg1 = 100;
        condarg2 = 0;
      } else if (cond <= 200) {
        condtype = "CondType.cond_carry";
        condarg1 = `Obj.${objnames[cond - 100]!}`;
        condarg2 = 0;
      } else if (cond <= 300) {
        condtype = "CondType.cond_with";
        condarg1 = `Obj.${objnames[cond - 200]!}`;
        condarg2 = 0;
      } else {
        condtype = "CondType.cond_not";
        condarg1 = cond % 100;
        condarg2 = Math.trunc((cond - 300) / 100);
      }

      const dest = newloc % 1000;
      let desttype: string;
      let destval: string;
      if (dest <= 300) {
        desttype = "DestType.dest_goto";
        destval = `Location.${locnames[dest]!}`;
      } else if (dest > 500) {
        desttype = "DestType.dest_speak";
        destval = `Msg.${msgnames[dest - 500]!}`;
      } else {
        desttype = "DestType.dest_special";
        destval = `Location.${locnames[dest - 300]!}`;
      }

      const motion = rule.shift()!;
      const motionStr = typeof motion === "number" ? String(motion) : `Motion.${motion}`;

      travel.push({
        locIndex: tkey.length - 1,
        locName: locnames[tkey.length - 1]!,
        motion: motionStr,
        condtype,
        condarg1,
        condarg2,
        desttype,
        destval,
        nodwarves,
        stop: false,
      });
    }
    travel[travel.length - 1]!.stop = true;
  }

  return { travel, tkey };
}

// ── State definitions ──

function getStateDefines(objects: [string, YamlObject][]): {
  defines: string;
  maxState: number;
} {
  let defines = "";
  let maxState = 0;

  for (const [name, obj] of objects) {
    const states = obj.states ?? [];
    if (states.length > 0) {
      defines += `  // States for ${name}\n`;
      for (let n = 0; n < states.length; n++) {
        defines += `  ${states[n]!}: ${n},\n`;
        maxState = Math.max(maxState, n);
      }
    }
  }

  return { defines, maxState };
}

// ── Condition bits ──

function getCondBits(locations: [string, YamlLocation][]): string[] {
  const result: string[] = [];
  for (const [, loc] of locations) {
    const conditions = loc.conditions ?? {};
    const hints = loc.hints ?? [];
    const flags: string[] = [];
    for (const [flag, value] of Object.entries(conditions)) {
      if (value) {
        flags.push(`(1 << COND_${flag})`);
      }
    }
    for (const hint of hints) {
      flags.push(`(1 << COND_H${hint.name})`);
    }
    let expr = flags.join(" | ");
    if (!expr) expr = "0";
    result.push(expr);
  }
  return result;
}

// ── Ignore string ──

function getIgnoreChars(
  motionPairs: [string, YamlMotion][],
  actionPairs: [string, YamlAction][],
): string {
  let ignore = "";
  for (const [, motion] of motionPairs) {
    if (motion.oldstyle === false && motion.words) {
      for (const word of motion.words) {
        if (word.length === 1) {
          ignore += word.toUpperCase();
        }
      }
    }
  }
  for (const [, action] of actionPairs) {
    if (action.oldstyle === false && action.words) {
      for (const word of action.words) {
        if (word.length === 1) {
          ignore += word.toUpperCase();
        }
      }
    }
  }
  return ignore;
}

// ── Main generator ──

function generate(): string {
  const yamlContent = readFileSync(YAML_PATH, "utf-8");
  const raw = yaml.load(yamlContent) as YamlDbRaw;

  // Convert single-key objects to [name, data] pairs
  const locPairs = toPairs(raw.locations as unknown as Record<string, YamlLocation>[]);
  const objPairs = toPairs(raw.objects as unknown as Record<string, YamlObject>[]);
  const motionPairs = toPairs(raw.motions as unknown as Record<string, YamlMotion>[]);
  const actionPairs = toPairs(raw.actions as unknown as Record<string, YamlAction>[]);
  const msgPairs = toPairs(raw.arbitrary_messages as unknown as Record<string, string | null>[]);

  const locnames = locPairs.map((l) => l[0]);
  const objnames = objPairs.map((o) => o[0]);
  const motionnames = motionPairs.map((m) => m[0]);
  const actionnames = actionPairs.map((a) => a[0]);
  const msgnames = msgPairs.map((m) => m[0]);

  const { travel, tkey } = buildTravel(
    locPairs,
    objPairs,
    motionPairs,
    msgnames,
    locnames,
    objnames,
    motionnames,
  );
  const { defines: stateDefines, maxState } = getStateDefines(objPairs);
  const condBitExprs = getCondBits(locPairs);
  const ignoreChars = getIgnoreChars(motionPairs, actionPairs);

  // Bird endstate
  const birdObj = objPairs.find((o) => o[0] === "BIRD");
  const birdEndstate = birdObj ? (birdObj[1].sounds?.length ?? 1) - 1 : 5;

  const lines: string[] = [];
  const emit = (s: string) => lines.push(s);

  emit("/* Generated from adventure.yaml - do not hand-hack! */");
  emit("");
  emit("/*");
  emit(" * SPDX-FileCopyrightText: (C) Eric S. Raymond <esr@thyrsus.com>");
  emit(" * SPDX-License-Identifier: BSD-2-Clause");
  emit(" */");
  emit("");
  emit('import type { LocationData, ObjectData, MotionData, ActionData, HintData, ClassMessage, TurnThreshold, Obituary, TravelOp } from "./types.js";');
  emit('import { CondType, DestType } from "./types.js";');
  emit("");

  // ── Constants ──
  emit(`export const NLOCATIONS = ${locPairs.length - 1};`);
  emit(`export const NOBJECTS = ${objPairs.length - 1};`);
  emit(`export const NHINTS = ${raw.hints.length};`);
  emit(`export const NCLASSES = ${raw.classes.length - 1};`);
  emit(`export const NDEATHS = ${raw.obituaries.length};`);
  emit(`export const NTHRESHOLDS = ${raw.turn_thresholds.length};`);
  emit(`export const NMOTIONS = ${motionPairs.length};`);
  emit(`export const NACTIONS = ${actionPairs.length};`);
  emit(`export const NTRAVEL = ${travel.length};`);
  emit(`export const NKEYS = ${tkey.length};`);
  emit(`export const BIRD_ENDSTATE = ${birdEndstate};`);
  emit(`export const NDWARVES = ${raw.dwarflocs.length};`);
  emit(`export const MAX_STATE = ${maxState};`);
  emit("");

  // ── Condition bit constants (needed for conditions array init) ──
  emit("const COND_LIT = 0;");
  emit("const COND_OILY = 1;");
  emit("const COND_FLUID = 2;");
  emit("const COND_NOARRR = 3;");
  emit("const COND_NOBACK = 4;");
  emit("const COND_ABOVE = 5;");
  emit("const COND_DEEP = 6;");
  emit("const COND_FOREST = 7;");
  emit("// const COND_FORCED = 8;  // set at runtime in init");
  emit("const COND_ALLDIFFERENT = 9;");
  emit("const COND_ALLALIKE = 10;");
  emit("const COND_HBASE = 11;");
  emit("const COND_HCAVE = 12;");
  emit("const COND_HBIRD = 13;");
  emit("const COND_HSNAKE = 14;");
  emit("const COND_HMAZE = 15;");
  emit("const COND_HDARK = 16;");
  emit("const COND_HWITT = 17;");
  emit("const COND_HCLIFF = 18;");
  emit("const COND_HWOODS = 19;");
  emit("const COND_HOGRE = 20;");
  emit("const COND_HJADE = 21;");
  emit("");
  // Suppress unused warnings via void operator
  emit("void COND_LIT, COND_OILY, COND_FLUID, COND_NOARRR, COND_NOBACK;");
  emit("void COND_ABOVE, COND_DEEP, COND_FOREST, COND_ALLDIFFERENT, COND_ALLALIKE;");
  emit("void COND_HBASE, COND_HCAVE, COND_HBIRD, COND_HSNAKE, COND_HMAZE;");
  emit("void COND_HDARK, COND_HWITT, COND_HCLIFF, COND_HWOODS, COND_HOGRE, COND_HJADE;");
  emit("");

  // ── Location enum ──
  emit("export const Location = {");
  for (let i = 0; i < locnames.length; i++) {
    emit(`  ${locnames[i]!}: ${i},`);
  }
  emit("} as const;");
  emit("export type Location = (typeof Location)[keyof typeof Location];");
  emit("");

  // ── Object enum ──
  emit("export const Obj = {");
  for (let i = 0; i < objnames.length; i++) {
    emit(`  ${objnames[i]!}: ${i},`);
  }
  emit("} as const;");
  emit("export type Obj = (typeof Obj)[keyof typeof Obj];");
  emit("");

  // ── Motion enum ──
  emit("export const Motion = {");
  for (let i = 0; i < motionnames.length; i++) {
    emit(`  ${motionnames[i]!}: ${i},`);
  }
  emit("} as const;");
  emit("export type Motion = (typeof Motion)[keyof typeof Motion];");
  emit("");

  // ── Action enum ──
  emit("export const Action = {");
  for (let i = 0; i < actionnames.length; i++) {
    emit(`  ${actionnames[i]!}: ${i},`);
  }
  emit("} as const;");
  emit("export type Action = (typeof Action)[keyof typeof Action];");
  emit("");

  // ── Message enum ──
  emit("export const Msg = {");
  for (let i = 0; i < msgnames.length; i++) {
    emit(`  ${msgnames[i]!}: ${i},`);
  }
  emit("} as const;");
  emit("export type Msg = (typeof Msg)[keyof typeof Msg];");
  emit("");

  // ── Object state constants ──
  emit("export const ObjState = {");
  emit(stateDefines);
  emit(`  MAX_STATE: ${maxState},`);
  emit("} as const;");
  emit("");

  // ── Arbitrary messages ──
  emit("export const arbitraryMessages: readonly (string | null)[] = [");
  for (const [, msg] of msgPairs) {
    emit(`  ${makeTsString(msg)},`);
  }
  emit("];");
  emit("");

  // ── Classes ──
  emit("export const classes: readonly ClassMessage[] = [");
  for (const cls of raw.classes) {
    emit(`  { threshold: ${cls.threshold}, message: ${makeTsString(cls.message)} },`);
  }
  emit("];");
  emit("");

  // ── Turn thresholds ──
  emit("export const turnThresholds: readonly TurnThreshold[] = [");
  for (const t of raw.turn_thresholds) {
    emit(
      `  { threshold: ${t.threshold}, pointLoss: ${t.point_loss}, message: ${makeTsString(t.message)} },`,
    );
  }
  emit("];");
  emit("");

  // ── Locations ──
  emit("export const locations: readonly LocationData[] = [");
  for (const [, loc] of locPairs) {
    const small = makeTsString(loc.description.short);
    const big = makeTsString(loc.description.long);
    const sound = loc.sound ?? "SILENT";
    const soundVal = sound === "SILENT" ? -1 : msgnames.indexOf(sound);
    const loud = loc.loud ? "true" : "false";
    emit(`  { description: { small: ${small}, big: ${big} }, sound: ${soundVal}, loud: ${loud} },`);
  }
  emit("];");
  emit("");

  // ── Objects ──
  emit("export const objects: readonly ObjectData[] = [");
  for (const [, obj] of objPairs) {
    const words = obj.words ?? [];
    const wordsStr = `{ strs: [${words.map((w) => makeTsString(w)).join(", ")}], n: ${words.length} }`;
    const inv = makeTsString(obj.inventory);

    // Location handling - match Python logic exactly
    let plac: string;
    let fixd: string;
    if (obj.locations == null) {
      plac = "Location.LOC_NOWHERE";
      fixd = "Location.LOC_NOWHERE";
    } else if (typeof obj.locations === "string") {
      plac = `Location.${obj.locations}`;
      fixd = obj.immovable ? "-1" : "0";
    } else {
      plac = `Location.${obj.locations[0]}`;
      const f = obj.locations[1];
      fixd = typeof f === "string" ? `Location.${f}` : String(f);
    }

    const treasure = obj.treasure ? "true" : "false";

    // Arrays - match C: NULL pointer becomes [null]
    const descs = obj.descriptions
      ? `[${obj.descriptions.map((d) => makeTsString(d)).join(", ")}]`
      : "[null]";
    const sounds = obj.sounds
      ? `[${obj.sounds.map((s) => makeTsString(s)).join(", ")}]`
      : "[null]";
    const texts = obj.texts
      ? `[${obj.texts.map((t) => makeTsString(t)).join(", ")}]`
      : "[null]";
    const changes = obj.changes
      ? `[${obj.changes.map((c) => makeTsString(c)).join(", ")}]`
      : "[null]";

    emit(
      `  { words: ${wordsStr}, inventory: ${inv}, plac: ${plac}, fixd: ${fixd}, isTreasure: ${treasure}, descriptions: ${descs}, sounds: ${sounds}, texts: ${texts}, changes: ${changes} },`,
    );
  }
  emit("];");
  emit("");

  // ── Obituaries ──
  emit("export const obituaries: readonly Obituary[] = [");
  for (const o of raw.obituaries) {
    emit(
      `  { query: ${makeTsString(o.query)}, yesResponse: ${makeTsString(o.yes_response)} },`,
    );
  }
  emit("];");
  emit("");

  // ── Hints ──
  emit("export const hints: readonly HintData[] = [");
  for (const h of raw.hints) {
    const hi = h.hint;
    emit(
      `  { number: ${hi.number}, turns: ${hi.turns}, penalty: ${hi.penalty}, question: ${makeTsString(hi.question)}, hint: ${makeTsString(hi.hint)} },`,
    );
  }
  emit("];");
  emit("");

  // ── Conditions (mutable - COND_FORCED is set at runtime by init) ──
  emit("export const conditions: number[] = [");
  for (const expr of condBitExprs) {
    emit(`  ${expr},`);
  }
  emit("];");
  emit("");

  // ── Motions ──
  emit("export const motions: readonly MotionData[] = [");
  for (const [, motion] of motionPairs) {
    const words = motion.words ?? [];
    const wordsStr = `{ strs: [${words.map((w) => makeTsString(w)).join(", ")}], n: ${words.length} }`;
    emit(`  { words: ${wordsStr} },`);
  }
  emit("];");
  emit("");

  // ── Actions ──
  emit("export const actions: readonly ActionData[] = [");
  for (const [, action] of actionPairs) {
    const words = action.words ?? [];
    const wordsStr = `{ strs: [${words.map((w) => makeTsString(w)).join(", ")}], n: ${words.length} }`;
    const msg = makeTsString(action.message);
    const noaction = action.noaction ? "true" : "false";
    emit(`  { words: ${wordsStr}, message: ${msg}, noaction: ${noaction} },`);
  }
  emit("];");
  emit("");

  // ── Travel key ──
  emit("export const tkey: readonly number[] = [");
  const tkeyChunks: string[] = [];
  for (let i = 0; i < tkey.length; i += 10) {
    const chunk = tkey.slice(i, i + 10).join(", ");
    tkeyChunks.push(`  ${chunk},`);
  }
  emit(tkeyChunks.join("\n"));
  emit("];");
  emit("");

  // ── Travel table ──
  emit("export const travel: readonly TravelOp[] = [");
  for (const entry of travel) {
    emit(
      `  { motion: ${entry.motion}, condtype: ${entry.condtype}, condarg1: ${entry.condarg1}, condarg2: ${entry.condarg2}, desttype: ${entry.desttype}, destval: ${entry.destval}, nodwarves: ${entry.nodwarves}, stop: ${entry.stop} },`,
    );
  }
  emit("];");
  emit("");

  // ── Ignore string ──
  emit(`export const ignore = ${makeTsString(ignoreChars)};`);
  emit("");

  // ── Dwarf starting locations ──
  emit(
    `export const dwarflocs: readonly number[] = [${raw.dwarflocs.map((l) => `Location.${l}`).join(", ")}];`,
  );
  emit("");

  // ── DungeonData type (for import convenience) ──
  emit("export interface DungeonData {");
  emit("  readonly locations: typeof locations;");
  emit("  readonly objects: typeof objects;");
  emit("}");
  emit("");

  emit("/* end */");

  return lines.join("\n") + "\n";
}

// ── CLI ──

const args = process.argv.slice(2);
const checkMode = args.includes("--check");

const output = generate();

if (checkMode) {
  try {
    const existing = readFileSync(OUTPUT_PATH, "utf-8");
    if (existing === output) {
      console.log("dungeon.generated.ts is up to date.");
      process.exit(0);
    } else {
      console.error("dungeon.generated.ts is out of date. Run: pnpm run generate");
      process.exit(1);
    }
  } catch {
    console.error("dungeon.generated.ts not found. Run: pnpm run generate");
    process.exit(1);
  }
} else {
  writeFileSync(OUTPUT_PATH, output);
  console.log(`Generated ${OUTPUT_PATH}`);
}
