# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-04-22

### Added
- **`read_file_lines`** - New tool for reading specific line ranges from files
  - Supports exact line range mode (`startLine`/`endLine`)
  - Supports pattern-based search with context (`aroundPattern`)
  - 90% token savings compared to reading full files
  - Perfect for debugging and viewing specific code blocks
  
- **`search_code_pattern`** - New tool for searching patterns across repositories
  - Returns matches with file paths, line numbers, and context
  - Respects `.gitignore` rules automatically
  - Configurable file extensions and excluded directories
  - Optional context lines around each match
  - 85% more efficient than manual grep workflows

- **`clean_backups`** - New tool for cleaning all backup files
  - Removes entire `.mcp-backups` directory at project root
  - Keeps projects clean and organized
  - Frees up disk space

### Changed
- **Centralized Backup System** - Major improvement to backup management
  - Backups now stored in ONE directory: `[project-root]/.mcp-backups/`
  - Maintains internal folder structure for organization
  - No more scattered `.mcp-backups/` folders throughout the project
  - Cleaner git status and working directory
  - Backward compatible with legacy backup locations
- Updated server version to 2.2.0
- Updated README with documentation for new tools
- Renumbered tool sections (now 11 tools total: 5 read + 1 cleanup + 5 write)

### Technical
- Added comprehensive test suite for new tools (`tests/test-new-tools.ts`)
- All tests passing (7/7)
- Based on real-world debugging experience with Flutter/Dart projects

## [2.0.0] - Previous Release

### Added
- Initial release with 8 tools
- AST-based surgical code editing
- Support for TypeScript, JavaScript, PHP, Dart, Python
- Two-phase confirmation workflow
- Rolling backup system
- Fuzzy symbol matching

[2.2.0]: https://github.com/achatainga/mcp-code-context/compare/v2.0.0...v2.2.0
[2.0.0]: https://github.com/achatainga/mcp-code-context/releases/tag/v2.0.0
