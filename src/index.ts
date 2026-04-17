#!/usr/bin/env node

/**
 * mcp-code-context — Semantic Code Context Server
 *
 * A Model Context Protocol (MCP) server that compresses any code repository
 * into LLM-ready semantic context and provides surgical code editing.
 *
 * Read Tools:
 *   1. get_semantic_repo_map  — Compressed structural map of a repo
 *   2. read_file_surgical     — Full file or specific symbol extraction
 *   3. analyze_impact         — Find all dependents of a modified file
 *
 * Write Tools:
 *   4. write_file_surgical    — Replace a symbol's code in-place
 *   5. insert_symbol          — Insert code at precise AST positions
 *   6. rename_symbol          — Rename across entire repository
 *   7. remove_symbol          — Safely delete symbols with dep checking
 *
 * Transport: stdio (JSON-RPC over stdin/stdout)
 * Compatible with: Claude Desktop, Cursor, Windsurf, Copilot, Amazon Q, and any MCP client.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { IgnoreManager } from "./utils/ignoreManager.js";
import { compressFile, extractSymbol } from "./ast/semanticCompressor.js";
import {
  replaceSymbol,
  insertCode,
  renameInFile,
  renameReferencesInFile,
  removeSymbolFromFile,
  WRITABLE_EXTENSIONS,
  type WriteResult,
  type InsertPosition,
} from "./ast/writers/symbolWriter.js";
import { generateDiff, generateMultiFileDiff } from "./utils/diffEngine.js";
import { createBackup, restoreBackup, cleanBackup } from "./utils/backupManager.js";
import { extractFallbackSymbols, findClosestSymbols } from "./utils/fuzzyMatch.js";
import { confirmationCache } from "./utils/confirmationCache.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Constants ──────────────────────────────────────────────────────

const SERVER_NAME = "mcp-code-context";
const SERVER_VERSION = "2.0.0";

/** Extensions we consider source code for analysis */
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs",
  ".py", ".pyi",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".txt",
  ".css", ".scss", ".less",
  ".html", ".vue", ".svelte",
  ".rs", ".go", ".java", ".kt", ".dart",
  ".c", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".swift",
  ".sh", ".bash", ".zsh",
  ".sql",
  ".graphql", ".gql",
  ".proto",
  ".dockerfile",
]);

/** Extensions eligible for import analysis */
const IMPORTABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs",
  ".py", ".pyi",
  ".php", ".phtml",
  ".dart",
  ".vue", ".svelte",
]);

// ─── MCP Server Instance ────────────────────────────────────────────

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

