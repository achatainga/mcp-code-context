# Architecture Overview

## System Design

`mcp-code-context` is a Model Context Protocol (MCP) server that provides semantic code analysis and surgical editing capabilities. The architecture follows a layered design with clear separation of concerns.

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client                              │
│              (Claude, Cursor, Amazon Q, etc.)                │
└────────────────────────┬────────────────────────────────────┘
                         │ JSON-RPC over stdio
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   MCP Server (index.ts)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Tool Registry & Dispatcher                  │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌────────────────┐ ┌────────────┐ ┌────────────┐
│ Read Handlers  │ │   Write    │ │   Util     │
│                │ │  Handlers  │ │  Handlers  │
│ • repo_map     │ │ • surgical │ │ • rollback │
│ • read_file    │ │ • insert   │ │ • cleanup  │
│ • analyze      │ │ • rename   │ └────────────┘
│ • search       │ │ • remove   │
└────────┬───────┘ └─────┬──────┘
         │               │
         └───────┬───────┘
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                      Core Services                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   AST    │  │  Cache   │  │Security  │  │  Backup  │   │
│  │ Parsers  │  │   LRU    │  │Validation│  │  Manager │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
         │               │               │               │
         └───────────────┴───────────────┴───────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │     File System        │
                    └────────────────────────┘
```

## Component Responsibilities

### 1. MCP Server Layer (`index.ts`)

**Responsibility**: Protocol handling and request routing

- Initializes MCP server with stdio transport
- Registers available tools
- Routes requests to appropriate handlers
- Minimal business logic (~150 lines)

### 2. Handler Layer (`src/handlers/`)

**Responsibility**: Tool implementation and orchestration

#### Read Handlers (`readHandlers.ts`)
- `get_semantic_repo_map`: Generate compressed repo overview
- `read_file_surgical`: Extract specific symbols or full files
- `analyze_impact`: Find file dependencies
- `read_file_lines`: Read specific line ranges
- `search_code_pattern`: Search patterns across repo

#### Write Handlers (`writeHandlers.ts`)
- `write_file_surgical`: Replace symbol code
- `insert_symbol`: Insert code at precise locations
- `rename_symbol`: Rename across repository
- `remove_symbol`: Safe symbol deletion

#### Util Handlers (`utilHandlers.ts`)
- `rollback_file`: Restore from backup
- `clean_backups`: Remove backup files

### 3. Core Services Layer

#### AST Parsers (`src/ast/`)
- **TypeScript/JavaScript**: Uses `ts-morph` (real AST)
- **PHP**: Uses `php-parser` (real AST)
- **Dart**: Brace-counting + regex (pragmatic)
- **Python**: Indentation-aware regex (pragmatic)

**Design Decision**: Mix of real parsers and pragmatic approaches balances robustness with simplicity.

#### Cache (`src/cache/astCache.ts`)
- LRU cache for parsed ASTs
- Automatic invalidation via file mtime
- 90% performance improvement for repeated operations
- Memory-bounded (configurable max size)

#### Security (`src/utils/validation.ts`)
- Path traversal prevention
- ReDoS protection
- Input sanitization
- File size limits

#### Backup Manager (`src/utils/backupManager.ts`)
- Rolling 5-version backup system
- Centralized `.mcp-backups/` directory
- Automatic cleanup
- Surgical rollback capability

### 4. Utility Layer (`src/utils/`)

- **constants.ts**: Centralized configuration
- **normalization.ts**: CRLF/indentation handling
- **validation.ts**: Security and input validation
- **fuzzyMatch.ts**: Symbol name suggestions
- **diffEngine.ts**: Unified diff generation
- **confirmationCache.ts**: Two-phase write workflow

## Data Flow

### Read Operation Example: `read_file_surgical`

```
1. Client Request
   ↓
2. index.ts routes to readHandlers.handleReadFileSurgical()
   ↓
3. Validate file path (validation.ts)
   ↓
4. Check cache (astCache.ts)
   ├─ Cache hit → Return cached result
   └─ Cache miss → Continue
   ↓
