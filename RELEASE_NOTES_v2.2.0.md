# 🚀 Release v2.2.0 - Centralized Backup System + New Read Tools

**Release Date:** April 22, 2026  
**Type:** Minor Release (New Features + Improvements)

---

## 🎯 What's New

### 1. 📖 **New Read Tools** (Token Efficiency Champions)

#### `read_file_lines` - Surgical Line Reading
Read specific line ranges or search around patterns without loading entire files.

**Use Cases:**
- Debug specific code blocks
- View error context from stack traces
- Inspect method implementations without full file overhead

**Token Savings:** ~90% compared to reading full files

**Examples:**
```typescript
// Read exact range
read_file_lines({
  filePath: "/project/src/utils.ts",
  startLine: 120,
  endLine: 135
})

// Search around pattern
read_file_lines({
  filePath: "/project/src/service.ts",
  aroundPattern: "calculateTotal",
  contextLines: 5
})
```

#### `search_code_pattern` - Repository-Wide Pattern Search
Find patterns across your codebase with context, respecting `.gitignore`.

**Use Cases:**
- Find all usages of a function
- Locate TODO comments
- Search for specific patterns with context

**Token Savings:** ~85% compared to manual grep workflows

**Examples:**
```typescript
search_code_pattern({
  rootDir: "/project",
  pattern: "widget\\.height",
  fileExtensions: [".dart"],
  showContext: true,
  maxResults: 20
})
```

---

### 2. 🧹 **Centralized Backup System** (Major Improvement)

**Problem Solved:** Backups were scattered throughout projects, polluting git status and creating multiple `.mcp-backups/` folders.

**Solution:** ONE centralized backup directory at project root.

#### Before (v2.1.x):
```
project/
├── lib/
│   ├── screens/
│   │   └── .mcp-backups/  ❌
│   └── services/
│       └── .mcp-backups/  ❌
└── src/
    └── .mcp-backups/      ❌
```

#### After (v2.2.0):
```
project/
├── .mcp-backups/          ✅ ONE directory
│   ├── lib/
│   │   ├── screens/
│   │   └── services/
│   └── src/
├── lib/
├── services/
└── src/
```

**Benefits:**
- ✅ Clean git status
- ✅ Easy to clean all backups at once
- ✅ Preserves internal folder structure
- ✅ Backward compatible

#### `clean_backups` - New Cleanup Tool
Remove all backups with a single command.

```typescript
clean_backups({
  projectRoot: "/path/to/project"
})
```

---

## 📊 Technical Improvements

### Test Coverage
- **148 tests passing** (100% success rate)
  - 35 Dart compression tests
  - 33 PHP compression tests
  - 59 Surgical writing tests
  - 7 New tools tests
  - 7 Backup system tests
  - 7 Integration tests

### Performance
- `read_file_lines`: 90% token reduction vs full file reads
- `search_code_pattern`: 85% more efficient than manual grep
- Centralized backups: 0 scattered directories

### Reliability
- Comprehensive error handling
- Edge case coverage (deep nesting, non-existent paths)
- Backward compatible with legacy backup locations

---

## 🛠️ All Tools (11 Total)

### Read Tools (5)
1. `get_semantic_repo_map` - Repository structure overview
2. `read_file_surgical` - Extract specific symbols
3. `analyze_impact` - Find dependencies
4. **`read_file_lines`** - Read line ranges ⭐ NEW
5. **`search_code_pattern`** - Search with context ⭐ NEW

### Cleanup Tools (1)
6. **`clean_backups`** - Remove all backups ⭐ NEW

### Write Tools (5)
7. `write_file_surgical` - Replace symbols
8. `insert_symbol` - Insert code precisely
9. `rename_symbol` - Rename across repository
10. `remove_symbol` - Safe symbol removal
11. `rollback_file` - Undo changes

---

## 📦 Installation

### NPM (Recommended)
```bash
npm install -g mcp-code-context@2.2.0
```

### From Source
```bash
git clone https://github.com/achatainga/mcp-code-context.git
cd mcp-code-context
git checkout v2.2.0
npm install
npm run build
```

---

## ⚙️ Configuration

### Amazon Q / VS Code / Cursor
Add to your MCP config:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "mcp-code-context@2.2.0"]
    }
  }
}
```

### Claude Desktop
Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "mcp-code-context@2.2.0"]
    }
  }
}
```

---

## 🔄 Migration from v2.1.x

### Automatic Migration
No action needed! The new backup system:
- ✅ Automatically uses centralized location for new backups
- ✅ Still reads legacy backup locations
- ✅ No breaking changes

### Optional Cleanup
Clean old scattered backups:

```bash
# Find old backup directories
find . -type d -name ".mcp-backups" -not -path "./.mcp-backups"

# Remove them (after verifying)
find . -type d -name ".mcp-backups" -not -path "./.mcp-backups" -exec rm -rf {} +
```

---

## 🐛 Bug Fixes

- Fixed backup directory pollution in git status
- Improved error messages for non-existent paths
- Better handling of deeply nested file structures

---

## 📚 Documentation

- [README.md](README.md) - Complete tool documentation
- [CHANGELOG.md](CHANGELOG.md) - Detailed change history
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [llms.txt](llms.txt) - AI-optimized documentation

---

## 🙏 Acknowledgments

This release was built based on real-world debugging experience with:
- Flutter/Dart projects (DeTodo24 mobile app)
- WordPress/PHP backends (dt24-home-engine)
- Complex multi-repository architectures

Special thanks to the community for feedback and testing.

---

## 📈 What's Next (v2.3.0)

Planned features:
- `extract_json_value` - Parse JSON responses efficiently
- Enhanced `get_semantic_repo_map` with file limits
- Support for more languages (Go, Rust, Java)
- Performance optimizations for large repositories

---

## 🔗 Links

- **GitHub:** https://github.com/achatainga/mcp-code-context
- **NPM:** https://www.npmjs.com/package/mcp-code-context
- **Issues:** https://github.com/achatainga/mcp-code-context/issues
- **Discussions:** https://github.com/achatainga/mcp-code-context/discussions

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details

---

**Full Changelog:** https://github.com/achatainga/mcp-code-context/compare/v2.1.3...v2.2.0

---

*Built with ❤️ for the AI-assisted development community*

**Version:** 2.2.0  
**Released:** April 22, 2026  
**Tested:** 148/148 tests passing ✅