// ─── Tool Definitions ───────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_semantic_repo_map",
    description:
      "Generates a semantically compressed map of a code repository. " +
      "Walks the directory tree respecting .gitignore rules, reads source files, " +
      "and extracts only structural signatures (functions, classes, interfaces, types) " +
      "while stripping implementation bodies. Returns an XML or Markdown document " +
      "optimized for LLM consumption with minimal token usage. " +
      "Supports TypeScript, JavaScript, PHP (AST-based), Dart, and Python. " +
      "Use this to understand the architecture of a large codebase at a glance.",
    inputSchema: {
      type: "object" as const,
      properties: {
        directoryPath: {
          type: "string",
          description:
            "Absolute path to the repository root directory to analyze.",
        },
        format: {
          type: "string",
          enum: ["xml", "markdown"],
          description:
            "Output format for the repo map. 'xml' (default) provides structured data, " +
            "'markdown' provides human-readable output.",
        },
      },
      required: ["directoryPath"],
    },
  },
  {
    name: "read_file_surgical",
    description:
      "Reads the complete source code of a file, or surgically extracts only " +
      "a specific named symbol (function, class, interface, method, type alias). " +
      "When a symbol name is provided, only the full source code block for that " +
      "symbol is returned — saving tokens compared to reading the entire file. " +
      "Supports TypeScript, JavaScript, PHP, Dart, and Python files for symbol extraction.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file to read.",
        },
        symbolName: {
          type: "string",
          description:
            "Optional. Name of a specific function, class, interface, method, " +
            "or type alias to extract. If omitted, the entire file is returned.",
        },
        className: {
          type: "string",
          description:
            "Optional. Name of the class to scope the symbol search to. " +
            "Use this when multiple classes in the same file have methods with the same name " +
            "(e.g., multiple build() methods in Flutter). If omitted, returns the first match.",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "rollback_file",
    description: "Reverts a file to a previous backup state after a surgical write operation. Keeps up to 5 automatic backups. Specify the number of steps to rollback (1 = most recent).",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file to revert.",
        },
        steps: {
          type: "number",
          description: "Number of steps back to revert to (1-5). Defaults to 1 (most recent backup).",
        }
      },
      required: ["filePath"],
    },
  },
  {
    name: "analyze_impact",
    description:
      "Analyzes the impact of modifying a given file by discovering all other " +
      "files in the repository that import or depend on it. Scans for ES import/export, " +
      "CommonJS require(), Python import, PHP use/require_once/include, and Dart import statements. " +
      "Returns a structured report listing all dependent files and the specific " +
      "import statements that create the dependency. Essential for understanding " +
      "blast radius before refactoring.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description:
            "Absolute path to the file being modified (the dependency target).",
        },
        rootDir: {
          type: "string",
          description:
            "Optional. Absolute path to the repository root. If omitted, " +
            "the server walks up from filePath to find the nearest directory " +
            "containing package.json, .git, or similar root markers.",
        },
      },
      required: ["filePath"],
    },
  },
  // ─── Write Tools ────────────────────────────────────────────────────
  {
    name: "write_file_surgical",
    description:
      "Surgically replaces the full source code of a named symbol (function, class, " +
      "method, interface, type alias) in a file. The AI provides ONLY the replacement " +
      "code for that specific symbol — the tool handles locating it via AST parsing " +
      "and splicing the replacement into the correct position. Supports TypeScript, " +
      "JavaScript, PHP, Dart, and Python. Returns a unified diff of the changes. " +
      "Supports dry-run mode to preview changes without modifying the file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file to modify.",
        },
        symbolName: {
          type: "string",
          description:
            "Name of the function, class, method, interface, or type alias to replace.",
        },
        newContent: {
          type: "string",
          description:
            "The complete replacement source code for the symbol, including its " +
            "signature and body. Must be syntactically valid for the target language.",
        },
        className: {
          type: "string",
          description:
            "Optional. Name of the class to scope the symbol search to. " +
            "Use when multiple classes have methods with the same name.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Required for Phase 2. The token provided from the Phase 1 Dry-Run preview.",
        },
        confirm: {
          type: "boolean",
          description:
            "Required for Phase 2. Set to true to confirm and apply the changes.",
        },
        createBackup: {
          type: "boolean",
          description:
            "If true, creates a .bak copy of the file before modifying it. " +
            "Defaults to false (opt-in).",
        },
      },
      required: ["filePath", "symbolName", "newContent"],
    },
  },
  {
    name: "insert_symbol",
    description:
      "Inserts new code at a precise location relative to an existing symbol in a file. " +
      "Can insert before or after a symbol, or inside a class/interface at the start or end. " +
      "If no anchor symbol is provided, inserts at the end of the file. " +
      "Supports TypeScript, JavaScript, PHP, Dart, and Python. " +
      "Automatically matches the surrounding indentation style.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file to modify.",
        },
        code: {
          type: "string",
          description: "The new code to insert. Must be syntactically valid.",
        },
        anchorSymbol: {
          type: "string",
          description:
            "Name of an existing symbol to position relative to. " +
            "If omitted, code is inserted at the end of the file.",
        },
        position: {
          type: "string",
          enum: ["before", "after", "inside_start", "inside_end"],
          description:
            "Where to insert relative to the anchor. 'before' and 'after' insert " +
            "outside the symbol. 'inside_start' and 'inside_end' insert as members " +
            "inside a class or interface. Defaults to 'after'.",
        },
        className: {
          type: "string",
          description:
            "Optional. Name of the class to scope the anchor symbol search to. " +
            "Use when multiple classes have methods with the same name.",
        },
        dryRun: {
          type: "boolean",
          description: "If true, preview changes without modifying the file.",
        },
        createBackup: {
          type: "boolean",
          description: "If true, backup the file before modifying.",
        },
      },
      required: ["filePath", "code"],
    },
  },
  {
    name: "rename_symbol",
    description:
      "Renames a symbol across an entire repository. Renames the definition in the " +
      "source file AND updates all files that import or reference it. Uses AST-aware " +
      "whole-word replacement to avoid false matches. Supports TypeScript, JavaScript, " +
      "PHP, Dart, and Python. Returns a multi-file diff showing all changes. " +
      "Essential for safe refactoring.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description:
            "Absolute path to the file where the symbol is defined.",
        },
        oldName: {
          type: "string",
          description: "The current name of the symbol.",
        },
        newName: {
          type: "string",
          description: "The new name for the symbol.",
        },
        rootDir: {
          type: "string",
          description:
            "Optional. Absolute path to the repository root. " +
            "If omitted, auto-detected from the file path.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Required for Phase 2. The token provided from the Phase 1 Dry-Run preview.",
        },
        confirm: {
          type: "boolean",
          description:
            "Required for Phase 2. Set to true to confirm and apply the changes.",
        },
        createBackup: {
          type: "boolean",
          description: "If true, backup each modified file before changing it.",
        },
      },
      required: ["filePath", "oldName", "newName"],
    },
  },
  {
    name: "remove_symbol",
    description:
      "Removes a named symbol from a file. By default, checks for dependents first " +
      "and refuses to remove if other files import or reference the symbol. " +
      "Use force=true to skip the dependency check and remove anyway. " +
      "Supports TypeScript, JavaScript, PHP, Dart, and Python. " +
      "Returns a diff showing what was removed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file.",
        },
        symbolName: {
          type: "string",
          description: "Name of the symbol to remove.",
        },
        className: {
          type: "string",
          description:
            "Optional. Name of the class to scope the symbol search to. " +
            "Use when multiple classes have methods with the same name.",
        },
        force: {
          type: "boolean",
          description:
            "If true, skip the dependency check and remove the symbol even if " +
            "other files reference it. Defaults to false.",
        },
        dryRun: {
          type: "boolean",
          description: "If true, preview the removal without modifying the file.",
        },
        createBackup: {
          type: "boolean",
          description: "If true, backup the file before modifying.",
        },
      },
      required: ["filePath", "symbolName"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// ─── Tool Dispatcher ────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_semantic_repo_map":
        return await handleGetSemanticRepoMap(
          args as Record<string, unknown>,
        );
      case "read_file_surgical":
        return await handleReadFileSurgical(
          args as Record<string, unknown>,
        );
      case "analyze_impact":
        return await handleAnalyzeImpact(args as Record<string, unknown>);
      case "write_file_surgical":
        return await handleWriteFileSurgical(
          args as Record<string, unknown>,
        );
      case "insert_symbol":
        return await handleInsertSymbol(
          args as Record<string, unknown>,
        );
      case "rename_symbol":
        return await handleRenameSymbol(
          args as Record<string, unknown>,
        );
      case "remove_symbol":
        return await handleRemoveSymbol(
          args as Record<string, unknown>,
        );
      case "rollback_file":
        return await handleRollbackFile(
          args as Record<string, unknown>,
        );
      default:
        return errorResponse(`Unknown tool: "${name}"`);
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    return errorResponse(`Unhandled error in tool "${name}": ${message}`);
  }
});

