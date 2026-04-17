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
  removeSymbolFromFile,
  WRITABLE_EXTENSIONS,
  type WriteResult,
  type InsertPosition,
} from "./ast/writers/symbolWriter.js";
import { generateDiff, generateMultiFileDiff } from "./utils/diffEngine.js";
import { createBackup, restoreBackup, cleanBackup } from "./utils/backupManager.js";
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
        dryRun: {
          type: "boolean",
          description:
            "If true, returns the diff of proposed changes without modifying the file. " +
            "Defaults to false.",
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
        dryRun: {
          type: "boolean",
          description:
            "If true, preview all changes across the repo without modifying any files.",
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

async function handleGetSemanticRepoMap(args: Record<string, unknown>) {
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

async function handleReadFileSurgical(args: Record<string, unknown>) {
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
    // Symbol not found — return full file with a warning
    return {
      content: [
        {
          type: "text" as const,
          text: className
            ? `// ⚠️ Symbol "${symbolName}" not found in class "${className}" in ${path.basename(resolvedPath)}\n` +
              `// Returning full file content instead.\n` +
              `// File: ${resolvedPath}\n\n${content}`
            : `// ⚠️ Symbol "${symbolName}" not found in ${path.basename(resolvedPath)}\n` +
              `// Returning full file content instead.\n` +
              `// File: ${resolvedPath}\n\n${content}`,
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

async function handleAnalyzeImpact(args: Record<string, unknown>) {
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

async function handleWriteFileSurgical(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const symbolName = args.symbolName as string;
  const newContent = args.newContent as string;
  const className = args.className as string | undefined;
  const dryRun = (args.dryRun as boolean) || false;
  const shouldBackup = (args.createBackup as boolean) || false;

  if (!filePath) return errorResponse("Missing required parameter: filePath");
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
      `Supported: .ts, .tsx, .js, .jsx, .mts, .mjs, .cts, .cjs, .php, .phtml, .dart, .py, .pyi`,
    );
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to read file: ${msg}`);
  }

  // Perform the replacement
  const result: WriteResult = replaceSymbol(resolvedPath, content, symbolName, newContent, className);

  if (!result.success) {
    return errorResponse(result.error || "Unknown error during symbol replacement");
  }

  // Generate diff
  const diff = generateDiff(content, result.newContent, resolvedPath);

  if (dryRun) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `// 🔍 DRY RUN — No files modified\n` +
            `// Tool: write_file_surgical\n` +
            `// File: ${resolvedPath}\n` +
            `// Symbol: ${symbolName}\n\n` +
            diff,
        },
      ],
    };
  }

  // Create backup if requested
  if (shouldBackup) {
    try {
      createBackup(resolvedPath);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return errorResponse(`Failed to create backup: ${msg}`);
    }
  }

  // Write the modified file
  try {
    fs.writeFileSync(resolvedPath, result.newContent, "utf-8");
  } catch (error: unknown) {
    // Restore backup on write failure
    if (shouldBackup) restoreBackup(resolvedPath);
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to write file: ${msg}`);
  }

  return {
    content: [
      {
        type: "text" as const,
        text:
          `// ✅ Symbol "${symbolName}" replaced successfully\n` +
          `// File: ${resolvedPath}\n` +
          `// Backup: ${shouldBackup ? "created" : "skipped (opt-in)"}\n\n` +
          diff,
      },
    ],
  };
}

// ─── Tool 5: insert_symbol ──────────────────────────────────────────

async function handleInsertSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const code = args.code as string;
  const anchorSymbol = (args.anchorSymbol as string) || null;
  const position = (args.position as InsertPosition) || "after";
  const className = args.className as string | undefined;
  const dryRun = (args.dryRun as boolean) || false;
  const shouldBackup = (args.createBackup as boolean) || false;

  if (!filePath) return errorResponse("Missing required parameter: filePath");
  if (!code) return errorResponse("Missing required parameter: code");

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`File not found: ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(ext)) {
    return errorResponse(`Unsupported file type "${ext}" for code insertion.`);
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to read file: ${msg}`);
  }

  const result: WriteResult = insertCode(resolvedPath, content, code, anchorSymbol, position, className);

  if (!result.success) {
    return errorResponse(result.error || "Unknown error during code insertion");
  }

  const diff = generateDiff(content, result.newContent, resolvedPath);

  if (dryRun) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `// 🔍 DRY RUN — No files modified\n` +
            `// Tool: insert_symbol\n` +
            `// File: ${resolvedPath}\n` +
            `// Anchor: ${anchorSymbol || "(end of file)"}\n` +
            `// Position: ${position}\n\n` +
            diff,
        },
      ],
    };
  }

  if (shouldBackup) {
    try {
      createBackup(resolvedPath);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return errorResponse(`Failed to create backup: ${msg}`);
    }
  }

  try {
    fs.writeFileSync(resolvedPath, result.newContent, "utf-8");
  } catch (error: unknown) {
    if (shouldBackup) restoreBackup(resolvedPath);
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to write file: ${msg}`);
  }

  return {
    content: [
      {
        type: "text" as const,
        text:
          `// ✅ Code inserted successfully\n` +
          `// File: ${resolvedPath}\n` +
          `// Anchor: ${anchorSymbol || "(end of file)"}\n` +
          `// Position: ${position}\n\n` +
          diff,
      },
    ],
  };
}

