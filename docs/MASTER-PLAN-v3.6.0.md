# MASTER PLAN v3.6.0

**Project**: mcp-code-context (antigravity-mcp-context)  
**Version**: v3.6.0  
**Duration**: 144 hours (7 weeks @ 20h/week)  
**Start**: May 1, 2026  
**Target Release**: June 20, 2026

---

## 🎯 EXECUTIVE SUMMARY

### Objective
Transform mcp-code-context from fragile in-memory tool to production-ready platform with multi-process safety, persistent caching, automated testing, and advanced search capabilities.

### Critical Fixes
- **Multi-process file corruption** — Filesystem-based locks replace in-memory locks
- **Hot-reload infinite loops** — Backups moved from project root to OS temp directory
- **OOM on large files** — Myers diff algorithm replaces O(n×m) LCS
- **Code duplication** — Extract common `walkDir` utility (eliminates 3× duplication)

### Major Features
- **Automated testing** — Vitest with 80%+ coverage, CI/CD on 3 OS × 2 Node versions
- **Structured logging** — pino with JSON output to stderr (MCP-safe)
- **Persistent caching** — WASM SQLite with <100ms cache hits (10× faster)
- **File watcher** — chokidar with auto-invalidation and configurable debouncing
- **Advanced search** — Auto-detect ripgrep/ugrep/ag/findstr/grep, fuzzy search, pagination
- **Token optimization** — Compact diffs, no repetition in Phase 2, auto-optimize output

### Architectural Promise
**Zero Native Dependencies** — Maintained via WASM (Tree-sitter + SQLite)
- ✅ No Visual Studio required
- ✅ No node-gyp required
- ✅ No Python required
- ✅ Cross-platform: Windows/Mac/Linux
- ✅ Plug & play installation

### Success Metrics
- Test coverage: >80% (lines, functions, statements), >75% (branches)
- Cache hit: <100ms
- Parse file: <500ms
- Search: <2000ms
- Token savings: 50-80%
- Multi-process safe: No file corruption
- CI passes: 3 OS × 2 Node versions

---

## 🚨 CRITICAL GOTCHAS & MITIGATIONS

### Gotcha #1: OS Temp Directory Cleanup
**Problem**: Operating systems aggressively clean `/tmp` (Linux: >10 days, Windows: >7 days, macOS: each reboot). Cache and backups stored in OS temp may be deleted while IDE is open over weekend.

**Mitigation**:
```typescript
// Graceful recovery when OS deletes temp directory
if (!existsSync(this.cacheDir)) {
  logger.warn('Cache directory deleted by OS, recreating...');
  mkdirSync(this.cacheDir, { recursive: true });
  this.initSchema();
  return null; // Cache miss, not crash
}
```

**Implementation**: Phase 6 (Caching), Phase 3 (Backups)

---

### Gotcha #2: Stale Locks
**Problem**: If process receives SIGKILL, `.lock` files become orphaned and block future operations indefinitely.

**Mitigation**:
```typescript
// Configure stale lock detection in proper-lockfile
await lockfile.lock(filePath, {
  stale: 30000, // 30s timeout
  retries: {
    retries: 10,
    minTimeout: 100,
    maxTimeout: 1000,
    factor: 2
  }
});
```

**Implementation**: Phase 3 (File Locking)

---

### Gotcha #3: Memory Leaks in Worker Pool
**Problem**: Workers that live for extended periods leak memory through accumulated closures and event listeners.

**Mitigation**:
```typescript
// Recycle workers every 100 operations
class WorkerPool {
  private operationCount = new Map<Worker, number>();
  
  async execute(pattern: string, text: string): Promise<boolean> {
    const worker = this.getAvailableWorker();
    const count = this.operationCount.get(worker) || 0;
    
    if (count >= 100) {
      await worker.terminate();
      const newWorker = new Worker('./safeRegex.worker.js');
      this.workers.set(this.workers.indexOf(worker), newWorker);
      this.operationCount.set(newWorker, 0);
    }
    
    // Execute operation...
    this.operationCount.set(worker, count + 1);
  }
}
```

**Implementation**: Phase 4 (Code Quality) — Included in worker pool refactor

