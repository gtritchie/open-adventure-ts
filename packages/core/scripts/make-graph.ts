#!/usr/bin/env tsx
/*
 * Dungeon graph generator - reads adventure.yaml and emits Graphviz DOT format
 *
 * Port of make_graph.py from the C open-adventure project.
 *
 * Usage:
 *   npx tsx scripts/make-graph.ts [options]
 *
 * Options:
 *   --all         Entire dungeon
 *   --maze-alike  Maze all alike (default)
 *   --maze-diff   Maze all different
 *   --forest      Forest locations
 *   --surface     Non-forest surface locations
 *   --verbose     Include internal LOC_ names in labels
 *
 * Output is DOT format to stdout. Pipe to: dot -Tsvg > file.svg
 *
 * SPDX-FileCopyrightText: (C) Eric S. Raymond <esr@thyrsus.com>
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const YAML_PATH = resolve(ROOT, "adventure.yaml");

// ── YAML parsing helpers (same pattern as make-dungeon.ts) ──

function toPair<T>(obj: Record<string, T>): [string, T] {
  const keys = Object.keys(obj);
  return [keys[0]!, obj[keys[0]!]!];
}

function toPairs<T>(arr: Record<string, T>[]): [string, T][] {
  return arr.map(toPair);
}

// ── Types ──

interface GraphLocation {
  description: { short: string | null; long: string | null; maptag: string | null };
  conditions?: Record<string, boolean>;
  travel?: YamlTravelRule[];
}

interface YamlTravelRule {
  verbs: string[];
  action: [string, ...unknown[]];
  cond?: unknown[] | null;
}

interface YamlObject {
  locations?: string | [string, number | string];
  immovable?: boolean;
}

// ── Subset filters ──

type SubsetFilter = (loc: string, lookup: Map<string, GraphLocation>) => boolean;

function allalike(loc: string, lookup: Map<string, GraphLocation>): boolean {
  return lookup.get(loc)!.conditions?.["ALLALIKE"] === true;
}

function alldifferent(loc: string, lookup: Map<string, GraphLocation>): boolean {
  return lookup.get(loc)!.conditions?.["ALLDIFFERENT"] === true;
}

function surface(loc: string, lookup: Map<string, GraphLocation>): boolean {
  return lookup.get(loc)!.conditions?.["ABOVE"] === true;
}

function forest(loc: string, lookup: Map<string, GraphLocation>): boolean {
  return lookup.get(loc)!.conditions?.["FOREST"] === true;
}

// ── Helper functions ──

function abbreviate(d: string): string {
  const m: Record<string, string> = {
    NORTH: "N",
    EAST: "E",
    SOUTH: "S",
    WEST: "W",
    UPWAR: "U",
    DOWN: "D",
  };
  return m[d] ?? d;
}

function isForwarder(loc: string, lookup: Map<string, GraphLocation>): boolean {
  const travel = lookup.get(loc)!.travel ?? [];
  return travel.length === 1 && travel[0]!.verbs.length === 0;
}

function forward(loc: string, lookup: Map<string, GraphLocation>): string {
  while (isForwarder(loc, lookup)) {
    loc = lookup.get(loc)!.travel![0]!.action[1] as string;
  }
  return loc;
}

function reveal(objName: string, objLookup: Map<string, YamlObject>): boolean {
  if (objName.includes("OBJ_")) return false;
  if (objName === "VEND") return true;
  const obj = objLookup.get(objName)!;
  return !obj.immovable;
}

function roomLabel(
  loc: string,
  lookup: Map<string, GraphLocation>,
  verbose: boolean,
  startLocs: Map<string, string[]>,
): string {
  const locDesc = lookup.get(loc)!.description;
  let description = "";
  if (verbose) {
    description = loc.slice(4); // strip "LOC_"
  }
  const longd = locDesc.long;
  let short: string | null = locDesc.maptag ?? locDesc.short;
  if (short == null && longd != null && longd.length < 20) {
    short = longd;
  }
  if (short != null) {
    if (short.startsWith("You're ")) short = short.slice(7);
    if (short.startsWith("You are ")) short = short.slice(8);
    if (short.startsWith("in ") || short.startsWith("at ") || short.startsWith("on ")) {
      short = short.slice(3);
    }
    if (short.startsWith("the ")) short = short.slice(4);
    if (["n/s", "e/w"].includes(short.slice(0, 3))) {
      short = short.slice(0, 3).toUpperCase() + short.slice(3);
    } else if (["ne", "sw", "se", "nw"].includes(short.slice(0, 2))) {
      short = short.slice(0, 2).toUpperCase() + short.slice(2);
    } else {
      short = short[0]!.toUpperCase() + short.slice(1);
    }
    if (verbose) description += "\\n";
    description += short;
    const objs = startLocs.get(loc);
    if (objs) {
      description += "\\n(" + objs.join(",").toLowerCase() + ")";
    }
  }
  return description;
}

// ── CLI arg parsing ──

const args = process.argv.slice(2);
let subset: SubsetFilter = allalike;
let verbose = false;

for (const arg of args) {
  switch (arg) {
    case "--all":
      subset = () => true;
      break;
    case "--maze-alike":
      subset = allalike;
      break;
    case "--maze-diff":
      subset = alldifferent;
      break;
    case "--forest":
      subset = forest;
      break;
    case "--surface":
      subset = surface;
      break;
    case "--verbose":
      verbose = true;
      break;
    default:
      console.error(`Unknown option: ${arg}`);
      console.error(
        "Usage: make-graph.ts [--all] [--maze-alike] [--maze-diff] [--forest] [--surface] [--verbose]",
      );
      process.exit(1);
  }
}

// ── Load YAML ──

const yamlContent = readFileSync(YAML_PATH, "utf-8");
const db = yaml.load(yamlContent) as {
  locations: Record<string, GraphLocation>[];
  objects: Record<string, YamlObject>[];
};

const locPairs = toPairs(db.locations);
const objPairs = toPairs(db.objects);

const locLookup = new Map(locPairs);
const objLookup = new Map(objPairs);

// ── Build starting object locations ──

const startLocs = new Map<string, string[]>();
for (const [objName, obj] of objPairs) {
  const location = obj.locations;
  if (location != null && location !== "LOC_NOWHERE" && reveal(objName, objLookup)) {
    // Revealed objects always have a single string location
    const loc = location as string;
    const existing = startLocs.get(loc);
    if (existing) {
      existing.push(objName);
    } else {
      startLocs.set(loc, [objName]);
    }
  }
}

// ── Build links and nodes ──

const nodes: string[] = [];
const links = new Map<string, string[]>();
const linkOrder: string[] = [];

for (const [loc, attrs] of locPairs) {
  nodes.push(loc);
  const travel = attrs.travel ?? [];
  for (const dest of travel) {
    const verbs = dest.verbs.map(abbreviate);
    if (verbs.length === 0) continue;
    const action = dest.action;
    if (action[0] === "goto") {
      const target = forward(action[1] as string, locLookup);
      if (!subset(loc, locLookup) && !subset(target, locLookup)) continue;
      const key = `${loc}\0${target}`;
      if (!links.has(key)) linkOrder.push(key);
      links.set(key, verbs);
    }
  }
}

// ── Build neighbors ──

const neighbors = new Set<string>();
for (const loc of nodes) {
  for (const key of linkOrder) {
    const [f, t] = key.split("\0") as [string, string];
    if (f === "LOC_NOWHERE" || t === "LOC_NOWHERE") continue;
    if ((f === loc && subset(t, locLookup)) || (t === loc && subset(f, locLookup))) {
      neighbors.add(loc);
      break;
    }
  }
}

// ── Emit DOT ──

const lines: string[] = [];
lines.push("digraph G {");

for (const loc of nodes) {
  if (isForwarder(loc, locLookup)) continue;
  const label = roomLabel(loc, locLookup, verbose, startLocs);
  if (subset(loc, locLookup)) {
    lines.push(`    ${loc.slice(4)} [shape=box,label="${label}"]`);
  } else if (neighbors.has(loc)) {
    lines.push(`    ${loc.slice(4)} [label="${label}"]`);
  }
}

for (const key of linkOrder) {
  const [f, t] = key.split("\0") as [string, string];
  let arc = `${f.slice(4)} -> ${t.slice(4)}`;
  const label = links.get(key)!.join(",").toLowerCase();
  if (label.length > 0) {
    arc += ` [label="${label}"]`;
  }
  lines.push("    " + arc);
}

lines.push("}");

console.log(lines.join("\n"));
