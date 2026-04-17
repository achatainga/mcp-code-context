# mcp-code-context

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-passing-success.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)]()
[![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)]()

> MCP server that compresses any codebase into LLM-ready semantic context **and provides surgical code editing tools**. AST-based read & write for TypeScript, JavaScript, PHP, Dart & Python.

## 🚀 Quick Start (Claude Desktop)

1. **Install**: `npm install -g mcp-code-context`
2. **Configure**: Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "mcp-code-context"]
    }
  }
}
```
3. **Enjoy**: Use symbols like `@code-context` to map repos or edit code surgically.

Works with **Claude Desktop**, **Cursor**, **Windsurf**, **GitHub Copilot**, **Amazon Q**, and any [Model Context Protocol](https://modelcontextprotocol.io/) compatible client.

## The Problem

LLMs working with code face two bottlenecks:
1. **Reading**: Sending raw source files wastes the context window on function bodies and boilerplate. A 500-line file might contain only 30 lines of *structural* information the LLM needs.
2. **Writing**: Rewriting entire files to change one function is error-prone, token-expensive, and risks corrupting unrelated code.

## The Solution

`mcp-code-context` provides **7 tools** — 3 for reading and 4 for writing — that operate at the **symbol level** (functions, classes, methods). Furthermore, tools support a `className` scope which correctly isolates identical symbol names in the same file (e.g. Flutter `build()` methods) to avoid reading or changing the wrong logic. Read tools extract structural skeletons. Write tools splice changes into the exact AST location.

| File | Original | Compressed | Reduction |
|------|----------|------------|-----------|
| PHP class (426 lines) | 426 | 60 | **85.9%** |
| Dart repository (230 lines) | 230 | 30 | **87.0%** |
| PHP config (68 lines) | 68 | 15 | **77.9%** |

## Reliability & Testing

Built to be robust and precise. Both read and write engines are tested against real-world, complex codebases (including nested generic types in Dart, complex interfaces in PHP, and multi-file rename operations) with a **100% test pass rate** across all languages and operations.

## Features

### Read
- 🌳 **AST-based compression** — Real parsers for TypeScript/JavaScript ([ts-morph](https://ts-morph.com/)) and PHP ([php-parser](https://github.com/nickygerritsen/php-parser)). Brace-counting engine for Dart. Regex-based extraction for Python.
- 🔬 **Surgical symbol extraction** — Extract a single function, class, or method from a file by name. Use `className` to scope disambiguation (e.g., getting multiple `build()` methods in Dart).
- 💥 **Impact analysis** — Discover all files that depend on a given file before refactoring. Supports ES imports, CommonJS `require()`, Python imports, PHP `use`/`require_once`/`include`, and Dart imports.
- 📁 **Smart file walking** — Respects `.gitignore` and `.repomixignore` rules. Automatically excludes `node_modules`, `dist`, `vendor`, `.git`, etc.
- 📄 **Multi-format output** — XML (optimized for LLM consumption) or Markdown (human-readable).

### Write
- ✏️ **Surgical symbol replacement** — Replace a function, method, or class body without touching the rest of the file. Narrow down the target using the `className` parameter.
- ➕ **Precise code insertion** — Insert new code before/after a symbol, or inside a class at the start/end.
- 🔄 **Repository-wide rename** — Rename a symbol in its definition AND all files that import it, atomically.
- 🗑️ **Safe symbol removal** — Delete code with automatic dependency checking to prevent breakage.
- 🔍 **Dry-run mode** — Preview all changes as unified diffs before applying.
- 💾 **Opt-in backups** — Create `.bak` copies before modification, with automatic rollback on failure.

## Supported Languages

| Language | Read (Compress + Extract) | Write (Replace + Insert + Rename + Remove) | Import Analysis |
|----------|---------------------------|---------------------------------------------|------------------|
| TypeScript / JavaScript | ✅ AST (ts-morph) | ✅ AST (ts-morph) | ✅ |
| PHP | ✅ AST (php-parser) | ✅ AST + line-splice | ✅ |
| Dart | ✅ Brace-counting + regex | ✅ Brace-counting + regex | ✅ |
| Python | ✅ Regex-based | ✅ Indentation-aware | ✅ |
| Others (JSON, YAML, CSS, etc.) | Passthrough / truncation | — | — |

## Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/mcp-code-context.git
cd mcp-code-context

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-code-context": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-code-context/dist/index.js"]
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "mcp-code-context": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-code-context/dist/index.js"]
    }
  }
}
```

