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
import {
  validateFilePath,
  validateSymbolName,
} from "../utils/validation.js";
import { IMPORTABLE_EXTENSIONS } from "../utils/constants.js";

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

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.normalizedPath!;

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(ext)) {
    return errorResponse(`Unsupported file type: ${ext}`);
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
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

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.normalizedPath!;

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(ext)) {
    return errorResponse(`Unsupported file type: ${ext}`);
  }

  let fileContent: string;
  try {
    fileContent = fs.readFileSync(resolvedPath, "utf-8");
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
    for (const res of results) {
      try { createBackup(res.filePath); } catch (e) {}
    }

    try {
      for (const res of results) {
        fs.writeFileSync(res.filePath, res.newContent, "utf-8");
        invalidateFileCache(res.filePath);
      }
    } catch (error: unknown) {
      return errorResponse(`Write failed: ${error instanceof Error ? error.message : String(error)}`);
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

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.normalizedPath!;

  let sourceContent: string;
  try {
    sourceContent = fs.readFileSync(resolvedPath, "utf-8");
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
    const allFiles = ignoreManager.walkDirectory();

    for (const dependentFile of allFiles) {
      if (path.resolve(dependentFile) === resolvedPath) continue;

      const ext = path.extname(dependentFile).toLowerCase();
      if (!IMPORTABLE_EXTENSIONS.has(ext)) continue;

      let depContent: string;
      try {
        depContent = fs.readFileSync(dependentFile, "utf-8");
      } catch {
        continue;
      }

      const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(?<=^|[^a-zA-Z0-9_$])(${escaped})(?=[^a-zA-Z0-9_$]|$)`);
      if (!regex.test(depContent)) continue;

      const depResult = renameReferencesInFile(dependentFile, depContent, oldName, newName);
      if (depResult.success && depResult.newContent !== depContent) {
        results.push({
          filePath: path.resolve(dependentFile),
          oldContent: depContent,
          newContent: depResult.newContent,
        });
      }
    }
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

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.normalizedPath!;

  let fileContent: string;
  try {
    fileContent = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return errorResponse(`Read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Safety check
  if (!force) {
    const projectRoot = findProjectRoot(resolvedPath);
    if (projectRoot) {
      const ignoreManager = new IgnoreManager(projectRoot);
      const allFiles = ignoreManager.walkDirectory();
      
      for (const f of allFiles) {
        if (path.resolve(f) === resolvedPath) continue;
        const fExt = path.extname(f).toLowerCase();
        if (!IMPORTABLE_EXTENSIONS.has(fExt)) continue;
        
        try {
          const fContent = fs.readFileSync(f, "utf-8");
          const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(`(?<=^|[^a-zA-Z0-9_$])(${escaped})(?=[^a-zA-Z0-9_$]|$)`);
          
          if (regex.test(fContent)) {
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
