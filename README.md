# mcp-code-context

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/mcp-code-context.svg)](https://www.npmjs.com/package/mcp-code-context)
[![npm downloads](https://img.shields.io/npm/dm/mcp-code-context.svg)](https://www.npmjs.com/package/mcp-code-context)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)]()
[![Tests](https://img.shields.io/badge/tests-74%20passing-success.svg)]()
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=ko-fi)](https://ko-fi.com/achatainga)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal)](https://paypal.me/achatainga)

> MCP server with **Tree-sitter WASM parsers** for 100% AST accuracy. Zero native dependencies. Production-ready with persistent caching, structured logging, fuzzy search, and multi-process safety.

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

**No build tools required** - Works on Windows/Mac/Linux without Visual Studio, Python, or node-gyp.

Works with **Claude Desktop**, **Cursor**, **Windsurf**, **GitHub Copilot**, **Amazon Q**, and any [Model Context Protocol](https://modelcontextprotocol.io/) compatible client.

📖 **For AI Agents**: See [INSTRUCTIONS.md](INSTRUCTIONS.md) for essential usage patterns and best practices.

---

## 💡 Why This Exists

This tool was born out of necessity in **Caracas, Venezuela 🇻🇪**, where economic limitations made every API token count. When you're choosing between groceries and Claude API credits, you learn to optimize fast.

What started as a personal script to compress context windows became a full MCP server when I realized others faced the same problem: **LLM APIs are expensive, and most tools waste tokens on boilerplate**.

If this tool saves you money or time, consider [supporting its development](#-support-this-project). Every contribution helps keep this project maintained and free for everyone.

---

## The Problem

LLMs working with code face two bottlenecks:
1. **Reading**: Sending raw source files wastes the context window on function bodies and boilerplate. A 500-line file might contain only 30 lines of *structural* information the LLM needs.
2. **Writing**: Rewriting entire files to change one function is error-prone, token-expensive, and risks corrupting unrelated code.

## The Solution

`mcp-code-context` provides **13 tools** — 6 for reading, 2 for cleanup, and 5 for writing — that operate at the **symbol level** (functions, classes, methods). Furthermore, tools support a `className` scope which correctly isolates identical symbol names in the same file (e.g. Flutter `build()` methods) to avoid reading or changing the wrong logic. Read tools extract structural skeletons. Write tools splice changes into the exact AST location.

| File | Original | Compressed | Reduction |
|------|----------|------------|-----------|
| PHP class (426 lines) | 426 | 60 | **85.9%** |
| Dart repository (230 lines) | 230 | 30 | **87.0%** |
| PHP config (68 lines) | 68 | 15 | **77.9%** |

## Reliability & Testing

Built to be robust and precise. Both read and write engines are tested against real-world, complex codebases (including nested generic types in Dart, complex interfaces in PHP, and multi-file rename operations) with a **100% test pass rate** across all languages and operations.

## Features

### What's New in v3.6.1

| Feature | Description |
|---------|-------------|
| ⚡ **Persistent Cache** | WASM SQLite cache — <100ms hits, 10× faster on repeated reads |
| 📝 **Structured Logging** | pino JSON logging to stderr (MCP-safe, never pollutes stdio) |
| 👁️ **File Watcher** | chokidar auto-invalidates cache on file changes |
| 🔍 **Fuzzy Search** | fuse.js finds `authUser` when you search `authenticateUser` |
| 📄 **Pagination** | Search defaults to 10 results with `startIndex` for navigation |
| 🔒 **Multi-process Safe** | Filesystem locks via `proper-lockfile` (was in-memory) |
| 💾 **OS Temp Backups** | Backups in `os.tmpdir()` — no more hot-reload loops |
| 🧪 **74 Tests** | Unit + integration + performance + stress tests |
| 🎯 **Token Savings** | 50-80% reduction: compact diffs, no Phase 2 repeat, auto-optimize output |

### Read
- 🌳 **AST-based compression** — Real Tree-sitter WASM parsers for TypeScript/JavaScript/Python/PHP/Dart. Zero regex-based parsing.
- 🔬 **Surgical symbol extraction** — Extract a single function, class, or method from a file by name. Use `className` to scope disambiguation (e.g., getting multiple `build()` methods in Dart).
- 💥 **Impact analysis** — Discover all files that depend on a given file before refactoring. Supports ES imports, CommonJS `require()`, Python imports, PHP `use`/`require_once`/`include`, and Dart imports.
- 📁 **Smart file walking** — Respects `.gitignore` and `.repomixignore` rules. Automatically excludes `node_modules`, `dist`, `vendor`, `.git`, etc.
- 📄 **Multi-format output** — XML (optimized for LLM consumption) or Markdown (human-readable).

### Write
- ✏️ **Surgical symbol replacement** — Replace a function, method, or class body without touching the rest of the file. Narrow down the target using the `className` parameter.
- ➕ **Precise code insertion** — Insert new code before/after a symbol, or inside a class at the start/end.
- 🔄 **Repository-wide rename** — Rename a symbol in its definition AND all files that import it, atomically.
- 🗑️ **Safe symbol removal** — Delete code with automatic dependency checking to prevent breakage.
- 🔍 **Mandatory dry-run flow** — Write tools return a preview diff and a `confirmationToken` by default. Changes are only applied after explicit confirmation.
- 💾 **Robust rolling backups** — Automatically keeps the last 5 versions of modified files in a hidden `.mcp-backups/` directory.
- ⏪ **Surgical rollback** — Revert files to any of the 5 previous states using the `rollback_file` tool.
- 🤖 **Fuzzy symbol matching** — When a symbol is not found, the server provides structured suggestions based on Levenshtein distance.
- 🔐 **Private symbol support** — Full support for `_` and `__` prefixed symbols in Dart and Python.

## Supported Languages

| Language | Read (Compress + Extract) | Write (Replace + Insert + Rename + Remove) | Import Analysis |
|----------|---------------------------|---------------------------------------------|------------------|
| TypeScript / JavaScript | ✅ AST (Tree-sitter WASM) | ✅ AST (Tree-sitter WASM) | ✅ |
| PHP | ✅ AST (Tree-sitter WASM) | ✅ AST + line-splice | ✅ |
| Dart | ✅ AST (Tree-sitter WASM) | ✅ AST + line-splice | ✅ |
| Python | ✅ AST (Tree-sitter WASM) | ✅ Indentation-aware | ✅ |
| Others (JSON, YAML, CSS, etc.) | Passthrough / truncation | — | — |

## ⚠️ Known Limitations

### `rename_symbol` Tool

**Dart and Python**: Cross-file rename is **NOT supported** for `.dart`, `.py`, and `.pyi` files.

- **Reason**: No AST parser available for safe cross-file refactoring
- **Risk**: Regex-based rename may corrupt strings, comments, or unrelated code
- **Recommendation**: Use IDE refactoring tools instead:
  - **Dart**: VS Code with Dart extension (F2 key) or IntelliJ IDEA
  - **Python**: PyCharm, VS Code with Pylance (F2 key)
- **Alternative**: Use `write_file_surgical` to rename within a single file

**TypeScript, JavaScript, PHP**: Fully supported with AST-aware renaming ✅

**Note**: While the definition file uses pure AST replacement, dependent files (imports) are updated using regex word-boundaries. Review the generated diffs carefully to ensure strings or comments sharing the same name aren't unintentionally modified.

### `get_semantic_repo_map` Tool

- **Max files**: Limited to 500 files to prevent timeouts
- **Performance**: Synchronous I/O may take 10-30 seconds on large repositories
- **Recommendation**: Use `@folder` syntax to target specific directories

### General

- **Validation**: No automatic syntax checking after edits. Always review diffs carefully before confirming.
- **Backups**: 5-version rolling backup system. Use `rollback_file` if something goes wrong.
- **Large files**: Files >10MB are skipped for safety.

## Installation

```bash
# Global installation (recommended)
npm install -g mcp-code-context

# Or use directly with npx (no installation)
npx -y mcp-code-context
```

**Note**: Unlike v2.x, this version uses **web-tree-sitter (WASM)** instead of native bindings. No Visual Studio, Python, or node-gyp required!

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-code-context": {
      "command": "npx",
      "args": ["-y", "mcp-code-context"]
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
      "command": "npx",
      "args": ["-y", "mcp-code-context"]
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
      "command": "npx",
      "args": ["-y", "mcp-code-context"]
    }
  }
}
```

### Amazon Q / Other MCP Clients

Any MCP-compatible client can use this server. The transport is **stdio** (JSON-RPC over stdin/stdout). Point your client to `npx -y mcp-code-context`.

## Tools

### Read Tools

#### 1. `get_semantic_repo_map`
Generate a compressed architectural overview of an entire repository.
- `directoryPath` (required) — Path to the repo root
- `format` (optional) — `"xml"` (default) or `"markdown"`

#### 2. `read_file_surgical`
Read a file, or extract only a specific named symbol. Returns structured suggestions if the symbol is missing.
- `filePath` (required) — Path to the source file
- `symbolName` (optional) — Name of a function, class, method, or type
- `className` (optional) — Scope the symbol to a specific class (to avoid duplicates)

#### 3. `analyze_impact`
Find all files that depend on a given file.
- `filePath` (required) — Path to the file being modified
- `rootDir` (optional) — Repository root (auto-detected)

#### 4. `read_file_lines`
Read specific line ranges from a file without loading the entire content. More efficient than `read_file_surgical` for small fragments.
- `filePath` (required) — Path to the source file
- `startLine` (optional) — Starting line number (1-indexed)
- `endLine` (optional) — Ending line number (1-indexed)
- `aroundPattern` (optional) — Search pattern to find and return surrounding lines
- `contextLines` (optional) — Number of lines before/after pattern (default: 5)

#### 5. `search_code_pattern`
Search for code patterns across multiple files with context. Respects `.gitignore` rules.
- `rootDir` (required) — Repository root directory
- `pattern` (required) — Regular expression pattern to search
- `fileExtensions` (optional) — Array of extensions to search (e.g., `[".ts", ".dart"]`)
- `excludeDirs` (optional) — Directories to exclude (default: `["node_modules", "dist", "build"]`)
- `maxResults` (optional) — Maximum matches per page (default: 10)
- `startIndex` (optional) — Pagination offset (default: 0)
- `fuzzyMatch` (optional) — Enable fuzzy/typo-tolerant matching (default: false)
- `fuzzyThreshold` (optional) — Fuzzy sensitivity 0.0–1.0 (default: 0.4)

#### 6. `rollback_file`
Surgically restore a file to a previous state from the automated backup system.
- `filePath` (required) — Path to the file to restore
- `steps` (optional) — Number of versions to go back (1-5, default: 1)

#### 7. `clean_backups`
Remove all backup files for a project to keep the working directory clean.
- `projectRoot` (required) — Absolute path to the project root

**Note:** Backups are stored centrally at `[project-root]/.mcp-backups/` to keep your project organized.

### Write Tools (Two-Phase Workflow)

All write tools follow a **Two-Phase Workflow**:
1. **Call without token**: Returns a unified `diff` and a `confirmationToken`.
2. **Call with token**: Set `confirm: true` and provide the token to apply the changes.

#### 8. `write_file_surgical`
Replace the full source code of a named symbol in a file.
- `filePath` (required) — Path to the file
- `symbolName` (required) — Symbol to replace
- `newContent` (required) — Replacement code (signature + body)
- `confirmationToken` (optional) — Token from Phase 1 to apply changes
- `confirm` (optional) — Set to `true` to apply
- `className` (optional) — Scope the symbol to a specific class

#### 9. `insert_symbol`
Insert new code at a precise location relative to an existing symbol.
- `filePath` (required) — Path to the file
- `code` (required) — Code to insert
- `anchorSymbol` (optional) — Symbol to position relative to
- `position` (optional) — `"before"`, `"after"`, `"inside_start"`, `"inside_end"`
- `className` (optional) — Scope the anchor to a specific class
- `confirmationToken`, `confirm` (optional)

#### 10. `rename_symbol`
Rename a symbol across the entire repository (definition + all usages).
- `filePath` (required) — File where the symbol is defined
- `oldName` (required) — Current name
- `newName` (required) — New name
- `rootDir` (optional) — Repository root
- `confirmationToken`, `confirm` (optional)

#### 11. `remove_symbol`
Safely remove a symbol from a file with dependency checking.
- `filePath` (required) — Path to the file
- `symbolName` (required) — Symbol to remove
- `className` (optional) — Scope the symbol to a specific class
- `force` (optional) — Skip dependency check
- `confirmationToken`, `confirm` (optional)

## Recommended Workflow

1. **Understand** → `get_semantic_repo_map` to see the architecture
2. **Read** → `read_file_surgical` with symbol name for specific implementations
3. **Assess** → `analyze_impact` before modifying shared files
4. **Edit (Preview)** → Call write tools to generate a `diff` and `confirmationToken`
5. **Confirm** → Call the same write tool with the token and `confirm: true` to apply
6. **Recovery** → Use `rollback_file` if something goes wrong after confirmation

---

## 💰 Support This Project

### Why Support?

This tool was born in **Caracas, Venezuela 🇻🇪**, where economic limitations mean every API token counts. What started as a personal script to save money on Claude API became a full MCP server when I realized others faced the same problem.

**Current Reality**:
- ⏰ ~10 hours/week of maintenance
- 💵 ~$20/month in costs (npm, testing, domain)
- 🆓 100% free and open source (always will be)

If this tool saves you time or money, consider supporting its development.

---

### 💳 Ways to Support

#### 🔹 One-Time Donation

**Ko-fi** (PayPal + Cards, 0% fees)  
[ko-fi.com/achatainga](https://ko-fi.com/achatainga)

**PayPal** (Direct)  
[paypal.me/achatainga](https://paypal.me/achatainga)

**Binance (USDT)** (Crypto, lowest fees)  
- **TRC20/ERC20**: `0xa68d53f7853ce0175eb96aaad4a30c068ca96444`
- **Binance Pay ID**: `367669339`

*Recommended: TRC20 for lower gas fees*

#### Suggested Amounts:
- ☕ **$5** - A coffee (1 hour of development)
- 🍕 **$25** - A pizza (testing a new language)
- 🚀 **$100** - Rocket fuel (major feature development)

---

#### 🔹 Recurring Support

**Ko-fi Membership**  
[ko-fi.com/achatainga/tiers](https://ko-fi.com/achatainga/tiers)

Monthly tiers:
- **$5/month** - Supporter (name in SPONSORS.md)
- **$25/month** - Contributor (priority support, early access)
- **$100/month** - Sponsor (feature requests, 1-on-1 consultation)

---

#### 🔹 Hire Me

Need custom MCP tools or AI integrations?

- 💼 **Available for**: Freelance contracts
- 🌐 **Location**: Caracas, Venezuela (Remote)
- 💻 **Skills**: TypeScript, Node.js, MCP, AI/LLM integrations
- 💵 **Rate**: $50-75/hour

📧 **Contact**: a.chataing.a@gmail.com  
📄 **Details**: [HIRE_ME.md](HIRE_ME.md)

---

### 📊 Transparency

I believe in radical transparency:

**Current Status**:
- 💰 Donations received: $0
- 💸 Expenses: $20/month (npm, testing)
- ⏰ Time invested: ~10 hours/week
- 📦 Downloads: 10,000+/month

*(Updated monthly)*

---

### 🏆 Hall of Fame

Thank you to these amazing supporters:

*(No sponsors yet - be the first!)*

See full list: [SPONSORS.md](SPONSORS.md)

---

### ❤️ Non-Financial Support

Can't donate? No problem! You can still help:

- ⭐ Star the repo on GitHub
- 🐛 Report bugs or suggest features
- 📝 Improve documentation
- 🗣️ Share with others who might benefit
- 💬 Join discussions and help other users

Every contribution matters, financial or not.

---

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Development (build + start)
npm run dev
```

## Technical Details

- **Transport:** stdio (JSON-RPC over stdin/stdout)
- **Runtime:** Node.js >= 18
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/)
- **AST Engines:** web-tree-sitter@0.25.1 (WASM) for TypeScript/JS/Python/PHP/Dart
- **Language Grammars:** tree-sitter-wasms@0.1.13 (ABI v15)
- **Cache:** sql.js@1.14.1 (WASM SQLite, zero native deps)
- **Logging:** pino@10.3.1 (JSON to stderr, MCP-safe)
- **File Watcher:** chokidar@5.0.0 (auto cache invalidation)
- **Fuzzy Search:** fuse.js@7.3.0 (typo-tolerant matching)
- **File Locking:** proper-lockfile@4.1.2 (multi-process safe, OS temp)
- **Diff:** diff-match-patch@1.0.5 (Myers algorithm, O(n+d²))
- **Ignore Engine:** `ignore` npm package (full .gitignore spec support)
- **Safety Features:** Mandatory two-phase confirmation, rolling 5-version backups, fuzzy matching, dependency checking, surgical restoration, ReDoS protection via worker_threads.
- **Portability:** 100% WASM - no native dependencies, works on all platforms
- **Tests:** 74 passing (unit + integration + performance + stress)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for security policies and reporting vulnerabilities.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.

### Viewing Logs

Because MCP uses `stdout` for protocol communication, all logs are safely routed to `stderr`. You can view them in your client's log files:

- **Claude Desktop (macOS)**: `~/Library/Logs/Claude/mcp-server-mcp-code-context.log`
- **Claude Desktop (Windows)**: `%APPDATA%\Claude\logs\mcp-server-mcp-code-context.log`
- **Cursor**: `Output` panel → Select `mcp-code-context` from the dropdown

**Environment Variables** (optional):

```json
{
  "mcpServers": {
    "mcp-code-context": {
      "command": "npx",
      "args": ["-y", "mcp-code-context"],
      "env": {
        "NODE_ENV": "development",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

Supported `LOG_LEVEL` values: `fatal`, `error`, `warn`, `info`, `debug`, `trace` (default: `info`).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)

---

**Built with ❤️ from Caracas, Venezuela 🇻🇪**
