/**
 * Safe regex public API — all execution routed through worker pool
 */

import { isMainThread } from "node:worker_threads";
import { REGEX_TIMEOUT_MS } from "./constants.js";
import { validateRegexPattern } from "./regexValidator.js";
import { runRegexWorkerJob } from "./safeRegexPool.js";

export interface RegexResult {
  success: boolean;
  matches?: RegExpMatchArray | null;
  error?: string;
  timedOut?: boolean;
}

function extractPatternInfo(pattern: string | RegExp): { source: string; flags: string } {
  return {
    source: pattern instanceof RegExp ? pattern.source : pattern,
    flags: pattern instanceof RegExp ? pattern.flags : "",
  };
}

export async function safeRegexTest(
  pattern: string | RegExp,
  input: string,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; matched: boolean; error?: string; timedOut?: boolean }> {
  if (!isMainThread) return { success: false, matched: false };
  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runRegexWorkerJob<{ matched: boolean }>(
    { pattern: source, flags, input, mode: "test" },
    timeoutMs
  );
  if (timedOut) return { success: false, matched: false, timedOut: true, error: `Regex exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, matched: false, error };
  return { success: true, matched: result!.matched };
}

export async function safeRegexMatch(
  pattern: string | RegExp,
  input: string,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<RegexResult> {
  if (!isMainThread) return { success: false };
  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runRegexWorkerJob<{ matches: RegExpMatchArray | null }>(
    { pattern: source, flags, input, mode: "match" },
    timeoutMs
  );
  if (timedOut) return { success: false, timedOut: true, error: `Regex exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, matches: result!.matches };
}

export async function safeRegexBatchTest(
  pattern: string | RegExp,
  lines: string[],
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; matches?: Array<{ index: number; content: string }>; timedOut?: boolean; error?: string }> {
  if (!isMainThread) return { success: false };
  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runRegexWorkerJob<{ matches: Array<{ index: number; content: string }> }>(
    { pattern: source, flags, lines, mode: "batch_test" },
    timeoutMs
  );
  if (timedOut) return { success: false, timedOut: true, error: `Regex batch exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, matches: result!.matches };
}

export async function safeRegexFindFirst(
  pattern: string | RegExp,
  lines: string[],
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; matchIndex?: number; timedOut?: boolean; error?: string }> {
  if (!isMainThread) return { success: false };
  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runRegexWorkerJob<{ matchIndex: number }>(
    { pattern: source, flags, lines, mode: "batch_find_first" },
    timeoutMs
  );
  if (timedOut) return { success: false, timedOut: true, error: `Regex search exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, matchIndex: result!.matchIndex };
}

export async function safeRegexAnyTest(
  patterns: string[],
  input: string,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; matched: boolean; timedOut?: boolean; error?: string }> {
  if (!isMainThread) return { success: false, matched: false };
  for (const pattern of patterns) {
    const validation = validateRegexPattern(pattern);
    if (!validation.safe) {
      return { success: false, matched: false, error: `Unsafe regex pattern: ${validation.issues.join(", ")}` };
    }
  }
  const { result, timedOut, error } = await runRegexWorkerJob<{ matched: boolean }>(
    { patterns, input, flags: "", mode: "any_test" },
    timeoutMs
  );
  if (timedOut) return { success: false, matched: false, timedOut: true, error: `Regex exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, matched: false, error };
  return { success: true, matched: result!.matched };
}

export async function safeRegexReplaceAll(
  pattern: string,
  replacement: string,
  input: string,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; output?: string; timedOut?: boolean; error?: string }> {
  if (!isMainThread) return { success: false };
  const validation = validateRegexPattern(pattern);
  if (!validation.safe) {
    return { success: false, error: `Unsafe regex pattern: ${validation.issues.join(", ")}` };
  }
  const { result, timedOut, error } = await runRegexWorkerJob<{ output: string }>(
    { pattern, flags: "g", input, replacement, mode: "replace_all" },
    timeoutMs
  );
  if (timedOut) return { success: false, timedOut: true, error: `Regex replace exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, output: result!.output };
}

export async function safeRegexMultiFileBatchTest(
  pattern: string | RegExp,
  files: Array<{ path: string; lines: string[] }>,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; results?: Array<{ file: string; index: number; content: string }>; timedOut?: boolean; error?: string }> {
  if (!isMainThread) return { success: false };
  const { source, flags } = extractPatternInfo(pattern);
  const { result, timedOut, error } = await runRegexWorkerJob<{ results: Array<{ file: string; index: number; content: string }> }>(
    { pattern: source, flags, files, mode: "batch_multi_file" },
    timeoutMs
  );
  if (timedOut) return { success: false, timedOut: true, error: `Multi-file regex scan exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, results: result!.results };
}
