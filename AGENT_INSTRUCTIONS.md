# Smart Code Analysis & Editing Tools
**Available tools for efficient code analysis, context management, and surgical code modification.**

## Read Tools

### 1. `get_semantic_repo_map` — Architectural Map
**When to use**: At the start of a session, before a major refactor, or when you need to understand a new codebase or directory structure.
**NEVER use**: For reading specific implementations — this tool extracts ONLY structural signatures (classes, functions), not the code bodies.
```ts
get_semantic_repo_map(directoryPath: "/path/to/project/src", format: "markdown")
```

### 2. `read_file_surgical` — Surgical Reading
**When to use**: When you need a specific method, class, or symbol. ALWAYS prefer this over reading the entire file (like `fsRead`) if the symbol name is known.
**NEVER use**: For reading complete files if you only need a single function or symbol.
```ts
read_file_surgical(filePath: "/path/to/file.ts", symbolName: "ClassName")
read_file_surgical(filePath: "/path/to/file.dart", symbolName: "WidgetName")
// Omitting symbolName will read the entire file
read_file_surgical(filePath: "/path/to/file.php")
```
- If the symbol is not found, the tool returns a **structured JSON error** with `available_symbols` and `suggestions` (e.g., if a `className` scope is missing but the symbol exists in a class).
- **Pro-tip**: Use the suggestions to fix your next tool call (e.g., adding the correct `className`).

### 3. `analyze_impact` — Blast Radius Detection
**When to use**: ALWAYS before modifying a file that might be imported or depended upon by other parts of the system.
**NEVER use**: Ignore or skip this step when refactoring shared services, utilities, or core components.
**Features**: Detects imports across ecosystems (e.g., `use Namespace\Class` in PHP, `import` in JS/TS/Dart/Python).
```ts
analyze_impact(filePath: "/path/to/project/src/services/MyService.ts")
analyze_impact(filePath: "/path/to/project/src/Services/GeoIPService.php")
analyze_impact(filePath: "/path/to/detodo24_mobile/lib/services/tracking_service.dart")
```

---

## Write Tools

### Mandatory Two-Phase Write Workflow (v2.1.1+)

All write tools (`write_file_surgical`, `insert_symbol`, `rename_symbol`, `remove_symbol`) now enforce a safety-first confirmation flow.

**Phase 1: Dry-Run / Preview**
Call the tool with your proposed changes. You will receive:
1. A unified `diff` of the proposed changes.
2. A `confirmationToken`.

**Phase 2: Confirmation**
To apply the changes, call the SAME tool again with:
1. `confirmationToken`: The token from Phase 1.
2. `confirm: true`.

---

### 4. `write_file_surgical` — Surgical Symbol Replacement
**When to use**: Replace a specific function, method, class, or interface.
**Phase 1 (Preview)**:
```ts
write_file_surgical(filePath: "/path/to/file.ts", symbolName: "processOrder", newContent: "...")
```
**Phase 2 (Apply)**:
```ts
write_file_surgical(filePath: "/path/to/file.ts", symbolName: "processOrder", confirmationToken: "TOKEN_FROM_P1", confirm: true)
```

### 5. `insert_symbol` — Precise Code Insertion
**When to use**: Adding new members relative to an existing anchor symbol.
**Phase 1 (Preview)**:
```ts
insert_symbol(filePath: "/path/to/file.dart", code: "void clear() { ... }", anchorSymbol: "getUser", position: "after")
```
**Phase 2 (Apply)**:
```ts
insert_symbol(filePath: "/path/to/file.dart", code: "void clear() { ... }", confirmationToken: "TOKEN_FROM_P1", confirm: true)
```

### 6. `rename_symbol` — Repository-Wide Rename
**When to use**: Atomic identifier renaming across the entire project.
**Phase 1 (Preview)**:
```ts
rename_symbol(filePath: "/path/to/UserService.ts", oldName: "UserService", newName: "AccountService")
```
**Phase 2 (Apply)**:
```ts
rename_symbol(filePath: "/path/to/UserService.ts", oldName: "UserService", newName: "AccountService", confirmationToken: "TOKEN_FROM_P1", confirm: true)
```

### 7. `remove_symbol` — Safe Symbol Deletion
**When to use**: Removing code with dependency checking.
**Phase 1 (Preview)**:
```ts
remove_symbol(filePath: "/path/to/file.ts", symbolName: "deprecatedHelper")
```
**Phase 2 (Apply)**:
```ts
remove_symbol(filePath: "/path/to/file.ts", symbolName: "deprecatedHelper", confirmationToken: "TOKEN_FROM_P1", confirm: true)
```
- **Safety**: Safe removal check happens in Phase 1. If dependents exist, use `force: true` in your next Phase 1 call to override.

### 8. `rollback_file` — Surgical Restoration
**When to use**: If an applied change introduces an unexpected error or side effect.
**Safety**: The server automatically keeps the last 5 versions in `.mcp-backups/`.
```ts
rollback_file(filePath: "/path/to/file.ts", steps: 1)
```

### 7. `remove_symbol` — Safe Symbol Deletion
**When to use**: When removing a function, method, or class from a file.
**Safety**: By default, checks for dependents and **refuses** to remove if other files reference it.
```ts
// Safe removal (checks dependents first)
remove_symbol(filePath: "/path/to/file.ts", symbolName: "deprecatedHelper")
// Force removal (skip dependency check)
remove_symbol(filePath: "/path/to/file.php", symbolName: "oldMethod", force: true)
```

---

## Mandatory Workflow
1. **New Session / Unknown Context** → Use `get_semantic_repo_map` on the relevant directory to understand the structure.
2. **Read Code** → Use `read_file_surgical` with a `symbolName` whenever possible.
3. **Handle Missing Symbols** → If you get a JSON error, use the `suggestions` to refine your `symbolName` or `className`.
4. **Before Modifying** → Use `analyze_impact` if the file is a shared module or component.
5. **Modify Code (Phase 1)** → Use write tools to generate a `diff` and `confirmationToken`.
6. **Verify Diff** → Read the diff carefully. If incorrect, correct your prompt and start Phase 1 again.
7. **Apply (Phase 2)** → Call the same write tool with the token and `confirm: true`.
8. **Verify Result** → Ensure nothing broke. Use `rollback_file` if needed.

## Supported Languages (Read + Write)
| Language | Read | Write | Engine |
|----------|------|-------|--------|
| TypeScript / JavaScript | ✅ | ✅ | AST (ts-morph) |
| PHP | ✅ | ✅ | AST (php-parser) |
| Dart | ✅ | ✅ | Brace-counting + regex |
| Python | ✅ | ✅ | Indentation-based |
