import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { globalTelemetry } from "../utils/telemetry.js";
import { globalAuditLogger } from "../utils/auditLogger.js";
import { OPERATION_COSTS } from "../utils/rateLimiter.js";
import { WRITE_OPS } from "./toolDefinitions.js";
import { getSession, SESSION_ID } from "./context.js";
import * as handlers from "./handlers.js";

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

      let result;
      switch (name) {
        case "get_semantic_repo_map":
          result = await handlers.handleGetSemanticRepoMap(args as Record<string, unknown>); break;
        case "read_file_surgical":
          result = await handlers.handleReadFileSurgical(args as Record<string, unknown>); break;
        case "analyze_impact":
          result = await handlers.handleAnalyzeImpact(args as Record<string, unknown>); break;
        case "read_file_lines":
          result = await handlers.handleReadFileLines(args as Record<string, unknown>); break;
        case "search_code_pattern":
          result = await handlers.handleSearchCodePattern(args as Record<string, unknown>); break;
        case "parse_file":
          result = await handlers.handleParseFile(args as Record<string, unknown>); break;
        case "write_file_surgical":
          result = await handlers.handleWriteFileSurgical(args as Record<string, unknown>); break;
        case "insert_symbol":
          result = await handlers.handleInsertSymbol(args as Record<string, unknown>); break;
        case "remove_symbol":
          result = await handlers.handleRemoveSymbol(args as Record<string, unknown>); break;
        case "rename_symbol":
          result = await handlers.handleRenameSymbol(args as Record<string, unknown>); break;
        case "rollback_file":
          result = await handlers.handleRollbackFile(args as Record<string, unknown>); break;
        case "clean_backups":
          result = await handlers.handleCleanBackups(args as Record<string, unknown>); break;
        case "get_server_stats":
          result = await handlers.handleGetServerStats(); break;
        case "get_cache_stats":
          result = await handlers.handleGetCacheStats(args as Record<string, unknown>); break;
        case "clear_cache":
          result = await handlers.handleClearCache(args as Record<string, unknown>); break;
        case "configure_file_watcher":
          result = await handlers.handleConfigureFileWatcher(args as Record<string, unknown>); break;
        case "get_file_watcher_status":
          result = await handlers.handleGetFileWatcherStatus(args as Record<string, unknown>); break;
        case "search_symbols":
          result = await handlers.handleSearchSymbols(args as Record<string, unknown>); break;
        case "explain_symbol":
          result = await handlers.handleExplainSymbol(args as Record<string, unknown>); break;
        case "batch_read":
          result = await handlers.handleBatchRead(args as Record<string, unknown>); break;
        case "get_rate_limit_status":
          result = await handlers.handleGetRateLimitStatus(); break;
        case "get_session_stats":
          result = await handlers.handleGetSessionStats(); break;
        case "clear_session_cache":
          result = await handlers.handleClearSessionCache(args as Record<string, unknown>); break;
        case "list_pending_operations":
          result = await handlers.handleListPendingOperations(); break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

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
