/**
 * writeHandlers.ts — Write Tool Handlers
 * 
 * Handles all write operations with two-phase confirmation:
 * - write_file_surgical
 * - insert_symbol
 * - rename_symbol
 * - remove_symbol
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { IgnoreManager } from "../utils/ignoreManager.js";
import {
  replaceSymbol,
  insertCode,
  renameInFile,
  renameReferencesInFile,
  removeSymbolFromFile,
  WRITABLE_EXTENSIONS,
  type WriteResult,
  type InsertPosition,
} from "../ast/writers/symbolWriter.js";
import { generateDiff, generateMultiFileDiff } from "../utils/diffEngine.js";
import { createBackup, restoreBackup } from "../utils/backupManager.js";
import { extractFallbackSymbols, findClosestSymbols } from "../utils/fuzzyMatch.js";
import { confirmationCache } from "../utils/confirmationCache.js";
import { invalidateFileCache } from "../cache/astCache.js";
import { TransactionManager } from "../utils/transactionManager.js";
import {
  validateFilePath,
  validateSymbolName,
} from "../utils/validation.js";
import { IMPORTABLE_EXTENSIONS } from "../utils/constants.js";
import { checkSymbolUsage } from "../utils/dependencyChecker.js";

// ─── Handler: write_file_surgical ───────────────────────────────────

export async function handleWriteFileSurgical(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const symbolName = args.symbolName as string;
  const newContent = args.newContent as string;
  const className = args.className as string | undefined;
  
  const confirmationToken = args.confirmationToken as string | undefined;
  const confirm = args.confirm as boolean | undefined;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  // PHASE 2: Apply
  if (confirmationToken && confirm) {
    const pending = confirmationCache.consume(confirmationToken);
    if (!pending || pending.operation !== "write_file_surgical") {
      return errorResponse("Invalid or expired confirmation token");
    }
    
    const resolvedPath = pending.filePath;
    try {
      createBackup(resolvedPath);
    } catch (error: unknown) {
      return errorResponse(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      fs.writeFileSync(resolvedPath, pending.payload.newContentFull, "utf-8");
      invalidateFileCache(resolvedPath);
    } catch (error: unknown) {
      restoreBackup(resolvedPath);
      return errorResponse(`Write failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `// ✅ Symbol "${pending.payload.symbolName}" replaced\n// File: ${resolvedPath}\n\n${pending.payload.diff}`,
        },
      ],
    };
  }

  // PHASE 1: Dry-Run
  if (!symbolName) return errorResponse("Missing required parameter: symbolName");
  if (!newContent) return errorResponse("Missing required parameter: newContent");

  // Validate symbol name
  const symbolValidation = validateSymbolName(symbolName);
  if (!symbolValidation.valid) {
    return errorResponse(symbolValidation.error!);
  }

  // SECURITY: Use secure validation with project boundary enforcement
  const { validateFilePathSecure } = await import("../utils/secureValidation.js");
  const validation = validateFilePathSecure(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.resolvedPath!;

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(ext)) {
    return errorResponse(`Unsupported file type: ${ext}`);
  }

  let content: string;
  try {
    content = await fs.promises.readFile(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return errorResponse(`Read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result: WriteResult = replaceSymbol(resolvedPath, content, symbolName, newContent, className);

  if (!result.success) {
    const isNotFoundError = result.error && result.error.includes("not found");
    if (isNotFoundError) {
        const available = extractFallbackSymbols(content);
        const closest = findClosestSymbols(symbolName, available, 5);
        
        const availableFormatted = available.slice(0, 15).map(s => `${s.name} (${s.type}${s.className ? ` in ${s.className}` : ''})`);
        if (available.length > 15) availableFormatted.push(`...and ${available.length - 15} more`);

        const suggestions = [];
        if (className) {
          const inOtherClass = available.find(s => s.name === symbolName && s.className !== className);
          if (inOtherClass) suggestions.push(`Try className: '${inOtherClass.className}'`);
        } else {
          const needsScope = available.filter(s => s.name === symbolName && s.className);
          if (needsScope.length > 0) suggestions.push(`Use className: '${needsScope[0].className}'`);
        }

        if (closest.length > 0) {
          suggestions.push(`Similar: ${closest.map(s => s.name).join(', ')}`);
        }

        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: result.error,
                available_symbols: availableFormatted,
                suggestions
              }, null, 2),
            },
          ],
        };
    }
    return errorResponse(result.error || "Unknown error");
  }

  const diff = generateDiff(content, result.newContent, resolvedPath);
  
  const token = confirmationCache.add("write_file_surgical", resolvedPath, {
    symbolName,
    newContentFull: result.newContent,
    diff,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `// 🔍 DRY-RUN: Review changes below\n// To apply: confirmationToken: "${token}", confirm: true\n\n${diff}`,
      },
    ],
  };
}

// ─── Handler: insert_symbol ─────────────────────────────────────────

export async function handleInsertSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const code = args.code as string;
  const anchorSymbol = (args.anchorSymbol as string) || null;
  const position = (args.position as InsertPosition) || "after";
  const className = args.className as string | undefined;
  
  const confirmationToken = args.confirmationToken as string | undefined;
  const confirm = args.confirm as boolean | undefined;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  // PHASE 2
  if (confirmationToken && confirm) {
    const pending = confirmationCache.consume(confirmationToken);
    if (!pending || pending.operation !== "insert_symbol") {
      return errorResponse("Invalid or expired confirmation token");
    }
    
    const resolvedPath = pending.filePath;
    try {
      createBackup(resolvedPath);
    } catch (error: unknown) {
      return errorResponse(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      fs.writeFileSync(resolvedPath, pending.payload.newContentFull, "utf-8");
      invalidateFileCache(resolvedPath);
    } catch (error: unknown) {
      restoreBackup(resolvedPath);
      return errorResponse(`Write failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `// ✅ Code inserted\n// File: ${resolvedPath}\n\n${pending.payload.diff}`,
        },
      ],
    };
  }

  // PHASE 1
  if (!code) return errorResponse("Missing required parameter: code");

  // SECURITY: Use secure validation with project boundary enforcement
  const { validateFilePathSecure } = await import("../utils/secureValidation.js");
  const validation = validateFilePathSecure(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.resolvedPath!;

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(ext)) {
    return errorResponse(`Unsupported file type: ${ext}`);
  }

  let fileContent: string;
  try {
    fileContent = await fs.promises.readFile(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return errorResponse(`Read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result: WriteResult = insertCode(resolvedPath, fileContent, code, anchorSymbol, position, className);

  if (!result.success) {
    return errorResponse(result.error || "Unknown error");
  }

  const diff = generateDiff(fileContent, result.newContent, resolvedPath);

  const token = confirmationCache.add("insert_symbol", resolvedPath, {
    newContentFull: result.newContent,
    diff,
    anchorSymbol,
    position
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `// 🔍 DRY-RUN: Review changes below\n// To apply: confirmationToken: "${token}", confirm: true\n\n${diff}`,
      },
    ],
  };
}

// ─── Handler: rename_symbol ─────────────────────────────────────────

export async function handleRenameSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const oldName = args.oldName as string;
  const newName = args.newName as string;
  const rootDir = args.rootDir as string | undefined;
  
  const confirmationToken = args.confirmationToken as string | undefined;
  const confirm = args.confirm as boolean | undefined;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  // PHASE 2
  if (confirmationToken && confirm) {
    const pending = confirmationCache.consume(confirmationToken);
    if (!pending || pending.operation !== "rename_symbol") {
      return errorResponse("Invalid or expired confirmation token");
    }
    
    const results = pending.payload.results;
    
    const transaction = new TransactionManager();
    transaction.stageMultiple(results.map((r: any) => ({
      filePath: r.filePath,
      newContent: r.newContent
    })));

    const commitResult = await transaction.commit();
    if (!commitResult.success) {
      return errorResponse(commitResult.error!);
    }

    for (const res of results) {
      invalidateFileCache(res.filePath);
    }

    return {
      content: [{
        type: "text" as const,
        text: `// ✅ Rename applied\n\n${pending.payload.diff}`,
      }],
    };
  }

  // PHASE 1
  if (!oldName) return errorResponse("Missing required parameter: oldName");
  if (!newName) return errorResponse("Missing required parameter: newName");

  // Validate symbol names
  const oldValidation = validateSymbolName(oldName);
  if (!oldValidation.valid) {
    return errorResponse(`Invalid oldName: ${oldValidation.error}`);
  }

  const newValidation = validateSymbolName(newName);
  if (!newValidation.valid) {
    return errorResponse(`Invalid newName: ${newValidation.error}`);
  }

  // SECURITY: Use secure validation with project boundary enforcement
  const { validateFilePathSecure } = await import("../utils/secureValidation.js");
  const validation = validateFilePathSecure(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.resolvedPath!;

  // SECURITY: Block cross-file rename for languages without AST support
  const ext = path.extname(resolvedPath).toLowerCase();
  if (['.dart', '.py', '.pyi'].includes(ext)) {
    return errorResponse(
      `⚠️ Cross-file rename not supported for ${ext} files.\n\n` +
      `Reason: No AST parser available for safe refactoring across multiple files.\n` +
      `Risk: Regex-based rename may corrupt strings, comments, or unrelated code.\n\n` +
      `Recommendation: Use IDE refactoring tools:\n` +
      `  • Dart: VS Code with Dart extension (F2 key)\n` +
      `  • Python: PyCharm, VS Code with Pylance (F2 key)\n\n` +
      `Alternative: Use write_file_surgical to rename within a single file.`
    );
  }

  let sourceContent: string;
  try {
    sourceContent = await fs.promises.readFile(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return errorResponse(`Read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const sourceResult = renameInFile(resolvedPath, sourceContent, oldName, newName);
  if (!sourceResult.success) {
    return errorResponse(sourceResult.error || `Symbol "${oldName}" not found`);
  }

  const results: { filePath: string; oldContent: string; newContent: string }[] = [
    {
      filePath: resolvedPath,
      oldContent: sourceContent,
      newContent: sourceResult.newContent,
    },
  ];

  const projectRoot = rootDir ? path.resolve(rootDir) : findProjectRoot(resolvedPath);
  if (projectRoot) {
    const ignoreManager = new IgnoreManager(projectRoot);
    const allFiles = await ignoreManager.walkDirectoryAsync();

    const { processBatched } = await import("../utils/arrayUtils.js");
    const dependentResults = await processBatched(
      allFiles.filter(f => path.resolve(f) !== resolvedPath),
      async (dependentFile) => {
        const ext = path.extname(dependentFile).toLowerCase();
        if (!IMPORTABLE_EXTENSIONS.has(ext)) return null;

        let depContent: string;
        try {
          depContent = await fs.promises.readFile(dependentFile, "utf-8");
        } catch {
          return null;
        }

        const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(?<=^|[^a-zA-Z0-9_$])(${escaped})(?=[^a-zA-Z0-9_$]|$)`);
        if (!regex.test(depContent)) return null;

        const depResult = renameReferencesInFile(dependentFile, depContent, oldName, newName);
        if (depResult.success && depResult.newContent !== depContent) {
          return {
            filePath: path.resolve(dependentFile),
            oldContent: depContent,
            newContent: depResult.newContent,
          };
        }
        return null;
      },
      50
    );

    results.push(...dependentResults.filter(r => r !== null));
  }

  const multiDiff = generateMultiFileDiff(results);
  
  const token = confirmationCache.add("rename_symbol", resolvedPath, {
    results,
    diff: multiDiff
  });

  return {
    content: [{
      type: "text" as const,
      text: `// 🔍 DRY-RUN: Review changes below\n// To apply: confirmationToken: "${token}", confirm: true\n\n${multiDiff}`,
    }],
  };
}

// ─── Handler: remove_symbol ─────────────────────────────────────────

export async function handleRemoveSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const symbolName = args.symbolName as string;
  const className = args.className as string | undefined;
  const force = (args.force as boolean) || false;
  
  const confirmationToken = args.confirmationToken as string | undefined;
  const confirm = args.confirm as boolean | undefined;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  // PHASE 2
  if (confirmationToken && confirm) {
    const pending = confirmationCache.consume(confirmationToken);
    if (!pending || pending.operation !== "remove_symbol") {
      return errorResponse("Invalid or expired confirmation token");
    }
    
    const resolvedPath = pending.filePath;
    try { createBackup(resolvedPath); } catch (e) {}

    try {
      fs.writeFileSync(resolvedPath, pending.payload.newContentFull, "utf-8");
      invalidateFileCache(resolvedPath);
    } catch (error: unknown) {
      restoreBackup(resolvedPath);
      return errorResponse(`Write failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      content: [{
        type: "text" as const,
        text: `// ✅ Symbol "${pending.payload.symbolName}" removed\n\n${pending.payload.diff}`,
      }],
    };
  }

  if (!symbolName) return errorResponse("Missing required parameter: symbolName");

  // Validate symbol name
  const symbolValidation = validateSymbolName(symbolName);
  if (!symbolValidation.valid) {
    return errorResponse(symbolValidation.error!);
  }

  // SECURITY: Use secure validation with project boundary enforcement
  const { validateFilePathSecure } = await import("../utils/secureValidation.js");
  const validation = validateFilePathSecure(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.resolvedPath!;

  let fileContent: string;
  try {
    fileContent = await fs.promises.readFile(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return errorResponse(`Read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Safety check
  if (!force) {
    const projectRoot = findProjectRoot(resolvedPath);
    if (projectRoot) {
      const ignoreManager = new IgnoreManager(projectRoot);
      const allFiles = await ignoreManager.walkDirectoryAsync();
      
      for (const f of allFiles) {
        if (path.resolve(f) === resolvedPath) continue;
        const fExt = path.extname(f).toLowerCase();
        if (!IMPORTABLE_EXTENSIONS.has(fExt)) continue;
        
        try {
          const fContent = await fs.promises.readFile(f, "utf-8");
          const isUsed = await checkSymbolUsage(f, fContent, symbolName);
          
          if (isUsed) {
             return errorResponse(`Symbol "${symbolName}" used in ${path.relative(projectRoot, f)}. Use force: true to delete.`);
          }
        } catch {}
      }
    }
  }

  const result = removeSymbolFromFile(resolvedPath, fileContent, symbolName, className);
  if (!result.success) {
    return errorResponse(result.error || "Unknown error");
  }

  const diff = generateDiff(fileContent, result.newContent, resolvedPath);
  
  const token = confirmationCache.add("remove_symbol", resolvedPath, {
    symbolName,
    newContentFull: result.newContent,
    diff
  });

  return {
    content: [{
      type: "text" as const,
      text: `// 🔍 DRY-RUN: Review changes below\n// To apply: confirmationToken: "${token}", confirm: true\n\n${diff}`,
    }],
  };
}

// ─── Utility Functions ──────────────────────────────────────────────

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `❌ ${message}` }],
    isError: true,
  };
}

function findProjectRoot(filePath: string): string | undefined {
  const ROOT_MARKERS = ["package.json", ".git", "pubspec.yaml"];
  let current = path.dirname(path.resolve(filePath));
  const root = path.parse(current).root;

  while (current !== root) {
    for (const marker of ROOT_MARKERS) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }
    current = path.dirname(current);
  }

  return undefined;
}