---

### Gotcha #4: sql.js I/O Blocking
**Problem**: sql.js loads entire database into WASM heap. Calling `db.export()` + `fs.writeFileSync()` on every `set()` operation blocks Node.js event loop. A 50MB cache causes ~200ms freeze.

**Mitigation**:
```typescript
// Debounced save — persist to disk every 5s or on process exit
class CacheManager {
  private persistTimer: NodeJS.Timeout | null = null;
  private isDirty = false;

  set(file: CachedFile): void {
    this.db.run(/* INSERT OR REPLACE */);
    this.isDirty = true;
    
    // Debounce persist
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persist(), 5000);
  }

  private persist(): void {
    if (!this.isDirty) return;
    
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
    this.isDirty = false;
  }

  constructor(projectRoot: string) {
    // Persist on process exit
    process.on('SIGINT', () => this.persist());
    process.on('SIGTERM', () => this.persist());
    process.on('exit', () => this.persist());
  }
}
```

**Implementation**: Phase 6 (Caching)

---

### Gotcha #5: execAsync Buffer Overflow
**Problem**: `exec()` accumulates entire stdout in memory before resolving. If search pattern matches minified file with 2MB single line, buffer explodes even with `maxBuffer: 10MB`.

**Mitigation**:
```typescript
// Use spawn + readline instead of exec
import { spawn } from 'child_process';
import readline from 'readline';

async function searchWithTool(
  tool: SearchTool,
  pattern: string,
  rootDir: string,
  options: { maxResults?: number } = {}
): Promise<string> {
  const maxResults = options.maxResults || 50;
  const results: string[] = [];
  
  const child = spawn(tool, [pattern, rootDir]);
  const rl = readline.createInterface({ input: child.stdout });
  
  for await (const line of rl) {
    results.push(line);
    if (results.length >= maxResults) {
      child.kill(); // Stop reading after maxResults
      break;
    }
  }
  
  return results.join('\n');
}
```

**Implementation**: Phase 4 (Search Tools)

---

## 🗺️ PHASES & TIMELINE

### Phase 1: Research & Setup (12h)
**Week 1**

**Objective**: Investigate technologies and document gotchas

**Tasks**:
1. Research testing frameworks (Vitest vs Jest vs Mocha)
2. Research logging (pino vs winston vs bunyan)
3. Research file locking (proper-lockfile vs manual fs.open)
4. Research file watcher (chokidar vs fs.watch vs watchman)
5. Research caching (sql.js vs lowdb vs JSON files)
6. Research diff algorithms (diff-match-patch vs custom LCS)
7. Document gotchas: OS temp cleanup, stale locks, worker memory leaks, sql.js I/O blocking, execAsync buffer overflow

**Deliverables**:
- `docs/research/testing-framework.md`
- `docs/research/logging-strategy.md`
- `docs/research/file-locking.md`
- `docs/research/file-watcher.md`
- `docs/research/caching-strategy.md`
- `docs/research/diff-algorithm.md`
- `docs/research/gotchas-mitigation.md`

**Decisions**:
- ✅ Vitest (fast, ESM-native)
- ✅ pino (fastest, JSON-native, stderr output)
- ✅ proper-lockfile (cross-platform, stale detection)
- ✅ chokidar (stable, used by Vite, optional native deps)
- ✅ sql.js (WASM SQLite, maintains Zero Native Dependencies)
- ✅ diff-match-patch (Google-proven Myers algorithm)

---

### Phase 2: Testing Infrastructure (16h)
**Week 1-2** ✅ **COMPLETE**

**Objective**: Setup Vitest and create baseline test coverage

**Status**: ✅ Completed May 1, 2026

**Completed Tasks**:
1. ✅ Installed dependencies: `vitest`, `@vitest/coverage-v8`, `@types/node`
2. ✅ Created `vitest.config.ts` with Node environment, V8 coverage, 80% thresholds, basic reporter
3. ✅ Created test structure:
   ```
   tests/
   ├── unit/
   │   ├── parsers/          # TypeScript, Python, PHP, Dart
   │   ├── operations/       # read, write, compress
   │   └── utils/            # diff, fileLock, backupManager, safeRegex
   ├── integration/          # write-workflow, multi-process
   ├── performance/          # cache, search benchmarks
   ├── stress/               # concurrent operations, large files
   └── fixtures/             # Sample code for each language
   ```
