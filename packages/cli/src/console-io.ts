/*
 * ConsoleIO - production GameIO using node:readline/promises.
 *
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
 * SPDX-License-Identifier: BSD-2-Clause
 */
import { createInterface, type Interface } from "node:readline/promises";
import type { GameIO, Settings } from "@open-adventure/core";

/**
 * Production I/O using node:readline/promises.
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

  constructor(_settings: Settings) {
    this.isTTY = process.stdin.isTTY === true;
    this.echoInput = !this.isTTY;
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: this.isTTY,
    });
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
        return await this.rl.question(prompt);
      } else {
        const result = await this.lineIterator!.next();
        if (result.done) {
          process.stdout.write(prompt);
          return null;
        }
        return result.value;
      }
    } catch {
      return null;
    }
  }

  close(): void {
    this.rl.close();
  }
}
