/**
 * Read core — extractSymbol and readLines
 */

import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import { BaseParser } from "../parsers/base.js";
import { safeRegexFindFirst } from "../utils/safeRegex.js";
import { validateRegexPattern } from "../utils/regexValidator.js";
import { CacheManager } from "../core/cacheManager.js";

export interface ReadResult {
  success: boolean;
  content?: string;
  symbols?: unknown[];
  error?: string;
}

async function getFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, "utf-8");
  return crypto.createHash("md5").update(content).digest("hex");
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
