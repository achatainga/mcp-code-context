# mcp-code-context

> MCP server that compresses any codebase into LLM-ready semantic context. AST-based compression for TypeScript, JavaScript, PHP, Dart & Python.

Works with **Claude Desktop**, **Cursor**, **Windsurf**, **GitHub Copilot**, **Amazon Q**, and any [Model Context Protocol](https://modelcontextprotocol.io/) compatible client.

## The Problem

When an LLM needs to understand a large codebase, sending raw source files wastes most of the context window on function bodies, boilerplate, and irrelevant files. A 500-line file might contain only 30 lines of *structural* information (signatures, types, interfaces) that the LLM actually needs.

## The Solution

`mcp-code-context` extracts only the **structural skeleton** of your code — function signatures, class declarations, interfaces, type aliases, constants, and docblocks — delivering a compressed map that gives the LLM full architectural awareness at a fraction of the token cost.

| File | Original | Compressed | Reduction |
|------|----------|------------|-----------|
| PHP class (426 lines) | 426 | 60 | **85.9%** |
| Dart repository (230 lines) | 230 | 30 | **87.0%** |
| PHP config (68 lines) | 68 | 15 | **77.9%** |

## Features

- 🌳 **AST-based compression** — Real parsers for TypeScript/JavaScript ([ts-morph](https://ts-morph.com/)) and PHP ([php-parser](https://github.com/nickygerritsen/php-parser)). Brace-counting engine for Dart. Regex-based extraction for Python.
- 🔬 **Surgical symbol extraction** — Extract a single function, class, or method from a file by name. Get only what you need.
- 💥 **Impact analysis** — Discover all files that depend on a given file before refactoring. Supports ES imports, CommonJS `require()`, Python imports, PHP `use`/`require_once`/`include`, and Dart imports.
- 📁 **Smart file walking** — Respects `.gitignore` and `.repomixignore` rules. Automatically excludes `node_modules`, `dist`, `vendor`, `.git`, etc.
- 📄 **Multi-format output** — XML (optimized for LLM consumption) or Markdown (human-readable).

## Supported Languages

| Language | Compression Engine | Symbol Extraction | Import Analysis |
|----------|-------------------|-------------------|-----------------|
| TypeScript / JavaScript | AST (ts-morph) | ✅ | ✅ |
| PHP | AST (php-parser) | ✅ | ✅ |
| Dart | Brace-counting + regex | ✅ | ✅ |
| Python | Regex-based | ✅ | ✅ |
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

### 1. `get_semantic_repo_map`

Generate a compressed architectural overview of an entire repository.

**Parameters:**
- `directoryPath` (required) — Absolute path to the repository root
- `format` (optional) — `"xml"` (default) or `"markdown"`

**Example output (PHP class):**
```php
namespace Dt24ApiAuth;

class Dt24_Api_Auth_Admin {
    private $plugin_name;
    private $version;
    const CUSTOM_STATUSES = ['shipped' => '...', 'delivered' => '...'];
    public function __construct($plugin_name, $version) { /* ... */ }
    public function enqueue_styles() { /* ... */ }
    /** @param int $order_id The order ID. */
    public function check_the_elapsed_time(int $time_to_check, int $intervalo, string $unidad, ?int $current_time = null) { /* ... */ }
}
```

### 2. `read_file_surgical`

Read a complete file, or extract only a specific named symbol.

**Parameters:**
- `filePath` (required) — Absolute path to the source file
- `symbolName` (optional) — Name of a function, class, method, or type to extract

**Example:** Extract only the `fetchSections` method from a 230-line Dart file:
```dart
// Symbol: fetchSections
// File: home_repository.dart

/// Obtiene las secciones del home
Future<List<Map<String, dynamic>>> fetchSections({
    String platform = 'app',
    bool useCache = true,
}) async {
    final token = await AuthService().getValidToken();
    // ... full implementation
}
```

### 3. `analyze_impact`

Find all files that import or depend on a given file.

**Parameters:**
- `filePath` (required) — Absolute path to the file being modified
- `rootDir` (optional) — Repository root (auto-detected if omitted)

**Example output:**
```markdown
# Impact Analysis

## Target
- **File:** `includes/Dt24Config.php`
- **Dependent files:** 1

## Dependent Files

### `dt24-core-plugin.php`
- `use Dt24ApiAuth\Dt24Config`
```

## Recommended Workflow

1. **Start with `get_semantic_repo_map`** to understand the project architecture
2. **Use `read_file_surgical`** with a symbol name to drill into specific implementations
3. **Before modifying a file, run `analyze_impact`** to understand the blast radius

## Development

```bash
# Build
npm run build

# Run tests
npm run build && node dist/test-dart.js && node dist/test-php.js

# Development (build + start)
npm run dev
```

## Technical Details

- **Transport:** stdio (JSON-RPC over stdin/stdout)
- **Runtime:** Node.js >= 18
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/)
- **AST Engines:** ts-morph (TypeScript/JS), php-parser (PHP), brace-counting (Dart), regex (Python)
- **Ignore Engine:** `ignore` npm package (full .gitignore spec support)

## License

[MIT](LICENSE)