// ─── Tool 1: get_semantic_repo_map ──────────────────────────────────

export async function handleGetSemanticRepoMap(args: Record<string, unknown>) {
  const directoryPath = args.directoryPath as string;
  const format = (args.format as string) || "xml";

  if (!directoryPath) {
    return errorResponse("Missing required parameter: directoryPath");
  }

  const resolvedPath = path.resolve(directoryPath);

  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`Directory not found: ${resolvedPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isDirectory()) {
    return errorResponse(`Path is not a directory: ${resolvedPath}`);
  }

  const ignoreManager = new IgnoreManager(resolvedPath);
  const files = ignoreManager.walkDirectory();
  const projectName = path.basename(resolvedPath);

  const entries: FileEntry[] = [];
  let skippedCount = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) {
      skippedCount++;
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      skippedCount++;
      continue;
    }

    // Skip files with null bytes (binary masquerading as text)
    if (content.includes("\0")) {
      skippedCount++;
      continue;
    }

    const relativePath = path
      .relative(resolvedPath, file)
      .replace(/\\/g, "/");
    const language = getLanguageName(ext);
    const compressed = compressFile(file, content);

    entries.push({ relativePath, language, compressed });
  }

  const output =
    format === "markdown"
      ? formatAsMarkdown(projectName, resolvedPath, entries, skippedCount)
      : formatAsXml(projectName, resolvedPath, entries, skippedCount);

  return {
    content: [{ type: "text" as const, text: output }],
  };
}

// ─── Tool 2: read_file_surgical ─────────────────────────────────────

export async function handleReadFileSurgical(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const symbolName = args.symbolName as string | undefined;
  const className = args.className as string | undefined;

  if (!filePath) {
    return errorResponse("Missing required parameter: filePath");
  }

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`File not found: ${resolvedPath}`);
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to read file: ${msg}`);
  }

  // If no symbol requested, return the full file
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

  // Attempt surgical extraction
  const extracted = extractSymbol(content, symbolName, resolvedPath, className);

  if (extracted === null) {
    // Symbol not found — use fuzzy matching to return suggestions
    const available = extractFallbackSymbols(content);
    const closest = findClosestSymbols(symbolName, available, 5);
    
    const availableFormatted = available.slice(0, 15).map(s => `${s.name} (${s.type}${s.className ? ` in ${s.className}` : ''})`);
    if (available.length > 15) availableFormatted.push(`...and ${available.length - 15} more`);

    const suggestions = [];
    if (className) {
      // Check if it exists in another class
      const inOtherClass = available.find(s => s.name === symbolName && s.className !== className);
      if (inOtherClass) suggestions.push(`Did you mean '${symbolName}' in class '${inOtherClass.className}'? Update your className parameter.`);
    } else {
      // Check if it requires a class scope
      const needsScope = available.filter(s => s.name === symbolName && s.className);
      if (needsScope.length > 0) suggestions.push(`Symbol '${symbolName}' exists inside multiple scopes. Did you mean to use className: '${needsScope[0].className}'?`);
    }

    if (closest.length > 0) {
      suggestions.push(`Similar symbols: ${closest.map(s => s.name).join(', ')}`);
    }

    const errorPayload = {
      error: `Symbol '${symbolName}' not found in ${path.basename(resolvedPath)}`,
      available_symbols: availableFormatted,
      suggestions
    };

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(errorPayload, null, 2),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text:
          `// Symbol: ${symbolName}\n` +
          `// File: ${resolvedPath}\n\n${extracted}`,
      },
    ],
  };
}

