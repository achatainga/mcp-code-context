/**
 * readHandlers.ts — Read Tool Handlers
 * 
 * Handles all read-only operations:
 * - get_semantic_repo_map
 * - read_file_surgical
 * - analyze_impact
 * - read_file_lines
 * - search_code_pattern
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { IgnoreManager } from "../utils/ignoreManager.js";
import { compressFile, extractSymbol } from "../ast/semanticCompressor.js";
import { extractFallbackSymbols, findClosestSymbols } from "../utils/fuzzyMatch.js";
import { readFileLines } from "../tools/readFileLines.js";
import { searchCodePattern } from "../tools/searchCodePattern.js";
import { compressionCache, symbolCache, getSymbolCacheKey } from "../cache/astCache.js";
import {
  validateFilePath,
  validateDirectoryPath,
  validateFileSize,
  validateFileContent,
} from "../utils/validation.js";
import {
  SOURCE_EXTENSIONS,
  IMPORTABLE_EXTENSIONS,
  MAX_FILES_FOR_REPO_MAP,
} from "../utils/constants.js";

// ─── Types ──────────────────────────────────────────────────────────

interface FileEntry {
  relativePath: string;
  language: string;
  compressed: string;
}

interface Dependent {
  file: string;
  imports: string[];
}

// ─── Handler: get_semantic_repo_map ─────────────────────────────────

export async function handleGetSemanticRepoMap(args: Record<string, unknown>, signal?: AbortSignal) {
  const directoryPath = args.directoryPath as string;
  const format = (args.format as string) || "xml";

  if (!directoryPath) {
    return errorResponse("Missing required parameter: directoryPath");
  }

  const validation = validateDirectoryPath(directoryPath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.normalizedPath!;
  const ignoreManager = new IgnoreManager(resolvedPath);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  
  try {
    if (signal?.aborted) throw new Error("Operation cancelled");
    
    const files = await ignoreManager.walkDirectoryAsync(resolvedPath, controller.signal);

  // CRITICAL: Limit files to prevent timeout
  if (files.length > MAX_FILES_FOR_REPO_MAP) {
    return errorResponse(
      `Repository too large (${files.length} files). ` +
      `get_semantic_repo_map supports up to ${MAX_FILES_FOR_REPO_MAP} files. ` +
      `Use a more specific directory path or increase MAX_FILES_FOR_REPO_MAP.`
    );
  }

  const projectName = path.basename(resolvedPath);
  const entries: FileEntry[] = [];
  let skippedCount = 0;

  // Process files in batches to avoid blocking
  const { processBatched } = await import("../utils/arrayUtils.js");
  const results = await processBatched(
    files,
    async (file) => {
      const ext = path.extname(file).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) {
        return { skipped: true };
      }

      // Validate file size
      const sizeValidation = validateFileSize(file);
      if (!sizeValidation.valid) {
        return { skipped: true };
      }

      let content: string;
      try {
        content = await fs.promises.readFile(file, "utf-8");
      } catch {
        return { skipped: true };
      }

      // Validate content
      const contentValidation = validateFileContent(content);
      if (!contentValidation.valid) {
        return { skipped: true };
      }

      const relativePath = path.relative(resolvedPath, file).replace(/\\/g, "/");
      const language = getLanguageName(ext);

      // Check cache first
      const cacheKey = file;
      let compressed = compressionCache.get(cacheKey, file);

      if (!compressed) {
        compressed = compressFile(file, content);
        compressionCache.set(cacheKey, compressed, file);
      }

      return { entry: { relativePath, language, compressed } };
    },
    50
  );

  for (const result of results) {
    if ('skipped' in result) {
      skippedCount++;
    } else if ('entry' in result) {
      entries.push(result.entry);
    }
  }

    const output =
      format === "markdown"
        ? formatAsMarkdown(projectName, resolvedPath, entries, skippedCount)
        : formatAsXml(projectName, resolvedPath, entries, skippedCount);

    return {
      content: [{ type: "text" as const, text: output }],
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Handler: read_file_surgical ────────────────────────────────────

export async function handleReadFileSurgical(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const symbolName = args.symbolName as string | undefined;
  const className = args.className as string | undefined;

  if (!filePath) {
    return errorResponse("Missing required parameter: filePath");
  }

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.normalizedPath!;

  // Validate file size
  const sizeValidation = validateFileSize(resolvedPath);
  if (!sizeValidation.valid) {
    return errorResponse(sizeValidation.error!);
  }

  let content: string;
  try {
    content = await fs.promises.readFile(resolvedPath, "utf-8");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to read file: ${msg}`);
  }

  // Validate content
  const contentValidation = validateFileContent(content);
  if (!contentValidation.valid) {
    return errorResponse(contentValidation.error!);
  }

  if (!symbolName) {
    return {
      content: [
        {
          type: "text" as const,
          text: `// File: ${resolvedPath}\n// Lines: ${content.split("\n").length}\n\n${content}`,
        },
      ],
    };
  }

  // Check cache
  const cacheKey = getSymbolCacheKey(resolvedPath, symbolName, className);
  let extracted = symbolCache.get(cacheKey, resolvedPath);

  if (extracted === undefined) {
    extracted = extractSymbol(content, symbolName, resolvedPath, className);
    symbolCache.set(cacheKey, extracted, resolvedPath);
  }

  if (extracted === null) {
    const available = extractFallbackSymbols(content);
    const closest = findClosestSymbols(symbolName, available, 5);
    
    const availableFormatted = available.slice(0, 15).map(s => `${s.name} (${s.type}${s.className ? ` in ${s.className}` : ''})`);
    if (available.length > 15) availableFormatted.push(`...and ${available.length - 15} more`);

    const suggestions = [];
    if (className) {
      const inOtherClass = available.find(s => s.name === symbolName && s.className !== className);
      if (inOtherClass) suggestions.push(`Did you mean '${symbolName}' in class '${inOtherClass.className}'?`);
    } else {
      const needsScope = available.filter(s => s.name === symbolName && s.className);
      if (needsScope.length > 0) suggestions.push(`Symbol '${symbolName}' exists in class '${needsScope[0].className}'. Use className parameter.`);
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
            error: `Symbol '${symbolName}' not found`,
            available_symbols: availableFormatted,
            suggestions
          }, null, 2),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `// Symbol: ${symbolName}\n// File: ${resolvedPath}\n\n${extracted}`,
      },
    ],
  };
}

// ─── Handler: analyze_impact ────────────────────────────────────────

export async function handleAnalyzeImpact(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  let rootDir = args.rootDir as string | undefined;

  if (!filePath) {
    return errorResponse("Missing required parameter: filePath");
  }

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.normalizedPath!;

  if (!rootDir) {
    rootDir = findProjectRoot(resolvedPath);
  }

  if (!rootDir || !fs.existsSync(rootDir)) {
    return errorResponse(`Could not determine project root for ${resolvedPath}`);
  }

  rootDir = path.resolve(rootDir);

  const ignoreManager = new IgnoreManager(rootDir);
  const allFiles = await ignoreManager.walkDirectoryAsync();

  const targetRelative = path.relative(rootDir, resolvedPath).replace(/\\/g, "/");

  const importPatterns: RegExp[] = [
    /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    /from\s+(\S+)\s+import/gm,
    /^import\s+(\S+)/gm,
    /^\s*use\s+([\w\\]+)/gm,
    /(?:require_once|require|include_once|include)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/gm,
    /^\s*import\s+['"]([^'"]+)['"]\s*;/gm,
  ];

  const dependents: Dependent[] = [];

  // Process files in batches
  const { processBatched } = await import("../utils/arrayUtils.js");
  const results = await processBatched(
    allFiles.filter(f => path.resolve(f) !== resolvedPath),
    async (file) => {
      const ext = path.extname(file).toLowerCase();
      if (!IMPORTABLE_EXTENSIONS.has(ext)) return null;

      let content: string;
      try {
        content = await fs.promises.readFile(file, "utf-8");
      } catch {
        return null;
      }

      let isDependent = false;
      const matchedImports: string[] = [];

      for (const pattern of importPatterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
          const importPath = match[1];
          if (resolveImportMatch(importPath, resolvedPath, file, rootDir)) {
            matchedImports.push(match[0].trim());
            isDependent = true;
          }
        }
      }

      if (isDependent) {
        return {
          file: path.relative(rootDir, file).replace(/\\/g, "/"),
          imports: [...new Set(matchedImports)],
        };
      }
      return null;
    },
    50
  );

  dependents.push(...results.filter(r => r !== null));

  const report = buildImpactReport(targetRelative, rootDir, dependents);

  return {
    content: [{ type: "text" as const, text: report }],
  };
}

// ─── Handler: read_file_lines ───────────────────────────────────────

export async function handleReadFileLines(args: Record<string, unknown>) {
  const result = readFileLines(args as any);

  if (!result.success) {
    return errorResponse(result.error || "Unknown error reading file lines");
  }

  const { content, lineRange } = result;
  const header = lineRange
    ? `// Lines ${lineRange.start}-${lineRange.end}\n// File: ${args.filePath}\n\n`
    : `// File: ${args.filePath}\n\n`;

  return {
    content: [
      {
        type: "text" as const,
        text: header + content,
      },
    ],
  };
}

// ─── Handler: search_code_pattern ───────────────────────────────────

export async function handleSearchCodePattern(args: Record<string, unknown>) {
  const result = await searchCodePattern(args as any);

  if (!result.success) {
    return errorResponse(result.error || "Unknown error searching code");
  }

  const { matches, totalMatches } = result;

  if (!matches || matches.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `# Search Results\n\nNo matches found for pattern: "${args.pattern}"`,
        },
      ],
    };
  }

  const lines: string[] = [
    `# Search Results`,
    ``,
    `**Pattern:** \`${args.pattern}\``,
    `**Root:** \`${args.rootDir}\``,
    `**Matches:** ${totalMatches} (showing ${matches.length})`,
    ``,
  ];

  for (const match of matches) {
    lines.push(`## \`${match.file}\` (line ${match.lineNumber})`);
    lines.push(``);

    if (match.context) {
      lines.push("```");
      lines.push(...match.context);
      lines.push("```");
    } else {
      lines.push(`\`\`\`\n${match.line}\n\`\`\``);
    }

    lines.push(``);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: lines.join("\n"),
      },
    ],
  };
}

// ─── Utility Functions ──────────────────────────────────────────────

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `❌ ${message}` }],
    isError: true,
  };
}

function getLanguageName(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TypeScript JSX", ".js": "JavaScript",
    ".jsx": "JavaScript JSX", ".py": "Python", ".php": "PHP", ".dart": "Dart",
  };
  return map[ext] || ext.substring(1).toUpperCase();
}

function formatAsXml(projectName: string, projectPath: string, entries: FileEntry[], skippedCount: number): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<repository name="${esc(projectName)}" path="${esc(projectPath)}" files="${entries.length}" skipped="${skippedCount}">`,
    `  <file_tree>`,
  ];

  for (const entry of entries) {
    lines.push(`    <file path="${esc(entry.relativePath)}" language="${esc(entry.language)}" />`);
  }

  lines.push(`  </file_tree>`);

  for (const entry of entries) {
    lines.push(`  <file path="${esc(entry.relativePath)}" language="${esc(entry.language)}">`);
    lines.push(`<compressed>${entry.compressed}</compressed>`);
    lines.push(`  </file>`);
  }

  lines.push(`</repository>`);
  return lines.join("\n");
}

function formatAsMarkdown(projectName: string, projectPath: string, entries: FileEntry[], skippedCount: number): string {
  const lines: string[] = [
    `# Repository Map: ${projectName}`,
    ``,
    `> **Path:** \`${projectPath}\``,
    `> **Files:** ${entries.length} | **Skipped:** ${skippedCount}`,
    ``,
  ];

  for (const entry of entries) {
    lines.push(`- \`${entry.relativePath}\` *(${entry.language})*`);
  }

  return lines.join("\n");
}

function buildImpactReport(targetRelative: string, rootDir: string, dependents: Dependent[]): string {
  const lines: string[] = [
    `# Impact Analysis`,
    ``,
    `**Target:** \`${targetRelative}\``,
    `**Dependents:** ${dependents.length}`,
    ``,
  ];

  if (dependents.length === 0) {
    lines.push(`No dependencies found.`);
  } else {
    for (const dep of dependents) {
      lines.push(`### \`${dep.file}\``);
      for (const imp of dep.imports) {
        lines.push(`- \`${imp}\``);
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function resolveImportMatch(importPath: string, targetFile: string, sourceFile: string, rootDir: string): boolean {
  const normalized = importPath.replace(/\\/g, "/");
  const targetResolved = path.resolve(targetFile);
  const targetBaseName = path.basename(targetFile, path.extname(targetFile));

  if (normalized.startsWith(".")) {
    const sourceDir = path.dirname(sourceFile);
    // Remove .js extension from import path (TypeScript ESM imports use .js for .ts files)
    const cleanImportPath = normalized.replace(/\.js$/, "");
    const resolved = path.resolve(sourceDir, cleanImportPath);

    const candidates = [
      resolved,
      resolved + ".ts",
      resolved + ".tsx",
      resolved + ".js",
      resolved + ".jsx",
      resolved + ".mts",
      resolved + ".mjs",
      resolved + ".php",
      resolved + ".dart",
      resolved + ".py",
      path.join(resolved, "index.ts"),
      path.join(resolved, "index.js"),
      path.join(resolved, "index.mjs"),
    ];

    for (const candidate of candidates) {
      if (path.resolve(candidate) === targetResolved) {
        return true;
      }
    }
  }

  return normalized.endsWith(targetBaseName);
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
