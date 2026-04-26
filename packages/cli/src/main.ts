/*
 * CLI entry point.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import { writeFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { GameIO, Settings } from "@open-adventure/core";
import { TerminateError, ScriptIO, createSettings, runGame } from "@open-adventure/core";
import { ConsoleIO } from "./console-io.js";
import { NodeFileStorage } from "./node-storage.js";

async function main(): Promise<void> {
  const { values: vals, positionals } = parseArgs({
    strict: true,
    allowPositionals: true,
    options: {
      l: { type: "string" },
      o: { type: "boolean" },
      r: { type: "string" },
      d: { type: "boolean" },
    },
  });

  const settingsOverrides: Partial<Settings> = {};
  if (vals.d) settingsOverrides.debug = 1;
  if (vals.o) {
    settingsOverrides.oldstyle = true;
    settingsOverrides.prompt = false;
  }

  // Logging
  if (vals.l !== undefined) {
    const logfilename = vals.l;
    const logLines: string[] = [];
    settingsOverrides.logfp = (line: string): void => {
      logLines.push(line);
      try { writeFileSync(logfilename, logLines.join("\n") + "\n"); } catch { /* ignore */ }
    };
  }

  // Debug callback (only when -d is passed; matches the gating from createSettings).
  if (vals.d) {
    settingsOverrides.debugCallback = (msg: string): void => {
      process.stderr.write(msg);
    };
  }

  // Resume file (-r)
  let initialSave: string | undefined;
  if (vals.r !== undefined) {
    try {
      initialSave = readFileSync(vals.r, "utf-8");
    } catch {
      process.stderr.write(`advent: can't open save file ${vals.r} for read\n`);
      process.exit(1);
    }
    // Preserve today's CLI -r strictness: today's restoreFromFile() lets
    // JSON.parse throw, which exits via main().catch with stderr + exit 1.
    // runGame's initialSave path is intentionally graceful for browser hosts
    // (rspeak BAD_SAVE + continue); CLI keeps the strict crash semantics.
    try {
      JSON.parse(initialSave);
    } catch (err: unknown) {
      process.stderr.write(String(err) + "\n");
      process.exit(1);
    }
  }

  // Script files (positional args)
  let io: GameIO | undefined;
  if (positionals.length > 0) {
    const allLines: string[] = [];
    for (const scriptFile of positionals) {
      if (scriptFile === "-") continue;
      try {
        allLines.push(...readFileSync(scriptFile, "utf-8").split("\n"));
      } catch {
        process.stderr.write(`Can't open script ${scriptFile}\n`);
      }
    }
    if (allLines.length > 0) {
      io = new ScriptIO(allLines, createSettings());
    }
  }
  if (io === undefined) io = new ConsoleIO(createSettings());

  const runOpts = {
    io,
    storage: new NodeFileStorage(),
    settings: settingsOverrides,
    ...(initialSave !== undefined ? { initialSave } : {}),
  };
  const exitCode = await runGame(runOpts);

  if (io instanceof ConsoleIO) io.close();
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  if (err instanceof TerminateError) process.exit(err.code);
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
