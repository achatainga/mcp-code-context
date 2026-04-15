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
- **Surgical extraction is supported for**: TypeScript, JavaScript, PHP, **Dart**, and Python.
- If the symbol is not found, the tool safely falls back to returning the entire file content.

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

### 4. `write_file_surgical` — Surgical Symbol Replacement
**When to use**: When you need to replace a specific function, method, class, or interface. Provide ONLY the replacement code — the tool locates the symbol via AST and splices it in.
**NEVER use**: For adding new code (use `insert_symbol` instead) or for renaming (use `rename_symbol`).
```ts
write_file_surgical(filePath: "/path/to/file.ts", symbolName: "processOrder", newContent: "function processOrder(id: string): Order {\n  return db.find(id);\n}")
write_file_surgical(filePath: "/path/to/file.php", symbolName: "findUser", newContent: "public function findUser(int $id): ?User { ... }", dryRun: true)
```
- Returns a **unified diff** of the changes.
- Use `dryRun: true` to preview changes without modifying the file.
- Use `createBackup: true` to create a `.bak` copy before editing.

### 5. `insert_symbol` — Precise Code Insertion
**When to use**: When adding new methods, functions, or members at a specific location relative to an existing symbol.
**Position options**: `"before"`, `"after"`, `"inside_start"`, `"inside_end"`.
```ts
// Add a method after an existing one
insert_symbol(filePath: "/path/to/file.dart", code: "void clearCache() { _cache.clear(); }", anchorSymbol: "getUser", position: "after")
// Add a method at the end of a class
insert_symbol(filePath: "/path/to/file.ts", code: "getUserCount(): number { return this.users.size; }", anchorSymbol: "UserService", position: "inside_end")
// Append to end of file (no anchor)
insert_symbol(filePath: "/path/to/file.py", code: "def helper(): pass")
```

### 6. `rename_symbol` — Repository-Wide Rename
**When to use**: When renaming a function, class, or method across the ENTIRE repository. Renames the definition AND all imports/usages.
**ALWAYS use**: Instead of manual find-and-replace for identifiers.
```ts
rename_symbol(filePath: "/path/to/UserService.ts", oldName: "UserService", newName: "AccountService", dryRun: true)
rename_symbol(filePath: "/path/to/models.py", oldName: "get_user", newName: "fetch_user")
```
- Scans all dependent files and renames references atomically.
- Supports rollback on failure when `createBackup: true`.

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
2. **Read Code** → Use `read_file_surgical` with a `symbolName` whenever possible (TS, JS, PHP, **Dart**, Python) to save tokens.
3. **Before Modifying** → Use `analyze_impact` if the file is a shared module, service, or component.
4. **Modify Code** → Use `write_file_surgical` to replace symbols, `insert_symbol` to add new code, `rename_symbol` for refactoring names, `remove_symbol` to delete code safely.
5. **Preview First** → ALWAYS use `dryRun: true` for major changes to verify the diff before applying.
6. **Read Entire File** → Only omit `symbolName` in `read_file_surgical` when you genuinely need the full file content.

## Supported Languages (Read + Write)
| Language | Read | Write | Engine |
|----------|------|-------|--------|
| TypeScript / JavaScript | ✅ | ✅ | AST (ts-morph) |
| PHP | ✅ | ✅ | AST (php-parser) |
| Dart | ✅ | ✅ | Brace-counting + regex |
| Python | ✅ | ✅ | Indentation-based |