### Windsurf

Add to your Windsurf MCP config:

```json
{
  "mcpServers": {
    "mcp-code-context": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-code-context/dist/index.js"]
    }
  }
}
```

### Amazon Q / Other MCP Clients

Any MCP-compatible client can use this server. The transport is **stdio** (JSON-RPC over stdin/stdout). Point your client to `node dist/index.js`.

## Tools

### Read Tools

#### 1. `get_semantic_repo_map`
Generate a compressed architectural overview of an entire repository.
- `directoryPath` (required) — Path to the repo root
- `format` (optional) — `"xml"` (default) or `"markdown"`

#### 2. `read_file_surgical`
Read a file, or extract only a specific named symbol.
- `filePath` (required) — Path to the source file
- `symbolName` (optional) — Name of a function, class, method, or type
- `className` (optional) — Scope the symbol to a specific class (to avoid duplicates)

#### 3. `analyze_impact`
Find all files that depend on a given file.
- `filePath` (required) — Path to the file being modified
- `rootDir` (optional) — Repository root (auto-detected)

### Write Tools

#### 4. `write_file_surgical`
Replace the full source code of a named symbol in a file.
- `filePath` (required) — Path to the file
- `symbolName` (required) — Symbol to replace
- `newContent` (required) — Replacement code (signature + body)
- `className` (optional) — Scope the symbol to a specific class
- `dryRun` (optional) — Preview changes as diff without writing
- `createBackup` (optional) — Create `.bak` copy before editing

#### 5. `insert_symbol`
Insert new code at a precise location relative to an existing symbol.
- `filePath` (required) — Path to the file
- `code` (required) — Code to insert
- `anchorSymbol` (optional) — Symbol to position relative to
- `position` (optional) — `"before"`, `"after"`, `"inside_start"`, `"inside_end"`
- `className` (optional) — Scope the anchor to a specific class
- `dryRun`, `createBackup` (optional)

#### 6. `rename_symbol`
Rename a symbol across the entire repository (definition + all usages).
- `filePath` (required) — File where the symbol is defined
- `oldName` (required) — Current name
- `newName` (required) — New name
- `rootDir` (optional) — Repository root
- `dryRun`, `createBackup` (optional)

#### 7. `remove_symbol`
Safely remove a symbol from a file with dependency checking.
- `filePath` (required) — Path to the file
- `symbolName` (required) — Symbol to remove
- `className` (optional) — Scope the symbol to a specific class
- `force` (optional) — Skip dependency check
- `dryRun`, `createBackup` (optional)

## Recommended Workflow

1. **Understand** → `get_semantic_repo_map` to see the architecture
2. **Read** → `read_file_surgical` with symbol name for specific implementations
3. **Assess** → `analyze_impact` before modifying shared files
4. **Edit** → `write_file_surgical`, `insert_symbol`, `rename_symbol`, or `remove_symbol`
5. **Preview** → Always use `dryRun: true` for significant changes

## Development

```bash
# Build
npm run build

# Run read tests (compression + extraction)
npm run build && node dist/tests/test-dart.js && node dist/tests/test-php.js

# Run write tests (replace, insert, rename, remove)
npm run build && node dist/tests/writers/test-write-smoke.js

# Run all tests
npm run build && node dist/tests/test-dart.js && node dist/tests/test-php.js && node dist/tests/writers/test-write-smoke.js

# Development (build + start)
npm run dev
```

## Technical Details

- **Transport:** stdio (JSON-RPC over stdin/stdout)
- **Runtime:** Node.js >= 18
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/)
- **AST Engines:** ts-morph (TypeScript/JS), php-parser (PHP), brace-counting (Dart), regex (Python)
- **Ignore Engine:** `ignore` npm package (full .gitignore spec support)
- **Safety Features:** Dry-run previews, opt-in backups, syntax validation, dependency checking, atomic rollback

## License

[MIT](LICENSE)
