# mcp-code-context

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/mcp-code-context.svg)](https://www.npmjs.com/package/mcp-code-context)
[![npm downloads](https://img.shields.io/npm/dm/mcp-code-context.svg)](https://www.npmjs.com/package/mcp-code-context)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)]()
[![Tests](https://img.shields.io/badge/tests-83%20passing-success.svg)]()
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=ko-fi)](https://ko-fi.com/achatainga)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal)](https://paypal.me/achatainga)

> MCP server with **Tree-sitter WASM parsers** for 100% AST accuracy. Zero native dependencies. Production-ready with persistent caching, structured logging, fuzzy search, multi-process safety, and **session-scoped state**.

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

`mcp-code-context` provides **25 tools** — covering reading, writing, AST transformation, search, and session management — all operating at the **symbol level** (functions, classes, methods). Tools support a `className` scope to correctly isolate identical symbol names in the same file (e.g. Flutter `build()` methods). Read tools extract structural skeletons. Write tools splice changes into the exact AST location.

| File | Original | Compressed | Reduction |
|------|----------|------------|-----------|
| PHP class (426 lines) | 426 | 60 | **85.9%** |
| Dart repository (230 lines) | 230 | 30 | **87.0%** |
| PHP config (68 lines) | 68 | 15 | **77.9%** |

### Token Savings

**Real-world results**:
- TypeScript project: 73% reduction in tokens sent to LLM
- PHP application: 82% reduction
- Dart codebase: 79% reduction

---

## Reliability & Testing

Built to be robust and precise. Both read and write engines are tested against real-world, complex codebases (including nested generic types in Dart, complex interfaces in PHP, and multi-file rename operations) with a **100% test pass rate** across all languages and operations.

### Production-Ready Features

| Feature | v3.6.x | v3.7.1 | Benefit |
|---------|--------|--------|---------|
| Multi-process safety | ✅ | ✅ | No file corruption |
| Persistent cache | ✅ | ✅ | <100ms cache hits |
| Session-scoped state | ❌ | ✅ | No state leakage between clients |
| Crash recovery | ❌ | ✅ | Pending operations survive restart |
| Expanded ReDoS protection | 6 patterns | 15+ patterns | Better security |
| Auto-persist before eviction | ❌ | ✅ | Cache data preserved |

---

## Features

### What's New in v3.7.1

| Feature | Description |
|---------|-------------|
| 🔒 **Session-scoped state** | Each MCP client gets isolated locks, confirmation store, rate limiter (no state leakage) |
| 💾 **Crash recovery** | SQLite-backed pending operations store - survive restarts |
| 🔍 **Expanded ReDoS protection** | 15+ patterns (was 6) - better protection against regex DoS |
| ⚡ **Auto-persist before eviction** | CacheManager now persists before LRU eviction |
| 📊 **Higher file limits** | MAX_FILES_REPO_MAP = 2000 (was 500) |
| 🧪 **Multi-client tests** | New integration tests for concurrent MCP clients |
| 📝 **New tools**: `get_session_stats`, `clear_session_cache`, `list_pending_operations` | Session-aware operations |

### Previous Versions (v3.6.x)

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
- 💾 **Robust rolling backups** — Automatically keeps the last 5 versions of modified files in the OS temp directory.
- ⏪ **Surgical rollback** — Revert files to any of the 5 previous states using the `rollback_file` tool.
- ���� **Fuzzy symbol matching** — When a symbol is not found, the server provides structured suggestions based on Levenshtein distance.
- 🔐 **Private symbol support** — Full support for `_` and `__` prefixed symbols in Dart and Python.

---

## Supported Languages

| Language | Read (Compress + Extract) | Write (Replace + Insert + Rename + Remove) | Import Analysis |
|----------|---------------------------|---------------------------------------------|------------------|
| TypeScript / JavaScript | ✅ AST (Tree-sitter WASM) | ✅ AST (Tree-sitter WASM) | ✅ |
| PHP | ✅ AST (Tree-sitter WASM) | ✅ AST + line-splice | ✅ |
| Dart | ✅ AST (Tree-sitter WASM) | ✅ AST + line-splice | ✅ |
| Python | ✅ AST (Tree-sitter WASM) | ✅ Indentation-aware | ✅ |
| Others (JSON, YAML, CSS, etc.) | Passthrough / truncation | — | — |

---

## ⚠️ Known Limitations

### `rename_symbol` Tool

**All languages**: The definition file is renamed using **AST (Tree-sitter)** — safe and precise. ✅

**Cross-file rename (dependent files)**: Updated using **regex word-boundaries** for all languages, including TypeScript, JavaScript, and PHP.

- **Risk**: Regex may match strings, comments, or unrelated identifiers sharing the same name
- **Dart and Python**: Higher risk — import syntax (`import 'package:...'`, `from module import name`) is less reliably matched by the current regex patterns
- **Recommendation**: Always review the generated diff carefully before confirming
- **Alternative**: Use `write_file_surgical` to rename within a single file safely

### `get_semantic_repo_map` Tool

- **Max files**: Limited to 2000 files to prevent timeouts (increased from 500 in v3.7.1)
- **Performance**: Synchronous I/O may take 10-30 seconds on large repositories
- **Recommendation**: Use `@folder` syntax to target specific directories

### General

- **Validation**: No automatic syntax checking after edits. Always review diffs carefully before confirming.
- **Backups**: 5-version rolling backup system. Use `rollback_file` if something goes wrong.
- **Large files**: Files >10MB are skipped for safety.
- **Phase 2 tokens**: Confirmation tokens expire after 5 minutes.

---

## Installation

```bash
# Global installation (recommended)
npm install -g mcp-code-context

# Or use directly with npx (no installation)
npx -y mcp-code-context
```

**Note**: Unlike v2.x, this version uses **web-tree-sitter (WASM)** instead of native bindings. No Visual Studio, Python, or node-gyp required!

---

## Session State (v3.7.1+)

**Important**: v3.7.1 introduces **session-scoped state** for each MCP client connection. This prevents state leakage when multiple agents (Amazon Q, Kiro, Cursor, etc.) use the same server instance.

### What Changed

| Before (v3.6.x) | After (v3.7.1) |
|----------------|----------------|
| Global `LockManager` (shared by all clients) | Session-scoped `sessionStates` Map |
| Global `ConfirmationStore` (in-memory Map) | Session-scoped confirmation store + SQLite persistence |
| Global `RateLimiter` (shared tokens) | Per-session token bucket |
| No crash recovery | SQLite-backed pending operations store |

### Benefits

- ✅ **No state leakage**: Each agent gets isolated locks, confirmation store, and rate limiter
- ✅ **Crash recovery**: Pending operations survive server restarts
- ✅ **Multi-agent safe**: Amazon Q and Kiro can run simultaneously without conflicts

### Configuration

**No additional configuration needed**. Session isolation is automatic. Just configure your MCP server normally:

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

### New Tools (v3.7.1)

- `get_session_stats` — Get stats for current session only
- `clear_session_cache` — Clear cache for current session only
- `list_pending_operations` — List pending operations for recovery

---

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

### Amazon Q

Add to your Amazon Q MCP config:

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

### Kiro

Add to your Kiro MCP config (`.kiro/settings/mcp.json`):

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

### Antigravity

Add to your Antigravity MCP config (`.antigravity/mcp.json`):

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

### Other MCP Clients

Any MCP-compatible client can use this server. The transport is **stdio** (JSON-RPC over stdin/stdout). Point your client to `npx -y mcp-code-context`.

---

## Tools

### Tool Reference (25 tools)

#### Read Tools

| Tool | Key Params | Description |
|------|-----------|-------------|
| `get_semantic_repo_map` | `directoryPath`, `projectRoot`, `format` | Compressed XML/Markdown repo overview with AST symbols |
| `read_file_surgical` | `filePath`, `projectRoot`, `symbolName?`, `className?` | Extract one symbol or full file |
| `analyze_impact` | `filePath`, `projectRoot`, `rootDir?` | All files that depend on this file |
| `read_file_lines` | `filePath`, `projectRoot`, `startLine?`, `endLine?`, `aroundPattern?` | Read a line range or pattern context |
| `search_code_pattern` | `rootDir`, `projectRoot`, `pattern`, `fileExtensions?`, `fuzzyMatch?` | Regex search across files (ripgrep-fast) |
| `parse_file` | `filePath`, `projectRoot` | All symbols with line numbers (cheap index) |
| `search_symbols` | `rootDir`, `projectRoot`, `query`, `fuzzy?`, `types?` | AST symbol search by name, not text |
| `explain_symbol` | `filePath`, `projectRoot`, `symbolName`, `rootDir?` | Signature + location + callers in one call |
| `batch_read` | `reads[]`, `projectRoot` | N symbols from N files in 1 round-trip |
| `get_rate_limit_status` | — | Token balance + `canAfford` map |

#### Write Tools (Two-Phase: preview → confirm)

All write tools require two calls:
1. **Phase 1** — Call normally → returns `diff` + `confirmationToken`
2. **Phase 2** — Call again with `confirm: true` + `confirmationToken` → applies changes

`newContent`/`code` are **not required** in Phase 2 — the server stores them from Phase 1.

| Tool | Key Params | Description |
|------|-----------|-------------|
| `write_file_surgical` | `filePath`, `projectRoot`, `symbolName`, `newContent`, `className?` | Replace a symbol with new code |
| `insert_symbol` | `filePath`, `projectRoot`, `code`, `anchorSymbol?`, `position?`, `className?` | Insert code before/after/inside a symbol |
| `remove_symbol` | `filePath`, `projectRoot`, `symbolName`, `className?`, `force?` | Remove a symbol (with dependency check) |
| `rename_symbol` | `filePath`, `projectRoot`, `oldName`, `newName`, `rootDir?` | Rename across entire repo (AST + regex) |
| `ast_transform` | `filePath`, `projectRoot`, `symbolName`, `transform`, `className?` | Declarative transforms: `wrap_with_try_catch`, `add_parameter`, `add_decorator`, `change_return_type`, `extract_variable` |

#### Admin / Recovery Tools

| Tool | Key Params | Description |
|------|-----------|-------------|
| `rollback_file` | `filePath`, `projectRoot`, `steps?` | Restore file from rolling backup (up to 5 versions) |
| `clean_backups` | `projectRoot` | Delete all backups for this project |
| `get_server_stats` | — | Telemetry, audit stats, rate limiter state |
| `get_cache_stats` | `projectRoot` | Cache entries, size, hit rate |
| `clear_cache` | `projectRoot` | Invalidate cache for this project |
| `configure_file_watcher` | `projectRoot`, `action` (`start`/`stop`), `debounceMs?` | Auto-invalidate cache on file changes |
| `get_file_watcher_status` | `projectRoot` | Watcher state + watched paths |
| `get_session_stats` | — | Per-session: pending ops, locks, tokens |
| `clear_session_cache` | `projectRoot?` | Clear cache for current session only |
| `list_pending_operations` | — | List pending Phase 1 tokens (crash recovery) |

---

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

---

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
- **Safety Features:** Mandatory two-phase confirmation, rolling 5-version backups, fuzzy matching, dependency checking, surgical restoration, ReDoS protection via worker_threads, session-scoped state.
- **Portability:** 100% WASM - no native dependencies, works on all platforms
- **Tests:** 83 passing (unit + integration + performance + stress)

### v3.7.1 Key Changes

| Component | Change | Benefit |
|-----------|--------|---------|
| State management | Session-scoped instead of global | No state leakage between clients |
| Pending operations | SQLite-backed | Survive server restarts |
| ReDoS patterns | 6 → 15+ | Better security |
| Cache eviction | Auto-persist before close | Cache data preserved |
| File limits | MAX_FILES = 2000 (was 500) | Better support for large projects |
| Tests | Added multi-client concurrency tests | Production readiness verified |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Security

See [SECURITY.md](SECURITY.md) for security policies and reporting vulnerabilities.

---

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.

### Viewing Logs

Because MCP uses `stdout` for protocol communication, all logs are safely routed to `stderr`. You can view them in your client's log files:

- **Claude Desktop (macOS)**: `~/Library/Logs/Claude/mcp-server-mcp-code-context.log`
- **Claude Desktop (Windows)**: `%APPDATA%\Claude\logs\mcp-server-mcp-code-context.log`
- **Cursor**: `Output` panel → Select `mcp-code-context` from the dropdown
- **Amazon Q**: Check `stderr` output in the MCP server configuration
- **Kiro**: Check logs in the MCP server view
- **Antigravity**: Check logs in the MCP server view

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

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## License

[MIT](LICENSE)

---

**Built with ❤️ from Caracas, Venezuela 🇻🇪**