// ─── Tool 3: analyze_impact ─────────────────────────────────────────

export async function handleAnalyzeImpact(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  let rootDir = args.rootDir as string | undefined;

  if (!filePath) {
    return errorResponse("Missing required parameter: filePath");
  }

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`File not found: ${resolvedPath}`);
  }

  // Discover project root if not provided
  if (!rootDir) {
    rootDir = findProjectRoot(resolvedPath);
  }

  if (!rootDir || !fs.existsSync(rootDir)) {
    return errorResponse(
      `Could not determine project root for ${resolvedPath}. ` +
        `Provide rootDir explicitly.`,
    );
  }

  rootDir = path.resolve(rootDir);

  const ignoreManager = new IgnoreManager(rootDir);
  const allFiles = ignoreManager.walkDirectory();

  const targetRelative = path
    .relative(rootDir, resolvedPath)
    .replace(/\\/g, "/");

  // Import pattern regexes
  const importPatterns: RegExp[] = [
    // ES static import: import ... from "path"
    /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm,
    // ES dynamic import: import("path")
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    // CommonJS: require("path")
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    // Python: from package import ...
    /from\s+(\S+)\s+import/gm,
    // Python: import package
    /^import\s+(\S+)/gm,
    // PHP: use Namespace\Class
    /^\s*use\s+([\w\\]+)/gm,
    // PHP: require_once / require / include_once / include
    /(?:require_once|require|include_once|include)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/gm,
    // Dart: import 'package:...' or import '../...';
    /^\s*import\s+['"]([^'"]+)['"]\s*;/gm,
  ];

  const dependents: Dependent[] = [];

  for (const file of allFiles) {
    // Skip the target file itself
    if (path.resolve(file) === resolvedPath) continue;

    // Only scan importable file types
    const ext = path.extname(file).toLowerCase();
    if (!IMPORTABLE_EXTENSIONS.has(ext)) continue;

    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    let isDependent = false;
    const matchedImports: string[] = [];

    for (const pattern of importPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        const importPath = match[1];
        if (
          resolveImportMatch(importPath, resolvedPath, file, rootDir)
        ) {
          matchedImports.push(match[0].trim());
          isDependent = true;
        }
      }
    }

    if (isDependent) {
      dependents.push({
        file: path.relative(rootDir, file).replace(/\\/g, "/"),
        imports: [...new Set(matchedImports)], // deduplicate
      });
    }
  }

  // Build the report
  const report = buildImpactReport(
    targetRelative,
    rootDir,
    dependents,
  );

  return {
    content: [{ type: "text" as const, text: report }],
  };
}

// ─── Tool 4: write_file_surgical ────────────────────────────────────

