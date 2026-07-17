# Changelog

## [3.9.1] - 2026-07-17

### Fixed

- **`get_rails_routes` namespace bug** — routes inside `namespace :admin do` / `namespace :api do` now correctly produce prefixed paths (`/admin/users`, `/api/v1/orders`) and namespaced controllers (`admin/users`, `api/v1/orders`). Root cause: the original regex `/^(?:namespace|scope)\s+[:'"]([^'"]+)['"]/` captured `admin do` instead of `admin` when using symbol syntax (`:admin`). Rewrote parser to handle symbol (`:admin`) and string (`'admin'`) syntax separately.
- **`get_rails_routes` depth tracking** — replaced fragile `do/end` counter with indentation-based namespace stack. Parser now correctly handles nested namespaces (`api > v1`), `resources` blocks with `member do`, and `scope` blocks without false prefix leakage.
- **`get_semantic_repo_map` Gemfile + Concerns injection** — repo map XML now appends `<gem>` blocks and `<concern>` entries when a Gemfile and concerns directory are present.

---

## [3.9.0] - 2026-07-17

### Added

- **`get_gemfile_context`** (R7) — parses `Gemfile` and returns known gems with their implicit Rails behavior. Uses `gemDescriptions.json` lookup table (updateable without recompile). Includes mtime-keyed cache for zero re-read cost.
- **`find_metaprogramming`** (R3) — scans Ruby files for dynamic method generation entry points: `define_method`, `method_missing`, `class_eval/module_eval`, `instance_eval`, `send/public_send`, `ActiveSupport::Concern`, `included do`, `attr_accessor/reader/writer`, `delegate :to =>`, `has_many :through`. Accepts single file or full directory scan.
- **`get_rails_routes`** (R2) — parses `config/routes.rb` and returns a structured route map (method, path, controller, action). Supports `resources`, `resource`, explicit HTTP verbs (`get/post/patch/put/delete`), `namespace/scope` prefixing, `root`, and `do`-block nesting warnings. mtime-keyed cache.
- **Concern Resolution in `analyze_impact`** (R5) — `rubyModuleResolvesToFile()` now checks `app/models/concerns` and `app/controllers/concerns` via `findRailsConcerns()` before falling back to file system candidates. Prevents false positives for stdlib mixins.
- **`findRailsConcerns()`** utility — scans both concern directories and returns a `Map<moduleName, filePaths[]>` for use by impact analysis and future tools.

### Changed

- `gemDescriptions.json` — new data file for gem behavior descriptions (bundled in `src/utils/`)

---

## [3.8.1] - 2026-07-16

### Added

- **`insertCode` fix for brace-less languages (Ruby, Python)** — `inside_start`/`inside_end` positions now use AST-aware methods instead of `indexOf("{")` / `lastIndexOf("}")`. Added `getInsideStartIndex()` and `getInsideEndIndex()` to `BaseParser` with language-specific overrides in `RubyParser` and `PythonParser`.
- **Ruby import analysis** — `extractImports` in `compress.ts` now detects `require` and `require_relative` patterns. `analyzeImpact` adds Ruby patterns with file-resolution guard (prevents false positives from stdlib mixins like `include Comparable`).
- **ActiveRecord schema injection in `get_semantic_repo_map`** — repo map now includes `db_column` symbols for AR models, showing database columns alongside methods in the XML/Markdown output.

### Fixed

- **`insert_symbol inside_start/inside_end` for Ruby** — previously returned wrong position (`-1`) for any Ruby class or method. Now inserts correctly after the opening header line (`inside_start`) and before the closing `end` keyword (`inside_end`).
- **`insert_symbol inside_start/inside_end` for Python** — previously searched for `{`/`}` that don't exist. Now uses colon+newline and indentation-aware end position.

---

## [3.8.0] - 2026-07-15

### Added

