/*
 * Cross-comparison test: runs every .log test against BOTH the original C
 * advent binary and the TypeScript port, then diffs their stdout.
 *
 * This validates that the .chk files haven't drifted from the C original
 * and that the TS port produces byte-identical output.
 *
 * Usage:
 *   npx tsx scripts/cross-compare.ts              # Run all tests
 *   npx tsx scripts/cross-compare.ts --test NAME  # Run single test
 *   npx tsx scripts/cross-compare.ts --verbose     # Show diffs for failures
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  mkdtempSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname!, "..");
const TESTS_DIR = join(ROOT, "tests");
const MAIN_TS = join(ROOT, "src", "main.ts");
const CHEAT_TS = join(ROOT, "src", "cheat.ts");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");

const C_ROOT = resolve(ROOT, "..", "open-adventure");
const C_ADVENT = join(C_ROOT, "advent");
const C_CHEAT = join(C_ROOT, "cheat");

// Save files needed by tests, and the cheat args to generate them
const SAVE_FILES: Record<string, string[]> = {
  "cheat_numdie.adv": ["-d", "-900"],
  "cheat_numdie1000.adv": ["-d", "-1000"],
  "cheat_savetamper.adv": ["-d", "2000"],
  "resume_badversion.adv": ["-v", "-1337"],
  "thousand_saves.adv": ["-s", "-1000"],
  "thousand_turns.adv": ["-t", "-1000"],
  "thousand_limit.adv": ["-l", "-1000"],
};

// Tests that create save files consumed by later tests (must run in order)
const CHAINED_TESTS = [
  "saveresume.1",
  "saveresume.2",
  "saveresume.3",
  "saveresume.4",
];

function discoverTests(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".log"))
    .map((f) => f.replace(/\.log$/, ""))
    .sort();
}

function orderTests(tests: string[]): string[] {
  // Remove chained tests from their natural positions, re-insert in order
  const nonChained = tests.filter((t) => !CHAINED_TESTS.includes(t));
  for (const ct of CHAINED_TESTS) {
    if (!tests.includes(ct)) continue;
    let insertAt = nonChained.length;
    for (let i = 0; i < nonChained.length; i++) {
      if (nonChained[i]! > ct) {
        insertAt = i;
        break;
      }
    }
    nonChained.splice(insertAt, 0, ct);
  }
  return nonChained;
}

function extractOptions(logPath: string): string[] {
  const content = readFileSync(logPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^#options:\s*(.*)/);
    if (match) {
      return match[1]!.trim().split(/\s+/);
    }
  }
  return [];
}

function setupWorkDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `advent-${label}-`));
  // Copy all .log files into the work dir
  for (const f of readdirSync(TESTS_DIR)) {
    if (f.endsWith(".log")) {
      cpSync(join(TESTS_DIR, f), join(dir, f));
    }
  }
  return dir;
}

function generateCSaveFiles(workDir: string): void {
  for (const [filename, args] of Object.entries(SAVE_FILES)) {
    try {
      execFileSync(C_CHEAT, [...args, "-o", join(workDir, filename)], {
        cwd: workDir,
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Warning: C cheat failed for ${filename}: ${msg}\n`);
    }
  }
}

function generateTSSaveFiles(workDir: string): void {
  for (const [filename, args] of Object.entries(SAVE_FILES)) {
    try {
      execFileSync(TSX, [CHEAT_TS, ...args, "-o", join(workDir, filename)], {
        cwd: workDir,
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `Warning: TS cheat failed for ${filename}: ${msg}\n`,
      );
    }
  }
}

function runC(testName: string, workDir: string): string | null {
  const logPath = join(workDir, `${testName}.log`);
  const options = extractOptions(logPath);
  const logContent = readFileSync(logPath);

  const execOpts: ExecFileSyncOptions = {
    input: logContent,
    cwd: workDir,
    timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  };

  try {
    return execFileSync(C_ADVENT, options, execOpts).toString("utf-8");
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

function runTS(testName: string, workDir: string): string | null {
  const logPath = join(workDir, `${testName}.log`);
  const options = extractOptions(logPath);
  const logContent = readFileSync(logPath);

  const execOpts: ExecFileSyncOptions = {
    input: logContent,
    cwd: workDir,
    timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  };

  try {
    return execFileSync(TSX, [MAIN_TS, ...options], execOpts).toString("utf-8");
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

  const summary = `First difference at line ${firstDiff} (C: ${aLines.length} lines, TS: ${bLines.length} lines)`;
  return summary + "\n" + diffLines.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  let singleTest: string | null = null;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--test" && args[i + 1]) {
      singleTest = args[++i]!;
    } else if (args[i] === "--verbose") {
      verbose = true;
    }
  }

  // Set up isolated work directories
  process.stderr.write("Setting up work directories...\n");
  const cWorkDir = setupWorkDir("c");
  const tsWorkDir = setupWorkDir("ts");

  process.stderr.write("Generating C save files...\n");
  generateCSaveFiles(cWorkDir);
  process.stderr.write("Generating TS save files...\n");
  generateTSSaveFiles(tsWorkDir);

  let tests: string[];
  if (singleTest) {
    tests = [singleTest];
  } else {
    tests = orderTests(discoverTests());
  }

  // TAP output
  console.log(`1..${tests.length}`);

  let passed = 0;
  let failed = 0;
  let errored = 0;

  for (let i = 0; i < tests.length; i++) {
    const testName = tests[i]!;
    const num = i + 1;

    // Read description
    let description = testName;
    try {
      const logPath = join(TESTS_DIR, `${testName}.log`);
      const firstLine = readFileSync(logPath, "utf-8").split("\n")[0] ?? "";
      const descMatch = firstLine.match(/^##\s*(.*)/);
      if (descMatch) description = `${testName}: ${descMatch[1]}`;
    } catch {
      // ignore
    }

    const cOutput = runC(testName, cWorkDir);
    const tsOutput = runTS(testName, tsWorkDir);

    if (cOutput === null) {
      console.log(`not ok ${num} - ${description}`);
      console.log(`  # C binary failed to run`);
      errored++;
      continue;
    }

    if (tsOutput === null) {
      console.log(`not ok ${num} - ${description}`);
      console.log(`  # TS binary failed to run`);
      errored++;
      continue;
    }

    if (cOutput === tsOutput) {
      console.log(`ok ${num} - ${description}`);
      passed++;
    } else {
      console.log(`not ok ${num} - ${description}`);
      if (verbose) {
        for (const line of diff(cOutput, tsOutput).split("\n")) {
          console.log(`  # ${line}`);
        }
      }
      failed++;
    }
  }

  // Cleanup temp dirs
  rmSync(cWorkDir, { recursive: true, force: true });
  rmSync(tsWorkDir, { recursive: true, force: true });

  process.stderr.write(
    `\nResults: ${passed} passed, ${failed} failed, ${errored} errors out of ${tests.length} tests\n`,
  );

  if (failed + errored > 0) {
    process.exit(1);
  }
}

main();