export async function handleWriteFileSurgical(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const symbolName = args.symbolName as string;
  const newContent = args.newContent as string;
  const className = args.className as string | undefined;
  const shouldBackup = (args.createBackup as boolean) || false;
  
  const confirmationToken = args.confirmationToken as string | undefined;
  const confirm = args.confirm as boolean | undefined;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  // PHASE 2: Apply the change
  if (confirmationToken && confirm) {
    const pending = confirmationCache.consume(confirmationToken);
    if (!pending || pending.operation !== "write_file_surgical") {
      return errorResponse("Invalid or expired confirmation token. Please run the operation again to generate a new preview.");
    }
    
    const resolvedPath = pending.filePath;
    try {
      createBackup(resolvedPath);
    } catch (error: unknown) {
      return errorResponse(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      fs.writeFileSync(resolvedPath, pending.payload.newContentFull, "utf-8");
    } catch (error: unknown) {
      restoreBackup(resolvedPath);
      return errorResponse(`Failed to write file: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `// ✅ Symbol "${pending.payload.symbolName}" replaced successfully\n// File: ${resolvedPath}\n\n${pending.payload.diff}`,
        },
      ],
    };
  }

  // PHASE 1: Dry-Run Preview
  if (!symbolName) return errorResponse("Missing required parameter: symbolName");
  if (!newContent) return errorResponse("Missing required parameter: newContent");

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`File not found: ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(ext)) {
    return errorResponse(
      `Unsupported file type "${ext}" for surgical writing. ` +
      `Supported: .ts, .tsx, .js, .jsx, .mts, .mjs, .cts, .cjs, .php, .phtml, .dart, .py, .pyi`
    );
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return errorResponse(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Perform the replacement memory-only
  const result: WriteResult = replaceSymbol(resolvedPath, content, symbolName, newContent, className);

  if (!result.success) {
    const isNotFoundError = result.error && (result.error.includes("not found") || result.error.includes("Could not locate"));
    if (isNotFoundError) {
        const available = extractFallbackSymbols(content);
        const closest = findClosestSymbols(symbolName, available, 5);
        
        const availableFormatted = available.slice(0, 15).map(s => `${s.name} (${s.type}${s.className ? ` in ${s.className}` : ''})`);
        if (available.length > 15) availableFormatted.push(`...and ${available.length - 15} more`);

        const suggestions = [];
        if (className) {
          const inOtherClass = available.find(s => s.name === symbolName && s.className !== className);
          if (inOtherClass) suggestions.push(`Did you mean '${symbolName}' in class '${inOtherClass.className}'? Update your className parameter.`);
        } else {
          const needsScope = available.filter(s => s.name === symbolName && s.className);
          if (needsScope.length > 0) suggestions.push(`Symbol '${symbolName}' exists inside multiple scopes. Did you mean to use className: '${needsScope[0].className}'?`);
        }

        if (closest.length > 0) {
          suggestions.push(`Similar symbols: ${closest.map(s => s.name).join(', ')}`);
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
    return errorResponse(result.error || "Unknown error during symbol replacement");
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
        text: `// 🔍 ACTION REQUIRED (DRY-RUN DEFAULT)\n// To apply these changes, you MUST call this tool again with:\n// confirmationToken: "${token}"\n// confirm: true\n\n${diff}`,
      },
    ],
  };
}

// ─── Tool 5: insert_symbol ──────────────────────────────────────────

export async function handleInsertSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const code = args.code as string;
  const anchorSymbol = (args.anchorSymbol as string) || null;
  const position = (args.position as InsertPosition) || "after";
  const className = args.className as string | undefined;
  const shouldBackup = (args.createBackup as boolean) || false;

  const confirmationToken = args.confirmationToken as string | undefined;
  const confirm = args.confirm as boolean | undefined;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  // PHASE 2: Apply the change
  if (confirmationToken && confirm) {
    const pending = confirmationCache.consume(confirmationToken);
    if (!pending || pending.operation !== "insert_symbol") {
      return errorResponse("Invalid or expired confirmation token. Please run the operation again to generate a new preview.");
    }
    
    const resolvedPath = pending.filePath;
    try {
      createBackup(resolvedPath);
    } catch (error: unknown) {
      return errorResponse(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      fs.writeFileSync(resolvedPath, pending.payload.newContentFull, "utf-8");
    } catch (error: unknown) {
      restoreBackup(resolvedPath);
      return errorResponse(`Failed to write file: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `// ✅ Code inserted successfully\n// File: ${resolvedPath}\n// Anchor: ${pending.payload.anchorSymbol || "(end of file)"}\n// Position: ${pending.payload.position}\n\n${pending.payload.diff}`,
        },
      ],
    };
  }

  // PHASE 1: Dry-Run
  if (!code) return errorResponse("Missing required parameter: code");

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`File not found: ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(ext)) {
    return errorResponse(`Unsupported file type "${ext}" for code insertion.`);
  }

  let fileContent: string;
  try {
    fileContent = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return errorResponse(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result: WriteResult = insertCode(resolvedPath, fileContent, code, anchorSymbol, position, className);

  if (!result.success) {
    return errorResponse(result.error || "Unknown error during code insertion");
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
        text: `// 🔍 ACTION REQUIRED (DRY-RUN DEFAULT)\n// To apply these changes, you MUST call this tool again with:\n// confirmationToken: "${token}"\n// confirm: true\n\n${diff}`,
      },
    ],
  };
}

