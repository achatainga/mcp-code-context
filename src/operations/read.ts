/**
 * Read Operations - v3.6.1
 * FIXES: extractSymbol args, batch regex (worker_threads) in readLines/searchPattern
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { BaseParser } from "../parsers/base.js";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS, MAX_FILES_SEARCH, OPERATION_TIMEOUT_MS } from "../utils/constants.js";
import { safeRegexFindFirst, safeRegexMultiFileBatchTest, validateRegexPattern } from "../utils/safeRegex.js";
import { walkDir } from "../utils/fileWalker.js";
import { CacheManager } from "../core/cacheManager.js";
import { fuzzySearch } from "../utils/fuzzySearch.js";
import { searchWithNativeTool } from "../utils/searchTools.js";

const DEFAULT_MAX_RESULTS = 10; // Changed from 50 for pagination
const SCAN_TIMEOUT_BASE_MS = 1000;
const SCAN_TIMEOUT_PER_FILE_MS = 10;

async function getFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  return crypto.createHash('md5').update(content).digest('hex');
}

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
  useCache?: boolean;
  cache?: CacheManager | null;
}): Promise<ReadResult> {
  try {
    const cache = params.cache;
    
    // Try cache first
    if (cache) {
      const hash = await getFileHash(params.filePath);
      const cached = await cache.get(params.filePath, hash);
      
      if (cached) {
        const symbol = cached.symbols.find(s => 
          s.name === params.symbolName && (!params.className || s.className === params.className)
        );
        
        if (symbol) {
          const content = await fs.readFile(params.filePath, "utf-8");
          const tree = params.parser.parse(content);
          const extracted = params.parser.extractSymbol(tree, params.symbolName, params.className);
          
          if (extracted) {
            return { success: true, content: extracted };
          }
        }
      }
    }
    
    // Cache miss - parse file
    const content = await fs.readFile(params.filePath, "utf-8");
    const tree = params.parser.parse(content);
    const symbols = params.parser.findSymbols(tree);
    
    // Update cache
    if (cache) {
      const hash = await getFileHash(params.filePath);
      const stat = await fs.stat(params.filePath);
      await cache.set({
        filePath: params.filePath,
        hash,
        symbols,
        lastModified: stat.mtimeMs,
        cachedAt: Date.now(),
      });
    }

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
  startIndex?: number;
  fuzzyMatch?: boolean;
  fuzzyThreshold?: number;
}): Promise<ReadResult> {
  try {
    const maxResults = params.maxResults || DEFAULT_MAX_RESULTS;

    // Try native tools first (ripgrep > ugrep > ag > findstr/grep)
    const nativeResult = await searchWithNativeTool(params.pattern, params.rootDir, maxResults, 10000);
    if (nativeResult && !nativeResult.timedOut) {
      const startIdx = params.startIndex || 0;
      const paginatedMatches = nativeResult.matches.slice(startIdx, startIdx + maxResults);
      const results = paginatedMatches.map(m => ({
        file: m.file,
        line: m.line,
        content: m.content,
      }));
      const totalResults = nativeResult.matches.length;
      const hasMore = startIdx + maxResults < totalResults;
      const footer = `\n\nShowing ${startIdx + 1}-${startIdx + results.length} of ${totalResults} results (via ${nativeResult.tool})${hasMore ? ' (use startIndex to see more)' : ''}`;
      return { success: true, content: JSON.stringify(results, null, 2) + footer };
    }

    // Fallback to regex-based search
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

    await walkDir(params.rootDir, {
      extensions,
      excludeDirs,
      onFile: async (fullPath) => {
        const content = await fs.readFile(fullPath, "utf-8");
        fileEntries.push({ path: fullPath, lines: content.split("\n") });
      },
    });

    // CRITICAL: Prevent OOM in large monorepos
    if (fileEntries.length > MAX_FILES_SEARCH) {
      return {
        success: false,
        error: `Too many files to search (${fileEntries.length}). Maximum: ${MAX_FILES_SEARCH}. Try narrowing your search with fileExtensions or excludeDirs.`
      };
    }

    // Step 2: ONE worker for ALL files — eliminates N worker spawns
    const scanTimeout = Math.min(OPERATION_TIMEOUT_MS, SCAN_TIMEOUT_BASE_MS + fileEntries.length * SCAN_TIMEOUT_PER_FILE_MS);
    const batchResult = await safeRegexMultiFileBatchTest(regex, fileEntries, scanTimeout);

    if (batchResult.timedOut) {
      console.warn(`\u26a0\ufe0f  Regex scan timed out across ${fileEntries.length} files`);
      return { success: false, error: `Regex scan timed out (${fileEntries.length} files, potential ReDoS)` };
    }

    if (!batchResult.success) {
      return { success: false, error: batchResult.error };
    }

    // Step 3: Collect results with pagination
    const startIdx = params.startIndex || 0;
    const maxRes = params.maxResults || DEFAULT_MAX_RESULTS;
    const allMatches = batchResult.results!;
    
    // Apply fuzzy filtering if requested
    let filteredMatches = allMatches;
    if (params.fuzzyMatch) {
      const fuzzyThreshold = params.fuzzyThreshold ?? 0.4;
      const searchItems = allMatches.map(m => ({
        ...m,
        searchText: `${m.file} ${m.content}`,
      }));
      
      const fuzzyResults = fuzzySearch(searchItems, params.pattern, {
        threshold: fuzzyThreshold,
        keys: ['searchText'],
      });
      
      filteredMatches = fuzzyResults.map(r => r.item);
    }
    
    // Paginate results
    const paginatedMatches = filteredMatches.slice(startIdx, startIdx + maxRes);
    const results: any[] = paginatedMatches.map(match => ({
      file: match.file,
      line: match.index + 1,
      content: match.content,
    }));
    
    // Add pagination footer
    const totalResults = filteredMatches.length;
    const hasMore = startIdx + maxRes < totalResults;
    const footer = `\n\nShowing ${startIdx + 1}-${startIdx + results.length} of ${totalResults} results${hasMore ? ' (use startIndex to see more)' : ''}`;

    return {
      success: true,
      content: JSON.stringify(results, null, 2) + footer,
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

    await walkDir(params.rootDir, {
      extensions: SUPPORTED_EXTENSIONS,
      excludeDirs: EXCLUDE_DIRS,
      onFile: async (fullPath) => {
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
      },
    });

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
