/**
 * Read Operations - v3.5.3
 * FIXES: extractSymbol args, batch regex (worker_threads) in readLines/searchPattern
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseParser } from "../parsers/base.js";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";
import { safeRegexFindFirst, safeRegexMultiFileBatchTest, validateRegexPattern } from "../utils/safeRegex.js";

export interface ReadResult {
  success: boolean;
  content?: string;
  symbols?: any[];
  error?: string;
}

/**
 * Extract a specific symbol from a file
 */
export async function extractSymbol(params: {
  filePath: string;
  projectRoot: string;
  symbolName: string;
  className?: string;
  parser: BaseParser;
}): Promise<ReadResult> {
  try {
    const content = await fs.readFile(params.filePath, "utf-8");
    const tree = params.parser.parse(content);

    // CRITICAL FIX: args were (tree, content, symbolName) — content was passed as symbolName
    const extracted = params.parser.extractSymbol(tree, params.symbolName, params.className);

    if (!extracted) {
      const symbols = params.parser.findSymbols(tree);
      return {
        success: false,
        error: `Symbol "${params.symbolName}" not found. Available: ${symbols.map(s => s.name).join(", ")}`,
        symbols,
      };
    }

    return {
      success: true,
      content: extracted,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read specific line ranges from a file
 */
export async function readLines(params: {
  filePath: string;
  startLine?: number;
  endLine?: number;
  aroundPattern?: string;
  contextLines?: number;
}): Promise<ReadResult> {
  try {
    const content = await fs.readFile(params.filePath, "utf-8");
    const lines = content.split("\n");

    if (params.aroundPattern) {
      // CRITICAL FIX: validate pattern before use (was raw new RegExp)
      const validation = validateRegexPattern(params.aroundPattern);
      if (!validation.safe) {
        return {
          success: false,
          error: `Unsafe regex pattern: ${validation.issues.join(", ")}`,
        };
      }

      const regex = new RegExp(params.aroundPattern);

      // Batch: send all lines to one worker, find first match
      const findResult = await safeRegexFindFirst(regex, lines);
      if (findResult.timedOut) {
        return {
          success: false,
          error: `Regex timed out searching for pattern (potential ReDoS)`,
        };
      }
      if (!findResult.success) {
        return { success: false, error: findResult.error };
      }

      const matchIndex = findResult.matchIndex!;
      if (matchIndex === -1) {
        return {
          success: false,
          error: `Pattern "${params.aroundPattern}" not found`,
        };
      }

      const context = params.contextLines || 5;
      const start = Math.max(0, matchIndex - context);
      const end = Math.min(lines.length, matchIndex + context + 1);

      return {
        success: true,
        content: lines.slice(start, end).join("\n"),
      };
    }

    if (params.startLine !== undefined && params.endLine !== undefined) {
      const start = params.startLine - 1; // Convert to 0-indexed
      const end = params.endLine;

      if (start < 0 || end > lines.length) {
        return {
          success: false,
          error: `Invalid line range: ${params.startLine}-${params.endLine} (file has ${lines.length} lines)`,
        };
      }

      return {
        success: true,
        content: lines.slice(start, end).join("\n"),
      };
    }

    return {
      success: false,
      error: "Must provide either startLine+endLine or aroundPattern",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Search for code patterns across files
 */
export async function searchPattern(params: {
  rootDir: string;
  pattern: string;
  fileExtensions?: string[];
  excludeDirs?: string[];
  showContext?: boolean;
  contextLines?: number;
  maxResults?: number;
}): Promise<ReadResult> {
  try {
    const maxResults = params.maxResults || 50;

    // Validate regex pattern
    const validation = validateRegexPattern(params.pattern);
    if (!validation.safe) {
      return {
        success: false,
        error: `Unsafe regex pattern: ${validation.issues.join(", ")}`,
      };
    }

    const regex = new RegExp(params.pattern, "g");
    const extensions = params.fileExtensions || SUPPORTED_EXTENSIONS;
    const excludeDirs = params.excludeDirs || EXCLUDE_DIRS;

    // Step 1: Collect all files and their lines
    const fileEntries: Array<{ path: string; lines: string[] }> = [];

    async function walkDir(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!(excludeDirs as readonly string[]).includes(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if ((extensions as readonly string[]).includes(ext)) {
            const content = await fs.readFile(fullPath, "utf-8");
            fileEntries.push({ path: fullPath, lines: content.split("\n") });
          }
        }
      }
    }

    await walkDir(params.rootDir);

    // CRITICAL: Prevent OOM in large monorepos
    const MAX_FILES = 2000;
    if (fileEntries.length > MAX_FILES) {
      return {
        success: false,
        error: `Too many files to search (${fileEntries.length}). Maximum: ${MAX_FILES}. Try narrowing your search with fileExtensions or excludeDirs.`
      };
    }

    // Step 2: ONE worker for ALL files — eliminates N worker spawns
    const scanTimeout = Math.min(30000, 1000 + fileEntries.length * 10);
    const batchResult = await safeRegexMultiFileBatchTest(regex, fileEntries, scanTimeout);

    if (batchResult.timedOut) {
      console.warn(`\u26a0\ufe0f  Regex scan timed out across ${fileEntries.length} files`);
      return { success: false, error: `Regex scan timed out (${fileEntries.length} files, potential ReDoS)` };
    }

    if (!batchResult.success) {
      return { success: false, error: batchResult.error };
    }

    // Step 3: Collect results up to maxResults
    const results: any[] = [];
    for (const match of batchResult.results!) {
      if (results.length >= maxResults) break;
      results.push({
        file: match.file,
        line: match.index + 1,
        content: match.content,
      });
    }

    return {
      success: true,
      content: JSON.stringify(results, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Analyze file dependencies (impact analysis)
 */
export async function analyzeImpact(params: {
  filePath: string;
  rootDir: string;
}): Promise<ReadResult> {
  try {
    const dependents: string[] = [];
    const targetFile = path.basename(params.filePath);

    async function walkDir(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!EXCLUDE_DIRS.includes(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (SUPPORTED_EXTENSIONS.includes(ext as any)) {
            const content = await fs.readFile(fullPath, "utf-8");

            // Check for imports/requires
            const importPatterns = [
              new RegExp(`import.*from.*['"].*${targetFile.replace(/\.[^.]+$/, "")}`, "g"),
              new RegExp(`require\\(['"].*${targetFile}`, "g"),
              new RegExp(`from.*${targetFile.replace(/\.[^.]+$/, "")}.*import`, "g"),
            ];

            if (importPatterns.some(pattern => pattern.test(content))) {
              dependents.push(fullPath);
            }
          }
        }
      }
    }

    await walkDir(params.rootDir);

    return {
      success: true,
      content: JSON.stringify({ file: params.filePath, dependents }, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
