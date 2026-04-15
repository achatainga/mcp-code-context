/**
 * dartWriter.ts — Dart Surgical Writer
 *
 * Uses the same brace-counting + regex engine as dartCompressor.ts
 * to locate symbol boundaries, then performs line-splice operations.
 *
 * Dart code structure is brace-delimited like most C-style languages,
 * so we reuse the proven boundary detection from the read side.
 *
 * Supports: .dart
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface WriteResult {
  success: boolean;
  newContent: string;
  symbolsAffected: string[];
  error?: string;
}

export type InsertPosition = "before" | "after" | "inside_start" | "inside_end";

// ─── Regex Patterns ─────────────────────────────────────────────────

const DECLARATION_REGEX =
  /^(abstract\s+)?(class|mixin|extension|enum)\s+(\w+)/;

const IMPORT_REGEX = /^\s*import\s+['"]/;

// ─── Replace Symbol ─────────────────────────────────────────────────

/**
 * Replace the full text of a named symbol in a Dart file.
 */
export function replaceDartSymbol(
  content: string,
  symbolName: string,
  newContent: string,
): WriteResult {
  const lines = content.split("\n");
  const range = findSymbolRange(lines, symbolName);

  if (!range) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Symbol "${symbolName}" not found in Dart file`,
    };
  }

  const { start, end } = range;

  // Detect indentation of original
  const originalIndent = getIndent(lines[start]);
  const reindented = reindentCode(newContent.trim(), originalIndent);

  // Splice
  const before = lines.slice(0, start);
  const after = lines.slice(end + 1);
  const result = [...before, reindented, ...after].join("\n");

  // Basic validation: check brace balance
  if (!hasBraceBalance(result)) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Replacement produced unbalanced braces. Aborting.`,
    };
  }

  return {
    success: true,
    newContent: result,
    symbolsAffected: [symbolName],
  };
}

// ─── Insert Code ────────────────────────────────────────────────────

/**
 * Insert new code at a precise location relative to an anchor symbol.
 */
export function insertDartCode(
  content: string,
  code: string,
  anchorSymbol: string | null,
  position: InsertPosition,
): WriteResult {
  const lines = content.split("\n");

  if (!anchorSymbol) {
    // No anchor — append at end of file
    lines.push("", code.trim(), "");
    return {
      success: true,
      newContent: lines.join("\n"),
      symbolsAffected: [],
    };
  }

  const range = findSymbolRange(lines, anchorSymbol);
  if (!range) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Anchor symbol "${anchorSymbol}" not found`,
    };
  }

  const { start, end } = range;
  const indent = getIndent(lines[start]);

  switch (position) {
    case "before": {
      const reindented = reindentCode(code.trim(), indent);
      lines.splice(start, 0, reindented, "");
      break;
    }
    case "after": {
      const reindented = reindentCode(code.trim(), indent);
      lines.splice(end + 1, 0, "", reindented);
      break;
    }
    case "inside_start": {
      // Find opening brace
      const braceIdx = findBraceLine(lines, start);
      if (braceIdx === -1) {
        return {
          success: false,
          newContent: content,
          symbolsAffected: [],
          error: `Cannot find opening brace for "${anchorSymbol}"`,
        };
      }
      const innerIndent = indent + "  "; // Dart convention: 2-space indent
      const innerCode = reindentCode(code.trim(), innerIndent);
      lines.splice(braceIdx + 1, 0, innerCode, "");
      break;
    }
    case "inside_end": {
      const innerIndent = indent + "  ";
      const innerCode = reindentCode(code.trim(), innerIndent);
      lines.splice(end, 0, "", innerCode);
      break;
    }
  }

  return {
    success: true,
    newContent: lines.join("\n"),
    symbolsAffected: [anchorSymbol],
  };
}

// ─── Rename Symbol ──────────────────────────────────────────────────

/**
 * Rename all occurrences of a symbol within a Dart file.
 */
export function renameDartSymbol(
  content: string,
  oldName: string,
  newName: string,
): WriteResult {
  const lines = content.split("\n");
  const range = findSymbolRange(lines, oldName);

  if (!range) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Symbol "${oldName}" not found for renaming`,
    };
  }

  // Whole-word replacement
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "g");
  const result = content.replace(regex, newName);

  return {
    success: true,
    newContent: result,
    symbolsAffected: [oldName],
  };
}

// ─── Remove Symbol ──────────────────────────────────────────────────

/**
 * Remove a named symbol from a Dart file.
 */
