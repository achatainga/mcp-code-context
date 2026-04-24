/**
 * Safe Regex - v3.5.2
 * CRITICAL FIX: Real ReDoS protection via worker_threads
 *
 * Problem: setTimeout cannot interrupt regex.test() in Node.js single-threaded event loop.
 * Solution: Execute regex in a Worker thread. If it exceeds timeout, worker.terminate() kills it.
 *
 * This file serves dual purpose:
 * - Main thread: exports safe regex functions that delegate to workers
 * - Worker thread: executes regex operations when loaded as a worker
 */

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { REGEX_TIMEOUT_MS } from './constants.js';

export interface RegexResult {
  success: boolean;
  matches?: RegExpMatchArray | null;
  error?: string;
  timedOut?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// WORKER THREAD EXECUTION
// Runs when this file is loaded as a Worker via new Worker(thisFile, { workerData })
// ─────────────────────────────────────────────────────────────────────────

if (!isMainThread && workerData) {
  const { pattern, flags, input, mode, lines } = workerData;
  const regex = new RegExp(pattern, flags);

  switch (mode) {
    case "test":
      parentPort?.postMessage({ matched: regex.test(input) });
      break;

    case "match":
      parentPort?.postMessage({ matches: input.match(regex) });
      break;

    case "batch_test": {
      // One worker per file: test each line, return matching indices
      const matches: Array<{ index: number; content: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          matches.push({ index: i, content: lines[i].trim() });
        }
      }
      parentPort?.postMessage({ matches });
      break;
    }

    case "batch_find_first": {
      // Find first matching line index
      let matchIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          matchIndex = i;
          break;
        }
      }
      parentPort?.postMessage({ matchIndex });
      break;
    }

    case "batch_multi_file": {
      // All files in one worker — eliminates N worker spawns in searchPattern
      // files: Array<{ path: string, lines: string[] }>
      const { files } = workerData;
      const fileResults: Array<{ file: string; index: number; content: string }> = [];
      for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(file.lines[i])) {
            fileResults.push({ file: file.path, index: i, content: file.lines[i].trim() });
          }
        }
      }
      parentPort?.postMessage({ results: fileResults });
      break;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN THREAD: Worker execution helper
// ─────────────────────────────────────────────────────────────────────────

const WORKER_FILE = fileURLToPath(import.meta.url);

function runInWorker<T>(data: Record<string, any>, timeoutMs: number): Promise<{ result?: T; timedOut?: boolean; error?: string }> {
  if (!isMainThread) {
    throw new Error("safeRegex: runInWorker called from worker thread — this is a bug");
  }
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_FILE, { workerData: data });
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve({ timedOut: true });
    }, timeoutMs);

    worker.on("message", (msg: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve({ result: msg });
    });

    worker.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error: err.message });
    });
  });
}

