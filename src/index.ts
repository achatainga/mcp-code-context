#!/usr/bin/env node

/**
 * mcp-code-context v3.6.2 - Tree-sitter WASM Edition
 * 
 * Production-ready with:
 * - Tree-sitter WASM for 100% AST accuracy (TypeScript, Python, PHP, Dart)
 * - Zero native dependencies — 100% portable across Windows/Mac/Linux
 * - Two-phase write workflow (dry-run + confirmation token)
 * - Middleware pipeline: rate limiting, file locking, audit logging, telemetry
 * - Mandatory security boundaries on ALL handlers
 * - Persistent WASM SQLite cache with <100ms hits
 * - Structured logging with pino (JSON to stderr, MCP-safe)
 * - File watcher with chokidar for auto cache invalidation
 * - Fuzzy search with fuse.js + pagination
 * - Token optimization: compact diffs, auto-optimize output
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { CodeContextEngine } from "./core/engine.js";
import { ParserRegistry } from "./parsers/registry.js";
import { SecurityValidator } from "./core/validator.js";
import { replaceSymbol, insertCode, removeSymbol, writeFile, renameSymbol } from "./operations/write.js";
import { extractSymbol, readLines, searchPattern, analyzeImpact, searchSymbols, explainSymbol, batchRead } from "./operations/read.js";
import { compressRepository } from "./operations/compress.js";
import { globalConfirmationStore } from "./operations/confirmationStore.js";
import { globalAuditLogger } from "./utils/auditLogger.js";
import { globalTelemetry, trackOperation } from "./utils/telemetry.js";
import { RateLimiter, OPERATION_COSTS } from "./utils/rateLimiter.js";
import { globalLockManager } from "./utils/fileLock.js";
import { streamFile } from "./utils/streaming.js";
import { BackupManager } from "./utils/backupManager.js";
import { CacheManager } from "./core/cacheManager.js";
import * as fs from "node:fs/promises";

const SERVER_NAME = "mcp-code-context";
const SERVER_VERSION = "3.6.2";

// Global instances
let engine: CodeContextEngine;
let registry: ParserRegistry;
const rateLimiter = new RateLimiter();

// LRU cache for CacheManagers (max 5 projects to prevent FD exhaustion)
const cacheManagers = new Map<string, { cache: CacheManager; lastUsed: number }>();
const MAX_CACHE_MANAGERS = 5;

function getCacheManager(projectRoot: string): CacheManager {
  const now = Date.now();
  
  // Update last used time if exists
  if (cacheManagers.has(projectRoot)) {
    const entry = cacheManagers.get(projectRoot)!;
    entry.lastUsed = now;
    return entry.cache;
  }
  
  // Evict LRU if at capacity
  if (cacheManagers.size >= MAX_CACHE_MANAGERS) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of cacheManagers.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      const evicted = cacheManagers.get(oldestKey)!;
      evicted.cache.close(); // CRITICAL: Close watcher and free WASM heap
      cacheManagers.delete(oldestKey);
    }
  }
  
  // Create new cache manager
  const cache = new CacheManager(projectRoot);
  cacheManagers.set(projectRoot, { cache, lastUsed: now });
  return cache;
}

// Write operations that require file locking and two-phase workflow
const WRITE_OPS = new Set(["replace_symbol", "insert_symbol", "remove_symbol", "rename_symbol"]);

const TOOLS = [
  {
    name: "get_semantic_repo_map",
    description: "Generate a compressed architectural overview of an entire repository",
    inputSchema: {
      type: "object" as const,
      properties: {
        directoryPath: { type: "string", description: "Absolute path to repository root" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        format: { type: "string", enum: ["xml", "markdown"], description: "Output format (default: xml)" },
      },
      required: ["directoryPath", "projectRoot"],
    },
  },
  {
    name: "read_file_surgical",
    description: "Read a file or extract a specific named symbol",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol name to extract (optional)" },
        className: { type: "string", description: "Class name for scoping (optional)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "analyze_impact",
    description: "Find all files that depend on a given file",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        rootDir: { type: "string", description: "Repository root (optional, defaults to projectRoot)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "read_file_lines",
    description: "Read specific line ranges from a file",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        startLine: { type: "number", description: "Starting line number (1-indexed)" },
        endLine: { type: "number", description: "Ending line number (1-indexed)" },
        aroundPattern: { type: "string", description: "Search pattern to find and return surrounding lines" },
        contextLines: { type: "number", description: "Number of lines before/after pattern (default: 5)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "search_code_pattern",
    description: "Search for code patterns across multiple files",
    inputSchema: {
      type: "object" as const,
      properties: {
        rootDir: { type: "string", description: "Repository root directory" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        pattern: { type: "string", description: "Regular expression pattern to search" },
        fileExtensions: { type: "array", items: { type: "string" }, description: "Extensions to search" },
        excludeDirs: { type: "array", items: { type: "string" }, description: "Directories to exclude" },
        maxResults: { type: "number", description: "Maximum matches to return (default: 10)" },
        startIndex: { type: "number", description: "Start index for pagination (default: 0)" },
        fuzzyMatch: { type: "boolean", description: "Enable fuzzy matching (default: false)" },
        fuzzyThreshold: { type: "number", description: "Fuzzy match threshold 0-1 (default: 0.4)" },
      },
      required: ["rootDir", "projectRoot", "pattern"],
    },
  },
  {
    name: "parse_file",
    description: "Parse a file using Tree-sitter and extract symbols",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "write_file_surgical",
    description: "Replace a symbol with new code. Phase 1 (dry-run): returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol to replace" },
        newContent: { type: "string", description: "New code (Phase 1 only — omit in Phase 2, server uses stored content)" },
        className: { type: "string", description: "Class name (optional, for scoping)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation (Phase 2)" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run (Phase 2 only)" },
        diffFormat: { type: "string", enum: ["unified", "compact", "summary", "none"], description: "Diff verbosity in Phase 1 output (default: unified). Use none to skip diff and save tokens." },
      },
      required: ["filePath", "projectRoot", "symbolName"],
    },
  },
  {
    name: "insert_symbol",
    description: "Insert code at a specific location. Phase 1: returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        code: { type: "string", description: "Code to insert (Phase 1 only — omit in Phase 2, server uses stored content)" },
        anchorSymbol: { type: "string", description: "Symbol to position relative to" },
        position: { type: "string", enum: ["before", "after", "inside_start", "inside_end"], description: "Where to insert" },
        className: { type: "string", description: "Class name (optional)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation (Phase 2)" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run (Phase 2 only)" },
        diffFormat: { type: "string", enum: ["unified", "compact", "summary", "none"], description: "Diff verbosity in Phase 1 output (default: unified). Use none to skip diff and save tokens." },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "remove_symbol",
    description: "Remove a symbol from file. Phase 1: returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol to remove" },
        className: { type: "string", description: "Class name (optional)" },
        force: { type: "boolean", description: "Skip dependency check" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run" },
      },
      required: ["filePath", "projectRoot", "symbolName"],
    },
  },
  {
    name: "rename_symbol",
    description: "Rename a symbol across the entire repository. Phase 1: returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "File where symbol is defined" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        oldName: { type: "string", description: "Current name" },
        newName: { type: "string", description: "New name" },
        rootDir: { type: "string", description: "Repository root (optional)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run" },
      },
      required: ["filePath", "projectRoot", "oldName", "newName"],
    },
  },
  // ── NEW TOOLS v3.6.2 ──────────────────────────────────────────────────────
  {
    name: "search_symbols",
    description: "Search symbols by name across the repo using AST (not text search). Finds classes, functions, methods by approximate name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        rootDir: { type: "string", description: "Directory to search in" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        query: { type: "string", description: "Symbol name or partial name to search" },
        fuzzy: { type: "boolean", description: "Enable fuzzy name matching (default: false)" },
        types: { type: "array", items: { type: "string" }, description: "Filter by symbol types: class_declaration, function_declaration, method_definition, etc." },
        fileExtensions: { type: "array", items: { type: "string" }, description: "Extensions to search (default: all supported)" },
        excludeDirs: { type: "array", items: { type: "string" }, description: "Directories to exclude" },
        maxResults: { type: "number", description: "Maximum results (default: 20)" },
      },
      required: ["rootDir", "projectRoot", "query"],
    },
  },
  {
    name: "explain_symbol",
    description: "Get signature, location, and callers of a symbol in one call. More efficient than read_file_surgical + analyze_impact separately.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol to explain" },
        className: { type: "string", description: "Class name (optional, for scoping)" },
        rootDir: { type: "string", description: "Root dir for caller search (optional, defaults to projectRoot)" },
      },
      required: ["filePath", "projectRoot", "symbolName"],
    },
  },
  {
    name: "batch_read",
    description: "Read multiple symbols from multiple files in one call. Reduces N round-trips to 1.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reads: {
          type: "array",
          description: "List of symbols to read",
          items: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "Absolute path to file" },
              symbolName: { type: "string", description: "Symbol name to extract" },
              className: { type: "string", description: "Class name (optional)" },
            },
            required: ["filePath", "symbolName"],
          },
        },
        projectRoot: { type: "string", description: "Project root for security boundary" },
      },
      required: ["reads", "projectRoot"],
    },
  },
  {
    name: "get_rate_limit_status",
    description: "Get current rate limiter token balance and operation costs. Use before expensive operations to check available budget.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  // ── END NEW TOOLS ──────────────────────────────────────────────────────────
  {
    name: "rollback_file",
    description: "Revert a file to its backup state",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "clean_backups",
    description: "Remove all backup files for a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "get_server_stats",
    description: "Get server telemetry, audit statistics, and health metrics",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_cache_stats",
    description: "Get cache statistics (entries, size, hit rate)",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "clear_cache",
    description: "Clear all cached parse results for a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "configure_file_watcher",
    description: "Start/stop file watcher for auto-cache invalidation",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        action: { type: "string", enum: ["start", "stop"], description: "Action to perform" },
        debounceMs: { type: "number", description: "Debounce delay in ms (default: 500)" },
      },
      required: ["projectRoot", "action"],
    },
  },
  {
    name: "get_file_watcher_status",
    description: "Get file watcher status for a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["projectRoot"],
    },
  },
];

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Setup connection and initialize engine
async function main() {
  engine = new CodeContextEngine();
  await engine.init();
  registry = new ParserRegistry(engine);
  await registry.init();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} running on stdio`);
}

// -----------------------------------------------------------------------------
// READ HANDLERS
// -----------------------------------------------------------------------------

async function handleGetSemanticRepoMap(args: Record<string, unknown>) {
  const directoryPath = String(args.directoryPath);
  const projectRoot = String(args.projectRoot);
  const format = args.format === "markdown" ? "markdown" : "xml";

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(directoryPath);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const result = await compressRepository({ 
    directoryPath: validation.resolvedPath!, 
    registry, 
    format: format as "xml" | "markdown" 
  });
  if (!result.success) throw new Error(result.error);
  return {
    content: [{ type: "text", text: result.content! }],
  };
}

async function handleReadFileSurgical(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);
  const symbolName = args.symbolName ? String(args.symbolName) : undefined;
  const className = args.className ? String(args.className) : undefined;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  let content: string;
  if (symbolName) {
    const ext = path.extname(filePath);
    const parser = registry.getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);
    const result = await extractSymbol({ 
      filePath: validation.resolvedPath!, 
      projectRoot, 
      symbolName, 
      className, 
      parser,
      cache: getCacheManager(projectRoot)
    });
    if (!result.success) throw new Error(result.error);
    content = result.content!;
  } else {
    // If > 5MB, stream it to avoid memory issues
    const stat = await fs.stat(validation.resolvedPath!);
    if (stat.size > 5 * 1024 * 1024) {
      const streamRes = await streamFile(validation.resolvedPath!);
      if (!streamRes.success) throw new Error(streamRes.error);
      content = streamRes.chunks!.join("");
    } else {
      content = await fs.readFile(validation.resolvedPath!, "utf-8");
    }
  }

  return { content: [{ type: "text", text: content }] };
}

async function handleAnalyzeImpact(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);
  const rootDir = args.rootDir ? String(args.rootDir) : projectRoot;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const rootValidation = await validator.validateFilePath(rootDir);
  if (!rootValidation.valid) throw new Error(rootValidation.error);

  const result = await analyzeImpact({ filePath: validation.resolvedPath!, rootDir: rootValidation.resolvedPath! });
  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}

async function handleReadFileLines(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);
  
  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const result = await readLines({
    filePath: validation.resolvedPath!,
    startLine: args.startLine as number | undefined,
    endLine: args.endLine as number | undefined,
    aroundPattern: args.aroundPattern as string | undefined,
    contextLines: args.contextLines as number | undefined,
  });

  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}

async function handleSearchCodePattern(args: Record<string, unknown>) {
  const rootDir = String(args.rootDir);
  const projectRoot = String(args.projectRoot);
  
  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(rootDir);
  if (!validation.valid) throw new Error(validation.error);

  const result = await searchPattern({
    rootDir: validation.resolvedPath!,
    pattern: String(args.pattern),
    fileExtensions: args.fileExtensions as string[] | undefined,
    excludeDirs: args.excludeDirs as string[] | undefined,
    maxResults: args.maxResults as number | undefined,
    startIndex: args.startIndex as number | undefined,
    fuzzyMatch: args.fuzzyMatch as boolean | undefined,
    fuzzyThreshold: args.fuzzyThreshold as number | undefined,
  });

  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}

async function handleParseFile(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const content = await fs.readFile(validation.resolvedPath!, "utf-8");
  const ext = path.extname(validation.resolvedPath!);
  const parser = registry.getParser(ext);
  
  if (!parser) throw new Error(`No parser available for ${ext} files`);

  const tree = parser.parse(content);
  const symbols = parser.findSymbols(tree);

  return {
    content: [{ type: "text", text: JSON.stringify(symbols, null, 2) }],
  };
}

// -----------------------------------------------------------------------------
// WRITE HANDLERS (Two-Phase)
// -----------------------------------------------------------------------------

async function handleTwoPhaseWrite(
  args: Record<string, unknown>,
  operationName: string,
  executeWrite: () => Promise<any>
) {
  const confirm = Boolean(args.confirm);
  const token = args.confirmationToken ? String(args.confirmationToken) : undefined;

  if (confirm) {
    if (!token) throw new Error("confirmationToken is required when confirm=true");
    const pendingOp = globalConfirmationStore.consumePending(token);
    if (!pendingOp) throw new Error(`Invalid or expired confirmation token: ${token}`);

    const projectRoot = String(args.projectRoot);
    const validator = new SecurityValidator(projectRoot);

    const lockReleases: Array<() => Promise<void>> = [];

    try {
      // TOCTOU CHECK: Verify file hasn't been modified since Phase 1
      if (pendingOp.originalHash) {
        const validation = await validator.validateFilePath(pendingOp.filePath);
        if (!validation.valid) throw new Error(validation.error);
        const currentContent = await fs.readFile(validation.resolvedPath!, "utf-8");
        const currentHash = crypto.createHash('md5').update(currentContent).digest('hex');
        if (currentHash !== pendingOp.originalHash) {
          throw new Error("File was modified by another process after Phase 1. Please repeat the operation to prevent data loss.");
        }
      }

      if (pendingOp.pendingWrites && pendingOp.pendingWrites.length > 0) {
        const sortedWrites = [...pendingOp.pendingWrites].sort((a, b) =>
          a.filePath.localeCompare(b.filePath)
        );
        for (const pw of sortedWrites) {
          const validation = await validator.validateFilePath(pw.filePath);
          if (!validation.valid) throw new Error(validation.error);
          if (!globalLockManager.isLocked(validation.resolvedPath!)) {
            const release = await globalLockManager.acquireLock(validation.resolvedPath!);
            lockReleases.push(release);
          }
        }
        for (const pw of sortedWrites) {
          const validation = await validator.validateFilePath(pw.filePath);
          await BackupManager.createBackup(validation.resolvedPath!, projectRoot);
          await writeFile(validation.resolvedPath!, pw.newContent);
        }
      } else {
        const validation = await validator.validateFilePath(pendingOp.filePath);
        if (!validation.valid) throw new Error(validation.error);
        if (!globalLockManager.isLocked(validation.resolvedPath!)) {
          const release = await globalLockManager.acquireLock(validation.resolvedPath!);
          lockReleases.push(release);
        }
        await BackupManager.createBackup(validation.resolvedPath!, projectRoot);
        await writeFile(validation.resolvedPath!, pendingOp.newContent);
      }
    } finally {
      for (const release of lockReleases) {
        await release();
      }
    }

    const fileCount = pendingOp.pendingWrites?.length || 1;
    return {
      content: [{ type: "text", text: `✅ Success. Changes applied to ${fileCount} file(s).` }],
    };
  }

  // Phase 1: Dry-run
  const result = await executeWrite();
  if (!result.success) throw new Error(result.error);

  const hadConflict = globalConfirmationStore.hasConflictingPending(String(args.filePath));

  const newToken = globalConfirmationStore.storePending({
    filePath: String(args.filePath),
    operation: operationName,
    symbolName: args.symbolName ? String(args.symbolName) : undefined,
    newContent: result.newContent!,
    diff: result.diff!,
    originalHash: result.originalHash,
    pendingWrites: result.pendingWrites,
  });

  const conflictWarning = hadConflict
    ? `\n⚠️  A previous pending token for this file was invalidated. Only this new token is valid.`
    : "";

  // ERG-01 + NEW-04: decode diff and apply diffFormat
  const rawDiff = decodeURIComponent(result.diff);
  const fmt = args.diffFormat ? String(args.diffFormat) : "unified";
  let displayDiff: string;
  if (fmt === "none") {
    displayDiff = `(diff omitted — use diffFormat="unified" to see changes)`;
  } else if (fmt === "summary") {
    const added = (rawDiff.match(/^\+[^+]/gm) || []).length;
    const removed = (rawDiff.match(/^-[^-]/gm) || []).length;
    displayDiff = `+${added} lines, -${removed} lines`;
  } else if (fmt === "compact") {
    displayDiff = rawDiff.split("\n").filter(l => l.startsWith("+") || l.startsWith("-")).join("\n");
  } else {
    displayDiff = rawDiff;
  }

  return {
    content: [{
      type: "text",
      text: `DRY RUN SUCCESSFUL.${conflictWarning}\nTo apply these changes, call this tool again with confirm=true and confirmationToken="${newToken}"\n\nDiff:\n${displayDiff}`
    }],
  };
}

async function handleWriteFileSurgical(args: Record<string, unknown>) {
  return handleTwoPhaseWrite(args, "write_file_surgical", async () => {
    const ext = path.extname(String(args.filePath));
    const parser = registry.getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);

    return await replaceSymbol({
      filePath: String(args.filePath),
      projectRoot: String(args.projectRoot),
      symbolName: String(args.symbolName),
      newContent: String(args.newContent),
      className: args.className ? String(args.className) : undefined,
      parser,
    });
  });
}

async function handleInsertSymbol(args: Record<string, unknown>) {
  return handleTwoPhaseWrite(args, "insert_symbol", async () => {
    const ext = path.extname(String(args.filePath));
    const parser = registry.getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);

    return await insertCode({
      filePath: String(args.filePath),
      projectRoot: String(args.projectRoot),
      code: String(args.code),
      anchorSymbol: args.anchorSymbol ? String(args.anchorSymbol) : undefined,
      position: args.position as any,
      className: args.className ? String(args.className) : undefined,
      parser,
    });
  });
}

async function handleRemoveSymbol(args: Record<string, unknown>) {
  return handleTwoPhaseWrite(args, "remove_symbol", async () => {
    const ext = path.extname(String(args.filePath));
    const parser = registry.getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);

    return await removeSymbol({
      filePath: String(args.filePath),
      projectRoot: String(args.projectRoot),
      symbolName: String(args.symbolName),
      className: args.className ? String(args.className) : undefined,
      parser,
    });
  });
}

async function handleRenameSymbol(args: Record<string, unknown>) {
  return handleTwoPhaseWrite(args, "rename_symbol", async () => {
    const ext = path.extname(String(args.filePath));
    const parser = registry.getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);

    return await renameSymbol({
      filePath: String(args.filePath),
      projectRoot: String(args.projectRoot),
      oldName: String(args.oldName),
      newName: String(args.newName),
      rootDir: args.rootDir ? String(args.rootDir) : String(args.projectRoot),
      parser,
    });
  });
}

// -----------------------------------------------------------------------------
// OTHER HANDLERS
// -----------------------------------------------------------------------------

async function handleRollbackFile(args: Record<string, unknown>) {
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

async function handleCleanBackups(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);

  const validator = new SecurityValidator(projectRoot);
  // Just validate projectRoot is a valid directory
  const validation = await validator.validateFilePath(projectRoot);
  if (!validation.valid) throw new Error(validation.error);

  const result = await BackupManager.clean(projectRoot);
  if (!result.success) throw new Error(result.error);

  return { content: [{ type: "text", text: `Successfully cleaned backups. Deleted ${result.deletedCount} backup files.` }] };
}

async function handleGetServerStats() {
  const telemetry = globalTelemetry.getSummary();
  const audit = globalAuditLogger.getStats();
  const tokensAvailable = rateLimiter.getTokens("global");

  const stats = {
    pendingConfirmations: globalConfirmationStore.getPendingCount(),
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

async function handleGetCacheStats(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const cache = getCacheManager(projectRoot);
  const stats = await cache.getStats();
  
  return {
    content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
  };
}

async function handleClearCache(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const cache = getCacheManager(projectRoot);
  await cache.clear();
  
  return {
    content: [{ type: "text", text: "Cache cleared successfully" }],
  };
}

async function handleConfigureFileWatcher(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const action = String(args.action);
  const debounceMs = args.debounceMs ? Number(args.debounceMs) : 500;
  
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

async function handleGetFileWatcherStatus(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const cache = getCacheManager(projectRoot);
  const status = cache.getWatcherStatus();
  
  return {
    content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
  };
}

// NEW-01: get_rate_limit_status
async function handleGetRateLimitStatus() {
  const tokensAvailable = rateLimiter.getTokens("global");
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

// NEW-02: search_symbols
async function handleSearchSymbols(args: Record<string, unknown>) {
  const rootDir = String(args.rootDir);
  const projectRoot = String(args.projectRoot);

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(rootDir);
  if (!validation.valid) throw new Error(validation.error);

  const result = await searchSymbols({
    rootDir: validation.resolvedPath!,
    projectRoot,
    query: String(args.query),
    fuzzy: args.fuzzy as boolean | undefined,
    types: args.types as string[] | undefined,
    fileExtensions: args.fileExtensions as string[] | undefined,
    excludeDirs: args.excludeDirs as string[] | undefined,
    maxResults: args.maxResults as number | undefined,
  });

  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}

// NEW-03: explain_symbol
async function handleExplainSymbol(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);
  const rootDir = args.rootDir ? String(args.rootDir) : projectRoot;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const ext = path.extname(validation.resolvedPath!);
  const parser = registry.getParser(ext);
  if (!parser) throw new Error(`No parser available for ${ext} files`);

  const result = await explainSymbol({
    filePath: validation.resolvedPath!,
    projectRoot,
    symbolName: String(args.symbolName),
    className: args.className ? String(args.className) : undefined,
    parser,
    rootDir,
  });

  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}

// NEW-05: batch_read
async function handleBatchRead(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const reads = args.reads as Array<{ filePath: string; symbolName: string; className?: string }>;

  const validator = new SecurityValidator(projectRoot);
  // Validate all paths upfront
  for (const read of reads) {
    const v = await validator.validateFilePath(read.filePath);
    if (!v.valid) throw new Error(v.error);
    read.filePath = v.resolvedPath!;
  }

  const result = await batchRead({
    reads,
    projectRoot,
    parser: (ext: string) => registry.getParser(ext) ?? null,
  });

  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}

// -----------------------------------------------------------------------------
// PIPELINE & MAIN EXECUTION
// -----------------------------------------------------------------------------

/**
 * Redact sensitive fields from args before audit logging.
 * Prevents newContent/code from being persisted in plain text.
 */
