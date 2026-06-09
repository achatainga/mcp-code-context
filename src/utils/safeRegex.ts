import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { REGEX_TIMEOUT_MS } from "./constants.js";

export {
  validateRegexPattern,
  sanitizeRegexPattern,
  createSafeRegex,
} from "./regexValidator.js";

export interface RegexResult {
  success: boolean;
  matches?: RegExpMatchArray | null;
  error?: string;
  timedOut?: boolean;
}

type WorkerJob = Record<string, unknown>;

function executeRegexJob(data: WorkerJob): unknown {
  const { pattern, flags, input, mode, lines, files } = data as {
    pattern: string;
    flags: string;
    input?: string;
    mode: string;
    lines?: string[];
    files?: Array<{ path: string; lines: string[] }>;
  };

  const regex = new RegExp(pattern, flags);

  switch (mode) {
    case "test":
      return { matched: regex.test(input ?? "") };
    case "match":
      return { matches: (input ?? "").match(regex) };
    case "batch_test": {
      const matches: Array<{ index: number; content: string }> = [];
      for (let i = 0; i < (lines?.length ?? 0); i++) {
        regex.lastIndex = 0;
        if (regex.test(lines![i])) {
          matches.push({ index: i, content: lines![i].trim() });
        }
      }
      return { matches };
    }
    case "batch_find_first": {
      let matchIndex = -1;
      for (let i = 0; i < (lines?.length ?? 0); i++) {
        regex.lastIndex = 0;
        if (regex.test(lines![i])) {
          matchIndex = i;
          break;
        }
      }
      return { matchIndex };
    }
    case "batch_multi_file": {
      const fileResults: Array<{ file: string; index: number; content: string }> = [];
      for (const file of files ?? []) {
        for (let i = 0; i < file.lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(file.lines[i])) {
            fileResults.push({ file: file.path, index: i, content: file.lines[i].trim() });
          }
        }
      }
      return { results: fileResults };
    }
    default:
      throw new Error(`Unknown regex worker mode: ${mode}`);
  }
}

if (!isMainThread) {
  const runAndReply = (data: WorkerJob) => {
    try {
      parentPort?.postMessage(executeRegexJob(data));
    } catch (err) {
      parentPort?.postMessage({
        __error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (workerData) {
    runAndReply(workerData as WorkerJob);
  } else {
    parentPort?.on("message", runAndReply);
  }
}

const POOL_SIZE = 4;
let cachedWorkerFile: string | null = null;
let workerPool: Worker[] | null = null;
const idleWorkers: Worker[] = [];
const waitQueue: Array<(worker: Worker) => void> = [];

function getWorkerFile(): string {
  if (cachedWorkerFile) return cachedWorkerFile;

  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(thisDir, "../../dist/src/utils/safeRegex.js"),
    fileURLToPath(import.meta.url),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedWorkerFile = candidate;
      return candidate;
    }
  }

  throw new Error("safeRegex worker file not found. Run: npm run build");
}

function spawnWorker(): Worker {
  const worker = new Worker(getWorkerFile());
  worker.on("error", () => replaceWorker(worker));
  return worker;
}

function initPool(): void {
  if (workerPool) return;
  workerPool = Array.from({ length: POOL_SIZE }, () => spawnWorker());
  idleWorkers.push(...workerPool);
}

function replaceWorker(dead: Worker): void {
  if (!workerPool) return;
  const idx = workerPool.indexOf(dead);
  if (idx >= 0) {
    const replacement = spawnWorker();
    workerPool[idx] = replacement;
    idleWorkers.push(replacement);
    const waiter = waitQueue.shift();
    if (waiter) {
      idleWorkers.pop();
      waiter(replacement);
    }
  }
}

function acquireWorker(): Promise<Worker> {
  initPool();
  const worker = idleWorkers.pop();
  if (worker) return Promise.resolve(worker);
  return new Promise((resolve) => waitQueue.push(resolve));
}

function releaseWorker(worker: Worker): void {
  const waiter = waitQueue.shift();
  if (waiter) {
    waiter(worker);
  } else {
    idleWorkers.push(worker);
  }
}

async function runInWorker<T>(
  data: WorkerJob,
  timeoutMs: number
): Promise<{ result?: T; timedOut?: boolean; error?: string }> {
  if (!isMainThread) {
    throw new Error("safeRegex: runInWorker called from worker thread");
  }

  const worker = await acquireWorker();

  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.removeAllListeners("message");
      worker.terminate();
      replaceWorker(worker);
      resolve({ timedOut: true });
    }, timeoutMs);

    const onMessage = (msg: T & { __error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.off("message", onMessage);
      releaseWorker(worker);

      if (msg && typeof msg === "object" && "__error" in msg) {
        resolve({ error: msg.__error });
      } else {
        resolve({ result: msg });
      }
    };

    worker.on("message", onMessage);
    worker.postMessage(data);
  });
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
  const { result, timedOut, error } = await runInWorker<{ matched: boolean }>(
    { pattern: source, flags, input, mode: "test" },
    timeoutMs
  );

  if (timedOut) {
    return { success: false, matched: false, timedOut: true, error: `Regex exceeded ${timeoutMs}ms (ReDoS prevented)` };
  }
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
  const { result, timedOut, error } = await runInWorker<{ matches: RegExpMatchArray | null }>(
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
  const { result, timedOut, error } = await runInWorker<{ matches: Array<{ index: number; content: string }> }>(
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
  const { result, timedOut, error } = await runInWorker<{ matchIndex: number }>(
    { pattern: source, flags, lines, mode: "batch_find_first" },
    timeoutMs
  );

  if (timedOut) return { success: false, timedOut: true, error: `Regex search exceeded ${timeoutMs}ms (ReDoS prevented)` };
  if (error) return { success: false, error };
  return { success: true, matchIndex: result!.matchIndex };
}

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

  if (timedOut) {
    return { success: false, timedOut: true, error: `Multi-file regex scan exceeded ${timeoutMs}ms (ReDoS prevented)` };
  }
  if (error) return { success: false, error };
  return { success: true, results: result!.results };
}
