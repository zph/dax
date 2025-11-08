import * as path from "@std/path";
import { logger } from "./console/mod.ts";
import type { Reader } from "./pipes.ts";

interface Symbols {
  /** Use this symbol to enable the provided object to be written to in
   * an output redirect within a template literal expression.
   *
   * @example
   * ```ts
   * class MyClass {
   *   [$.symbols.writable](): WritableStream<Uint8Array> {
   *     // return a WritableStream here
   *   }
   * }
   * const myObj = new MyClass();
   * await $`echo 1 > ${myObj}`;
   * ```
   */
  readonly writable: symbol;
  /** Use this symbol to enable the provided object to be read from in
   * an input redirect within a template literal expression.
   *
   * @example
   * ```ts
   * class MyClass {
   *   [$.symbols.readable](): ReadableStream<Uint8Array> {
   *     // return a ReadableStream here
   *   }
   * }
   * const myObj = new MyClass();
   * await $`gzip < ${myObj}`;
   * ```
   */
  readonly readable: symbol;
}

export const symbols: Symbols = {
  writable: Symbol.for("dax.writableStream"),
  readable: Symbol.for("dax.readableStream"),
};

/** A timeout error. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
  }

  override get name(): string {
    return "TimeoutError";
  }
}

/**
 * Delay used for certain actions.
 *
 * @remarks Providing just a number will use milliseconds.
 */
export type Delay =
  | number
  | `${number}ms`
  | `${number}s`
  | `${number}m`
  | `${number}m${number}s`
  | `${number}h`
  | `${number}h${number}m`
  | `${number}h${number}m${number}s`;

/** An iterator that returns a new delay each time. */
export interface DelayIterator {
  next(): number;
}

export function formatMillis(ms: number) {
  if (ms < 1000) {
    return `${formatValue(ms)} millisecond${ms === 1 ? "" : "s"}`;
  } else if (ms < 60 * 1000) {
    const s = ms / 1000;
    return `${formatValue(s)} ${pluralize("second", s)}`;
  } else {
    const mins = ms / 60 / 1000;
    return `${formatValue(mins)} ${pluralize("minute", mins)}`;
  }

  function formatValue(value: number) {
    const text = value.toFixed(2);
    if (text.endsWith(".00")) {
      return value.toFixed(0);
    } else if (text.endsWith("0")) {
      return value.toFixed(1);
    } else {
      return text;
    }
  }

  function pluralize(text: string, value: number) {
    const suffix = value === 1 ? "" : "s";
    return text + suffix;
  }
}

export function delayToIterator(delay: Delay | DelayIterator): DelayIterator {
  if (typeof delay !== "number" && typeof delay !== "string") {
    return delay;
  }
  const ms = delayToMs(delay);
  return {
    next() {
      return ms;
    },
  };
}

export function delayToMs(delay: Delay) {
  if (typeof delay === "number") {
    return delay;
  } else if (typeof delay === "string") {
    // code seems kind of repetitive
    const msMatch = delay.match(/^([0-9]+)ms$/);
    if (msMatch != null) {
      return parseInt(msMatch[1], 10);
    }
    const secondsMatch = delay.match(/^([0-9]+\.?[0-9]*)s$/);
    if (secondsMatch != null) {
      return Math.round(parseFloat(secondsMatch[1]) * 1000);
    }
    const minutesMatch = delay.match(/^([0-9]+\.?[0-9]*)m$/);
    if (minutesMatch != null) {
      return Math.round(parseFloat(minutesMatch[1]) * 1000 * 60);
    }
    const minutesSecondsMatch = delay.match(/^([0-9]+\.?[0-9]*)m([0-9]+\.?[0-9]*)s$/);
    if (minutesSecondsMatch != null) {
      return Math.round(
        parseFloat(minutesSecondsMatch[1]) * 1000 * 60
          + parseFloat(minutesSecondsMatch[2]) * 1000,
      );
    }
    const hoursMatch = delay.match(/^([0-9]+\.?[0-9]*)h$/);
    if (hoursMatch != null) {
      return Math.round(parseFloat(hoursMatch[1]) * 1000 * 60 * 60);
    }
    const hoursMinutesMatch = delay.match(/^([0-9]+\.?[0-9]*)h([0-9]+\.?[0-9]*)m$/);
    if (hoursMinutesMatch != null) {
      return Math.round(
        parseFloat(hoursMinutesMatch[1]) * 1000 * 60 * 60
          + parseFloat(hoursMinutesMatch[2]) * 1000 * 60,
      );
    }
    const hoursMinutesSecondsMatch = delay.match(/^([0-9]+\.?[0-9]*)h([0-9]+\.?[0-9]*)m([0-9]+\.?[0-9]*)s$/);
    if (hoursMinutesSecondsMatch != null) {
      return Math.round(
        parseFloat(hoursMinutesSecondsMatch[1]) * 1000 * 60 * 60
          + parseFloat(hoursMinutesSecondsMatch[2]) * 1000 * 60
          + parseFloat(hoursMinutesSecondsMatch[3]) * 1000,
      );
    }
  }

  throw new Error(`Unknown delay value: ${delay}`);
}

