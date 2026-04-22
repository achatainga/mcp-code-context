# Release v2.1.3 - Windows CRLF & Parameter Brace Fixes

## 🎯 Overview
This release completely resolves false brace imbalance errors on Windows systems and fixes a critical bug with Dart method parameters containing braces.

## ✨ What's Fixed

### Windows CRLF Support (Complete Resolution)
- ✅ All Dart writer functions now normalize `\r\n` to `\n` before processing
- ✅ No more false "unbalanced braces" errors on Windows files
- ✅ Consistent behavior across Windows, macOS, and Linux
- ✅ Helper functions (`hasBraceBalance`, `reindentCode`) also normalize line endings

### Method Parameter Brace Handling
- ✅ Fixed critical bug where braces in method parameters (e.g., `{int? cart}`) were incorrectly counted as method body braces
- ✅ `findMatchingBraceStateAware` now tracks closing parenthesis to identify method body start
- ✅ Correctly handles Dart named parameters, optional parameters, and destructuring syntax

## 🧪 Testing
- **11 new test cases** covering:
  - CRLF line endings
  - Mixed CRLF/LF line endings
  - Methods with braces in parameters
  - All write operations (replace, insert, rename, remove)
- **100% test pass rate** on Windows 11

## 📝 Changes

### Modified Files
- `src/ast/writers/dartWriter.ts` - Core CRLF normalization and parameter brace detection
- `package.json` - Version bump to 2.1.3
- `CHANGELOG.md` - Detailed release notes
- `TROUBLESHOOTING.md` - Marked CRLF issue as resolved
- `llms.txt` - Updated for LLM consumption

### New Files
- `tests/writers/test-crlf-handling.ts` - Comprehensive CRLF test suite

## 🔄 Migration Guide
No breaking changes. Simply update:

```bash
npm install -g mcp-code-context@2.1.3
```

Or in your MCP client config:
```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "mcp-code-context@2.1.3"]
    }
  }
}
```

## 🐛 Bug Reports Resolved
- Windows CRLF false positive errors
- Parameter brace detection in Dart methods
- Mixed line ending handling

## 📊 Impact
- **Platforms affected**: Windows (primary), all platforms benefit from improved robustness
- **Languages affected**: Dart (primary fix), all languages benefit from CRLF normalization
- **Backward compatible**: Yes, no breaking changes

## 🙏 Credits
Special thanks to the Amazon Q Developer user who reported the Windows CRLF bug with detailed reproduction steps.

## 📚 Documentation
- [CHANGELOG.md](./CHANGELOG.md) - Full version history
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Known issues and solutions
- [README.md](./README.md) - Complete usage guide

---

**Full Changelog**: https://github.com/achatainga/mcp-code-context/compare/v2.1.2...v2.1.3
