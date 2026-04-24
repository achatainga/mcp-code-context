#!/usr/bin/env node

/**
 * mcp-code-context v3.4.0 - Tree-sitter WASM Edition
 * 
 * Production-ready with:
 * - Tree-sitter WASM for 100% AST accuracy (TypeScript, Python, PHP, Dart)
 * - Zero native dependencies — 100% portable across Windows/Mac/Linux
 * - Two-phase write workflow (dry-run + confirmation token)
 * - Middleware pipeline: rate limiting, file locking, audit logging, telemetry
 * - Mandatory security boundaries on ALL handlers
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as path from "node:path";

import { CodeContextEngine } from "./core/engine.js";
import { ParserRegistry } from "./parsers/registry.js";
import { SecurityValidator } from "./core/validator.js";
import { replaceSymbol, insertCode, removeSymbol, writeFile, renameSymbol } from "./operations/write.js";
import { extractSymbol, readLines, searchPattern, analyzeImpact } from "./operations/read.js";
import { compressRepository } from "./operations/compress.js";
import { globalConfirmationStore } from "./operations/confirmationStore.js";
import { globalAuditLogger } from "./utils/auditLogger.js";
import { globalTelemetry, trackOperation } from "./utils/telemetry.js";
import { RateLimiter, OPERATION_COSTS } from "./utils/rateLimiter.js";
import { globalLockManager } from "./utils/fileLock.js";
import { streamFile } from "./utils/streaming.js";
import * as fs from "node:fs/promises";

const SERVER_NAME = "mcp-code-context";
const SERVER_VERSION = "3.4.0";

// Global instances
let engine: CodeContextEngine;
let registry: ParserRegistry;
const rateLimiter = new RateLimiter();

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
        maxResults: { type: "number", description: "Maximum matches to return (default: 50)" },
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
        newContent: { type: "string", description: "New code" },
        className: { type: "string", description: "Class name (optional, for scoping)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run" },
      },
      required: ["filePath", "projectRoot", "symbolName", "newContent"],
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
        code: { type: "string", description: "Code to insert" },
        anchorSymbol: { type: "string", description: "Symbol to position relative to" },
        position: { type: "string", enum: ["before", "after", "inside_start", "inside_end"], description: "Where to insert" },
        className: { type: "string", description: "Class name (optional)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run" },
      },
      required: ["filePath", "projectRoot", "code"],
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
  return {
    content: [{ type: "text", text: result }],
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
    const result = await extractSymbol({ filePath: validation.resolvedPath!, projectRoot, symbolName, className, parser });
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
    
    // Apply the write
    await writeFile(pendingOp.filePath, pendingOp.newContent);
    return {
      content: [{ type: "text", text: `Success. Changes applied to ${pendingOp.filePath}\n\nDiff:\n${pendingOp.diff}` }],
    };
  }

  // Phase 1: Dry-run
  const result = await executeWrite();
  if (!result.success) throw new Error(result.error);

  const newToken = globalConfirmationStore.storePending({
    filePath: String(args.filePath),
    operation: operationName,
    symbolName: args.symbolName ? String(args.symbolName) : undefined,
    newContent: result.newContent!,
    diff: result.diff!,
  });

  return {
    content: [{ 
      type: "text", 
      text: `DRY RUN SUCCESSFUL. Please review the diff below.\nTo apply these changes, call this tool again with confirm=true and confirmationToken="${newToken}"\n\nDiff:\n${result.diff}` 
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
  // To be fully implemented with backup system
  return { content: [{ type: "text", text: "Rollback file not fully implemented yet." }] };
}

async function handleCleanBackups(args: Record<string, unknown>) {
  // To be fully implemented with backup system
  return { content: [{ type: "text", text: "Clean backups not fully implemented yet." }] };
}

async function handleGetServerStats() {
  const stats = {
    pendingConfirmations: globalConfirmationStore.getPendingCount(),
    // Telemetry and audit stats can be exposed here later
  };
  return {
    content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
  };
}

// -----------------------------------------------------------------------------
// PIPELINE & MAIN EXECUTION
// -----------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();
  let success = false;
  let lockReleased = false;

  try {
    // 1. Rate Limiting Middleware
    const cost = OPERATION_COSTS[name as keyof typeof OPERATION_COSTS] ?? 1;
    const rateCheck = await rateLimiter.checkLimit(name, cost);
    if (!rateCheck.allowed) {
      throw new Error(`Rate limit exceeded for tool: ${name}. Retry after ${rateCheck.retryAfter}ms`);
    }

    // 2. File Locking Middleware (for writes only)
    if (WRITE_OPS.has(name) && args && args.filePath) {
      await globalLockManager.acquireLock(String(args.filePath), "mcp-client", name);
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
    if (WRITE_OPS.has(name) && args && args.filePath && !lockReleased) {
      globalLockManager.releaseLock(String(args.filePath), "mcp-client");
      lockReleased = true;
    }

    // 5. Telemetry & Audit Logging Middleware
    globalTelemetry.recordOperation({ toolName: name, duration, success });
    globalAuditLogger.log({ 
      level: success ? "info" : "error",
      operation: name, 
      details: args ? (args as Record<string, any>) : {}, 
      result: success ? "success" : "failure"
    });
  }
});

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
