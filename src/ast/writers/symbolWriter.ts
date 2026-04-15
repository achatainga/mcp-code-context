/**
 * symbolWriter.ts — Central Dispatcher for Surgical Write Operations
 *
 * Routes write operations to the correct language-specific writer based
 * on file extension. This is the "write" counterpart to semanticCompressor.ts.
 *
 * Supports:
 *   - TypeScript/JavaScript (.ts, .tsx, .js, .jsx, .mts, .mjs, .cts, .cjs)
 *   - PHP (.php, .phtml)
 *   - Dart (.dart)
 *   - Python (.py, .pyi)
 */

import * as path from "node:path";

import {
  replaceTSSymbol,
  insertTSCode,
  renameTSSymbol,
  removeTSSymbol,
  type WriteResult,
  type InsertPosition,
} from "./tsWriter.js";

import {
  replacePHPSymbol,
  insertPHPCode,
  renamePHPSymbol,
  removePHPSymbol,
} from "./phpWriter.js";

import {
  replaceDartSymbol,
  insertDartCode,
  renameDartSymbol,
  removeDartSymbol,
} from "./dartWriter.js";

import {
  replacePySymbol,
  insertPyCode,
  renamePySymbol,
  removePySymbol,
} from "./pyWriter.js";

// Re-export types for consumers
export type { WriteResult, InsertPosition };

// ─── Extension Sets ─────────────────────────────────────────────────

const TS_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs",
]);

const PHP_EXTENSIONS = new Set([".php", ".phtml"]);

const DART_EXTENSIONS = new Set([".dart"]);

const PY_EXTENSIONS = new Set([".py", ".pyi"]);

/** All extensions supported for surgical writing */
export const WRITABLE_EXTENSIONS = new Set([
  ...TS_EXTENSIONS,
  ...PHP_EXTENSIONS,
  ...DART_EXTENSIONS,
  ...PY_EXTENSIONS,
]);

// ─── Replace Symbol ─────────────────────────────────────────────────

/**
 * Replace the full source code of a named symbol in a file.
 * Dispatches to the correct language-specific writer.
 *
 * @param filePath  - Used to detect language via extension
 * @param content   - Current file content
 * @param symbolName - Name of the symbol to replace
 * @param newContent - Complete replacement code (signature + body)
 */
export function replaceSymbol(
  filePath: string,
  content: string,
  symbolName: string,
  newContent: string,
): WriteResult {
  const ext = path.extname(filePath).toLowerCase();

  if (TS_EXTENSIONS.has(ext)) {
    return replaceTSSymbol(content, symbolName, newContent, filePath);
  }

  if (PHP_EXTENSIONS.has(ext)) {
    return replacePHPSymbol(content, symbolName, newContent);
  }

  if (DART_EXTENSIONS.has(ext)) {
    return replaceDartSymbol(content, symbolName, newContent);
  }

  if (PY_EXTENSIONS.has(ext)) {
    return replacePySymbol(content, symbolName, newContent);
  }

  return {
    success: false,
    newContent: content,
    symbolsAffected: [],
    error: `Unsupported file type "${ext}" for surgical writing. Supported: TypeScript, JavaScript, PHP, Dart, Python.`,
  };
}

// ─── Insert Code ────────────────────────────────────────────────────

/**
 * Insert new code at a precise location relative to an anchor symbol.
 *
 * @param filePath     - Used to detect language via extension
 * @param content      - Current file content
 * @param code         - The code to insert
 * @param anchorSymbol - Symbol to position relative to (null = end of file)
 * @param position     - Where to insert: before, after, inside_start, inside_end
 */
export function insertCode(
  filePath: string,
  content: string,
  code: string,
  anchorSymbol: string | null,
  position: InsertPosition,
): WriteResult {
  const ext = path.extname(filePath).toLowerCase();

  if (TS_EXTENSIONS.has(ext)) {
    return insertTSCode(content, code, anchorSymbol, position, filePath);
  }

  if (PHP_EXTENSIONS.has(ext)) {
    return insertPHPCode(content, code, anchorSymbol, position);
  }

  if (DART_EXTENSIONS.has(ext)) {
    return insertDartCode(content, code, anchorSymbol, position);
  }

  if (PY_EXTENSIONS.has(ext)) {
    return insertPyCode(content, code, anchorSymbol, position);
  }

  return {
    success: false,
    newContent: content,
    symbolsAffected: [],
    error: `Unsupported file type "${ext}" for code insertion.`,
  };
}

// ─── Rename Symbol ──────────────────────────────────────────────────

/**
 * Rename all occurrences of a symbol within a single file.
 *
 * @param filePath - Used to detect language via extension
 * @param content  - Current file content
 * @param oldName  - Current symbol name
 * @param newName  - New symbol name
 */
export function renameInFile(
  filePath: string,
  content: string,
  oldName: string,
  newName: string,
): WriteResult {
  const ext = path.extname(filePath).toLowerCase();

  if (TS_EXTENSIONS.has(ext)) {
    return renameTSSymbol(content, oldName, newName, filePath);
  }

  if (PHP_EXTENSIONS.has(ext)) {
    return renamePHPSymbol(content, oldName, newName);
  }

  if (DART_EXTENSIONS.has(ext)) {
    return renameDartSymbol(content, oldName, newName);
  }

  if (PY_EXTENSIONS.has(ext)) {
    return renamePySymbol(content, oldName, newName);
  }

  return {
    success: false,
    newContent: content,
    symbolsAffected: [],
    error: `Unsupported file type "${ext}" for symbol renaming.`,
  };
}

// ─── Remove Symbol ──────────────────────────────────────────────────

/**
 * Remove a named symbol from a file.
 *
 * @param filePath   - Used to detect language via extension
 * @param content    - Current file content
 * @param symbolName - Name of the symbol to remove
 */
export function removeSymbolFromFile(
  filePath: string,
  content: string,
  symbolName: string,
): WriteResult {
  const ext = path.extname(filePath).toLowerCase();

  if (TS_EXTENSIONS.has(ext)) {
    return removeTSSymbol(content, symbolName, filePath);
  }

  if (PHP_EXTENSIONS.has(ext)) {
    return removePHPSymbol(content, symbolName);
  }

  if (DART_EXTENSIONS.has(ext)) {
    return removeDartSymbol(content, symbolName);
  }

  if (PY_EXTENSIONS.has(ext)) {
    return removePySymbol(content, symbolName);
  }

  return {
    success: false,
    newContent: content,
    symbolsAffected: [],
    error: `Unsupported file type "${ext}" for symbol removal.`,
  };
}