- **Ruby full support** — `RubyParser` now complete with `search()` method for `search_code_pattern` tool compatibility
- **ActiveRecord Virtual Schema Extractor** — new `src/utils/railsSchema.ts` utility:
  - Parses `db/schema.rb` via O(n) line-by-line state machine (no backtracking risk)
  - mtime-keyed in-memory cache — zero I/O on repeated reads of unchanged schema
  - `modelToTable()` — Rails CoC PascalCase → snake_case → pluralize (`AdminUser → admin_users`, `Category → categories`)
  - `formatSchemaAnnotation()` — emits XML comment block with column names and types
- **AR schema injection in `read_file_surgical`** — when reading `.rb` files inheriting from `ApplicationRecord` or `ActiveRecord::Base`, virtual schema columns are prepended as XML comments
  - Context-aware: when `symbolName` is set, reads full file to detect AR inheritance before injecting
  - Graceful: no-op when `db/schema.rb` is absent or table not found

### Fixed

- **`RubyParser.extractSymbol` off-by-one** — `tree.rootNode.text` omits leading whitespace on Windows/WASM, causing `startIndex` drift. Fixed by adjusting indices relative to `tree.rootNode.startIndex`.

### Tests

- Added `tests/unit/parsers/ruby.spec.ts` — 5 vitest specs: symbol discovery, surgical replace, `extractSymbol` scoping, `parseSchemaRb` column extraction, `modelToTable` CoC mapping
- All 115 WASM parser tests passing (100%)

---

## [3.7.1] - 2026-06-18

### Fixed

- **`ast_transform` wrap_with_try_catch**: Missing closing `}` for method body caused unbalanced braces and syntax errors in all TypeScript class methods
- **`ast_transform` wrap_with_try_catch**: Missing newline after `try {` caused parse failure on all function types

---

## [3.7.0] - 2026-06-18

### 🚀 Production Readiness Release — Adversarial Audit Hardening

This release fixes **critical architectural issues** identified through three rounds of adversarial analysis and AST-based code review. All stoppers resolved. Ready for multi-agent production deployments.

### Fixed — Critical (Production Blockers)

1. **Session State Leakage / Memory Leak**
   - Global state (`globalLockManager`, `globalConfirmationStore`, `rateLimiter`) accumulated across client sessions with no cleanup.
   - **Fix**: `SessionManager` per-client state isolation with LRU eviction and 30-min timeout cleanup.

2. **No Phase 1 Crash Recovery**
   - Pending operations stored in memory only. Server crash between Phase 1 → Phase 2 lost all work.
   - **Fix**: SQLite-backed `PendingOperationStore` — operations persist across restarts.

3. **TOCTOU in Multi-File Writes**
   - Phase 2 only verified hash of the primary file, not dependent files in `pendingWrites`.
   - **Fix**: Hash verified on all files in the write set before applying.

4. **Symlink Boundary Escape**
   - `path.resolve()` used for boundary validation — does not follow symlinks.
   - **Fix**: `fs.realpath()` in `SecurityValidator.validateFilePath()`.

5. **`new Promise(async ...)` Anti-pattern in Worker**
   - `runInWorker` used `new Promise(async (resolve) => ...)` — swallowed async errors.
   - **Fix**: Refactored to standard async/await pattern.

6. **`WORKER_FILE` Resolved at Import-Time**
   - Worker path calculated before `dist/` exists — crashes on fresh install.
   - **Fix**: Lazy `getWorkerFile()` evaluated at runtime.

7. **ReDoS in `impactAnalysis`, `rename`, `readCore`**
   - Dynamic `new RegExp()` constructed in main thread without timeout.
   - **Fix**: All operation-level regex routed through `safeRegex` worker pool.

8. **Rate Limiter Shared Globally**
   - Single `'global'` bucket shared across all MCP clients.
   - **Fix**: Per-session `SESSION_ID` (pid-based) rate limiting.

9. **`configure_file_watcher` Without `rootDir` Validation**
   - Watcher path not validated through `SecurityValidator`.
   - **Fix**: Watcher uses only validated `projectRoot`.

10. **Confirmation Token Leak Without Cleanup**
    - Expired tokens accumulated in memory indefinitely.
    - **Fix**: `setInterval` 60s cleanup in `ConfirmationStore`.