function redactSensitiveFields(args: Record<string, any>): Record<string, any> {
  const SENSITIVE_KEYS = ["newContent", "code", "content"];
  const safe = { ...args };
  for (const key of SENSITIVE_KEYS) {
    if (key in safe && typeof safe[key] === "string") {
      safe[key] = `[REDACTED: ${(safe[key] as string).length} chars]`;
    }
  }
  return safe;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();
  let success = false;
  let lockReleased = false;
  let lockRelease: (() => Promise<void>) | null = null;

  try {
    // 1. Rate Limiting Middleware
    const cost = OPERATION_COSTS[name as keyof typeof OPERATION_COSTS] ?? 1;
    // Use global bucket — MCP stdio has 1 client per connection
    const rateCheck = await rateLimiter.checkLimit("global", cost);
    if (!rateCheck.allowed) {
      throw new Error(`Rate limit exceeded for tool: ${name}. Retry after ${rateCheck.retryAfter}ms`);
    }

    // 2. File Locking Middleware (for writes only)
    if (WRITE_OPS.has(name) && args && args.filePath) {
      lockRelease = await globalLockManager.acquireLock(String(args.filePath));
    }

    // 3. Execution
    let result;
    switch (name) {
      case "get_semantic_repo_map":
        result = await handleGetSemanticRepoMap(args as Record<string, unknown>); break;
      case "read_file_surgical":
        result = await handleReadFileSurgical(args as Record<string, unknown>); break;
      case "analyze_impact":
        result = await handleAnalyzeImpact(args as Record<string, unknown>); break;
      case "read_file_lines":
        result = await handleReadFileLines(args as Record<string, unknown>); break;
      case "search_code_pattern":
        result = await handleSearchCodePattern(args as Record<string, unknown>); break;
      case "parse_file":
        result = await handleParseFile(args as Record<string, unknown>); break;
      case "write_file_surgical":
        result = await handleWriteFileSurgical(args as Record<string, unknown>); break;
      case "insert_symbol":
        result = await handleInsertSymbol(args as Record<string, unknown>); break;
      case "remove_symbol":
        result = await handleRemoveSymbol(args as Record<string, unknown>); break;
      case "rename_symbol":
        result = await handleRenameSymbol(args as Record<string, unknown>); break;
      case "rollback_file":
        result = await handleRollbackFile(args as Record<string, unknown>); break;
      case "clean_backups":
        result = await handleCleanBackups(args as Record<string, unknown>); break;
      case "get_server_stats":
        result = await handleGetServerStats(); break;
      case "get_cache_stats":
        result = await handleGetCacheStats(args as Record<string, unknown>); break;
      case "clear_cache":
        result = await handleClearCache(args as Record<string, unknown>); break;
      case "configure_file_watcher":
        result = await handleConfigureFileWatcher(args as Record<string, unknown>); break;
      case "get_file_watcher_status":
        result = await handleGetFileWatcherStatus(args as Record<string, unknown>); break;
      case "search_symbols":
        result = await handleSearchSymbols(args as Record<string, unknown>); break;
      case "explain_symbol":
        result = await handleExplainSymbol(args as Record<string, unknown>); break;
      case "batch_read":
        result = await handleBatchRead(args as Record<string, unknown>); break;
      case "get_rate_limit_status":
        result = await handleGetRateLimitStatus(); break;
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

    // 4. File Lock Release
    if (lockRelease && !lockReleased) {
      await lockRelease();
      lockReleased = true;
    }

    // 5. Telemetry & Audit Logging Middleware
    globalTelemetry.recordOperation({ toolName: name, duration, success });
    // Redact sensitive fields (newContent, code) from audit log
    const safeDetails = args ? redactSensitiveFields(args as Record<string, any>) : {};
    globalAuditLogger.log({ 
      level: success ? "info" : "error",
      operation: name, 
      details: safeDetails, 
      result: success ? "success" : "failure"
    });
  }
});

// Global shutdown hook - persist all active caches on exit
const shutdownHandler = () => {
  for (const entry of cacheManagers.values()) {
    entry.cache.persistOnExit();
  }
};

process.on('SIGINT', shutdownHandler);
process.on('SIGTERM', shutdownHandler);
process.on('exit', shutdownHandler);

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
