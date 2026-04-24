/**
 * search_code_pattern — Search for code patterns across files
 * 
 * AST-aware search that finds patterns in code while optionally excluding
 * matches in strings, comments, and other non-code contexts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { IgnoreManager } from "../utils/ignoreManager.js";

export interface SearchCodePatternArgs {
  rootDir: string;
  pattern: string;
  fileExtensions?: string[];
  excludeDirs?: string[];
  showContext?: boolean;
  contextLines?: number;
  maxResults?: number;
  astAware?: boolean;
}

export interface SearchMatch {
  file: string;
  lineNumber: number;
  line: string;
  context?: string[];
}

export interface SearchCodePatternResult {
  success: boolean;
  matches?: SearchMatch[];
  error?: string;
  totalMatches?: number;
}

/**
 * Synchronous version (deprecated, use async version)
 * @deprecated Use searchCodePattern (async) instead
 */
export function searchCodePatternSync(args: SearchCodePatternArgs): SearchCodePatternResult {
  const {
    rootDir,
    pattern,
    fileExtensions = DEFAULT_EXTENSIONS,
    excludeDirs = ["node_modules", "dist", "build", ".git"],
    showContext = true,
    contextLines = 3,
    maxResults = 50,
  } = args;

  const resolvedRoot = path.resolve(rootDir);

  if (!fs.existsSync(resolvedRoot)) {
    return {
      success: false,
      error: `Directory not found: ${resolvedRoot}`,
    };
  }

  const ignoreManager = new IgnoreManager(resolvedRoot);
  const allFiles = ignoreManager.walkDirectory();

  const matches: SearchMatch[] = [];
  let totalMatches = 0;

  const regex = new RegExp(pattern, "gi");

  for (const file of allFiles) {
    const ext = path.extname(file).toLowerCase();
    if (!fileExtensions.includes(ext)) continue;

    const relativePath = path.relative(resolvedRoot, file);
    if (excludeDirs.some(dir => relativePath.includes(dir))) continue;

    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (regex.test(line)) {
        totalMatches++;

        if (matches.length < maxResults) {
          const match: SearchMatch = {
            file: path.relative(resolvedRoot, file).replace(/\\/g, "/"),
            lineNumber: i + 1,
            line: line.trim(),
          };

          if (showContext) {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);
            match.context = lines.slice(start, end + 1).map((l, idx) => {
              const lineNum = start + idx + 1;
              const marker = lineNum === i + 1 ? ">" : " ";
              return `${marker} ${lineNum}: ${l}`;
            });
          }

          matches.push(match);
        }
      }

      regex.lastIndex = 0;
    }
  }

  return {
    success: true,
    matches,
    totalMatches,
  };
}

const DEFAULT_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs",
  ".py", ".php", ".dart", ".java", ".go", ".rs"
];

/**
 * Search for a pattern across code files (async)
 */
export async function searchCodePattern(args: SearchCodePatternArgs): Promise<SearchCodePatternResult> {
  const {
    rootDir,
    pattern,
    fileExtensions = DEFAULT_EXTENSIONS,
    excludeDirs = ["node_modules", "dist", "build", ".git"],
    showContext = true,
    contextLines = 3,
    maxResults = 50,
    astAware = false,
  } = args;

  const resolvedRoot = path.resolve(rootDir);

  if (!fs.existsSync(resolvedRoot)) {
    return {
      success: false,
      error: `Directory not found: ${resolvedRoot}`,
    };
  }

  const ignoreManager = new IgnoreManager(resolvedRoot);
  const allFiles = await ignoreManager.walkDirectoryAsync();

  const matches: SearchMatch[] = [];
  let totalMatches = 0;

  const regex = new RegExp(pattern, "gi");

  for (const file of allFiles) {
    // Check extension
    const ext = path.extname(file).toLowerCase();
    if (!fileExtensions.includes(ext)) continue;

    // Check excluded directories
    const relativePath = path.relative(resolvedRoot, file);
    if (excludeDirs.some(dir => relativePath.includes(dir))) continue;

    let content: string;
    try {
      content = await fs.promises.readFile(file, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (regex.test(line)) {
        totalMatches++;

        if (matches.length < maxResults) {
          const match: SearchMatch = {
            file: path.relative(resolvedRoot, file).replace(/\\/g, "/"),
            lineNumber: i + 1,
            line: line.trim(),
          };

          if (showContext) {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);
            match.context = lines.slice(start, end + 1).map((l, idx) => {
              const lineNum = start + idx + 1;
              const marker = lineNum === i + 1 ? ">" : " ";
              return `${marker} ${lineNum}: ${l}`;
            });
          }

          matches.push(match);
        }
      }

      // Reset regex lastIndex for global flag
      regex.lastIndex = 0;
    }
  }

  return {
    success: true,
    matches,
    totalMatches,
  };
}
