import { describe, it, expect } from "vitest";
import { serializeGame, summarizeSave } from "./save-pure.js";
import { createGameState, initialise, createSettings } from "./init.js";
import { ScriptIO } from "./io.js";

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
});