// ─── Tool 6: rename_symbol ──────────────────────────────────────────

export async function handleRenameSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const oldName = args.oldName as string;
  const newName = args.newName as string;
  const rootDir = args.rootDir as string | undefined;
  const shouldBackup = (args.createBackup as boolean) || false;

  const confirmationToken = args.confirmationToken as string | undefined;
  const confirm = args.confirm as boolean | undefined;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  // PHASE 2
  if (confirmationToken && confirm) {
    const pending = confirmationCache.consume(confirmationToken);
    if (!pending || pending.operation !== "rename_symbol") {
      return errorResponse("Invalid or expired confirmation token.");
    }
    
    const results = pending.payload.results;
    for (const res of results) {
      try { createBackup(res.filePath); } catch (e) {}
    }

    try {
      for (const res of results) {
        fs.writeFileSync(res.filePath, res.newContent, "utf-8");
      }
    } catch (error: unknown) {
      return errorResponse(`Failed to write files during rename: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      content: [{
        type: "text" as const,
        text: `// ✅ Rename applied successfully.\n\n${pending.payload.diff}`,
      }],
    };
  }

  // PHASE 1
  if (!oldName) return errorResponse("Missing required parameter: oldName");
  if (!newName) return errorResponse("Missing required parameter: newName");

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`File not found: ${resolvedPath}`);
  }

  let sourceContent: string;
  try {
    sourceContent = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return errorResponse(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 1. Rename in the source file
  const sourceResult = renameInFile(resolvedPath, sourceContent, oldName, newName);
  if (!sourceResult.success) {
    return errorResponse(sourceResult.error || `Could not find definition for "${oldName}" in ${path.basename(resolvedPath)}.`);
  }

  const results: { filePath: string; oldContent: string; newContent: string }[] = [
    {
      filePath: resolvedPath,
      oldContent: sourceContent,
      newContent: sourceResult.newContent,
    },
  ];

  // 2. Discover and rename in dependent files
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

      // Quick check if file contains oldName before attempting heavy rename
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
      text: `// 🔍 ACTION REQUIRED (DRY-RUN DEFAULT)\n// To apply these changes, you MUST call this tool again with:\n// confirmationToken: "${token}"\n// confirm: true\n\n${multiDiff}`,
    }],
  };
}

// ─── Tool 7: remove_symbol ──────────────────────────────────────────

export async function handleRemoveSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const symbolName = args.symbolName as string;
  const className = args.className as string | undefined;
  const force = (args.force as boolean) || false;
  const shouldBackup = (args.createBackup as boolean) || false;

  const confirmationToken = args.confirmationToken as string | undefined;
  const confirm = args.confirm as boolean | undefined;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  // PHASE 2
  if (confirmationToken && confirm) {
    const pending = confirmationCache.consume(confirmationToken);
    if (!pending || pending.operation !== "remove_symbol") {
      return errorResponse("Invalid or expired confirmation token.");
    }
    
    const resolvedPath = pending.filePath;
    try { createBackup(resolvedPath); } catch (e) {}

    try {
      fs.writeFileSync(resolvedPath, pending.payload.newContentFull, "utf-8");
    } catch (error: unknown) {
      restoreBackup(resolvedPath);
      return errorResponse(`Failed to write file: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      content: [{
        type: "text" as const,
        text: `// ✅ Symbol "${pending.payload.symbolName}" removed successfully.\n\n${pending.payload.diff}`,
      }],
    };
  }

  if (!symbolName) return errorResponse("Missing required parameter: symbolName");

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`File not found: ${resolvedPath}`);
  }

  let fileContent: string;
  try {
    fileContent = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return errorResponse(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Safety check: Don't remove if dependents exist unless forced
  if (!force) {
    const projectRoot = findProjectRoot(resolvedPath);
    if (projectRoot) {
      const ignoreManager = new IgnoreManager(projectRoot);
      const allFiles = ignoreManager.walkDirectory();
      const targetRel = path.relative(projectRoot, resolvedPath).replace(/\\/g, "/");
      
      for (const f of allFiles) {
        if (path.resolve(f) === resolvedPath) continue;
        const fExt = path.extname(f).toLowerCase();
        if (!IMPORTABLE_EXTENSIONS.has(fExt)) continue;
        
        try {
          const fContent = fs.readFileSync(f, "utf-8");
          const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(`(?<=^|[^a-zA-Z0-9_$])(${escaped})(?=[^a-zA-Z0-9_$]|$)`);
          
          if (regex.test(fContent)) {
             return errorResponse(`Symbol "${symbolName}" might be used in ${path.relative(projectRoot, f)}. Use force: true to delete anyway.`);
          }
        } catch {}
      }
    }
  }

  const result = removeSymbolFromFile(resolvedPath, fileContent, symbolName, className);
  if (!result.success) {
    return errorResponse(result.error || "Unknown error during symbol removal");
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
      text: `// 🔍 ACTION REQUIRED (DRY-RUN DEFAULT)\n// To apply these changes, you MUST call this tool again with:\n// confirmationToken: "${token}"\n// confirm: true\n\n${diff}`,
    }],
  };
}

