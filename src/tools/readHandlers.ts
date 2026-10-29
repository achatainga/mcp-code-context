/** Tool handlers */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { SecurityValidator } from "../core/validator.js";
import { replaceSymbol, insertCode, removeSymbol, writeFile, renameSymbol } from "../operations/write.js";
import { extractSymbol, readLines, searchPattern, analyzeImpact, searchSymbols, searchCodeConcept, verifyImportIntegrity, explainSymbol, batchRead } from "../operations/read.js";
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
import { loadUnifiedVirtualSchema, formatUnifiedSchemaAnnotation } from "../utils/virtualSchema.js";
import { parseGemfile, formatGemAnnotation } from "../utils/gemfileParser.js";
import { findMetaprogrammingEntryPoints, formatMetaprogrammingResults } from "../utils/metaprogramming.js";
import { parseRailsRoutes } from "../utils/railsRoutes.js";
import { resolveProjectRoot } from "../utils/projectRoot.js";
import { getImpactedTests } from "../operations/testImpact.js";
import { getCallHierarchy } from "../operations/callHierarchy.js";
import { validateWireContract } from "../operations/wireContract.js";
import { predictSemanticConflicts } from "../operations/conflictPredictor.js";

export async function handleGetSemanticRepoMap(args: Record<string, unknown>) {
  if (!args.directoryPath) {
    throw new Error("directoryPath is required (e.g. C:\\code\\mcp-code-context)");
  }
  const directoryPath = String(args.directoryPath);
  const projectRoot = resolveProjectRoot(args, directoryPath);
  const format = args.format === "markdown" ? "markdown" : args.format === "html" ? "html" : "xml";

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(directoryPath);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const result = await compressRepository({ 
    directoryPath: validation.resolvedPath!, 
    projectRoot,
    registry: getRegistry(),
    format: format as "xml" | "markdown" | "html" 
  });
  if (!result.success) throw new Error(result.error);
  return {
    content: [{ type: "text", text: result.content! }],
  };
}

export async function handleReadFileSurgical(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = resolveProjectRoot(args, filePath);
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

  // Unified Virtual ORM Schema injection (ActiveRecord, Eloquent, Django, Prisma, Drizzle)
  const fileExt = path.extname(filePath);
  if (fileExt === ".rb" || fileExt === ".php" || fileExt === ".py" || fileExt === ".ts" || fileExt === ".tsx" || fileExt === ".js" || fileExt === ".prisma") {
    let sourceForDetection = content;
    if (symbolName) {
      const fileStat = await fs.stat(validation.resolvedPath!);
      if (fileStat.size <= 5 * 1024 * 1024) {
        sourceForDetection = await fs.readFile(validation.resolvedPath!, "utf-8");
      }
    }

    let modelName: string | null = null;

    if (fileExt === ".rb") {
      const m = sourceForDetection.match(/class\s+(\w+)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base)/);
      if (m) { modelName = m[1]; }
    } else if (fileExt === ".php") {
      const m = sourceForDetection.match(/class\s+(\w+)\s+extends\s+(?:Model|Authenticatable)/);
      if (m) { modelName = m[1]; }
    } else if (fileExt === ".py") {
      const m = sourceForDetection.match(/class\s+(\w+)\s*\([^)]*models\.Model[^)]*\):/);
      if (m) { modelName = m[1]; }
    } else if (fileExt === ".prisma") {
      const m = sourceForDetection.match(/model\s+(\w+)\s*\{/);
      if (m) { modelName = m[1]; }
    } else if (fileExt === ".ts" || fileExt === ".tsx" || fileExt === ".js") {
      const drizzleM = sourceForDetection.match(/(?:export\s+const\s+(\w+)\s*=\s*)?(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*["']([^"']+)["']/);
      const prismaM = sourceForDetection.match(/(?:interface|type|class)\s+(\w+)\b/);
      if (drizzleM) {
        modelName = drizzleM[2] || drizzleM[1];
      } else if (prismaM) {
        modelName = prismaM[1];
      }
    }

    if (modelName) {
      const unified = await loadUnifiedVirtualSchema(projectRoot, fileExt).catch(() => null);
      if (unified && unified.schema) {
        const tableName = modelToTable(modelName);
        const columns = unified.schema[tableName] || unified.schema[modelName.toLowerCase()] || unified.schema[modelName];
        if (columns && Object.keys(columns).length > 0) {
          content = formatUnifiedSchemaAnnotation(unified.framework, tableName, columns) + "\n" + content;
        }
      }
    }
  }

    // Vector 5: Token Budget Efficiency Header
  let efficiencyHeader = "";
  try {
    const stat = await fs.stat(validation.resolvedPath!);
    const rawTokens = Math.max(1, Math.ceil(stat.size / 4));
    const deliveredTokens = Math.max(1, Math.ceil(content.length / 4));
    const saved = Math.max(0, rawTokens - deliveredTokens);
    const ratio = ((saved / rawTokens) * 100).toFixed(1);
    efficiencyHeader = `<!-- [CodeContext Efficiency]: Raw: ~${rawTokens} tokens | Delivered: ~${deliveredTokens} tokens | Saved: ~${saved} tokens (${ratio}% compression) -->\n\n`;
  } catch {
    // Non-blocking header computation
  }

  return { content: [{ type: "text", text: efficiencyHeader + content }] };
}

