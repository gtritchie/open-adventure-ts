/*
 * ScriptIO - in-memory GameIO for tests and scripted playback.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import type { GameIO, Settings } from "./types.js";

export class ScriptIO implements GameIO {
  private lines: readonly string[];
  private index: number;
  private outputBuffer: string[];
  readonly echoInput: boolean = true;

  constructor(lines: readonly string[], _settings: Settings) {
    this.lines = lines;
    this.index = 0;
    this.outputBuffer = [];
  }

  print(msg: string): void {
    this.outputBuffer.push(msg);
  }

  async readline(_prompt: string): Promise<string | null> {
    if (this.index >= this.lines.length) return null;
    return this.lines[this.index++]!;
  }

  getOutput(): string {
    return this.outputBuffer.join("");
  }

  getOutputLines(): string[] {
    return this.getOutput().split("\n");
  }
}