// ─── Import Resolution Logic ────────────────────────────────────────

function resolveImportMatch(
  importPath: string,
  targetFile: string,
  sourceFile: string,
  rootDir: string,
): boolean {
  const normalized = importPath.replace(/\\/g, "/");
  const targetResolved = path.resolve(targetFile);
  const targetWithoutExt = targetResolved.replace(/\.[^.]+$/, "");
  const targetBaseName = path.basename(
    targetFile,
    path.extname(targetFile),
  );

  // Relative imports (./foo, ../bar)
  if (normalized.startsWith(".")) {
    const sourceDir = path.dirname(sourceFile);
    const resolved = path.resolve(sourceDir, normalized);

    // Try exact match, then with common extensions, then /index variants
    const candidates = [
      resolved,
      resolved + ".ts",
      resolved + ".tsx",
      resolved + ".js",
      resolved + ".jsx",
      resolved + ".mts",
      resolved + ".mjs",
      resolved + ".dart",
      path.join(resolved, "index.ts"),
      path.join(resolved, "index.tsx"),
      path.join(resolved, "index.js"),
      path.join(resolved, "index.mjs"),
    ];

    for (const candidate of candidates) {
      if (
        path.resolve(candidate) === targetResolved ||
        path.resolve(candidate) === targetWithoutExt
      ) {
        return true;
      }
    }
    return false;
  }

  // Non-relative imports (aliases, packages)
  // Check if the import path ends with the target's relative path or basename
  const targetRelative = path
    .relative(rootDir, targetFile)
    .replace(/\\/g, "/")
    .replace(/\.[^.]+$/, ""); // strip extension

  if (
    normalized === targetBaseName ||
    normalized.endsWith("/" + targetBaseName) ||
    normalized === targetRelative ||
    normalized.endsWith(targetRelative)
  ) {
    return true;
  }

  // Python-style dotted imports: convert dots to path separators
  const dottedPath = normalized.replace(/\./g, "/");
  if (
    dottedPath === targetBaseName ||
    dottedPath.endsWith("/" + targetBaseName) ||
    dottedPath === targetRelative ||
    dottedPath.endsWith(targetRelative)
  ) {
    return true;
  }

  return false;
}

// ─── Project Root Discovery ─────────────────────────────────────────

