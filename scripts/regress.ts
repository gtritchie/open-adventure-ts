/*
 * Regression test runner for Open Adventure TypeScript port.
 *
 * Discovers .log/.chk pairs in tests/, feeds .log as stdin to the game,
 * compares stdout against .chk, and outputs TAP-format results.
 *
 * Usage:
 *   npx tsx scripts/regress.ts              # Run all tests
 *   npx tsx scripts/regress.ts --test NAME  # Run single test
 *   npx tsx scripts/regress.ts --update     # Update .chk files from output
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { execSync, execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname!, "..");
const TESTS_DIR = join(ROOT, "tests");
const MAIN_TS = join(ROOT, "src", "main.ts");
const CHEAT_TS = join(ROOT, "src", "cheat.ts");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");

// Save files needed by tests, and the cheat commands to generate them
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
  "saveresume.1",  // creates saveresume.adv
  "saveresume.2",  // reads saveresume.adv
  "saveresume.3",  // creates saveresume_win.adv
  "saveresume.4",  // reads saveresume_win.adv
];

function discoverTests(): string[] {
  const files = readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".log"))
    .map((f) => f.replace(/\.log$/, ""))
    .sort();
  return files;
}

function extractOptions(logPath: string): string[] {
  const content = readFileSync(logPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^#options:\s*(.*)/);
    if (match) {
      // Split options, respecting simple quoting
      return match[1]!.trim().split(/\s+/);
    }
  }
  return [];
}

function generateSaveFiles(): void {
  for (const [filename, args] of Object.entries(SAVE_FILES)) {
    const outPath = join(TESTS_DIR, filename);
    try {
      execFileSync(TSX, [CHEAT_TS, ...args, "-o", outPath], {
        cwd: TESTS_DIR,
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Warning: Failed to generate ${filename}: ${msg}\n`);
    }
  }
}

function runTest(
  testName: string,
): { passed: boolean; diff: string; error?: string } {
  const logPath = join(TESTS_DIR, `${testName}.log`);
  const chkPath = join(TESTS_DIR, `${testName}.chk`);

  if (!existsSync(chkPath)) {
    return { passed: false, diff: "", error: "No .chk file found" };
  }

  const options = extractOptions(logPath);
  const logContent = readFileSync(logPath);
  const expected = readFileSync(chkPath, "utf-8");

  const args = [MAIN_TS, ...options];

  const execOpts: ExecFileSyncOptions = {
    input: logContent,
    cwd: TESTS_DIR,
    timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  };

  let actual: string;
  try {
    const result = execFileSync(TSX, args, execOpts);
    actual = result.toString("utf-8");
  } catch (err: unknown) {
    // Process may exit with non-zero (e.g., TerminateError)
    // but still produce valid output
    if (
      err &&
      typeof err === "object" &&
      "stdout" in err &&
      err.stdout instanceof Buffer
    ) {
      actual = err.stdout.toString("utf-8");
      // If there's stderr output, capture it for diagnostics
      if ("stderr" in err && err.stderr instanceof Buffer) {
        const stderr = err.stderr.toString("utf-8").trim();
        if (stderr && !stderr.includes("Game terminated")) {
          return { passed: false, diff: "", error: stderr.slice(0, 500) };
        }
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      return { passed: false, diff: "", error: msg.slice(0, 500) };
    }
  }

  if (actual === expected) {
    return { passed: true, diff: "" };
  }

  // Generate a unified diff for diagnostics
  const actualLines = actual.split("\n");
  const expectedLines = expected.split("\n");
  const diffLines: string[] = [];
  const maxLines = Math.max(actualLines.length, expectedLines.length);
  let firstDiff = -1;

  for (let i = 0; i < maxLines; i++) {
    const a = actualLines[i];
    const e = expectedLines[i];
    if (a !== e) {
      if (firstDiff === -1) firstDiff = i + 1;
      if (a !== undefined) diffLines.push(`- ${i + 1}: ${a}`);
      if (e !== undefined) diffLines.push(`+ ${i + 1}: ${e}`);
      if (diffLines.length > 20) {
        diffLines.push("... (truncated)");
        break;
      }
    }
  }

  const summary = `First difference at line ${firstDiff} (got ${actualLines.length} lines, expected ${expectedLines.length} lines)`;
  return { passed: false, diff: summary + "\n" + diffLines.join("\n") };
}

function main(): void {
  const args = process.argv.slice(2);
  let singleTest: string | null = null;
  let updateMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--test" && args[i + 1]) {
      singleTest = args[++i]!;
    } else if (args[i] === "--update") {
      updateMode = true;
    }
  }

  // Generate save files
  process.stderr.write("Generating save files...\n");
  generateSaveFiles();

  let tests: string[];
  if (singleTest) {
    tests = [singleTest];
  } else {
    tests = discoverTests();
    // Ensure chained tests run in order
    for (const chain of CHAINED_TESTS) {
      const idx = tests.indexOf(chain);
      if (idx !== -1) {
        tests.splice(idx, 1);
      }
    }
    // Insert chained tests at their natural sort position
    const chainedPresent = CHAINED_TESTS.filter((t) =>
      existsSync(join(TESTS_DIR, `${t}.log`)),
    );
    // Remove chained tests from main list and add them back in order
    tests = [...tests.filter((t) => !chainedPresent.includes(t))];
    // Find where to insert chained tests (after their alphabetical position)
    for (const ct of chainedPresent) {
      let insertAt = tests.length;
      for (let i = 0; i < tests.length; i++) {
        if (tests[i]! > ct) {
          insertAt = i;
          break;
        }
      }
      tests.splice(insertAt, 0, ct);
    }
  }

  // TAP output
  console.log(`1..${tests.length}`);

  let passed = 0;
  let failed = 0;
  let errors = 0;

  for (let i = 0; i < tests.length; i++) {
    const testName = tests[i]!;
    const logPath = join(TESTS_DIR, `${testName}.log`);

    // Extract description from first line
    let description = testName;
    try {
      const firstLine = readFileSync(logPath, "utf-8").split("\n")[0] ?? "";
      const descMatch = firstLine.match(/^##\s*(.*)/);
      if (descMatch) {
        description = `${testName}: ${descMatch[1]}`;
      }
    } catch {
      // ignore
    }

    const result = runTest(testName);

    if (result.passed) {
      console.log(`ok ${i + 1} - ${description}`);
      passed++;
    } else if (result.error) {
      console.log(`not ok ${i + 1} - ${description}`);
      console.log(`  # Error: ${result.error.replace(/\n/g, "\n  # ")}`);
      errors++;
    } else {
      console.log(`not ok ${i + 1} - ${description}`);
      if (result.diff) {
        for (const line of result.diff.split("\n")) {
          console.log(`  # ${line}`);
        }
      }
      failed++;
    }

    if (updateMode && !result.passed) {
      // Re-run and capture output to update .chk
      const chkPath = join(TESTS_DIR, `${testName}.chk`);
      const options = extractOptions(logPath);
      try {
        const logContent = readFileSync(logPath);
        const output = execFileSync(TSX, [MAIN_TS, ...options], {
          input: logContent,
          cwd: TESTS_DIR,
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
          maxBuffer: 10 * 1024 * 1024,
        });
        writeFileSync(chkPath, output);
        process.stderr.write(`  Updated ${testName}.chk\n`);
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "stdout" in err &&
          err.stdout instanceof Buffer
        ) {
          writeFileSync(chkPath, err.stdout);
          process.stderr.write(`  Updated ${testName}.chk\n`);
        }
      }
    }
  }

  process.stderr.write(
    `\nResults: ${passed} passed, ${failed} failed, ${errors} errors out of ${tests.length} tests\n`,
  );

  if (failed + errors > 0) {
    process.exit(1);
  }
}

main();
