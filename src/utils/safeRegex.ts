import { isMainThread, parentPort, workerData } from "node:worker_threads";

export {
  validateRegexPattern,
  sanitizeRegexPattern,
  createSafeRegex,
} from "./regexValidator.js";

export {
  safeRegexTest,
  safeRegexMatch,
  safeRegexBatchTest,
  safeRegexFindFirst,
  safeRegexAnyTest,
  safeRegexReplaceAll,
  safeRegexMultiFileBatchTest,
  type RegexResult,
} from "./safeRegexApi.js";

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
    case "any_test": {
      const patterns = (data.patterns as string[]) ?? [];
      for (const p of patterns) {
        const r = new RegExp(p, flags);
        r.lastIndex = 0;
        if (r.test(input ?? "")) return { matched: true };
      }
      return { matched: false };
    }
    case "replace_all": {
      regex.lastIndex = 0;
      return { output: (input ?? "").replace(regex, data.replacement as string) };
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