11. **Windows Path Case Sensitivity in Boundary Check**
    - `fs.realpath()` returns `C:\` (uppercase), `path.resolve()` returns `c:\` (lowercase).
    - **Fix**: `.toLowerCase()` normalization on both sides before comparison.

12. **`ast_transform` try/catch Indentation Bug**
    - `applyWrapTryCatch` added extra indent on top of existing indentation.
    - **Fix**: Correct base-indent detection using last line of rawBody as closing-indent anchor.

### Added

#### 25 Tools (up from 13 in v3.6.x)

New tools added in this release:

| Tool | Purpose |
|------|---------|
| `ast_transform` | Declarative AST transforms: add_parameter, wrap_with_try_catch, add_decorator, change_return_type, extract_variable |
| `search_symbols` | AST-aware symbol search by name (fuzzy-capable), not text grep |
| `explain_symbol` | Signature + location + callers in one call |
| `batch_read` | Read N symbols from N files in 1 round-trip |
| `get_rate_limit_status` | Token balance + `canAfford` map per operation |
| `get_session_stats` | Per-session diagnostics (pending ops, locks, tokens) |
| `clear_session_cache` | Invalidate cache for current session only |
| `list_pending_operations` | Recovery listing after crash |

#### Architecture Improvements

- `SessionManager`: Per-client isolated state (locks, confirmations, rate limiter, cache pool)
- `safeRegexPool.ts` + `safeRegexApi.ts`: Worker pool split from monolithic `safeRegex.ts`
- `toctou.ts`: TOCTOU hash helpers extracted to own module
- `pendingStore.ts` + `pendingStoreInit.ts`: SQLite crash-recovery layer
- `toolDefinitionsAdmin.ts` + `toolDefinitionsCore.ts`: Tool definitions split from 1000-line index
- All `src/` files under 300 lines (from 1000-line monolith)

#### DX / Ergonomics

- `diffFormat` param on all write tools: `unified` | `compact` | `summary` | `none`
- Phase 2 does NOT require re-sending `newContent`/`code` (server stores from Phase 1)
- `aroundPattern` output includes `"Match found at line N (showing lines X-Y):"`
- `get_cache_stats` includes `hits`, `misses`, `hitRate`
- `get_file_watcher_status` includes `paths[]` (capped at 50)
- `get_server_stats` includes `rateLimiter.tokensAvailable` and `operationCosts`
- `MAX_FILES_REPO_MAP` = 2000 (was 500)

### Test Results

- **83/83 tests passing** (100%)
- Security tests: ✅
- File lock tests: ✅
- Rate limiter tests: ✅
- WASM parser tests (TS/PHP/Python/Dart): ✅
- Backup manager, diff, TOCTOU, cache, confirmation store: ✅
- Multi-process concurrency tests: ✅
- Performance tests: ✅

### Migration from v3.6.x

- **Zero breaking changes** in the public tool API.
- `parse_file` now returns `startLine`/`endLine` per symbol — additive, no breakage.
- New tools are purely additive.
- Session isolation is automatic — no configuration needed.

---

## [3.6.4] - 2026-05-14

### Added
- Language parsers: C#, Go, Java, Kotlin, Ruby, Rust (Tree-sitter WASM)
- `parse_file` returns `startLine`/`endLine` per symbol
- Fuzzy search with `fuzzyMatch` + `fuzzyThreshold` parameters
- Pagination via `startIndex` on `search_code_pattern`
- `diffFormat` parameter on write tools

### Fixed
- `parse_file` symbols missing line numbers
- CVE in `@modelcontextprotocol/sdk` (updated to 1.29.0)
- Incorrect TypeScript version `5.7.0` → `5.7.2`

---

## [3.6.1] - 2026-04-28

### Added
- Persistent WASM SQLite cache (`CacheManager`)
- Structured logging via pino (stderr-safe for MCP)
- File watcher via chokidar
- Multi-process file locking via proper-lockfile
- Rolling 5-version backup system
- `rollback_file` and `clean_backups` tools
- 74 tests (unit + integration + performance + stress)