export async function handleAnalyzeImpact(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = resolveProjectRoot(args, filePath);
  const rootDir = (args.rootDir && args.rootDir !== "undefined") ? String(args.rootDir) : projectRoot;

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
  const projectRoot = resolveProjectRoot(args, filePath);
  
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
  const projectRoot = resolveProjectRoot(args, rootDir);
  
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
  const projectRoot = resolveProjectRoot(args, filePath);

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
  const projectRoot = resolveProjectRoot(args, rootDir);

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


// NEW-02b: search_code_concept (v5.0.0)
export async function handleSearchCodeConcept(args: Record<string, unknown>) {
  const rootDir = (args.rootDir && args.rootDir !== "undefined") ? String(args.rootDir) : undefined;
  const projectRoot = resolveProjectRoot(args, rootDir);
  const targetDir = rootDir || projectRoot;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(targetDir);
  if (!validation.valid) throw new Error(validation.error);

  const registry = getRegistry();

  const result = await searchCodeConcept({
    rootDir: validation.resolvedPath!,
    projectRoot,
    query: String(args.query || ""),
    threshold: args.threshold !== undefined ? Number(args.threshold) : undefined,
    maxResults: args.maxResults !== undefined ? Number(args.maxResults) : undefined,
    fileExtensions: args.fileExtensions as string[] | undefined,
    excludeDirs: args.excludeDirs as string[] | undefined,
    registry,
  });

  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}


// NEW-02c: verify_import_integrity (v5.0.0)
export async function handleVerifyImportIntegrity(args: Record<string, unknown>) {
  if (!args.filePath) throw new Error("filePath is required for verify_import_integrity");
  const filePath = String(args.filePath);
  const projectRoot = resolveProjectRoot(args, filePath);

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const registry = getRegistry();

  const result = await verifyImportIntegrity({
    filePath: validation.resolvedPath!,
    projectRoot,
    content: args.content ? String(args.content) : undefined,
    registry,
  });

  if (!result.success) throw new Error(result.error);
  return { content: [{ type: "text", text: result.content! }] };
}

// NEW-03: explain_symbol
export async function handleExplainSymbol(args: Record<string, unknown>) {
  const filePath = String(args.filePath);
  const projectRoot = resolveProjectRoot(args, filePath);
  const rootDir = (args.rootDir && args.rootDir !== "undefined") ? String(args.rootDir) : projectRoot;

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
  const projectRoot = resolveProjectRoot(args);
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
  const projectRoot = resolveProjectRoot(args);

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
  const target = args.filePath ? String(args.filePath) : args.rootDir ? String(args.rootDir) : undefined;
  const projectRoot = resolveProjectRoot(args, target);
  const resolvedTarget = target ?? projectRoot;
  const isFile = Boolean(args.filePath);

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(resolvedTarget);
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
  const projectRoot = resolveProjectRoot(args);

  const validator = new SecurityValidator(projectRoot);
  const rootValidation = await validator.validateFilePath(projectRoot);
  if (!rootValidation.valid) throw new Error(rootValidation.error);

  const result = await parseRailsRoutes(rootValidation.resolvedPath!);
  if (!result) {
    return { content: [{ type: "text", text: JSON.stringify({ found: false, message: "No config/routes.rb found" }) }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

// TIA: get_impacted_tests — map modified AST symbols to target test suites
export async function handleGetImpactedTests(args: Record<string, unknown>) {
  if (!args.filePath) throw new Error("filePath is required");
  const filePath = String(args.filePath);
  const projectRoot = resolveProjectRoot(args, filePath);
  const symbolName = args.symbolName ? String(args.symbolName) : undefined;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const result = await getImpactedTests({
    filePath: validation.resolvedPath!,
    symbolName,
    projectRoot,
  });

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

// 3-Hop Call Hierarchy: get_call_hierarchy
export async function handleGetCallHierarchy(args: Record<string, unknown>) {
  if (!args.filePath) throw new Error("filePath is required");
  if (!args.symbolName) throw new Error("symbolName is required");

  const filePath = String(args.filePath);
  const symbolName = String(args.symbolName);
  const projectRoot = resolveProjectRoot(args, filePath);
  const direction = (args.direction as "callers" | "callees" | "both") || "both";
  const maxHops = args.maxHops ? Number(args.maxHops) : 3;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  const result = await getCallHierarchy({
    filePath: validation.resolvedPath!,
    symbolName,
    direction,
    maxHops,
    projectRoot,
  });

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

// Cross-Language Wire Contract: validate_wire_contract
export async function handleValidateWireContract(args: Record<string, unknown>) {
  if (!args.frontendFile) throw new Error("frontendFile is required");
  const frontendFile = String(args.frontendFile);
  const projectRoot = resolveProjectRoot(args, frontendFile);
  const backendFile = args.backendFile ? String(args.backendFile) : undefined;
  const endpoint = args.endpoint ? String(args.endpoint) : undefined;

  const validator = new SecurityValidator(projectRoot);
  const feVal = await validator.validateFilePath(frontendFile);
  if (!feVal.valid) throw new Error(feVal.error);

  let bePath: string | undefined = undefined;
  if (backendFile) {
    const beVal = await validator.validateFilePath(backendFile);
    if (!beVal.valid) throw new Error(beVal.error);
    bePath = beVal.resolvedPath;
  }

  const result = await validateWireContract({
    frontendFile: feVal.resolvedPath!,
    backendFile: bePath,
    endpoint,
    projectRoot,
  });

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

// Semantic Merge Conflict Predictor: predict_semantic_conflicts
export async function handlePredictSemanticConflicts(args: Record<string, unknown>) {
  const projectRoot = resolveProjectRoot(args);
  const baseBranch = args.baseBranch ? String(args.baseBranch) : undefined;
  const targetBranch = args.targetBranch ? String(args.targetBranch) : undefined;

  const result = await predictSemanticConflicts({
    baseBranch,
    targetBranch,
    projectRoot,
  });

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
