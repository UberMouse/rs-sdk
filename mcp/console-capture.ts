/**
 * Bounded console capture for execute_code.
 *
 * Captured output used to be an unbounded array. A script that logs from a
 * tight loop (e.g. a catch block with no await, retrying a call that throws
 * synchronously) never yields, so the execution timeout can't fire and the
 * array grows until the process - and the sandbox with it - runs out of
 * memory. Keep the first `headMax` and last `tailMax` lines, clip long lines,
 * and count everything dropped in between so memory stays constant.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const CONSOLE_HEAD_LINES = 300;
export const CONSOLE_TAIL_LINES = 300;
export const CONSOLE_MAX_LINE_CHARS = 2000;

export class ConsoleCapture {
  private readonly head: string[] = [];
  private readonly tail: string[] = []; // ring buffer once full
  private tailStart = 0;
  private omitted = 0;

  constructor(
    private readonly headMax = CONSOLE_HEAD_LINES,
    private readonly tailMax = CONSOLE_TAIL_LINES,
    private readonly maxLineChars = CONSOLE_MAX_LINE_CHARS,
  ) {}

  push(line: string): void {
    if (line.length > this.maxLineChars) {
      line = `${line.slice(0, this.maxLineChars)} … [${line.length - this.maxLineChars} more chars]`;
    }
    if (this.head.length < this.headMax) {
      this.head.push(line);
    } else if (this.tail.length < this.tailMax) {
      this.tail.push(line);
    } else if (this.tailMax === 0) {
      this.omitted++;
    } else {
      this.tail[this.tailStart] = line;
      this.tailStart = (this.tailStart + 1) % this.tailMax;
      this.omitted++;
    }
  }

  /** Number of lines retained (not counting omitted ones). */
  get length(): number {
    return this.head.length + this.tail.length;
  }

  /** Total lines logged, including omitted ones. */
  get total(): number {
    return this.length + this.omitted;
  }

  lines(): string[] {
    const tail = this.tail.slice(this.tailStart).concat(this.tail.slice(0, this.tailStart));
    if (this.omitted === 0) return this.head.concat(tail);
    const marker = `… ${this.omitted} line(s) omitted - console output keeps the first ${this.headMax} and last ${this.tailMax} lines …`;
    return [...this.head, marker, ...tail];
  }
}

// Errors need special-casing: JSON.stringify(new Error(...)) is '{}',
// which used to swallow every console.log(err) into two braces.
export function formatLogArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a, null, 2) ?? String(a); } catch { return String(a); }
  }
  return String(a);
}

/**
 * Per-call routing of console.log/warn for an MCP server whose stdout is the JSON-RPC channel.
 * installConsoleRouting() patches console once: inside runCaptured(capture, fn) output goes to that
 * call's capture (AsyncLocalStorage follows the call through awaits and timers, so overlapping
 * calls never see each other's output); everywhere else it goes to stderr, never stdout. Patching
 * once replaces per-call save-and-restore, which overlapping calls undid in the wrong order.
 */
const current = new AsyncLocalStorage<ConsoleCapture>();
let installed = false;

export function installConsoleRouting(): void {
  if (installed) return;
  installed = true;
  const stderr = console.error.bind(console);
  console.log = (...args: unknown[]) => {
    const capture = current.getStore();
    if (capture) capture.push(args.map(formatLogArg).join(' '));
    else stderr(...args);
  };
  console.warn = (...args: unknown[]) => {
    const capture = current.getStore();
    if (capture) capture.push('[warn] ' + args.map(formatLogArg).join(' '));
    else stderr(...args);
  };
}

export function runCaptured<T>(capture: ConsoleCapture, fn: () => T): T {
  return current.run(capture, fn);
}