5. Read file from disk
   ↓
6. Parse with appropriate AST parser
   ↓
7. Extract symbol
   ↓
8. Cache result
   ↓
9. Return to client
```

### Write Operation Example: `write_file_surgical`

```
PHASE 1 (Dry-Run):
1. Client Request (no confirmation token)
   ↓
2. index.ts routes to writeHandlers.handleWriteFileSurgical()
   ↓
3. Validate inputs (validation.ts)
   ↓
4. Read file and parse
   ↓
5. Perform replacement in memory
   ↓
6. Generate diff (diffEngine.ts)
   ↓
7. Store in confirmation cache
   ↓
8. Return diff + confirmation token

PHASE 2 (Apply):
1. Client Request (with confirmation token + confirm: true)
   ↓
2. Retrieve from confirmation cache
   ↓
3. Create backup (backupManager.ts)
   ↓
4. Write to disk
   ↓
5. Invalidate cache
   ↓
6. Return success
```

## Security Model

### Defense in Depth

1. **Input Validation**: All user inputs validated before processing
2. **Path Containment**: Paths must be within project root
3. **ReDoS Protection**: Regex patterns validated for safety
4. **File Size Limits**: Prevent memory exhaustion
5. **Two-Phase Writes**: Mandatory preview before applying changes
6. **Automatic Backups**: 5-version rolling backup system

### Threat Mitigation

| Threat | Mitigation |
|--------|-----------|
| Path Traversal | `validateFilePath()` checks for `..` and dangerous patterns |
| ReDoS | `validateRegexPattern()` detects catastrophic backtracking |
| Memory Exhaustion | File size limits + LRU cache with max size |
| Data Loss | Automatic backups + two-phase confirmation |
| Injection | Input sanitization + AST-based parsing |

## Performance Optimizations

### 1. LRU Cache
- **Impact**: 90% faster for repeated operations
- **Trade-off**: Memory usage (bounded by max size)

### 2. Lazy Loading
- AST parsers loaded on-demand
- Reduces startup time

### 3. Incremental Processing
- `get_semantic_repo_map` limited to 500 files
- Prevents timeout on large repositories

### 4. Efficient Diff Generation
- LCS algorithm for minimal diffs
- Context lines configurable

## Extensibility

### Adding a New Language

1. Create parser in `src/ast/` (e.g., `rustCompressor.ts`)
2. Create writer in `src/ast/writers/` (e.g., `rustWriter.ts`)
3. Add extension to `WRITABLE_EXTENSIONS` in `constants.ts`
4. Update `symbolWriter.ts` to route to new writer
5. Add tests in `tests/`

### Adding a New Tool

1. Create handler function in appropriate handler file
2. Add tool definition to `TOOLS` array in `index.ts`
3. Add route case in request handler
4. Add tests in `tests/`

## Testing Strategy

### Unit Tests
- Each handler tested in isolation
- Mock file system operations
- Test edge cases (missing files, invalid input, etc.)

### Integration Tests
- Full workflow tests (read → write → verify)
- Multi-file operations (rename across repo)
- Cache invalidation

### Security Tests
- Path traversal attempts
- ReDoS patterns
- Malformed input

### Performance Tests
- Large file handling
- Cache hit rate
- Memory usage under load

## Deployment

### NPM Package
```bash
npm install -g mcp-code-context
```

### MCP Client Configuration
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

## Monitoring & Observability

### Metrics (Future)
- Tool invocation counts
- Cache hit rates
- Error rates by tool
- Average response times

### Logging
- Errors logged to stderr
- MCP protocol messages on stdout
- Structured logging for debugging

## Future Enhancements

1. **Async I/O**: Migrate to `fs.promises` for non-blocking operations
2. **Streaming**: Support large files via streaming
3. **Tree-sitter**: Unified parser for all languages
4. **LSP Integration**: Leverage Language Server Protocol for advanced features
5. **Telemetry**: Optional usage analytics for improvement

## References

- [MCP Specification](https://modelcontextprotocol.io/)
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