export function filterEmptyRecordValues<TValue>(record: Record<string, TValue | undefined>): Record<string, TValue> {
  const result: Record<string, TValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value != null) {
      result[key] = value;
    }
  }
  return result;
}

export function resolvePath(cwd: string, arg: string) {
  return path.resolve(path.isAbsolute(arg) ? arg : path.join(cwd, arg));
}

export class Box<T> {
  constructor(public value: T) {
  }
}

export class TreeBox<T> {
  #value: T | TreeBox<T>;

  constructor(value: T | TreeBox<T>) {
    this.#value = value;
  }

  getValue() {
    let tree: TreeBox<T> = this;
    while (tree.#value instanceof TreeBox) {
      tree = tree.#value;
    }
    return tree.#value;
  }

  setValue(value: T) {
    this.#value = value;
  }

  createChild(): TreeBox<T> {
    return new TreeBox(this);
  }
}

/** A special kind of tree box that handles logging with static text. */
export class LoggerTreeBox extends TreeBox<(...args: any[]) => void> {
  override getValue(): (...args: any[]) => void {
    const innerValue = super.getValue();
    return (...args: any[]) => {
      return logger.withTempClear(() => {
        innerValue(...args);
      });
    };
  }
}

/** lstat that doesn't throw when the path is not found. */
export async function safeLstat(path: string) {
  try {
    return await Deno.lstat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return undefined;
    } else {
      throw err;
    }
  }
}

export function getFileNameFromUrl(url: string | URL) {
  const parsedUrl = url instanceof URL ? url : new URL(url);
  const fileName = parsedUrl.pathname.split("/").at(-1);
  return fileName?.length === 0 ? undefined : fileName;
}

/**
 * Gets an executable shebang from the provided file path.
 * @returns
 * - An object outlining information about the shebang.
 * - `undefined` if the file exists, but doesn't have a shebang.
 * - `false` if the file does NOT exist.
 */
