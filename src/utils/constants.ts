/**
 * Constants - Centralized configuration
 * v3.5.3
 */

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
];

export const MAX_FILES_REPO_MAP = 500;
export const MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const OPERATION_TIMEOUT_MS = 30000; // 30s
export const MAX_CONCURRENT_OPS = 100;
export const REGEX_TIMEOUT_MS = 1000; // 1s for regex operations
