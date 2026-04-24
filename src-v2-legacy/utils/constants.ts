/**
 * constants.ts — Centralized Configuration Constants
 * 
 * All magic numbers, file extensions, and configuration values
 * are defined here to eliminate hardcoding throughout the codebase.
 */

// ─── File Extensions ────────────────────────────────────────────────

/** Extensions considered source code for semantic analysis */
export const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs",
  ".py", ".pyi",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".txt",
  ".css", ".scss", ".less",
  ".html", ".vue", ".svelte",
  ".rs", ".go", ".java", ".kt", ".dart",
  ".c", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".swift",
  ".sh", ".bash", ".zsh",
  ".sql",
  ".graphql", ".gql",
  ".proto",
  ".dockerfile",
]);

/** Extensions eligible for import/dependency analysis */
export const IMPORTABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs",
  ".py", ".pyi",
  ".php", ".phtml",
  ".dart",
  ".vue", ".svelte",
]);

/** Extensions that support surgical AST-based editing */
export const WRITABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs",
  ".php", ".phtml",
  ".dart",
  ".py", ".pyi",
]);

// ─── Resource Limits ────────────────────────────────────────────────

/** Maximum files to process in get_semantic_repo_map to prevent timeout */
export const MAX_FILES_FOR_REPO_MAP = 500;

/** Maximum file size in bytes (10MB) to prevent memory issues */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum symbol name length for fuzzy matching (prevent ReDoS) */
export const MAX_SYMBOL_NAME_LENGTH = 1000;

/** Maximum number of backups to keep per file */
export const MAX_BACKUP_VERSIONS = 5;

/** Confirmation token TTL in milliseconds (5 minutes) */
export const CONFIRMATION_TOKEN_TTL_MS = 5 * 60 * 1000;

/** Maximum entries in confirmation cache before cleanup */
export const MAX_CONFIRMATION_CACHE_SIZE = 100;

/** Maximum results to return from code pattern search */
export const MAX_SEARCH_RESULTS = 50;

/** Default context lines for code search */
export const DEFAULT_CONTEXT_LINES = 3;

// ─── Indentation ────────────────────────────────────────────────────

/** Default indentation for Dart (2 spaces per Dart style guide) */
export const DART_INDENT = "  ";

/** Default indentation for TypeScript/JavaScript */
export const TS_INDENT = "  ";

/** Default indentation for PHP (4 spaces per PSR-12) */
export const PHP_INDENT = "    ";

/** Default indentation for Python (4 spaces per PEP 8) */
export const PYTHON_INDENT = "    ";

// ─── Project Root Markers ───────────────────────────────────────────

/** Files/directories that indicate a project root */
export const PROJECT_ROOT_MARKERS = [
  "package.json",
  ".git",
  "pyproject.toml",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "CMakeLists.txt",
  ".gitignore",
  "Gemfile",
  "composer.json",
  "pubspec.yaml",
];

// ─── Directories to Always Ignore ───────────────────────────────────

/** Directories that should always be excluded from analysis */
export const ALWAYS_IGNORE_DIRS = [
  "node_modules",
  "dist",
  "build",
  "out",
  "vendor",
  ".git",
  ".svn",
  ".hg",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "coverage",
  ".next",
  ".nuxt",
  "target",
  "bin",
  "obj",
];

// ─── Server Metadata ────────────────────────────────────────────────

export const SERVER_NAME = "mcp-code-context";
export const SERVER_VERSION = "3.0.0";

// ─── Validation Patterns ────────────────────────────────────────────

/** Regex to detect potentially dangerous patterns in user input */
export const DANGEROUS_PATTERN_REGEX = /(\.\.|\/etc\/|\/root\/|C:\\Windows|%SYSTEMROOT%)/i;

/** Maximum regex pattern length to prevent ReDoS */
export const MAX_REGEX_PATTERN_LENGTH = 500;
