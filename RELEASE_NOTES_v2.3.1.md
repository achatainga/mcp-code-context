# 🚀 Release v2.3.1 - Hotfix

**Release Date:** April 23, 2026  
**Type:** Patch Release (Dependency Fix)

---

## 🐛 Bug Fix

### Fixed npm Package Dependency Error

**Problem**: Version 2.3.0 failed to run via `npx` with error:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typescript'
```

**Root Cause**: The `safeRename.ts` module uses TypeScript compiler API at runtime, but `typescript` was in `devDependencies` instead of `dependencies`.

**Solution**: Moved `typescript` from `devDependencies` to `dependencies` in `package.json`.

**Impact**: 
- ✅ `npx -y mcp-code-context@2.3.1` now works correctly
- ✅ All MCP clients can use the package without errors
- ✅ No breaking changes

---

## 📦 What Changed

### package.json
```diff
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "ignore": "^6.0.2",
    "php-parser": "^3.5.1",
    "ts-morph": "^24.0.0",
+   "typescript": "^5.7.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
-   "rimraf": "^6.0.1",
-   "typescript": "^5.7.0"
+   "rimraf": "^6.0.1"
  }
```

---

## 🔄 Migration from v2.3.0

If you installed v2.3.0 and experienced the error, simply update:

```bash
# Update global installation
npm install -g mcp-code-context@2.3.1

# Or use npx (recommended)
npx -y mcp-code-context@2.3.1
```

### MCP Client Configuration

Update your config to use v2.3.1:

```json
{
  "mcpServers": {
    "context": {
      "command": "npx",
      "args": ["-y", "mcp-code-context@2.3.1"]
    }
  }
}
```

---

## ✅ Verification

Test that it works:

```bash
npx -y mcp-code-context@2.3.1
# Should output: 🚀 mcp-code-context v2.3.1 running on stdio transport
```

---

## 📚 Full Feature Set

All features from v2.3.0 are included:

- 🛡️ Security fix blocking Dart/Python cross-file rename
- 🏗️ Modular architecture (350 lines vs 1100)
- 🔒 Centralized security validation
- ⚡ LRU cache system (90% faster)
- 🧹 DRY compliance
- 📚 11 tools total

See [RELEASE_NOTES_v2.3.0.md](./RELEASE_NOTES_v2.3.0.md) for complete v2.3.0 features.

---

## 🙏 Apology

We apologize for the inconvenience caused by v2.3.0. This hotfix ensures the package works correctly for all users.

---

**Download**: https://www.npmjs.com/package/mcp-code-context/v/2.3.1
