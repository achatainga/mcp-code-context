# Changelog

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
