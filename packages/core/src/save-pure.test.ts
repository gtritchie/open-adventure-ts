/*
 * Unit tests for pure save/restore helpers.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import { describe, it, expect } from "vitest";
import { serializeGame, deserializeGame } from "./save-pure.js";
import { createGameState } from "./init.js";

describe("serializeGame / deserializeGame", () => {
  it("round-trips a fresh game state", () => {
    const state = createGameState();
    const json = serializeGame(state);
    const result = deserializeGame(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.lcgX).toBe(state.lcgX);
      expect(result.state.loc).toBe(state.loc);
    }
  });

  it("rejects malformed JSON with bad-json reason", () => {
    const result = deserializeGame("{not json");
    expect(result).toMatchObject({ ok: false, reason: "bad-json" });
  });

  it("rejects bad magic", () => {
    const json = JSON.stringify({
      magic: "wrong",
      version: 31,
      canary: 2317,
      game: createGameState(),
    });
    const result = deserializeGame(json);
    expect(result).toMatchObject({ ok: false, reason: "bad-magic" });
  });

  it("rejects version skew with version numbers in result", () => {
    const json = JSON.stringify({
      magic: "open-adventure\n",
      version: 30,
      canary: 2317,
      game: createGameState(),
    });
    const result = deserializeGame(json);
    expect(result).toMatchObject({
      ok: false,
      reason: "version-skew",
      saveVersion: 30,
      expectedVersion: 31,
    });
  });

  it("rejects JSON null as bad-magic", () => {
    const result = deserializeGame("null");
    expect(result).toMatchObject({ ok: false, reason: "bad-magic" });
  });

  it("rejects a primitive payload as bad-magic", () => {
    const result = deserializeGame("42");
    expect(result).toMatchObject({ ok: false, reason: "bad-magic" });
  });

  it("rejects header-valid JSON missing the game field as tampering", () => {
    const json = JSON.stringify({
      magic: "open-adventure\n",
      version: 31,
      canary: 2317,
      // game intentionally absent
    });
    const result = deserializeGame(json);
    expect(result).toMatchObject({ ok: false, reason: "tampering" });
  });

  it("rejects header-valid JSON whose game field is not an object", () => {
    const json = JSON.stringify({
      magic: "open-adventure\n",
      version: 31,
      canary: 2317,
      game: "not-an-object",
    });
    const result = deserializeGame(json);
    expect(result).toMatchObject({ ok: false, reason: "tampering" });
  });

  it("rejects header-valid JSON with an empty game object as tampering", () => {
    const json = JSON.stringify({
      magic: "open-adventure\n",
      version: 31,
      canary: 2317,
      game: {},
    });
    const result = deserializeGame(json);
    expect(result).toMatchObject({ ok: false, reason: "tampering" });
  });

  it("rejects header-valid JSON whose game object lacks required arrays", () => {
    const json = JSON.stringify({
      magic: "open-adventure\n",
      version: 31,
      canary: 2317,
      // valid scalar field but no dwarves/objects/locs/link arrays
      game: { abbnum: 1, lcgX: 0 },
    });
    const result = deserializeGame(json);
    expect(result).toMatchObject({ ok: false, reason: "tampering" });
  });
});
