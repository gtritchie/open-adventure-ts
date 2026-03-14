/*
 * Fuzz tester: generates random command sequences, runs them against both
 * the C advent binary and the TypeScript port, and compares stdout.
 *
 * Each run uses a deterministic game seed (via the "seed" command) and a
 * deterministic fuzzer seed, so failures are fully reproducible.
 *
 * Usage:
 *   npx tsx scripts/fuzz-compare.ts                    # 100 runs, 50 commands each
 *   npx tsx scripts/fuzz-compare.ts --runs 500         # 500 runs
 *   npx tsx scripts/fuzz-compare.ts --length 200       # 200 commands per run
 *   npx tsx scripts/fuzz-compare.ts --seed 42          # Start from fuzzer seed 42
 *   npx tsx scripts/fuzz-compare.ts --verbose          # Show diffs on failure
 *   npx tsx scripts/fuzz-compare.ts --repro 42         # Reproduce a single seed
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname!, "..");
const MAIN_TS = join(ROOT, "src", "main.ts");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const C_ADVENT = resolve(ROOT, "..", "open-adventure", "advent");

// --- Vocabulary ---
// Movement words
const MOTIONS = [
  "north", "south", "east", "west", "ne", "nw", "se", "sw",
  "up", "down", "in", "out", "left", "right", "back",
  "climb", "crawl", "jump", "cross", "enter",
  "forest", "hill", "road", "hall", "room",
  "stairs", "pit", "crack", "dome", "hole",
  "slab", "depression", "passage", "cave", "canyon",
  "upstream", "downstream", "outside",
  "xyzzy", "plugh", "plover", "y2",
  "bedquilt", "giant", "oriental", "shell", "reservoir",
  "secret", "barren",
];

// Object words
const OBJECTS = [
  "keys", "lamp", "cage", "bird", "rod", "nugget", "snake",
  "food", "bottle", "water", "oil", "knife", "axe",
  "dragon", "bear", "chain", "troll", "clam", "oyster",
  "magazine", "dwarf", "vase", "pillow", "mirror",
  "plant", "egg", "trident", "pearl", "rug", "chest",
  "gold", "diamonds", "silver", "jewels", "coins",
  "emerald", "pyramid", "amber", "sapphire", "ruby",
  "spices", "jade", "door", "grate", "urn", "sign",
  "ogre", "pirate",
];

// Action words
const ACTIONS = [
  "take", "drop", "open", "close", "on", "off",
  "wave", "pour", "rub", "throw", "find", "feed",
  "fill", "carry", "break", "wake", "attack", "eat",
  "drink", "say", "lock", "unlock", "read",
  "inventory", "look", "score", "brief",
  "blast", "fly", "listen", "suspend", "resume",
  "save", "restore",
];

// Gibberish words to test error handling
const GIBBERISH = [
  "xyzzy123", "asdf", "blorp", "frotz", "zork",
  "abcdef", "qqq", "nope", "maybe", "hmm",
  "12345", "!@#$", "", "the", "a",
];

// Common yes/no responses (the game asks questions)
const YES_NO = ["yes", "no", "y", "n"];

// Two-word commands: verb + object
function twoWordCommand(rng: () => number): string {
  const verbs = ["take", "drop", "throw", "open", "close", "wave",
    "pour", "rub", "feed", "fill", "break", "wake", "attack",
    "eat", "drink", "say", "lock", "unlock", "read", "find",
    "carry", "toss", "catch", "release", "free", "light", "extinguish"];
  const verb = verbs[Math.floor(rng() * verbs.length)]!;
  const obj = OBJECTS[Math.floor(rng() * OBJECTS.length)]!;
  return `${verb} ${obj}`;
}

// --- Simple seeded PRNG (mulberry32) ---
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateScript(fuzzerSeed: number, length: number): string {
  const rng = mulberry32(fuzzerSeed);
  // Use the fuzzer seed as the game seed too, for simplicity
  const gameSeed = Math.floor(rng() * 2147483647);
  const lines: string[] = [];

  // Standard preamble: decline instructions, set seed
  lines.push("no");
  lines.push(`seed ${gameSeed}`);

  for (let i = 0; i < length; i++) {
    const r = rng();

    if (r < 0.30) {
      // 30% movement
      lines.push(MOTIONS[Math.floor(rng() * MOTIONS.length)]!);
    } else if (r < 0.50) {
      // 20% single object word
      lines.push(OBJECTS[Math.floor(rng() * OBJECTS.length)]!);
    } else if (r < 0.70) {
      // 20% single action word
      lines.push(ACTIONS[Math.floor(rng() * ACTIONS.length)]!);
    } else if (r < 0.85) {
      // 15% two-word command
      lines.push(twoWordCommand(rng));
    } else if (r < 0.92) {
      // 7% yes/no (answers to game questions)
      lines.push(YES_NO[Math.floor(rng() * YES_NO.length)]!);
    } else if (r < 0.97) {
      // 5% gibberish
      lines.push(GIBBERISH[Math.floor(rng() * GIBBERISH.length)]!);
    } else {
      // 3% magic words
      const magic = ["fee", "fie", "foe", "foo", "fum",
        "abracadabra", "sesame", "shazam", "hocus", "pocus"];
      lines.push(magic[Math.floor(rng() * magic.length)]!);
    }
  }

  // End with quit to ensure clean termination
  lines.push("quit");
  lines.push("yes");

  return lines.join("\n") + "\n";
}

function runBinary(
  binary: string,
  args: string[],
  input: string,
  cwd: string,
): string | null {
  const execOpts: ExecFileSyncOptions = {
    input: Buffer.from(input),
    cwd,
    timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  };

  try {
    return execFileSync(binary, args, execOpts).toString("utf-8");
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "stdout" in err &&
      err.stdout instanceof Buffer
    ) {
      return err.stdout.toString("utf-8");
    }
    return null;
  }
}

function diff(a: string, b: string): string {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const maxLines = Math.max(aLines.length, bLines.length);
  const diffLines: string[] = [];
  let firstDiff = -1;

  for (let i = 0; i < maxLines; i++) {
    if (aLines[i] !== bLines[i]) {
      if (firstDiff === -1) firstDiff = i + 1;
      if (aLines[i] !== undefined) diffLines.push(`  C  ${i + 1}: ${aLines[i]}`);
      if (bLines[i] !== undefined) diffLines.push(`  TS ${i + 1}: ${bLines[i]}`);
      if (diffLines.length > 30) {
        diffLines.push("  ... (truncated)");
        break;
      }
    }
  }

  return `First difference at line ${firstDiff} (C: ${aLines.length} lines, TS: ${bLines.length} lines)\n${diffLines.join("\n")}`;
}

function main(): void {
  const argv = process.argv.slice(2);
  let numRuns = 100;
  let cmdLength = 50;
  let startSeed = 1;
  let verbose = false;
  let reproSeed: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--runs" && argv[i + 1]) numRuns = parseInt(argv[++i]!, 10);
    else if (arg === "--length" && argv[i + 1]) cmdLength = parseInt(argv[++i]!, 10);
    else if (arg === "--seed" && argv[i + 1]) startSeed = parseInt(argv[++i]!, 10);
    else if (arg === "--verbose") verbose = true;
    else if (arg === "--repro" && argv[i + 1]) reproSeed = parseInt(argv[++i]!, 10);
  }

  if (reproSeed !== null) {
    startSeed = reproSeed;
    numRuns = 1;
    verbose = true;
  }

  // Base work directory — each run gets isolated subdirs so save files
  // created during gameplay don't leak between runs or between C/TS.
  const baseDir = mkdtempSync(join(tmpdir(), "advent-fuzz-"));

  process.stderr.write(
    `Fuzzing ${numRuns} runs, ${cmdLength} commands each, starting at seed ${startSeed}\n`,
  );

  console.log(`1..${numRuns}`);

  let passed = 0;
  let failed = 0;
  let errored = 0;

  for (let i = 0; i < numRuns; i++) {
    const seed = startSeed + i;
    const num = i + 1;
    const script = generateScript(seed, cmdLength);

    // Each run gets its own C and TS directories for isolation
    const cDir = join(baseDir, `run_${seed}_c`);
    const tsDir = join(baseDir, `run_${seed}_ts`);
    mkdirSync(cDir);
    mkdirSync(tsDir);

    // Save the script for reproducibility on failure
    const scriptPath = join(baseDir, `fuzz_${seed}.log`);
    writeFileSync(scriptPath, script);

    const cOutput = runBinary(C_ADVENT, [], script, cDir);
    const tsOutput = runBinary(TSX, [MAIN_TS], script, tsDir);

    if (cOutput === null) {
      console.log(`not ok ${num} - seed ${seed}`);
      console.log(`  # C binary failed to produce output`);
      errored++;
      continue;
    }

    if (tsOutput === null) {
      console.log(`not ok ${num} - seed ${seed}`);
      console.log(`  # TS binary failed to produce output`);
      errored++;
      continue;
    }

    // Clean up per-run dirs (save files no longer needed)
    rmSync(cDir, { recursive: true, force: true });
    rmSync(tsDir, { recursive: true, force: true });

    if (cOutput === tsOutput) {
      console.log(`ok ${num} - seed ${seed} (${cOutput.split("\n").length} lines)`);
      passed++;
    } else {
      console.log(`not ok ${num} - seed ${seed}`);
      console.log(`  # Script saved to: ${scriptPath}`);
      if (verbose) {
        for (const line of diff(cOutput, tsOutput).split("\n")) {
          console.log(`  # ${line}`);
        }
      }
      failed++;
    }
  }

  // Cleanup on success, keep on failure for investigation
  if (failed === 0 && errored === 0) {
    rmSync(baseDir, { recursive: true, force: true });
  } else {
    process.stderr.write(`\nWork directory preserved: ${baseDir}\n`);
  }

  process.stderr.write(
    `\nResults: ${passed} passed, ${failed} failed, ${errored} errors out of ${numRuns} runs\n`,
  );

  if (failed + errored > 0) {
    process.exit(1);
  }
}

main();
