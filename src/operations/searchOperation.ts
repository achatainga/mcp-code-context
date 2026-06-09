/**
 * Search pattern operation
 */

import * as fs from "node:fs/promises";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS, MAX_FILES_SEARCH, OPERATION_TIMEOUT_MS } from "../utils/constants.js";
import { safeRegexMultiFileBatchTest } from "../utils/safeRegex.js";
import { validateRegexPattern } from "../utils/regexValidator.js";
import { walkDir } from "../utils/fileWalker.js";
import { fuzzySearch } from "../utils/fuzzySearch.js";
import { searchWithNativeTool } from "../utils/searchTools.js";
import type { ReadResult } from "./readCore.js";

const DEFAULT_MAX_RESULTS = 10;
const SCAN_TIMEOUT_BASE_MS = 1000;
const SCAN_TIMEOUT_PER_FILE_MS = 10;

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

    const validation = validateRegexPattern(params.pattern);
    if (!validation.safe) {
      return {
        success: false,
        error: `Unsafe regex pattern: ${validation.issues.join(", ")}`,
      };
    }

    // Try native tools after regex safety gate (ripgrep > ugrep > ag > findstr/grep)
    const nativeResult = await searchWithNativeTool(params.pattern, params.rootDir, maxResults, 10000);
    if (nativeResult && !nativeResult.timedOut && nativeResult.matches.length > 0) {
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
    const batchResult = await safeRegexMultiFileBatchTest(params.pattern, fileEntries, scanTimeout);

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
