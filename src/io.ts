/*
 * I/O implementations - ConsoleIO and ScriptIO.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { createInterface, type Interface } from "node:readline/promises";
import type { GameIO, Settings } from "./types.js";
import { PROMPT } from "./types.js";

/**
 * ConsoleIO - Production I/O using node:readline/promises.
 * Handles echo-when-piped: when stdin is not a TTY, echoes "> input\n" to stdout.
 * Port of get_input() / echo_input() from misc.c:203-273.
 */
export class ConsoleIO implements GameIO {
  private rl: Interface;
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY === true,
    });
  }

  print(msg: string): void {
    process.stdout.write(msg);
  }

  async readline(prompt: string): Promise<string | null> {
    const displayPrompt = this.settings.prompt ? prompt : "";
    try {
      const line = await this.rl.question(displayPrompt);
      // Echo when piped (stdin is not a TTY)
      if (!process.stdin.isTTY) {
        process.stdout.write(displayPrompt + line + "\n");
      }
      // Log if logging is enabled
      if (this.settings.logfp) {
        this.settings.logfp(line);
      }
      return line;
    } catch {
      // EOF or error
      return null;
    }
  }

  close(): void {
    this.rl.close();
  }
}

/**
 * ScriptIO - Test I/O that reads from string array, captures output to buffer.
 * Used for regression testing to match C test infrastructure.
 */
export class ScriptIO implements GameIO {
  private lines: readonly string[];
  private index: number;
  private outputBuffer: string[];
  private settings: Settings;

  constructor(lines: readonly string[], settings: Settings) {
    this.lines = lines;
    this.index = 0;
    this.outputBuffer = [];
    this.settings = settings;
  }

  print(msg: string): void {
    this.outputBuffer.push(msg);
  }

  async readline(_prompt: string): Promise<string | null> {
    if (this.index >= this.lines.length) {
      return null;
    }
    const line = this.lines[this.index++]!;
    const displayPrompt = this.settings.prompt ? PROMPT : "";
    // Always echo in script mode (mimics piped behavior)
    this.outputBuffer.push(displayPrompt + line + "\n");
    // Log if logging is enabled
    if (this.settings.logfp) {
      this.settings.logfp(line);
    }
    return line;
  }

  getOutput(): string {
    return this.outputBuffer.join("");
  }

  getOutputLines(): string[] {
    return this.getOutput().split("\n");
  }
}
