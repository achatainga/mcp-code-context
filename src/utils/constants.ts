/**
 * Constants - Centralized configuration
 * v3.9.1
 */

// Directory exclusions
export const EXCLUDE_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "vendor",
  ".mcp-backups",
  "coverage",
  ".nyc_output",
];

// Supported file extensions
export const SUPPORTED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".py",
  ".pyi",
  ".php",
  ".dart",
  ".java",
  ".go",
  ".cs",
  ".rb",
  ".rs",
  ".kt",
  ".kts",
];

// File and size limits
export const MAX_FILES_REPO_MAP = 500;
export const MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_FILES_SEARCH = 2000;

// Timeout configurations
export const OPERATION_TIMEOUT_MS = 30000; // 30s
export const REGEX_TIMEOUT_MS = 1000; // 1s for regex operations
export const LOCK_TIMEOUT_MS = 30000; // 30s for file locks
export const LOCK_STALE_MS = 30000; // 30s stale detection

// Retry configurations
export const LOCK_RETRY_COUNT = 10;
export const LOCK_RETRY_MIN_MS = 100;
export const LOCK_RETRY_MAX_MS = 1000;
export const LOCK_RETRY_FACTOR = 2;

// Backup configurations
export const MAX_BACKUPS_PER_FILE = 5;
export const HASH_LENGTH = 8;

// Concurrency limits
export const MAX_CONCURRENT_OPS = 100;

// Diff configurations
export const DIFF_CONTEXT_LINES = 3;
export const DIFF_MAX_FILE_LINES = 5000;
