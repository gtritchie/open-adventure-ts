/*
 * I/O implementations - ConsoleIO and ScriptIO.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { createInterface, type Interface } from "node:readline/promises";
import type { GameIO, Settings } from "./types.js";

/**
 * ConsoleIO - Production I/O using node:readline/promises.
 * Port of myreadline() from misc.c.
 *
 * Echo and logging are NOT done here — they are handled by getInput()
 * in input.ts after comment filtering, matching C's get_input() in misc.c:234-273.
 *
 * Uses an async line iterator internally because readline.question()
 * doesn't work reliably with piped (non-TTY) input in Node.js — only
 * the first question() resolves; subsequent calls hang indefinitely.
 * In TTY mode, question() works fine and is used for prompt display.
 */
export class ConsoleIO implements GameIO {
  private rl: Interface;
  readonly echoInput: boolean;
  private isTTY: boolean;
  private lineIterator: AsyncIterableIterator<string> | null = null;

  constructor(settings: Settings) {
    this.isTTY = process.stdin.isTTY === true;
    this.echoInput = !this.isTTY;
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: this.isTTY,
    });
    // For piped input, use async line iterator
    if (!this.isTTY) {
      this.lineIterator = this.rl[Symbol.asyncIterator]();
    }
  }

  print(msg: string): void {
    process.stdout.write(msg);
  }

  async readline(prompt: string): Promise<string | null> {
    try {
      if (this.isTTY) {
        // TTY mode: question() displays the prompt and reads a line
        const line = await this.rl.question(prompt);
        return line;
      } else {
        // Piped mode: use the line iterator (question() hangs after first call)
        const result = await this.lineIterator!.next();
        if (result.done) {
          // Print prompt at EOF (matching C main.c:58 — fputs(prompt, stdout) on NULL)
          process.stdout.write(prompt);
          return null;
        }
        return result.value;
      }
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
 *
 * Like ConsoleIO in piped mode, echo and logging are handled by getInput().
 */
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
    if (this.index >= this.lines.length) {
      return null;
    }
    const line = this.lines[this.index++]!;
    return line;
  }

  getOutput(): string {
    return this.outputBuffer.join("");
  }

  getOutputLines(): string[] {
    return this.getOutput().split("\n");
  }
}
