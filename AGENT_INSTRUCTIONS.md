# Smart Code Analysis Tools
**Available tools for efficient code analysis and context management.**

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

### Mandatory Workflow
1. **New Session / Unknown Context** → Use `get_semantic_repo_map` on the relevant directory to understand the structure.
2. **Read Code** → Use `read_file_surgical` with a `symbolName` whenever possible (TS, JS, PHP, **Dart**, Python) to save tokens.
3. **Before Modifying** → Use `analyze_impact` if the file is a shared module, service, or component (fully detects Dart imports too).
4. **Read Entire File** → Only omit `symbolName` in `read_file_surgical` (or use a native file read tool) when you genuinely need the full implementation of the file, or if the language doesn't support symbolic extraction.
