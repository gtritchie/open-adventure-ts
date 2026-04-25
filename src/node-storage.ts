/*
 * NodeFileStorage — SaveStorage adapter backed by node:fs.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import type { SaveStorage } from "./types.js";

export class NodeFileStorage implements SaveStorage {
  async read(name: string): Promise<string | null> {
    try {
      return await readFile(name, "utf-8");
    } catch {
      return null;
    }
  }

  async write(name: string, data: string): Promise<void> {
    await writeFile(name, data);
  }

  async delete(name: string): Promise<void> {
    await unlink(name);
  }
}
