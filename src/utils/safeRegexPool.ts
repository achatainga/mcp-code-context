import { Worker, isMainThread } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { existsSync } from "node:fs";

type WorkerJob = Record<string, unknown>;

const POOL_SIZE = 4;
let cachedWorkerFile: string | null = null;
let workerPool: Worker[] | null = null;
const idleWorkers: Worker[] = [];
const waitQueue: Array<(worker: Worker) => void> = [];

function getWorkerFile(): string {
  if (cachedWorkerFile) return cachedWorkerFile;

  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(thisDir, "safeRegex.js"),
    path.resolve(thisDir, "../../dist/src/utils/safeRegex.js"),
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

export async function runRegexWorkerJob<T>(
  data: WorkerJob,
  timeoutMs: number
): Promise<{ result?: T; timedOut?: boolean; error?: string }> {
  if (!isMainThread) {
    throw new Error("safeRegex: runRegexWorkerJob called from worker thread");
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