4. ✅ Created 4 test fixtures (TypeScript, Python, PHP, Dart)
5. ✅ Wrote 31 tests across 3 test files:
   - `tests/unit/parsers/typescript.spec.ts` (7 tests - skipped, needs WASM init)
   - `tests/unit/utils/diff.spec.ts` (10 tests - 2 passed, 8 failed as expected)
   - `tests/unit/utils/fileLock.spec.ts` (7 tests - 1 passed, 6 failed as expected)
   - `tests/unit/utils/backupManager.spec.ts` (7 tests - 1 passed, 6 failed as expected)
6. ✅ Configured output optimization (basic reporter, truncation, reduced test data)

**Test Results**:
- ✅ 4 passed (baseline)
- ⚠️ 20 failed (expected - will fix in Phase 3)
- ⏸️ 7 skipped (WASM init needed)
- ✅ Coverage report: ~40-50% initial

**Deliverables**:
- ✅ Vitest configured
- ✅ 31 tests created
- ✅ Test structure established
- ✅ Output optimized for token efficiency
- ⏳ CI/CD pipeline (deferred - will add after Phase 3 fixes)

**Files Created**:
- `vitest.config.ts`
- `tests/unit/parsers/typescript.spec.ts`
- `tests/unit/utils/diff.spec.ts`
- `tests/unit/utils/fileLock.spec.ts`
- `tests/unit/utils/backupManager.spec.ts`
- `tests/fixtures/typescript/sample.ts`
- `tests/fixtures/python/sample.py`
- `tests/fixtures/php/sample.php`
- `tests/fixtures/dart/sample.dart`

**Files Modified**:
- `package.json` — Added test scripts

**Next Phase**: Phase 3 (Critical Fixes) — Fix failing tests by implementing proper-lockfile, diff-match-patch, OS temp backups

---

### Phase 3: Critical Fixes (22h)
**Week 2-3**

**Objective**: Fix critical bugs identified by adversarial analysis

#### 3.1 File Locking → Filesystem (8h)

**Problem**: In-memory locks don't work across processes

**Solution**:
```bash
npm install proper-lockfile
```

**Files Modified**:
- `src/utils/fileLock.ts` — REWRITE with proper-lockfile
  - Locks in `os.tmpdir()/mcp-locks-{projectHash}/`
  - Stale detection: 30s timeout
  - Retry: exponential backoff (10 retries, 100ms-1000ms)
  - `releaseAll()` for graceful shutdown

**Tests**:
- `tests/unit/utils/fileLock.spec.ts` — Concurrent locks, stale recovery, cross-process

#### 3.2 Backups → OS Temp (4h)

**Problem**: Backups in project root trigger hot-reload loops

**Solution**:
```typescript
// Move from .mcp-backups/ to os.tmpdir()/mcp-backups-{projectHash}/
```