export async function getExecutableShebangFromPath(path: string) {
  try {
    const file = await Deno.open(path, { read: true });
    try {
      return await getExecutableShebang(file);
    } finally {
      try {
        file.close();
      } catch {
        // ignore
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

export interface ShebangInfo {
  stringSplit: boolean;
  command: string;
}

const decoder = new TextDecoder();
export async function getExecutableShebang(reader: Reader): Promise<ShebangInfo | undefined> {
  const text = "#!/usr/bin/env ";
  const buffer = new Uint8Array(text.length);
  const bytesReadCount = await reader.read(buffer);
  if (bytesReadCount !== text.length || decoder.decode(buffer) !== text) {
    return undefined;
  }
  const line = (await readFirstLine(reader)).trim();
  if (line.length === 0) {
    return undefined;
  }
  const dashS = "-S ";
  if (line.startsWith(dashS)) {
    return {
      stringSplit: true,
      command: line.slice(dashS.length),
    };
  } else {
    return {
      stringSplit: false,
      command: line,
    };
  }
}

async function readFirstLine(reader: Reader) {
  const chunkSize = 1024;
  const chunkBuffer = new Uint8Array(chunkSize);
  const collectedChunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const bytesRead = await reader.read(chunkBuffer);
    if (bytesRead == null || bytesRead === 0) {
      break;
    }
    const currentChunk = chunkBuffer.subarray(0, bytesRead);
    const newlineIndex = currentChunk.indexOf(0x0A);

    if (newlineIndex !== -1) {
      collectedChunks.push(currentChunk.subarray(0, newlineIndex));
      totalLength += newlineIndex;
      break;
    } else {
      collectedChunks.push(currentChunk);
      totalLength += bytesRead;
    }
  }

  const finalBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of collectedChunks) {
    finalBytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(finalBytes);
}

export function abortSignalToPromise(signal: AbortSignal) {
  const { resolve, promise } = Promise.withResolvers<void>();

  const listener = () => {
    signal.removeEventListener("abort", listener);
    resolve();
  };
  signal.addEventListener("abort", listener);
  return {
    [Symbol.dispose]() {
      signal.removeEventListener("abort", listener);
    },
    promise,
  };
}

const nodeENotEmpty = "ENOTEMPTY: ";
const nodeENOENT = "ENOENT: ";

export function errorToString(err: unknown) {
  let message: string;
  if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  if (message.startsWith(nodeENotEmpty)) {
    return message.slice(nodeENotEmpty.length);
  } else if (message.startsWith(nodeENOENT)) {
    return message.slice(nodeENOENT.length);
  } else {
    return message;
  }
}

/**
 * Detects if the current environment has issues with stdio inheritance.
 * Returns true for Jupyter notebooks, nested dax execution, or other
 * non-interactive environments where stdio inheritance may fail.
 */
export function shouldUsePipedStdio(): boolean {
  // Check if we're in a Jupyter environment
  if (typeof Deno !== "undefined") {
    // Check for Deno.jupyter API (if it exists)
    if ("jupyter" in Deno) {
      return true;
    }

    // Check for Jupyter environment variables
    try {
      const jupyterEnvVars = [
        "JUPYTER_RUNTIME_DIR",
        "JPY_SESSION_NAME",
        "JUPYTER_CONFIG_DIR",
        "KERNEL_ID",
      ];

      for (const envVar of jupyterEnvVars) {
        if (Deno.env.get(envVar)) {
          return true;
        }
      }
    } catch {
      // Env access denied, continue with other checks
    }
  }

  // Check if stdin/stdout/stderr are not TTY (indicates piped/redirected)
  // This helps detect nested execution scenarios
  try {
    if (typeof Deno !== "undefined" && Deno.stdin) {
      const isInteractive = Deno.stdin.isTerminal?.() ?? true;
      const stdoutIsTerminal = Deno.stdout.isTerminal?.() ?? true;

      // If both stdin and stdout are not terminals, we're likely in a
      // non-interactive context where inheritance might fail
      if (!isInteractive && !stdoutIsTerminal) {
        return true;
      }
    }
  } catch {
    // If we can't check TTY status, err on the side of caution
    // Don't assume piped mode just because we can't check
    return false;
  }

  return false;
}

/**
 * Gets the recommended default stdio kind based on the environment.
 * Can be overridden with DAX_STDIO_MODE environment variable.
 */
export function getDefaultStdioKind(): "inherit" | "inheritPiped" {
  // Check for explicit override via environment variable
  try {
    const override = Deno.env.get("DAX_STDIO_MODE");
    if (override === "piped" || override === "inheritPiped") {
      return "inheritPiped";
    }
    if (override === "inherit") {
      return "inherit";
    }
  } catch {
    // Environment access denied, continue with auto-detection
  }

  // Auto-detect based on environment
  return shouldUsePipedStdio() ? "inheritPiped" : "inherit";
}