function findProjectRoot(filePath: string): string | undefined {
  const ROOT_MARKERS = [
    "package.json",
    ".git",
    "pyproject.toml",
    "setup.py",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "CMakeLists.txt",
    ".gitignore",
    "Gemfile",
    "composer.json",
    "pubspec.yaml",
  ];

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

// ─── Output Formatting ─────────────────────────────────────────────

interface FileEntry {
  relativePath: string;
  language: string;
  compressed: string;
}

interface Dependent {
  file: string;
  imports: string[];
}

function formatAsXml(
  projectName: string,
  projectPath: string,
  entries: FileEntry[],
  skippedCount: number,
): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<repository name="${esc(projectName)}" path="${esc(projectPath)}" files="${entries.length}" skipped="${skippedCount}">`,
    ``,
    `  <file_tree>`,
  ];

  for (const entry of entries) {
    lines.push(
      `    <file path="${esc(entry.relativePath)}" language="${esc(entry.language)}" />`,
    );
  }

  lines.push(`  </file_tree>`);
  lines.push(``);

  for (const entry of entries) {
    lines.push(
      `  <file path="${esc(entry.relativePath)}" language="${esc(entry.language)}">`,
    );
    lines.push(`<compressed>`);
    lines.push(entry.compressed);
    lines.push(`</compressed>`);
    lines.push(`  </file>`);
    lines.push(``);
  }

  lines.push(`</repository>`);
  return lines.join("\n");
}

function formatAsMarkdown(
  projectName: string,
  projectPath: string,
  entries: FileEntry[],
  skippedCount: number,
): string {
  const lines: string[] = [
    `# Repository Map: ${projectName}`,
    ``,
    `> **Path:** \`${projectPath}\`  `,
    `> **Source files:** ${entries.length} | **Skipped:** ${skippedCount}`,
    ``,
    `## File Tree`,
    ``,
  ];

  for (const entry of entries) {
    lines.push(`- \`${entry.relativePath}\` *(${entry.language})*`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  for (const entry of entries) {
    const langId = getLangId(entry.language);
    lines.push(`### ${entry.relativePath}`);
    lines.push("```" + langId);
    lines.push(entry.compressed);
    lines.push("```");
    lines.push(``);
  }

  return lines.join("\n");
}

function buildImpactReport(
  targetRelative: string,
  rootDir: string,
  dependents: Dependent[],
): string {
  const lines: string[] = [
    `# Impact Analysis`,
    ``,
    `## Target`,
    `- **File:** \`${targetRelative}\``,
    `- **Project root:** \`${rootDir}\``,
    `- **Dependent files:** ${dependents.length}`,
    ``,
  ];

  if (dependents.length === 0) {
    lines.push(
      `> No files in this repository import or depend on the target file.`,
    );
    lines.push(``);
    lines.push(
      `This could mean the file is a leaf module, an entry point, ` +
        `or uses non-standard import patterns not detected by this analysis.`,
    );
  } else {
    lines.push(`## Dependent Files`);
    lines.push(``);

    for (const dep of dependents) {
      lines.push(`### \`${dep.file}\``);
      for (const imp of dep.imports) {
        lines.push(`- \`${imp}\``);
      }
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(``);
    lines.push(
      `> **⚠️ Blast radius:** Modifying \`${targetRelative}\` may affect ` +
        `**${dependents.length}** file(s). Review the import statements above ` +
        `to understand what each dependent file consumes from the target.`,
    );
  }

  return lines.join("\n");
}

// ─── Utility ────────────────────────────────────────────────────────

function getLanguageName(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript JSX",
    ".mts": "TypeScript",
    ".cts": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript JSX",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".py": "Python",
    ".pyi": "Python Stub",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".toml": "TOML",
    ".md": "Markdown",
    ".txt": "Text",
    ".css": "CSS",
    ".scss": "SCSS",
    ".less": "LESS",
    ".html": "HTML",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".rs": "Rust",
    ".go": "Go",
    ".java": "Java",
    ".kt": "Kotlin",
    ".c": "C",
    ".cpp": "C++",
    ".h": "C Header",
    ".hpp": "C++ Header",
    ".rb": "Ruby",
    ".php": "PHP",
    ".dart": "Dart",
    ".swift": "Swift",
    ".sh": "Shell",
    ".bash": "Bash",
    ".zsh": "Zsh",
    ".sql": "SQL",
    ".graphql": "GraphQL",
    ".gql": "GraphQL",
    ".proto": "Protocol Buffers",
    ".dockerfile": "Dockerfile",
  };
  return map[ext] || ext.substring(1).toUpperCase();
}

function getLangId(language: string): string {
  const map: Record<string, string> = {
    TypeScript: "typescript",
    "TypeScript JSX": "tsx",
    JavaScript: "javascript",
    "JavaScript JSX": "jsx",
    Python: "python",
    "Python Stub": "python",
    JSON: "json",
    YAML: "yaml",
    TOML: "toml",
    Markdown: "markdown",
    CSS: "css",
    SCSS: "scss",
    LESS: "less",
    HTML: "html",
    Vue: "vue",
    Svelte: "svelte",
    Rust: "rust",
    Go: "go",
    Java: "java",
    Kotlin: "kotlin",
    C: "c",
    "C++": "cpp",
    Ruby: "ruby",
    PHP: "php",
    Dart: "dart",
    Swift: "swift",
    Shell: "bash",
    SQL: "sql",
    GraphQL: "graphql",
  };
  return map[language] || language.toLowerCase();
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function handleRollbackFile(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const steps = (args.steps as number) || 1;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  const resolvedPath = path.resolve(filePath);
  
  if (steps < 1 || steps > 5) {
    return errorResponse("Steps must be between 1 and 5.");
  }

  const success = restoreBackup(resolvedPath, steps);

  if (!success) {
    return errorResponse(`No backup found for step ${steps} at ${resolvedPath}`);
  }

  return {
    content: [{
      type: "text" as const,
      text: `// ⏪ Rollback successful!\n// Reverted ${path.basename(resolvedPath)} to state from ${steps} step(s) ago.\n// File: ${resolvedPath}`,
    }],
  };
}

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `❌ ${message}` }],
    isError: true,
  };
}

// ─── Bootstrap ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `🚀 ${SERVER_NAME} v${SERVER_VERSION} running on stdio transport`,
  );
}

main().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
