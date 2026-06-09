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

export async function handleGetSemanticRepoMap(args: Record<string, unknown>) {
  if (!args.directoryPath || !args.projectRoot) {
    throw new Error("directoryPath and projectRoot are required (e.g. projectRoot: C:\\code\\mcp-code-context)");
  }
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
    projectRoot,
    registry: getRegistry(),
    format: format as "xml" | "markdown" 
  });
  if (!result.success) throw new Error(result.error);
  return {
    content: [{ type: "text", text: result.content! }],
  };
}

export async function handleReadFileSurgical(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);
  const symbolName = args.symbolName ? String(args.symbolName) : undefined;
  const className = args.className ? String(args.className) : undefined;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);
  assertNoPendingWriteConflict(getSession().confirmationStore, validation.resolvedPath!);

  let content: string;
  if (symbolName) {
    const ext = path.extname(filePath);
    const parser = getRegistry().getParser(ext);
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

export async function handleAnalyzeImpact(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);
  const rootDir = args.rootDir ? String(args.rootDir) : projectRoot;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const rootValidation = await validator.validateFilePath(rootDir);
  if (!rootValidation.valid) throw new Error(rootValidation.error);

  const result = await analyzeImpact({ filePath: validation.resolvedPath!, rootDir: rootValidation.resolvedPath!, projectRoot });
  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}

export async function handleReadFileLines(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);
  
  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);
  assertNoPendingWriteConflict(getSession().confirmationStore, validation.resolvedPath!);

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

export async function handleSearchCodePattern(args: Record<string, unknown>) {
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

export async function handleParseFile(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);
  assertNoPendingWriteConflict(getSession().confirmationStore, validation.resolvedPath!);

  const content = await fs.readFile(validation.resolvedPath!, "utf-8");
  const ext = path.extname(validation.resolvedPath!);
  const parser = getRegistry().getParser(ext);
  
  if (!parser) throw new Error(`No parser available for ${ext} files`);

  const tree = parser.parse(content);
  const symbols = parser.findSymbols(tree);

  return {
    content: [{ type: "text", text: JSON.stringify(symbols, null, 2) }],
  };
}

// NEW-02: search_symbols
export async function handleSearchSymbols(args: Record<string, unknown>) {
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
export async function handleExplainSymbol(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = String(args.projectRoot);
  const rootDir = args.rootDir ? String(args.rootDir) : projectRoot;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const ext = path.extname(validation.resolvedPath!);
  const parser = getRegistry().getParser(ext);
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
export async function handleBatchRead(args: Record<string, unknown>) {
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
    parser: (ext: string) => getRegistry().getParser(ext) ?? null,
  });

  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}