export function removeDartSymbol(
  content: string,
  symbolName: string,
): WriteResult {
  const lines = content.split("\n");
  const range = findSymbolRange(lines, symbolName);

  if (!range) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Symbol "${symbolName}" not found for removal`,
    };
  }

  lines.splice(range.start, range.end - range.start + 1);

  let result = lines.join("\n");
  result = result.replace(/\n{3,}/g, "\n\n");

  return {
    success: true,
    newContent: result,
    symbolsAffected: [symbolName],
  };
}

// ─── Symbol Finder ──────────────────────────────────────────────────

interface SymbolRange {
  start: number; // 0-indexed line
  end: number;   // 0-indexed line (inclusive)
}

/**
 * Find the start and end line indices of a named symbol in a Dart file.
 * Includes leading doc comments and annotations.
 */
function findSymbolRange(
  lines: string[],
  symbolName: string,
): SymbolRange | null {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Match class-level declarations
    const declMatch = DECLARATION_REGEX.exec(trimmed);
    if (declMatch && declMatch[3] === symbolName) {
      const start = findDocStart(lines, i);
      const end = findBlockEnd(lines, i);
      return { start, end };
    }

    // Match top-level functions
    if (isTopLevelFunction(trimmed)) {
      const funcName = extractFunctionName(trimmed);
      if (funcName === symbolName) {
        const start = findDocStart(lines, i);
        const end = findBlockEnd(lines, i);
        return { start, end };
      }
    }

    // Match methods inside classes
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const methodMatch = trimmed.match(
      new RegExp(`\\b${escaped}\\s*[<(]`),
    );
    if (
      methodMatch &&
      !DECLARATION_REGEX.test(trimmed) &&
      !IMPORT_REGEX.test(trimmed) &&
      (trimmed.includes("(") || trimmed.includes("<"))
    ) {
      if (isMethodOrConstructor(trimmed) || isTopLevelFunction(trimmed)) {
        const start = findDocStart(lines, i);
        const end = findBlockEnd(lines, i);
        return { start, end };
      }
    }
  }

  return null;
}

/**
 * Walk backward from a declaration to find leading doc comments/annotations.
 */
function findDocStart(lines: string[], declLine: number): number {
  let start = declLine;
  for (let k = declLine - 1; k >= 0; k--) {
    const t = lines[k].trim();
    if (t.startsWith("///") || t.startsWith("@") || t === "") {
      if (t !== "") start = k;
    } else {
      break;
    }
  }
  return start;
}

/**
 * Find the end of a block (matching closing brace).
 */
function findBlockEnd(lines: string[], startIdx: number): number {
  const line = lines[startIdx].trim();

  // Single-line declaration (no body)
  if (line.endsWith(";") && !line.includes("{")) {
    return startIdx;
  }

  // Find opening brace
  let braceLineIdx = startIdx;
  while (
    braceLineIdx < lines.length &&
    !lines[braceLineIdx].includes("{")
  ) {
    braceLineIdx++;
  }

  // Count braces to find matching close
  let depth = 0;
  for (let k = braceLineIdx; k < lines.length; k++) {
    for (const ch of lines[k]) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return k;
      }
    }
  }

  // Fallback: return last line
  return lines.length - 1;
}

// ─── Utility Functions ──────────────────────────────────────────────

function isTopLevelFunction(trimmed: string): boolean {
  // Matches: void foo(), Future<T> bar(), static Type baz()
  // But NOT: class/mixin/extension/enum declarations
  if (DECLARATION_REGEX.test(trimmed)) return false;
  if (IMPORT_REGEX.test(trimmed)) return false;
  if (trimmed.startsWith("//") || trimmed.startsWith("///")) return false;
  if (trimmed.startsWith("@")) return false;

  // Look for pattern: [returnType] functionName( or functionName<
  return /^(?:(?:static|final|const|async|Future|Stream|void|int|double|String|bool|List|Map|Set|dynamic|var)\s+)*\w+\s*[<(]/.test(
    trimmed,
  );
}

function extractFunctionName(trimmed: string): string {
  // Remove return type and modifiers, extract the name before ( or <
  const match = trimmed.match(/(\w+)\s*[<(]/);
  return match ? match[1] : "";
}

function isMethodOrConstructor(trimmed: string): boolean {
  // Similar to top-level function but may be indented
  if (DECLARATION_REGEX.test(trimmed)) return false;
  if (trimmed.startsWith("//") || trimmed.startsWith("///")) return false;
  if (trimmed.startsWith("@")) return false;

  return /^(?:(?:static|final|const|async|override|abstract|Future|Stream|void|int|double|String|bool|List|Map|Set|dynamic|var)\s+)*\w+\s*[<(]/.test(
    trimmed,
  );
}

function getIndent(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

function reindentCode(code: string, targetIndent: string): string {
  const lines = code.split("\n");
  if (lines.length === 0) return code;

  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }

  if (minIndent === Infinity) minIndent = 0;

  return lines
    .map((line) => {
      if (line.trim() === "") return "";
      return targetIndent + line.slice(minIndent);
    })
    .join("\n");
}

function findBraceLine(lines: string[], startIdx: number): number {
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].includes("{")) return i;
  }
  return -1;
}

function hasBraceBalance(content: string): boolean {
  let depth = 0;
  for (const ch of content) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}
