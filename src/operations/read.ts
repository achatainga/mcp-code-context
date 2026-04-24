/**
 * Read Operations - v3.2.0
 * IMPROVEMENTS: Centralized constants
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseParser } from "../parsers/base.js";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";

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
    const extracted = params.parser.extractSymbol(tree, content, params.symbolName);

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
      const regex = new RegExp(params.aroundPattern);
      const matchIndex = lines.findIndex(line => regex.test(line));
      
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
    const results: any[] = [];
    const regex = new RegExp(params.pattern, "g");
    const extensions = params.fileExtensions || SUPPORTED_EXTENSIONS;
    const excludeDirs = params.excludeDirs || EXCLUDE_DIRS;
    const maxResults = params.maxResults || 50;

    async function walkDir(dir: string) {
      if (results.length >= maxResults) return;

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!(excludeDirs as readonly string[]).includes(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if ((extensions as readonly string[]).includes(ext)) {
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");

            lines.forEach((line, index) => {
              if (results.length >= maxResults) return;
              if (regex.test(line)) {
                results.push({
                  file: fullPath,
                  line: index + 1,
                  content: line.trim(),
                });
              }
            });
          }
        }
      }
    }

    await walkDir(params.rootDir);

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
