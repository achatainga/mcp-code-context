/**
 * Read Operations - v3.6.3
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
      const validation = validateRegexPattern(params.aroundPattern);
      if (!validation.safe) {
        return {
          success: false,
          error: `Unsafe regex pattern: ${validation.issues.join(", ")}`,
        };
      }

      const regex = new RegExp(params.aroundPattern);

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
      const matchLine = matchIndex + 1;

      return {
        success: true,
        content: `Match found at line ${matchLine} (showing lines ${start + 1}-${end}):\n${lines.slice(start, end).join("\n")}`,
      };
    }

    if (params.startLine !== undefined && params.endLine !== undefined) {
      const start = Math.max(0, params.startLine - 1);
      // Clamp endLine to actual file length instead of erroring
      const clampedEnd = Math.min(params.endLine, lines.length);
      const clampWarning = params.endLine > lines.length
        ? `\n⚠️ endLine ${params.endLine} clamped to ${lines.length} (file has ${lines.length} lines)\n`
        : "";

      if (start >= lines.length) {
        return {
          success: false,
          error: `startLine ${params.startLine} exceeds file length (${lines.length} lines)`,
        };
      }

      return {
        success: true,
        content: clampWarning + lines.slice(start, clampedEnd).join("\n"),
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

/**
 * NEW-02: Search symbols by name across the repo (AST-aware, not text search)
 */
export async function searchSymbols(params: {
  rootDir: string;
  query: string;
  projectRoot: string;
  fuzzy?: boolean;
  types?: string[];
  fileExtensions?: string[];
  excludeDirs?: string[];
  maxResults?: number;
}): Promise<ReadResult> {
  try {
    const { ParserRegistry } = await import('../parsers/registry.js');
    const { CodeContextEngine } = await import('../core/engine.js');

    const engine = new CodeContextEngine();
    await engine.init();
    const registry = new ParserRegistry(engine);
    await registry.init();

    const extensions = params.fileExtensions || SUPPORTED_EXTENSIONS;
    const excludeDirs = params.excludeDirs || EXCLUDE_DIRS;
    const maxResults = params.maxResults || 20;
    const results: Array<{ name: string; type: string; file: string; startLine?: number; endLine?: number; className?: string }> = [];

    await walkDir(params.rootDir, {
      extensions,
      excludeDirs,
      onFile: async (fullPath) => {
        if (results.length >= maxResults * 3) return; // over-collect for fuzzy filtering
        const ext = path.extname(fullPath);
        const parser = registry.getParser(ext);
        if (!parser) return;

        const content = await fs.readFile(fullPath, 'utf-8');
        const tree = parser.parse(content);
        const symbols = parser.findSymbols(tree);

        for (const sym of symbols) {
          if (params.types && params.types.length > 0 && !params.types.includes(sym.type)) continue;
          results.push({
            name: sym.name,
            type: sym.type,
            file: fullPath,
            startLine: sym.startLine,
            endLine: sym.endLine,
            className: sym.className,
          });
        }
      },
    });

    // Filter by query
    let filtered = results;
    if (params.fuzzy) {
      const fuzzyResults = fuzzySearch(results, params.query, {
        threshold: 0.4,
        keys: ['name'],
      });
      filtered = fuzzyResults.map(r => r.item);
    } else {
      const q = params.query.toLowerCase();
      filtered = results.filter(r => r.name.toLowerCase().includes(q));
    }

    const paginated = filtered.slice(0, maxResults);
    const hasMore = filtered.length > maxResults;
    const footer = `\n\nShowing ${paginated.length} of ${filtered.length} symbols${hasMore ? ' (increase maxResults to see more)' : ''}`;

    return {
      success: true,
      content: JSON.stringify(paginated, null, 2) + footer,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * NEW-03: Explain a symbol — signature + callers + callees in one call
 */
export async function explainSymbol(params: {
  filePath: string;
  projectRoot: string;
  symbolName: string;
  className?: string;
  parser: BaseParser;
  rootDir: string;
}): Promise<ReadResult> {
  try {
    const content = await fs.readFile(params.filePath, 'utf-8');
    const tree = params.parser.parse(content);
    const symbols = params.parser.findSymbols(tree);

    const sym = symbols.find(s =>
      s.name === params.symbolName && (!params.className || s.className === params.className)
    );

    if (!sym) {
      return {
        success: false,
        error: `Symbol "${params.symbolName}" not found. Available: ${symbols.map(s => s.name).join(', ')}`,
      };
    }

    const extracted = params.parser.extractSymbol(tree, params.symbolName, params.className);

    // Extract signature (first line of the symbol)
    const signature = extracted ? extracted.split('\n')[0].trim() : '';

    // Find callers (files that reference this symbol name)
    const callers: string[] = [];
    await walkDir(params.rootDir, {
      extensions: SUPPORTED_EXTENSIONS,
      excludeDirs: EXCLUDE_DIRS,
      onFile: async (fullPath) => {
        if (fullPath === params.filePath) return;
        const c = await fs.readFile(fullPath, 'utf-8');
        if (c.includes(params.symbolName)) callers.push(fullPath);
      },
    });

    const result = {
      name: sym.name,
      type: sym.type,
      className: sym.className,
      signature,
      startLine: sym.startLine,
      endLine: sym.endLine,
      file: params.filePath,
      callers: callers.slice(0, 10), // cap at 10
      callerCount: callers.length,
    };

    return {
      success: true,
      content: JSON.stringify(result, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * NEW-05: Batch read multiple symbols in one call
 */
export async function batchRead(params: {
  reads: Array<{ filePath: string; symbolName: string; className?: string }>;
  projectRoot: string;
  parser: (ext: string) => BaseParser | null;
}): Promise<ReadResult> {
  try {
    const results: Array<{
      filePath: string;
      symbolName: string;
      className?: string;
      content?: string;
      error?: string;
    }> = [];

    for (const read of params.reads) {
      const ext = path.extname(read.filePath);
      const parser = params.parser(ext);
      if (!parser) {
        results.push({ ...read, error: `No parser for ${ext}` });
        continue;
      }

      const r = await extractSymbol({
        filePath: read.filePath,
        projectRoot: params.projectRoot,
        symbolName: read.symbolName,
        className: read.className,
        parser,
      });

      results.push({
        filePath: read.filePath,
        symbolName: read.symbolName,
        className: read.className,
        content: r.content,
        error: r.error,
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
