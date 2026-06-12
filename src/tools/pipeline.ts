import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { globalTelemetry } from "../utils/telemetry.js";
import { globalAuditLogger } from "../utils/auditLogger.js";
import { OPERATION_COSTS } from "../utils/rateLimiter.js";
import { WRITE_OPS } from "./toolDefinitions.js";
import { getSession, SESSION_ID } from "./context.js";
import * as handlers from "./handlers.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<any>;

/** Tool registry — replaces switch-case for O(1) dispatch and easy extensibility */
const TOOL_REGISTRY = new Map<string, ToolHandler>([
  // Read operations
  ["get_semantic_repo_map", handlers.handleGetSemanticRepoMap],
  ["read_file_surgical", handlers.handleReadFileSurgical],
  ["analyze_impact", handlers.handleAnalyzeImpact],
  ["read_file_lines", handlers.handleReadFileLines],
  ["search_code_pattern", handlers.handleSearchCodePattern],
  ["parse_file", handlers.handleParseFile],
  ["search_symbols", handlers.handleSearchSymbols],
  ["explain_symbol", handlers.handleExplainSymbol],
  ["batch_read", handlers.handleBatchRead],
  // Write operations
  ["write_file_surgical", handlers.handleWriteFileSurgical],
  ["insert_symbol", handlers.handleInsertSymbol],
  ["remove_symbol", handlers.handleRemoveSymbol],
  ["rename_symbol", handlers.handleRenameSymbol],
  ["ast_transform", handlers.handleAstTransform],
  // Admin operations
  ["rollback_file", handlers.handleRollbackFile],
  ["clean_backups", handlers.handleCleanBackups],
  ["get_server_stats", () => handlers.handleGetServerStats()],
  ["get_cache_stats", handlers.handleGetCacheStats],
  ["clear_cache", handlers.handleClearCache],
  ["configure_file_watcher", handlers.handleConfigureFileWatcher],
  ["get_file_watcher_status", handlers.handleGetFileWatcherStatus],
  ["get_rate_limit_status", () => handlers.handleGetRateLimitStatus()],
  ["get_session_stats", () => handlers.handleGetSessionStats()],
  ["clear_session_cache", handlers.handleClearSessionCache],
  ["list_pending_operations", () => handlers.handleListPendingOperations()],
]);

function redactSensitiveFields(args: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = ["newContent", "code", "content"];
  const safe = { ...args };
  for (const key of SENSITIVE_KEYS) {
    if (key in safe && typeof safe[key] === "string") {
      safe[key] = `[REDACTED: ${(safe[key] as string).length} chars]`;
    }
  }
  return safe;
}

/** Register a new tool handler at runtime */
export function registerTool(name: string, handler: ToolHandler): void {
  TOOL_REGISTRY.set(name, handler);
}

export function registerPipeline(server: Server) {
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startTime = Date.now();
    let success = false;
    let lockReleased = false;
    let lockRelease: (() => Promise<void>) | null = null;

    try {
      const session = getSession();

      const cost = OPERATION_COSTS[name as keyof typeof OPERATION_COSTS] ?? 1;
      const rateCheck = await session.rateLimiter.checkLimit(SESSION_ID, cost);
      if (!rateCheck.allowed) {
        throw new Error(`Rate limit exceeded for tool: ${name}. Retry after ${rateCheck.retryAfter}ms`);
      }

      if (WRITE_OPS.has(name) && args && args.filePath) {
        lockRelease = await session.lockManager.acquireLock(String(args.filePath));
      }

      const handler = TOOL_REGISTRY.get(name);
      if (!handler) throw new Error(`Unknown tool: ${name}`);

      const result = await handler(args as Record<string, unknown>);

      success = true;
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    } finally {
      const duration = Date.now() - startTime;

      if (lockRelease && !lockReleased) {
        await lockRelease();
        lockReleased = true;
      }

      globalTelemetry.recordOperation({ toolName: name, duration, success });
      const safeDetails = args ? redactSensitiveFields(args as Record<string, unknown>) : {};
      globalAuditLogger.log({
        level: success ? "info" : "error",
        operation: name,
        details: safeDetails,
        result: success ? "success" : "failure",
      });
    }
  });
}
