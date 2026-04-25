import { describe, it, expect } from "vitest";
import { serializeGame, summarizeSave } from "./save-pure.js";
import { createGameState, initialise, createSettings } from "./init.js";
import { ScriptIO } from "./io.js";
import { computeScore } from "./score.js";
import { Termination, ADVENT_MAGIC, ENDIAN_MAGIC, SAVE_VERSION } from "./types.js";

function makeInitialisedState() {
  const state = createGameState();
  const settings = createSettings();
  const io = new ScriptIO([], settings);
  initialise(state, settings, io);
  return state;
}

describe("summarizeSave", () => {
  it("returns a populated summary for a fresh game", () => {
    const state = makeInitialisedState();
    const summary = summarizeSave(state);
    if ("error" in summary) throw new Error(summary.error);
    expect(typeof summary.locationName).toBe("string");
    expect(summary.locationName.length).toBeGreaterThan(0);
    expect(summary.score).toBeGreaterThanOrEqual(0);
    expect(summary.maxScore).toBeGreaterThan(0);
    expect(summary.treasuresFound).toBe(0);
    expect(summary.treasuresTotal).toBeGreaterThan(0);
    expect(Array.isArray(summary.inventory)).toBe(true);
    expect(summary.phase).toBe("pre-cave");
    expect(summary.compatible).toBe(true);
  });

  it("accepts a JSON string", () => {
    const json = serializeGame(makeInitialisedState());
    const summary = summarizeSave(json);
    expect("error" in summary).toBe(false);
  });

  it("returns an error on bad JSON", () => {
    const summary = summarizeSave("{not json");
    expect(summary).toMatchObject({ error: expect.any(String) });
  });

  it("score is computed in scoregame mode (no +4 endgame bonus)", () => {
    const state = makeInitialisedState();
    const summary = summarizeSave(state);
    if ("error" in summary) throw new Error(summary.error);
    const expected = computeScore(state, Termination.scoregame);
    expect(summary.score).toBe(expected.points);
    // Verify the endgame bonus is NOT included — scoregame gives 4 fewer points than endgame
    const endgameResult = computeScore(state, Termination.endgame);
    expect(summary.score).toBe(endgameResult.points - 4);
  });

  it("version-skew JSON returns partial summary with compatible: false", () => {
    const oldVersionJson = JSON.stringify({
      magic: ADVENT_MAGIC,
      canary: ENDIAN_MAGIC,
      version: SAVE_VERSION - 1,
      game: {},
    });
    const summary = summarizeSave(oldVersionJson);
    expect("error" in summary).toBe(false);
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.compatible).toBe(false);
    expect(summary.saveVersion).toBe(SAVE_VERSION - 1);
    expect(summary.currentVersion).toBe(SAVE_VERSION);
    expect(summary.locationName).toBe("(incompatible save)");
    expect(summary.score).toBe(0);
    expect(summary.inventory).toEqual([]);
  });

  it("bad-magic JSON returns an error, not a partial summary", () => {
    const badMagicJson = JSON.stringify({
      magic: "wrong-magic",
      canary: ENDIAN_MAGIC,
      version: SAVE_VERSION,
      game: {},
    });
    const summary = summarizeSave(badMagicJson);
    expect(summary).toMatchObject({ error: expect.any(String) });
  });
});
