# Instructions for AI Agents Using mcp-code-context

## 🎯 Quick Start

This MCP server provides **surgical code editing** with Tree-sitter AST parsing. Use it to read and modify code with precision.

---

## 📖 Essential Reading Workflow

### 1. Start with Repository Map
```
@mcp-code-context/get_semantic_repo_map
  directoryPath: /absolute/path/to/project
  projectRoot: /absolute/path/to/project
  format: xml
```

**Why**: Get architectural overview before diving into files. Saves 80% tokens vs reading raw files.

### 2. Extract Specific Symbols
```
@mcp-code-context/read_file_surgical
  filePath: /path/to/file.ts
  projectRoot: /project/root
  symbolName: functionName
```

**Why**: Read only what you need. If symbol not found, tool suggests available symbols.

### 3. Check Impact Before Editing
```
@mcp-code-context/analyze_impact
  filePath: /path/to/file.ts
  projectRoot: /project/root
```

**Why**: Know which files depend on what you're about to change.

---

## ✏️ Essential Writing Workflow

### Two-Phase Pattern (ALWAYS FOLLOW)

**Phase 1: Preview**
```
@mcp-code-context/write_file_surgical
  filePath: /path/to/file.ts
  projectRoot: /project/root
  symbolName: myFunction
  newContent: "function myFunction() { return 42; }"
```

**Result**: Returns diff + confirmationToken

**Phase 2: Apply**
```
@mcp-code-context/write_file_surgical
  filePath: /path/to/file.ts
  projectRoot: /project/root
  symbolName: myFunction
  newContent: "function myFunction() { return 42; }"
  confirm: true
  confirmationToken: "TOKEN_FROM_PHASE_1"
```

**Result**: ✅ Success. Changes applied to 1 file(s).

---

## 🚨 Critical Rules

### 1. **ALWAYS Use projectRoot**
Every tool requires `projectRoot` for security. Use the project's root directory.

### 2. **NEVER Skip Phase 1**
Always preview diffs before applying. Tokens are stored in memory and expire on server restart.

### 3. **Use Surgical Tools, Not Full File Rewrites**
❌ **Bad**: Read entire file, modify, write entire file  
✅ **Good**: Use `write_file_surgical` to replace only the target symbol

### 4. **Check Dependencies First**
Before removing or renaming symbols, use `analyze_impact` to avoid breaking imports.

### 5. **Provide Complete Symbol Code**
When using `write_file_surgical`, include the full function/method signature + body:
```typescript
// ✅ GOOD
newContent: "function hello(name: string): string {\n  return `Hello, ${name}`;\n}"

// ❌ BAD (incomplete)
newContent: "return `Hello, ${name}`;"
```

---

## 🔍 Advanced Search

### Pattern Search
```
@mcp-code-context/search_code_pattern
  rootDir: /project/root
  projectRoot: /project/root
  pattern: "myFunction"
  fileExtensions: [".ts", ".js"]
  maxResults: 10
```

### Fuzzy Search (v3.6.2+)
```
@mcp-code-context/search_code_pattern
  rootDir: /project/root
  projectRoot: /project/root
  pattern: "authUser"
  fuzzyMatch: true
  fuzzyThreshold: 0.6
  maxResults: 5
```

**Finds**: `authenticateUser`, `authorizeUser`, etc.

---

## 🛡️ Safety Features

### Automatic Backups
Every write creates a backup. Rollback if needed:
```
@mcp-code-context/rollback_file
  filePath: /path/to/file.ts
  projectRoot: /project/root
```

### Cache Management
```
@mcp-code-context/get_cache_stats
  projectRoot: /project/root

@mcp-code-context/clear_cache
  projectRoot: /project/root
```

---

## 💡 Pro Tips

### 1. **Use className for Method Scoping**
When a file has multiple classes with same method name:
```
@mcp-code-context/read_file_surgical
  filePath: /path/to/file.ts
  symbolName: render
  className: MyComponent
```

### 2. **Batch Operations with rename_symbol**
Rename across entire codebase in one operation:
```
@mcp-code-context/rename_symbol
  filePath: /path/to/definition.ts
  projectRoot: /project/root
  oldName: oldFunction
  newName: newFunction
```

### 3. **Insert New Code Precisely**
```
@mcp-code-context/insert_symbol
  filePath: /path/to/file.ts
  projectRoot: /project/root
  code: "private newMethod() { }"
  anchorSymbol: existingMethod
  position: after
```

### 4. **Read Specific Lines Only**
```
@mcp-code-context/read_file_lines
  filePath: /path/to/file.ts
  projectRoot: /project/root
  startLine: 100
  endLine: 120
```

---

## ⚠️ Common Mistakes

### ❌ Mistake 1: Forgetting projectRoot
```
// WRONG
@mcp-code-context/read_file_surgical
  filePath: /path/to/file.ts
```

### ❌ Mistake 2: Skipping Phase 1
```
// WRONG - No preview
@mcp-code-context/write_file_surgical
  confirm: true
  confirmationToken: "FAKE_TOKEN"
```

### ❌ Mistake 3: Incomplete Symbol Code
```
// WRONG - Missing function signature
newContent: "{ return 42; }"
```

### ❌ Mistake 4: Not Checking Impact
```
// WRONG - Removing without checking dependencies
@mcp-code-context/remove_symbol
  symbolName: importantFunction
  force: true
```

---

## 📊 Performance Tips

1. **Use get_semantic_repo_map first** - 80% token savings
2. **Extract symbols, not full files** - 90% token savings
3. **Use fuzzy search for discovery** - Finds similar patterns
4. **Enable caching** - 10x faster repeated operations
5. **Paginate search results** - Default 10 results, use `startIndex` for more

---

## 🎓 Example Workflow

```
1. Get repo map
   → @mcp-code-context/get_semantic_repo_map

2. Find target symbol
   → @mcp-code-context/read_file_surgical
   
3. Check dependencies
   → @mcp-code-context/analyze_impact
   
4. Preview changes (Phase 1)
   → @mcp-code-context/write_file_surgical
   
5. Review diff, then apply (Phase 2)
   → @mcp-code-context/write_file_surgical (with token)
   
6. Verify or rollback if needed
   → @mcp-code-context/rollback_file
```

---

## 🚀 v3.6.3 Features

- ✅ **4 New Tools**: `search_symbols`, `explain_symbol`, `batch_read`, `get_rate_limit_status`
- ✅ **`diffFormat`**: Control diff verbosity on all write tools (`unified`, `compact`, `summary`, `none`)
- ✅ **Phase 2 optimized**: No need to resend `newContent`/`code` — server stores it from Phase 1
- ✅ **`aroundPattern` line number**: Output now shows `Match found at line N`
- ✅ **Rate limiter in stats**: `get_server_stats` includes token balance and operation costs
- ✅ **Cache hit rate**: `get_cache_stats` includes `hits`, `misses`, `hitRate`
- ✅ **Watcher paths**: `get_file_watcher_status` includes list of watched files
- ✅ **Fuzzy Search**: Find similar patterns with typo tolerance
- ✅ **Pagination**: Default 10 results, use `startIndex` for more
- ✅ **Persistent Cache**: 10x faster with sql.js WASM SQLite
- ✅ **File Watcher**: Auto-invalidate cache on file changes

---

## 📚 Full Documentation

See `llms.txt` for complete API reference and technical details.

---

**Version**: 3.6.3  
**Last Updated**: May 1, 2026