**Files Modified**:
- `src/utils/backupManager.ts` — Change `backupRoot` to OS temp
  - Add recovery when OS cleans temp dir (Gotcha #1 mitigation)
  - Maintain 5-version limit

**Tests**:
- `tests/unit/utils/backupManager.spec.ts` — Temp dir creation, OS cleanup recovery

#### 3.3 Diff → diff-match-patch (6h)

**Problem**: Custom LCS O(n×m) causes OOM on files >5000 lines

**Solution**:
```bash
npm install diff-match-patch
```

**Files Modified**:
- `src/utils/diff.ts` — REWRITE
  - Replace LCS with Myers algorithm (O(n+d²))
  - Add `generateCompactDiff()` — Only changes, no context (for token optimization)
  - Add `generateSmartDiff()` — Auto-selects compact if >2KB

**Tests**:
- `tests/unit/utils/diff.spec.ts` — Large files (10K+ lines), compact diff size reduction

#### 3.4 Extract walkDir (4h)

**Problem**: `walkDir` duplicated 3× (read.ts, write.ts, compress.ts)

**Solution**:
```typescript
// Create src/utils/fileWalker.ts
export async function walkDirectory(rootDir, callback, options)
```

**Files Created**:
- `src/utils/fileWalker.ts` — NEW

**Files Modified**:
- `src/operations/read.ts` — Replace inline walkDir
- `src/operations/write.ts` — Replace inline walkDir
- `src/operations/compress.ts` — Replace inline walkDir

**Tests**:
- `tests/unit/utils/fileWalker.spec.ts` — Extension filtering, directory exclusion, symlinks

**Deliverables**:
- ✅ Filesystem-based file locking
- ✅ Backups in OS temp with recovery
- ✅ Efficient diff algorithm
- ✅ Reusable walkDir utility
- ✅ Multi-process test now passes

---

### Phase 4: Code Quality + Search Tools (22h)
**Week 3-4**

**Objective**: Refactor complex code and add advanced search

#### 4.1 Refactor renameSymbol (8h)

**Problem**: 101-line function with cyclomatic complexity >15

**Solution**: Split into 4 functions
```typescript
// src/operations/write.ts — REFACTOR

async function validateRenameParams(params): Promise<ValidationResult>
async function findDependentFiles(rootDir, symbolName, projectRoot)
function generateRenameChanges(oldName, newName, definitionContent, dependents)
export async function renameSymbol(params): Promise<WriteResult> // Orchestrator
```

**Tests**:
- `tests/unit/operations/rename.spec.ts` — Test each function independently

#### 4.2 Auto-detect Search Tools (4h)

**Inspiration**: code-index-mcp

**Solution**:
```bash
npm install which
```

**Files Created**:
- `src/utils/searchTools.ts` — NEW
  ```typescript
  export async function detectSearchTool(): Promise<SearchTool>
  export async function searchWithTool(tool, pattern, rootDir, options)
  ```

**Detection Order**:
1. `ripgrep` (fastest, cross-platform)
2. `ugrep` (very fast, cross-platform)
3. `ag` (fast, cross-platform)
4. `findstr` (Windows native) / `grep` (Unix native)

**Files Modified**:
- `src/operations/read.ts` — Enhance `searchPattern` with native tools + spawn (Gotcha #5 mitigation)
- `src/index.ts` — Add MCP tool `refresh_search_tools`

**Tests**:
- `tests/unit/utils/searchTools.spec.ts` — Detection on Windows/Unix, fallback behavior, spawn vs exec

**Benefit**: 10-100× faster than manual regex

#### 4.3 Refactor searchPattern + readLines (6h)

**Problem**: Large functions (77 and 60 lines)

**Solution**: Split into validation, business logic, formatting functions

#### 4.4 Extract walkDir (4h)

Already completed in Phase 3.4

**Deliverables**:
- ✅ renameSymbol refactored (4 functions)
- ✅ Auto-detect search tools with spawn
- ✅ searchPattern and readLines simplified
- ✅ Tests for all refactored code

---

### Phase 5: Logging System (6h)
**Week 4**

**Objective**: Structured logging with pino

**Tasks**:
1. Install: `npm install pino pino-pretty`
2. Create `src/utils/logger.ts` with stderr stream (MCP-safe)
3. Replace all `console.log/error` with structured logging
4. Configure: pretty print in development, JSON in production

**Files Created**:
- `src/utils/logger.ts` — NEW

**Files Modified**:
- `src/index.ts` — Replace console.log
- `src/parsers/*.ts` — Replace console.log
- `src/operations/*.ts` — Replace console.log
- `src/utils/*.ts` — Replace console.log

**Tests**:
- `tests/unit/utils/logger.spec.ts` — Log levels, child loggers, stderr output

**Deliverables**:
- ✅ Structured logging
- ✅ Logs to stderr (doesn't interfere with MCP stdio)
- ✅ Pretty print in development
- ✅ JSON in production

---

### Phase 6: Persistent Caching (14h)
**Week 4-5**

**Objective**: WASM SQLite cache with <100ms hits

**Tasks**:
1. Install: `npm install sql.js`
2. Create `src/core/cacheManager.ts` with WASM SQLite
3. Implement debounced save (Gotcha #4 mitigation)
4. Integrate in `read.ts` operations
5. Add OS cleanup recovery (Gotcha #1 mitigation)
6. Add MCP tools: `get_cache_stats`, `clear_cache`

**Files Created**:
- `src/core/cacheManager.ts` — NEW

**Files Modified**:
- `src/operations/read.ts` — Integrate cache
- `src/index.ts` — Add MCP tools

**Tests**:
- `tests/unit/core/cacheManager.spec.ts` — Cache hit <100ms, OS cleanup recovery, 10K files without OOM
- `tests/performance/cache.spec.ts` — Benchmark cache performance

**Deliverables**:
- ✅ WASM SQLite cache (maintains Zero Native Dependencies)
- ✅ Debounced save (no event loop blocking)
- ✅ Cache in OS temp with recovery
- ✅ 10× faster on cache hit

---

### Phase 7: File Watcher (10h)
**Week 5**

**Objective**: Auto-refresh with chokidar

**Tasks**:
1. Install: `npm install chokidar @types/chokidar`
2. Create `src/utils/fileWatcher.ts` with debouncing (500ms default)
3. Integrate with CacheManager for auto-invalidation
4. Add MCP tools: `configure_file_watcher`, `get_file_watcher_status`

**Files Created**:
- `src/utils/fileWatcher.ts` — NEW

**Files Modified**:
- `src/core/cacheManager.ts` — Integrate watcher
- `src/index.ts` — Add MCP tools

**Tests**:
- `tests/unit/utils/fileWatcher.spec.ts` — Change detection, debouncing, ignored directories

**Deliverables**:
- ✅ File watcher with chokidar
- ✅ Auto-invalidation of cache
- ✅ Configurable debouncing

---

### Phase 8: Advanced Search (8h)
**Week 5-6**

**Objective**: Fuzzy search + pagination

#### 8.1 Fuzzy Search (6h)

**Inspiration**: code-index-mcp

**Tasks**:
1. Install: `npm install fuse.js @types/fuse.js`
2. Create `src/utils/fuzzySearch.ts`
3. Integrate in `searchPattern` with `fuzzyMatch` parameter

**Files Created**:
- `src/utils/fuzzySearch.ts` — NEW

**Files Modified**:
- `src/operations/read.ts` — Add fuzzy search
- `src/index.ts` — Add parameters `fuzzyMatch`, `fuzzyThreshold`

**Tests**:
- `tests/unit/utils/fuzzySearch.spec.ts` — Typo tolerance, score relevance, threshold tuning

**Benefit**: Finds `authenticateUser` when searching `authUser`

#### 8.2 Pagination (2h)

**Inspiration**: code-index-mcp

**Tasks**:
1. Add parameters `startIndex`, `maxResults` (default: 10, was 50)
2. Show footer with total results

**Files Modified**:
- `src/operations/read.ts` — Implement pagination
- `src/index.ts` — Add parameters

**Tests**:
- `tests/unit/operations/search-pagination.spec.ts` — Pagination boundaries, footer display

**Deliverables**:
- ✅ Fuzzy search with configurable threshold
- ✅ Pagination (default 10 results)
- ✅ Tests

---

### Phase 9: Token & Output Optimization (8h)
**Week 6**

**Objective**: Reduce token consumption by 50-80%

#### 9.1 No Repeat Diff in Phase 2 (1h)

**Problem**: Diff shown twice (Phase 1 dry-run + Phase 2 confirmation)

**Solution**:
```typescript
// src/index.ts — handleTwoPhaseWrite
// Phase 2: Only show "✅ Success" without diff
```

**Tests**:
- `tests/integration/two-phase-tokens.spec.ts` — Verify Phase 2 output size reduction

#### 9.2 Compact Diff (4h)

**Problem**: Diffs with context are verbose

**Solution**: Already implemented in Phase 3.3
- `generateCompactDiff()` — Only changes, no context
- `generateSmartDiff()` — Auto-selects if >2KB

**Tests**:
- `tests/unit/utils/diff-compact.spec.ts` — 70-80% size reduction

#### 9.3 Automatic Output Optimization (2h)

**Problem**: `get_semantic_repo_map` can generate >100KB output

**Solution**:
```typescript
// src/operations/compress.ts — MODIFY
// Auto-disable symbols if >100 files or >1MB
```

**Files Modified**:
- `src/operations/compress.ts` — Add auto-optimization
- `src/index.ts` — Add parameters `maxDepth`, `includeSymbols`

**Tests**:
- `tests/unit/operations/compress-optimization.spec.ts` — Large repo optimization, truncation at 100KB

#### 9.4 Platform-aware Search (1h)

Already implemented in Phase 4.2 (auto-detect with Windows/Unix fallbacks)

**Deliverables**:
- ✅ No repeat diff in Phase 2
- ✅ Compact diff (70-80% reduction)
- ✅ Auto-optimize output (50-90% reduction)
- ✅ Platform-aware search

**Token Savings**: 50-80% overall

---

### Phase 10: Integration & Testing (14h)
**Week 6-7**

**Objective**: End-to-end tests and performance validation

**Tasks**:
1. **End-to-end tests** (6h):
   - `tests/integration/full-workflow.spec.ts` — Read → Write → Rollback
   - `tests/integration/multi-process.spec.ts` — Concurrent writes (must pass)
2. **Performance tests** (4h):
   - `tests/performance/cache.spec.ts` — Cache hit <100ms
   - `tests/performance/search.spec.ts` — Search <2000ms
   - `tests/performance/parse.spec.ts` — Parse <500ms
3. **Stress tests** (4h):
   - `tests/stress/concurrent-operations.spec.ts` — 100 concurrent locks
   - `tests/stress/large-files.spec.ts` — 10K+ line files

**Success Criteria**:
- ✅ Coverage >80% (lines, functions, statements), >75% (branches)
- ✅ All tests pass on 3 OS × 2 Node versions
- ✅ Performance benchmarks met
- ✅ No memory leaks in stress tests

**Deliverables**:
- ✅ End-to-end tests
- ✅ Performance tests
- ✅ Stress tests
- ✅ Coverage >80%

---

### Phase 11: Documentation & Release (12h)
**Week 7**

**Objective**: Document and release v3.6.0

**Tasks**:
1. **Update README.md** (4h):
   - New features section
   - Performance benchmarks
   - Troubleshooting guide (multi-process, cache, gotchas)
   - Migration guide from v3.5.3 (zero breaking changes)
2. **Create CHANGELOG.md** (2h):
   - All changes categorized (Security, Performance, Quality, Architecture)
   - Breaking changes: None
   - Deprecations: None
3. **Document gotchas** (2h):
   - Already in `docs/research/gotchas-mitigation.md`
   - Add to README troubleshooting section
4. **Prepare release** (2h):
   - Version bump to 3.6.0
   - Build: `npm run build`
   - Tests: `npm run test:run`
   - Verify: No uncommitted files
5. **Publish** (2h):
   - `npm publish`
   - Create GitHub release with CHANGELOG
   - Announce on Reddit (r/ClaudeAI), Twitter/X

**Deliverables**:
- ✅ README updated
- ✅ CHANGELOG complete
- ✅ GitHub release
- ✅ npm published
- ✅ Announcements

---

## 🛠️ EXECUTION PROTOCOL

### Before Modifying Code
**ALWAYS execute this sequence**:
```typescript
1. get_semantic_repo_map()    // Understand structure
2. parse_file()                // See symbols in target file
3. analyze_impact()            // See what depends on this file
4. read_file_surgical()        // Read specific function
```

### After Modifying Code
**ALWAYS create tests**:
```typescript
1. Unit test for modified function
2. Integration test if affects multiple modules
3. Regression test to verify nothing broke
4. Execute: npm run test:coverage
5. Verify: Coverage >80%
```

### Implementation Pattern
**For each feature**:
```
1. Analyze existing code with AST tools
2. Implement change
3. Create tests (unit + integration)
4. Verify coverage >80%
5. Document in code (JSDoc)
6. Update README if new feature
```

### Critical Rules
1. **NEVER** modify code without creating tests
2. **ALWAYS** use AST tools before modifying
3. **ALWAYS** verify coverage after each change
4. **NEVER** break existing tests
5. **ALWAYS** document technical decisions
6. **NEVER** add tests automatically (only if user requests)
7. **ALWAYS** modify files with ALL changes at once (not incremental)
8. **ALWAYS** use spawn instead of exec for external commands
9. **ALWAYS** implement debounced save for sql.js operations
10. **ALWAYS** check directory existence before read (OS cleanup recovery)

### Technology Stack
- **Runtime**: Node.js 18+ (ESM)
- **Language**: TypeScript 5+
- **Testing**: Vitest + V8 coverage
- **Logging**: pino (JSON to stderr)
- **File locking**: proper-lockfile
- **Diff**: diff-match-patch (Myers algorithm)
- **Cache**: sql.js (WASM SQLite)
- **Watcher**: chokidar
- **Fuzzy search**: fuse.js
- **AST**: web-tree-sitter (WASM)

### Dependencies (All Zero Native)
| Dependency | Purpose | Type | Weekly Downloads |
|------------|---------|------|------------------|
| `proper-lockfile` | File locking | Pure JS | 2M+ |
| `diff-match-patch` | Diff algorithm | Pure JS | 1M+ |
| `pino` | Logging | Pure JS | 5M+ |
| `sql.js` | SQLite | WASM | 500K+ |
| `chokidar` | File watcher | JS + optional native | 20M+ |
| `fuse.js` | Fuzzy search | Pure JS | 2M+ |
| `which` | Command detection | Pure JS | 50M+ |

**Total bundle increase**: ~3MB (WASM binaries)

---

## 📊 TIMELINE & MILESTONES

| Phase | Duration | Week | Cumulative | Milestone |
|-------|----------|------|------------|-----------|
| 1. Research | 12h | 1 | 12h | Technology decisions documented |
| 2. Testing | 16h | 1-2 | 28h | Vitest setup, 30+ tests, CI/CD |
| 3. Critical Fixes | 22h | 2-3 | 50h | Multi-process safe, no OOM |
| 4. Code Quality | 22h | 3-4 | 72h | Refactored, search tools |
| 5. Logging | 6h | 4 | 78h | Structured logging |
| 6. Caching | 14h | 4-5 | 92h | WASM SQLite, <100ms hits |
| 7. File Watcher | 10h | 5 | 102h | Auto-invalidation |
| 8. Advanced Search | 8h | 5-6 | 110h | Fuzzy + pagination |
| 9. Token Optimization | 8h | 6 | 118h | 50-80% token savings |
| 10. Integration | 14h | 6-7 | 132h | Coverage >80%, all tests pass |
| 11. Documentation | 12h | 7 | 144h | Release ready |

**Total**: 144 hours (~7 weeks @ 20h/week)

---

## ✅ RELEASE CHECKLIST

### Code
- [ ] File locking filesystem
- [ ] Backups in OS temp
- [ ] Diff algorithm improved
- [ ] walkDir extracted
- [ ] renameSymbol refactored
- [ ] Auto-detect search tools
- [ ] Fuzzy search
- [ ] Pagination
- [ ] Token optimization
- [ ] Logging structured
- [ ] Caching persistent
- [ ] File watcher

### Tests
- [ ] Unit tests (100+)
- [ ] Integration tests (20+)
- [ ] Multi-process test passes
- [ ] Performance tests
- [ ] Stress tests
- [ ] Coverage >80%
- [ ] CI/CD passes on 3 OS × 2 Node versions

### Documentation
- [ ] README updated
- [ ] CHANGELOG complete
- [ ] Migration guide
- [ ] Troubleshooting guide
- [ ] Gotchas documented
- [ ] API docs updated

### Release
- [ ] Version bumped to 3.6.0
- [ ] Build successful
- [ ] All tests pass
- [ ] Commit and tag created
- [ ] Published to npm
- [ ] GitHub release created
- [ ] Announced on social media

---

**Version**: 1.0  
**Last Updated**: May 1, 2026  
**Status**: Ready for implementation  
**Next Step**: Begin Phase 2 (Testing Infrastructure)
