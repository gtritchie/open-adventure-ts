/*
 * Smoke test for runGame end-to-end with in-memory IO and storage.
 *
 * Imports only from the public API to catch accidental node:* imports in core.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import { describe, it, expect } from "vitest";
import {
  runGame,
  ScriptIO,
  createSettings,
  createGameState,
  initialise,
  serializeGame,
  type SaveStorage,
} from "../index.js";

class MemoryStorage implements SaveStorage {
  private data = new Map<string, string>();

  async read(name: string): Promise<string | null> {
    return this.data.get(name) ?? null;
  }

  async write(name: string, data: string): Promise<void> {
    this.data.set(name, data);
  }
}

describe("runGame smoke", () => {
  it("plays a brief scripted session and quits", async () => {
    const lines = [
      "no",       // not a novice
      "in",       // enter building
      "take lamp",
      "quit",
      "yes",      // confirm quit
    ];
    const io = new ScriptIO(lines, createSettings());
    const storage = new MemoryStorage();

    const exitCode = await runGame({ io, storage });
    expect(exitCode).toBe(0);

    const out = io.getOutput();
    // Output should contain the welcome and the building description.
    expect(out).toContain("Welcome");
    expect(out).toContain("building");
    expect(out.length).toBeGreaterThan(100);
  });

  it("auto-resumes when initialSave is provided", async () => {
    // Build a valid save from an initialized state.
    const discardIO = {
      print(): void { /* discard */ },
      async readline(): Promise<string | null> { return null; },
      echoInput: false as const,
    };
    const state = createGameState();
    const settings = createSettings();
    initialise(state, settings, discardIO);
    const json = serializeGame(state);

    const io = new ScriptIO(["quit", "yes"], createSettings());
    const storage = new MemoryStorage();

    const exitCode = await runGame({ io, storage, initialSave: json });
    expect(exitCode).toBe(0);
    // No "Welcome" greeting — initialSave skips the welcome flow.
    expect(io.getOutput()).not.toContain("Welcome to Adventure");
  });
});