// ─── Tool 6: rename_symbol ──────────────────────────────────────────

async function handleRenameSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const oldName = args.oldName as string;
  const newName = args.newName as string;
  let rootDir = args.rootDir as string | undefined;
  const dryRun = (args.dryRun as boolean) || false;
  const shouldBackup = (args.createBackup as boolean) || false;

  if (!filePath) return errorResponse("Missing required parameter: filePath");
  if (!oldName) return errorResponse("Missing required parameter: oldName");
  if (!newName) return errorResponse("Missing required parameter: newName");

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`File not found: ${resolvedPath}`);
  }

  // Discover project root
  if (!rootDir) {
    rootDir = findProjectRoot(resolvedPath);
  }
  if (!rootDir || !fs.existsSync(rootDir)) {
    return errorResponse(
      `Could not determine project root for ${resolvedPath}. Provide rootDir explicitly.`,
    );
  }
  rootDir = path.resolve(rootDir);

  // Step 1: Rename in the source file
  let sourceContent: string;
  try {
    sourceContent = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to read source file: ${msg}`);
  }

  const sourceResult = renameInFile(resolvedPath, sourceContent, oldName, newName);
  if (!sourceResult.success) {
    return errorResponse(sourceResult.error || "Failed to rename in source file");
  }

  // Step 2: Find all dependent files
  const ignoreManager = new IgnoreManager(rootDir);
  const allFiles = ignoreManager.walkDirectory();

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

  const allChanges: Array<{
    filePath: string;
    oldContent: string;
    newContent: string;
  }> = [];

  // Add source file change
  allChanges.push({
    filePath: resolvedPath,
    oldContent: sourceContent,
    newContent: sourceResult.newContent,
  });

  // Step 3: Rename in dependent files
  for (const file of allFiles) {
    if (path.resolve(file) === resolvedPath) continue;

    const ext = path.extname(file).toLowerCase();
    if (!WRITABLE_EXTENSIONS.has(ext)) continue;

    let fileContent: string;
    try {
      fileContent = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // Check if this file imports the target
    let importsTarget = false;
    for (const pattern of importPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(fileContent)) !== null) {
        if (resolveImportMatch(match[1], resolvedPath, file, rootDir)) {
          importsTarget = true;
          break;
        }
      }
      if (importsTarget) break;
    }

    if (!importsTarget) continue;

    // Rename occurrences in this file
    const depResult = renameInFile(file, fileContent, oldName, newName);
    if (depResult.success && depResult.newContent !== fileContent) {
      allChanges.push({
        filePath: file,
        oldContent: fileContent,
        newContent: depResult.newContent,
      });
    }
  }

  // Generate multi-file diff
  const multiDiff = generateMultiFileDiff(allChanges);

  if (dryRun) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `// 🔍 DRY RUN — No files modified\n` +
            `// Tool: rename_symbol\n` +
            `// Rename: "${oldName}" → "${newName}"\n` +
            `// Files affected: ${allChanges.length}\n\n` +
            multiDiff,
        },
      ],
    };
  }

  // Apply all changes
  const appliedFiles: string[] = [];
  const backedUpFiles: string[] = [];

  try {
    for (const change of allChanges) {
      if (shouldBackup) {
        createBackup(change.filePath);
        backedUpFiles.push(change.filePath);
      }
      fs.writeFileSync(change.filePath, change.newContent, "utf-8");
      appliedFiles.push(path.relative(rootDir, change.filePath).replace(/\\/g, "/"));
    }
  } catch (error: unknown) {
    // Rollback all backups on failure
    for (const backedUp of backedUpFiles) {
      restoreBackup(backedUp);
    }
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed during multi-file rename. All changes rolled back. Error: ${msg}`);
  }

  return {
    content: [
      {
        type: "text" as const,
        text:
          `// ✅ Symbol renamed: "${oldName}" → "${newName}"\n` +
          `// Files modified: ${appliedFiles.length}\n` +
          `//   ${appliedFiles.join("\n//   ")}\n\n` +
          multiDiff,
      },
    ],
  };
}

