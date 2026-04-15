# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-04-15

### Added
- **Surgical Writing Tools**: Four new tools for precise, AST-aware code modification:
  - `write_file_surgical`: Replace symbol implementation while preserving file structure.
  - `insert_symbol`: Insert new code relative to existing symbols (before, after, inside).
  - `rename_symbol`: Repository-wide renaming with import/usage updates.
  - `remove_symbol`: Safe deletion of symbols with automatic dependency checking.
- **Language-Specific Writers**: Custom AST adapters for TypeScript, JavaScript, PHP, Dart, and Python.
- **Dry-Run Engine**: Native unified diff generator for previewing changes without modifying the filesystem.
- **Backup System**: Opt-in `.bak` file management with automatic atomic rollback on multi-file operation failures.
- **Enhanced Agent Instructions**: Updated `AGENT_INSTRUCTIONS.md` and `llms.txt` for better AI integration.

### Changed
- Refactored project structure to separate read-only analysis from surgical editing logic.
- Updated `README.md` with comprehensive v2.0 documentation and tool usage examples.
- Standardized error reporting across all MCP tools.
- Modernized `package.json` scripts and metadata.

## [1.0.0] - 2026-04-14

### Added
- **Initial Release**: Basic MCP server for semantic code compression.
- **Semantic Repository Map**: Generate structural maps of entire codebases.
- **Surgical Reading**: Extract specific symbols to save context tokens.
- **Impact Analysis**: Identify files that depend on or import a specific file.
- **Multi-Language Support**: Initial support for TS, JS, PHP, Dart, and Python.
