# Project Instructions: mcp-code-context

## Tech Stack
- **Runtime:** Node.js >= 18.0.0 (Pure ESM, `"type": "module"`)
- **Language:** TypeScript 5.7.2 (Strict, ES2022)
- **AST Engine:** Pure WebAssembly Tree-sitter (`web-tree-sitter` v0.25.1 + `tree-sitter-wasms` v0.1.13)
- **Protocols:** Model Context Protocol (`@modelcontextprotocol/sdk` v1.29.0) with Dual Transport (Stdio + SSE)
- **Persistence:** In-Memory SQLite via WebAssembly (`sql.js` v1.14.1) + Rolling Backups (`BackupManager`)
- **Concurrency & Safety:** Cross-process atomic file locking (`proper-lockfile` v4.1.2) + Path Traversal Validation (`SecurityValidator`)

## Build & Run
- **Build:** `npm run build` (runs `tsc` and copies JSON schemas to `dist/`)
- **Dev:** `npm run dev`
- **Start:** `npm start`
- **Rebuild:** `npm run rebuild` (`npm run clean && npm run build`)
- **Clean:** `npm run clean` (`rimraf dist dist-tests`)

## Testing
- **Fast Unit Test Runner:** `npx vitest run` (44 test suites, 189 tests)
- **Single Suite:** `npx vitest run tests/unit/operations/<file>.spec.ts`
- **Adversarial Vectors Test:** `npm run test:vectors`
- **Full Production Integration Suite:** `npm test` (builds tests, runs security, file-lock, rate-limiter, telemetry, backup-manager, index-manager, and wasm-parsers test suites)

## Project Structure
```
src/
├── core/            # Engine lifecycle, SecurityValidator, SessionManager
├── parsers/         # BaseParser, ParserRegistry, 10 language WASM grammars
├── operations/      # AST operations (read, write, taint, type inference, diff, query)
├── tools/           # MCP tool definitions and request dispatch handlers
│   ├── toolDefinitionsCore.ts   # Core AST & analysis tool schemas
│   ├── toolDefinitionsAdmin.ts  # Admin & session tool schemas
│   ├── readHandlers.ts          # Read & static analysis handlers
│   └── writeHandlers.ts         # 2-Phase atomic write handlers
└── utils/           # FileLock, BackupManager, Telemetry, AuditLogger, ProjectRoot
```

## Engineering Guardrails & Conventions
1. **WASM Tree Lifecycle:** Always call `tree.delete()` in `finally` blocks for every parsed Tree-sitter tree to prevent linear memory leaks.
2. **2-Phase Surgical Write Protocol:** Write tools (`write_file_surgical`, `insert_symbol`, `remove_symbol`, `rename_symbol`) must execute dry-run preview diffs on Phase 1, issue an ephemeral `confirmationToken`, and require explicit confirmation (`confirm: true` + token) on Phase 2.
3. **SRE Physical Resource Bounds:**
   - Stream processing chunks must not exceed 8,192 bytes.
   - Max file size for full AST loading is capped at 2MB by `SecurityValidator`.
   - External command execution (e.g. `git diff`) must use `execFileAsync` without a shell, enforce `isValidGitRef`, and specify `timeout: 15000ms`.
4. **Thermo-Nuclear Maintainability:** Keep handler files decomposed under 1,000 lines. When adding new tools, extract dedicated submodule handlers instead of expanding `readHandlers.ts`.
5. **Git Conventions:** Conventional Commits (`feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`).