// ─── Tool 7: remove_symbol ──────────────────────────────────────────

async function handleRemoveSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const symbolName = args.symbolName as string;
  const className = args.className as string | undefined;
  const force = (args.force as boolean) || false;
  const dryRun = (args.dryRun as boolean) || false;
  const shouldBackup = (args.createBackup as boolean) || false;

  if (!filePath) return errorResponse("Missing required parameter: filePath");
  if (!symbolName) return errorResponse("Missing required parameter: symbolName");

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return errorResponse(`File not found: ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!WRITABLE_EXTENSIONS.has(ext)) {
    return errorResponse(`Unsupported file type "${ext}" for symbol removal.`);
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to read file: ${msg}`);
  }

  // Dependency check (unless forced)
  if (!force) {
    const rootDir = findProjectRoot(resolvedPath);
    if (rootDir) {
      const ignoreManager = new IgnoreManager(rootDir);
      const allFiles = ignoreManager.walkDirectory();

      // Check if the symbol name appears in any dependent file
      const importPatterns: RegExp[] = [
        /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
        /^\s*use\s+([\w\\]+)/gm,
        /^\s*import\s+['"]([^'"]+)['"]\s*;/gm,
        /from\s+(\S+)\s+import/gm,
      ];

      const usageFiles: string[] = [];

      for (const file of allFiles) {
        if (path.resolve(file) === resolvedPath) continue;

        const fileExt = path.extname(file).toLowerCase();
        if (!WRITABLE_EXTENSIONS.has(fileExt)) continue;

        let fileContent: string;
        try {
          fileContent = fs.readFileSync(file, "utf-8");
        } catch {
          continue;
        }

        // Check if this file imports the target file
        let importsTarget = false;
        for (const pattern of importPatterns) {
          const regex = new RegExp(pattern.source, pattern.flags);
          let match: RegExpExecArray | null;
          while ((match = regex.exec(fileContent)) !== null) {
            if (resolveImportMatch(match[1], resolvedPath, file, rootDir)) {
              importsTarget = true;
              break;
            }
          }
          if (importsTarget) break;
        }

        if (!importsTarget) continue;

        // Check if this file references the symbol name
        const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const symbolRegex = new RegExp(`\\b${escaped}\\b`);
        if (symbolRegex.test(fileContent)) {
          usageFiles.push(
            path.relative(rootDir, file).replace(/\\/g, "/"),
          );
        }
      }

      if (usageFiles.length > 0) {
        return errorResponse(
          `Cannot remove "${symbolName}" — it is referenced in ${usageFiles.length} file(s):\n` +
          usageFiles.map((f) => `  • ${f}`).join("\n") +
          `\n\nUse force=true to remove anyway, or update the dependent files first.`,
        );
      }
    }
  }

  // Perform the removal
  const result: WriteResult = removeSymbolFromFile(resolvedPath, content, symbolName, className);

  if (!result.success) {
    return errorResponse(result.error || "Unknown error during symbol removal");
  }

  const diff = generateDiff(content, result.newContent, resolvedPath);

  if (dryRun) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `// 🔍 DRY RUN — No files modified\n` +
            `// Tool: remove_symbol\n` +
            `// File: ${resolvedPath}\n` +
            `// Symbol: ${symbolName}\n` +
            `// Force: ${force}\n\n` +
            diff,
        },
      ],
    };
  }

  if (shouldBackup) {
    try {
      createBackup(resolvedPath);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return errorResponse(`Failed to create backup: ${msg}`);
    }
  }

  try {
    fs.writeFileSync(resolvedPath, result.newContent, "utf-8");
  } catch (error: unknown) {
    if (shouldBackup) restoreBackup(resolvedPath);
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to write file: ${msg}`);
  }

  return {
    content: [
      {
        type: "text" as const,
        text:
          `// ✅ Symbol "${symbolName}" removed successfully\n` +
          `// File: ${resolvedPath}\n` +
          `// Force: ${force}\n\n` +
          diff,
      },
    ],
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
