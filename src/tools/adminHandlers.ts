/** Tool handlers */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { SecurityValidator } from "../core/validator.js";
import { replaceSymbol, insertCode, removeSymbol, writeFile, renameSymbol } from "../operations/write.js";
import { extractSymbol, readLines, searchPattern, analyzeImpact, searchSymbols, explainSymbol, batchRead } from "../operations/read.js";
import { compressRepository } from "../operations/compress.js";
import { globalAuditLogger } from "../utils/auditLogger.js";
import { globalTelemetry } from "../utils/telemetry.js";
import { OPERATION_COSTS } from "../utils/rateLimiter.js";
import { streamFile } from "../utils/streaming.js";
import { BackupManager } from "../utils/backupManager.js";
import { globalSessionManager } from "../core/sessionManager.js";
import { verifyFileUnchanged, assertNoPendingWriteConflict } from "../utils/toctou.js";
import { getSession, getCacheManager, getRegistry, SESSION_ID } from "./context.js";

export async function handleRollbackFile(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);
  const steps = args.steps ? Number(args.steps) : 1;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const result = await BackupManager.rollback(validation.resolvedPath!, projectRoot, steps);
  if (!result.success) throw new Error(result.error);

  return { content: [{ type: "text", text: `Successfully rolled back ${path.basename(filePath)} from backup: ${result.restoredFrom}` }] };
}

export async function handleCleanBackups(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);

  const validator = new SecurityValidator(projectRoot);
  // Just validate projectRoot is a valid directory
  const validation = await validator.validateFilePath(projectRoot);
  if (!validation.valid) throw new Error(validation.error);

  const result = await BackupManager.clean(projectRoot);
  if (!result.success) throw new Error(result.error);

  return { content: [{ type: "text", text: `Successfully cleaned backups. Deleted ${result.deletedCount} backup files.` }] };
}

export async function handleGetServerStats() {
  const telemetry = globalTelemetry.getSummary();
  const audit = globalAuditLogger.getStats();
  const session = getSession();
  const tokensAvailable = session.rateLimiter.getTokens(SESSION_ID);

  const stats = {
    pendingConfirmations: session.confirmationStore.getPendingCount(),
    rateLimiter: {
      tokensAvailable,
      maxTokens: 100,
      refillRate: "10 tokens/second",
      operationCosts: OPERATION_COSTS,
    },
    telemetry,
    audit,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
  };
}

export async function handleGetCacheStats(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const cache = getCacheManager(projectRoot);
  const stats = await cache.getStats();
  
  return {
    content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
  };
}

export async function handleClearCache(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const cache = getCacheManager(projectRoot);
  await cache.clear();
  
  return {
    content: [{ type: "text", text: "Cache cleared successfully" }],
  };
}

export async function handleConfigureFileWatcher(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const action = String(args.action);
  const debounceMs = args.debounceMs ? Number(args.debounceMs) : 500;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(projectRoot);
  if (!validation.valid) throw new Error(validation.error);

  const cache = getCacheManager(projectRoot);
  
  if (action === "start") {
    cache.startWatcher(debounceMs);
    return {
      content: [{ type: "text", text: `File watcher started with ${debounceMs}ms debounce` }],
    };
  } else if (action === "stop") {
    cache.stopWatcher();
    return {
      content: [{ type: "text", text: "File watcher stopped" }],
    };
  } else {
    throw new Error(`Invalid action: ${action}`);
  }
}

export async function handleGetFileWatcherStatus(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const cache = getCacheManager(projectRoot);
  const status = cache.getWatcherStatus();
  
  return {
    content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
  };
}

export async function handleGetRateLimitStatus() {
  const session = getSession();
  const tokensAvailable = session.rateLimiter.getTokens(SESSION_ID);
  const result = {
    tokensAvailable,
    maxTokens: 100,
    refillRate: "10 tokens/second",
    canAfford: Object.fromEntries(
      Object.entries(OPERATION_COSTS).map(([op, cost]) => [op, tokensAvailable >= cost])
    ),
    operationCosts: OPERATION_COSTS,
  };
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}


export async function handleGetSessionStats() {
  const stats = globalSessionManager.getSessionStats(SESSION_ID);
  return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
}

export async function handleClearSessionCache(args: Record<string, unknown>) {
  const projectRoot = args.projectRoot ? String(args.projectRoot) : undefined;
  const cleared = await globalSessionManager.clearSessionCache(SESSION_ID, projectRoot);
  return { content: [{ type: "text", text: JSON.stringify({ cacheEntriesCleared: cleared }, null, 2) }] };
}

export async function handleListPendingOperations() {
  const ops = globalSessionManager.listPendingOperations(SESSION_ID);
  return { content: [{ type: "text", text: JSON.stringify({ pendingOperations: ops, count: ops.length }, null, 2) }] };
}
