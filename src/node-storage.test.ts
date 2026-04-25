import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeFileStorage } from "./node-storage.js";

describe("NodeFileStorage", () => {
  let dir: string;
  let storage: NodeFileStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "advent-store-"));
    storage = new NodeFileStorage();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads a file by path", async () => {
    const path = join(dir, "foo.adv");
    await storage.write(path, "hello");
    expect(await storage.read(path)).toBe("hello");
  });

  it("returns null when reading a missing file", async () => {
    expect(await storage.read(join(dir, "missing.adv"))).toBe(null);
  });

  it("delete removes the file", async () => {
    const path = join(dir, "doomed.adv");
    await storage.write(path, "data");
    await storage.delete!(path);
    expect(await storage.read(path)).toBe(null);
  });
});
