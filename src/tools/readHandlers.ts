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
import { loadRailsSchema, modelToTable, formatSchemaAnnotation } from "../utils/railsSchema.js";
import { parseGemfile, formatGemAnnotation } from "../utils/gemfileParser.js";
import { findMetaprogrammingEntryPoints, formatMetaprogrammingResults } from "../utils/metaprogramming.js";
import { parseRailsRoutes } from "../utils/railsRoutes.js";

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

  // ActiveRecord Virtual Schema injection
  if (path.extname(filePath) === ".rb") {
    // When extracting a symbol, `content` is only the method body — no class declaration.
    // We need the full file to detect AR inheritance, but guard with stat first to
    // avoid allocating >5MB files without the streaming guard.
    let sourceForDetection = content;
    if (symbolName) {
      const fileStat = await fs.stat(validation.resolvedPath!);
      if (fileStat.size <= 5 * 1024 * 1024) {
        sourceForDetection = await fs.readFile(validation.resolvedPath!, "utf-8");
      }
      // Files >5MB: skip schema injection for symbol extracts — not worth the memory cost
    }
    const arMatch = sourceForDetection.match(
      /class\s+(\w+)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base)/
    );
    if (arMatch) {
      const schema = await loadRailsSchema(projectRoot);
      if (schema) {
        const tableName = modelToTable(arMatch[1]);
        const columns = schema[tableName];
        if (columns && Object.keys(columns).length > 0) {
          content = formatSchemaAnnotation(tableName, columns) + "\n" + content;
        }
      }
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

// R7: get_gemfile_context — parse Gemfile and return known gem behaviors
export async function handleGetGemfileContext(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);

  const validator = new SecurityValidator(projectRoot);
  const rootValidation = await validator.validateFilePath(projectRoot);
  if (!rootValidation.valid) throw new Error(rootValidation.error);

  const result = await parseGemfile(rootValidation.resolvedPath!);
  if (!result) {
    return { content: [{ type: "text", text: JSON.stringify({ found: false, message: "No Gemfile found — not a Ruby project" }) }] };
  }

  const annotation = formatGemAnnotation(result.knownGems);
  const output = JSON.stringify({
    total_gems: result.gems.length,
    known_gems_with_behavior: result.knownGems.length,
    gems: result.knownGems,
    annotation,
  }, null, 2);

  return { content: [{ type: "text", text: output }] };
}

// R3: find_metaprogramming — scan for dynamic method generation entry points
export async function handleFindMetaprogramming(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);
  const target = args.filePath ? String(args.filePath) : args.rootDir ? String(args.rootDir) : projectRoot;
  const isFile = Boolean(args.filePath);

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(target);
  if (!validation.valid) throw new Error(validation.error);

  const matches = await findMetaprogrammingEntryPoints({
    target: validation.resolvedPath!,
    projectRoot,
    isFile,
  });

  return { content: [{ type: "text", text: formatMetaprogrammingResults(matches) }] };
}

// R2: get_rails_routes — parse config/routes.rb and return route map
export async function handleGetRailsRoutes(args: Record<string, unknown>) {
  const projectRoot = String(args.projectRoot);

  const validator = new SecurityValidator(projectRoot);
  const rootValidation = await validator.validateFilePath(projectRoot);
  if (!rootValidation.valid) throw new Error(rootValidation.error);

  const result = await parseRailsRoutes(rootValidation.resolvedPath!);
  if (!result) {
    return { content: [{ type: "text", text: JSON.stringify({ found: false, message: "No config/routes.rb found" }) }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