function extractPatternInfo(pattern: string | RegExp): { source: string; flags: string } {
  return {
    source: pattern instanceof RegExp ? pattern.source : pattern,
    flags: pattern instanceof RegExp ? pattern.flags : "",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API — Single operations
// ─────────────────────────────────────────────────────────────────────────

/**
 * Execute regex test with real timeout via worker_threads.
 * worker.terminate() can actually kill a stuck regex, unlike setTimeout.
 */
export async function safeRegexTest(
  pattern: string | RegExp,
  input: string,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; matched: boolean; error?: string; timedOut?: boolean }> {
  if (!isMainThread) return { success: false, matched: false };

  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runInWorker<{ matched: boolean }>(
    { pattern: source, flags, input, mode: "test" },
    timeoutMs
  );

  if (timedOut) return { success: false, matched: false, timedOut: true, error: `Regex exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, matched: false, error };
  return { success: true, matched: result!.matched };
}

/**
 * Execute regex match with real timeout via worker_threads.
 */
export async function safeRegexMatch(
  pattern: string | RegExp,
  input: string,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<RegexResult> {
  if (!isMainThread) return { success: false };

  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runInWorker<{ matches: RegExpMatchArray | null }>(
    { pattern: source, flags, input, mode: "match" },
    timeoutMs
  );

  if (timedOut) return { success: false, timedOut: true, error: `Regex exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, matches: result!.matches };
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API — Batch operations (one worker per file, loop inside worker)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Batch regex test: sends all lines to one worker, loops inside.
 * Returns matching line indices and trimmed content.
 * Use this for searchPattern — one worker per file, not per line.
 */
export async function safeRegexBatchTest(
  pattern: string | RegExp,
  lines: string[],
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; matches?: Array<{ index: number; content: string }>; timedOut?: boolean; error?: string }> {
  if (!isMainThread) return { success: false };

  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runInWorker<{ matches: Array<{ index: number; content: string }> }>(
    { pattern: source, flags, lines, mode: "batch_test" },
    timeoutMs
  );

  if (timedOut) return { success: false, timedOut: true, error: `Regex batch exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, matches: result!.matches };
}

/**
 * Batch find first matching line: one worker, returns index of first match.
 * Use this for readLines aroundPattern — avoids N worker spawns.
 */
export async function safeRegexFindFirst(
  pattern: string | RegExp,
  lines: string[],
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; matchIndex?: number; timedOut?: boolean; error?: string }> {
  if (!isMainThread) return { success: false };

  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runInWorker<{ matchIndex: number }>(
    { pattern: source, flags, lines, mode: "batch_find_first" },
    timeoutMs
  );

  if (timedOut) return { success: false, timedOut: true, error: `Regex search exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, matchIndex: result!.matchIndex };
}

/**
 * Multi-file batch regex test: ALL files processed in ONE worker spawn.
 * Eliminates N worker spawns for N files in searchPattern.
 * The worker loops all files×lines internally. If any line causes ReDoS,
 * the worker is terminated and the entire search times out safely.
 */
export async function safeRegexMultiFileBatchTest(
  pattern: string | RegExp,
  files: Array<{ path: string; lines: string[] }>,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; results?: Array<{ file: string; index: number; content: string }>; timedOut?: boolean; error?: string }> {
  if (!isMainThread) return { success: false };

  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runInWorker<{ results: Array<{ file: string; index: number; content: string }> }>(
    { pattern: source, flags, files, mode: "batch_multi_file" },
    timeoutMs
  );

  if (timedOut) return { success: false, timedOut: true, error: `Multi-file regex scan exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, results: result!.results };
}

// ─────────────────────────────────────────────────────────────────────────
// Pattern validation and sanitization (synchronous — no worker needed)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate regex pattern for safety
 */
export function validateRegexPattern(pattern: string): { safe: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check for catastrophic backtracking patterns
  const dangerousPatterns = [
    { pattern: /\([^)]*\+\)\+/, message: 'Nested quantifiers (a+)+ detected' },
    { pattern: /\([^)]*\*\)\*/, message: 'Nested quantifiers (a*)* detected' },
    { pattern: /\([^)]*\+\)\*/, message: 'Nested quantifiers (a+)* detected' },
    { pattern: /\([^)]*\*\)\+/, message: 'Nested quantifiers (a*)+ detected' },
    { pattern: /\([^|]*\|[^)]*\)\*/, message: 'Alternation with star (a|b)* detected' },
    { pattern: /\([^|]*\|[^)]*\)\+/, message: 'Alternation with plus (a|b)+ detected' },
  ];

  for (const { pattern: dangerousPattern, message } of dangerousPatterns) {
    if (dangerousPattern.test(pattern)) {
      issues.push(message);
    }
  }

  // Check for excessive repetition
  if (/\{(\d+),\}/.test(pattern)) {
    const match = pattern.match(/\{(\d+),\}/);
    if (match && parseInt(match[1]) > 1000) {
      issues.push('Excessive repetition {n,} with n > 1000');
    }
  }

  // Check for very long patterns (potential complexity)
  if (pattern.length > 500) {
    issues.push('Pattern exceeds 500 characters');
  }

  return {
    safe: issues.length === 0,
    issues,
  };
}

/**
 * Sanitize regex pattern (escape metacharacters)
 */
export function sanitizeRegexPattern(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create safe regex with validation
 */
export function createSafeRegex(
  pattern: string,
  flags?: string
): { regex: RegExp | null; error?: string } {
  const validation = validateRegexPattern(pattern);

  if (!validation.safe) {
    return {
      regex: null,
      error: `Unsafe regex pattern: ${validation.issues.join(', ')}`,
    };
  }

  try {
    const regex = new RegExp(pattern, flags);
    return { regex };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
