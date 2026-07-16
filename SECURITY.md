# Security Policy - mcp-code-context v3.8.1

## 🔒 Security Improvements in v3.7.1+

This release addresses **all critical security vulnerabilities** from comprehensive adversarial audit, implements full middleware pipeline, and hardens all 13 tool handlers. **NEW in v3.7.0**: Session-scoped state isolation prevents cross-client data leakage.

---

## Fixed Vulnerabilities

### 1. Path Traversal (HIGH)
**CVSS Score**: 8.1 (High)
**Status**: ✅ FIXED in v3.2.0, **hardened in v3.7.1**

**Description**: Path traversal check occurred BEFORE path normalization, allowing bypass with absolute paths.

**Fix**: Check boundary AFTER `path.resolve()` normalization. In v3.7.1, **all 13 handlers** now require `projectRoot` and validate via `SecurityValidator`.

---

### 2. Regex Injection in renameSymbol (HIGH)
**CVSS Score**: 7.5 (High)
**Status**: ✅ FIXED in v3.2.0

**Description**: User-provided symbol names used directly in regex without sanitization.

**Fix**: Sanitize all regex metacharacters via `sanitizeRegexPattern()` before use.

---

### 3. Code Corruption via Invalid Syntax (CRITICAL)
**CVSS Score**: 9.1 (Critical)
**Status**: ✅ FIXED in v3.2.0

**Description**: Write operations did not validate syntax of generated code.

**Fix**: Mandatory AST syntax validation before all writes.

---

### 4. ReDoS in searchPattern and readLines (MEDIUM)
**CVSS Score**: 5.3 (Medium)
**Status**: ✅ FIXED in v3.7.1

**Description**: User-provided regex patterns could cause catastrophic backtracking.

**Fix**: All regex operations now use `safeRegexTest()` with pattern validation and timeout enforcement (1s limit). **NEW**: 15+ patterns detected (was 6).

---

### 5. Unbounded Memory in compress (MEDIUM)
**CVSS Score**: 5.9 (Medium)
**Status**: ✅ FIXED in v3.2.0

**Fix**: `MAX_TOTAL_SIZE_BYTES` (50MB) + `MAX_FILES_REPO_MAP` (2000) limits.

---

### 6. extractSymbol API Mismatch (CRITICAL)
**CVSS Score**: 9.0 (Critical)
**Status**: ✅ FIXED in v3.7.1

**Description**: `read.ts` passed `content` as `symbolName` and real `symbolName` as `className`. Symbol extraction was 100% broken.

**Fix**: Corrected argument order to match `BaseParser.extractSymbol(tree, symbolName, className?)`.

---

### 7. Handlers Without Path Validation (HIGH)
**CVSS Score**: 8.5 (High)
**Status**: ✅ FIXED in v3.7.1

**Description**: `readLines`, `searchPattern`, `analyzeImpact`, `getSemanticRepoMap` had no path boundary check.

**Fix**: All 13 handlers now require `projectRoot` and validate all paths via `SecurityValidator`.

---

### 8. renameSymbol Arbitrary Write (HIGH)
**CVSS Score**: 8.0 (High)
**Status**: ✅ FIXED in v3.7.1

**Description**: `renameSymbol` wrote dependent files without SecurityValidator check, using non-atomic writes.

**Fix**: Each dependent file path validated via SecurityValidator + atomic write (write-to-tmp + rename).

---

### 9. LCS Diff OOM (MEDIUM)
**CVSS Score**: 5.0 (Medium)
**Status**: ✅ FIXED in v3.7.1

**Description**: LCS diff algorithm is O(n²) memory — 10K-line files cause OOM.

**Fix**: `MAX_DIFF_LINES = 5000` guard — falls back to O(n) `generateSimpleDiff` for large files.

---

### 10. Session State Leakage (HIGH) — **NEW in v3.7.0**
**CVSS Score**: 7.5 (High)
**Status**: ✅ FIXED in v3.7.0

**Description**: Global state (`globalLockManager`, `globalConfirmationStore`, `rateLimiter`) accumulated across client sessions with no cleanup.

**Impact**: Memory leak guaranteed in long-running server instances. After 24h uptime, OOM likely.

**Fix**: Implemented `sessionStates` Map with proper cleanup on disconnect. Added `close()` method for each session to release WASM heap and file watchers.

---

### 11. Pending Operations Not Persistent (HIGH) — **NEW in v3.7.0**
**CVSS Score**: 7.0 (High)
**Status**: ✅ FIXED in v3.7.0

**Description**: Pending operations stored in `globalConfirmationStore` (in-memory Map). No persistence.

**Impact**: If server crashes between Phase 1 and Phase 2, ALL work is lost. No way for user to recover.

**Fix**: Implemented `PendingOperationStore` using same SQLite DB as `CacheManager`. Operations persist across restarts.

---

## Security Features

### Defense in Depth

1. **Input Validation**
   - Path boundary enforcement on ALL handlers (v3.7.1)
   - File size limits (10MB per file, 50MB total)
   - Regex sanitization + timeout (1s limit)
   - **NEW**: 15+ ReDoS patterns detected (was 6)

2. **Two-Phase Write Workflow** (v3.7.1)
   - Phase 1: Dry-run returns diff + confirmation token
   - Phase 2: Apply with token (5-minute expiry)
   - Max 50 pending operations

3. **Middleware Pipeline** (v3.7.1)
   - Rate limiting (token bucket per operation)
   - File locking (prevents concurrent writes)
   - Audit logging (persistent `.mcp-audit-logs/`)
   - Telemetry (operation metrics, percentiles)

4. **Session-Scoped State** (v3.7.0)
   - Each MCP client gets isolated locks, confirmation store, rate limiter
   - No state leakage between clients (Amazon Q, Kiro, Cursor, etc.)

5. **Syntax Validation**
   - AST parsing of generated code post-write
   - Rejection of invalid syntax before any file modification

6. **Atomic Writes**
   - Write to `.tmp` file, then rename
   - Prevents corruption on crash/timeout

---

## Reporting Vulnerabilities

1. **DO NOT** open public GitHub issues for security vulnerabilities
2. Include: Description, Steps to reproduce, Impact, Suggested fix
3. Response: Critical 24h, High 72h, Medium 1 week

---

## Security Testing

```bash
npm run build:tests
node dist-tests/tests/test-security.js
```

**Coverage**:
- ✅ Path traversal (all handlers)
- ✅ Regex injection (sanitization + timeout)
- ✅ File size validation
- ✅ ReDoS detection (15+ patterns)
- ✅ Two-phase write confirmation
- ✅ Rate limiting
- ✅ File locking
- ✅ Session isolation
- ✅ Crash recovery

---

## Completed Security Roadmap

### v3.2.0 ✅
- [x] Path traversal fix (normalize before check)
- [x] Regex sanitization
- [x] Syntax validation
- [x] Bounded memory in compress

### v3.7.x ✅
- [x] Regex timeout enforcement (safeRegexTest)
- [x] Expanded ReDoS detection (15+ patterns)
- [x] Rate limiting (token bucket)
- [x] File locking (concurrent write prevention)
- [x] Audit logging (persistent, rotated)
- [x] Telemetry (operation metrics)
- [x] Two-phase write workflow
- [x] All handlers validated with projectRoot
- [x] extractSymbol bug fix
- [x] Diff OOM guard
- [x] Session-scoped state isolation
- [x] SQLite-backed pending operations store

---

**Last Updated**: 2026-06-08
**Version**: 3.8.1
