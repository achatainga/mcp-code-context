/**
 * pyWriter.ts — Python Surgical Writer
 *
 * Uses indentation-based block detection to locate symbol boundaries
 * in Python files. Python's significant whitespace makes this different
 * from brace-delimited languages — we detect block ends by watching
 * for dedentation back to the original level.
 *
 * Supports: .py, .pyi
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface WriteResult {
  success: boolean;
  newContent: string;
  symbolsAffected: string[];
  error?: string;
}

export type InsertPosition = "before" | "after" | "inside_start" | "inside_end";

// ─── Replace Symbol ─────────────────────────────────────────────────

/**
 * Replace the full text of a named symbol in a Python file.
 * The newContent should include the def/class signature and body.
 */
export function replacePySymbol(
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
      error: `Symbol "${symbolName}" not found in Python file`,
    };
  }

  const { start, end } = range;

  // Detect indentation of original
  const originalIndent = getIndent(lines[start]);
  const reindented = reindentPython(newContent.trim(), originalIndent);

  // Splice
  const before = lines.slice(0, start);
  const after = lines.slice(end + 1);
  const result = [...before, reindented, ...after].join("\n");

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
export function insertPyCode(
  content: string,
  code: string,
  anchorSymbol: string | null,
  position: InsertPosition,
): WriteResult {
  const lines = content.split("\n");

  if (!anchorSymbol) {
    // No anchor — append at end of file
    lines.push("", "", code.trim(), "");
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
      const reindented = reindentPython(code.trim(), indent);
      // Add proper spacing (PEP 8: two blank lines before top-level, one inside class)
      const spacing = indent === "" ? "\n\n" : "\n";
      lines.splice(start, 0, reindented + spacing);
      break;
    }
    case "after": {
      const reindented = reindentPython(code.trim(), indent);
      const spacing = indent === "" ? "\n\n" : "\n";
      lines.splice(end + 1, 0, spacing + reindented);
      break;
    }
    case "inside_start": {
      // Find the colon line (class Foo:) and insert after it
      const colonLine = findColonLine(lines, start);
      if (colonLine === -1) {
        return {
          success: false,
          newContent: content,
          symbolsAffected: [],
          error: `Cannot find class body start for "${anchorSymbol}"`,
        };
      }
      // Check if there's a docstring, insert after it
      const insertAt = skipDocstring(lines, colonLine + 1);
      const innerIndent = indent + "    "; // Python convention: 4-space indent
      const innerCode = reindentPython(code.trim(), innerIndent);
      lines.splice(insertAt, 0, innerCode, "");
      break;
    }
    case "inside_end": {
      const innerIndent = indent + "    ";
      const innerCode = reindentPython(code.trim(), innerIndent);
      lines.splice(end + 1, 0, "", innerCode);
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
 * Rename all occurrences of a symbol within a Python file.
 */
export function renamePySymbol(
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
 * Remove a named symbol from a Python file.
 */
export function removePySymbol(
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

  // Also remove leading decorators
  let actualStart = range.start;
  while (actualStart > 0 && lines[actualStart - 1].trim().startsWith("@")) {
    actualStart--;
  }

  lines.splice(actualStart, range.end - actualStart + 1);

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
 * Find the start and end line indices of a named symbol in a Python file.
 * Uses indentation to detect block boundaries (Python's significant whitespace).
 */
function findSymbolRange(
  lines: string[],
  symbolName: string,
): SymbolRange | null {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const isClass = new RegExp(`^class\\s+${escaped}[\\s(:]`).test(trimmed);
    const isFunc = new RegExp(
      `^(?:async\\s+)?def\\s+${escaped}\\s*\\(`,
    ).test(trimmed);

    if (!isClass && !isFunc) continue;

    const startLine = i;
    const baseIndent = measureIndent(line);

    // Also check for decorators above
    let decoratorStart = startLine;
    while (
      decoratorStart > 0 &&
      lines[decoratorStart - 1].trim().startsWith("@")
    ) {
      decoratorStart--;
    }

    // Find the end of the block
    let endLine = startLine;
    let j = startLine + 1;

    while (j < lines.length) {
      const bodyLine = lines[j];
      if (bodyLine.trim() === "") {
        j++;
        continue;
      }
      if (measureIndent(bodyLine) > baseIndent) {
        endLine = j;
        j++;
      } else {
        break;
      }
    }

    // Trim trailing blank lines from the block
    while (endLine > startLine && lines[endLine].trim() === "") {
      endLine--;
    }

    return { start: decoratorStart, end: endLine };
  }

  return null;
}

// ─── Utility Functions ──────────────────────────────────────────────

function measureIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function getIndent(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

/**
 * Re-indent a block of Python code to match a target indentation level.
 * Preserves relative indentation within the block.
 */
function reindentPython(code: string, targetIndent: string): string {
  const lines = code.split("\n");
  if (lines.length === 0) return code;

  // Find minimum non-empty indentation
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = measureIndent(line);
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

/**
 * Find the line containing the colon that starts a class/function body.
 */
function findColonLine(lines: string[], startIdx: number): number {
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].includes(":")) return i;
  }
  return -1;
}

/**
 * Skip past a docstring (if present) to find the first line of actual code.
 */
function skipDocstring(lines: string[], startIdx: number): number {
  let i = startIdx;

  // Skip blank lines
  while (i < lines.length && lines[i].trim() === "") i++;

  if (i >= lines.length) return startIdx;

  const trimmed = lines[i].trim();

  // Look for triple-quoted docstring
  if (
    trimmed.startsWith('"""') ||
    trimmed.startsWith("'''")
  ) {
    const quote = trimmed.slice(0, 3);

    // Single-line docstring
    if (trimmed.endsWith(quote) && trimmed.length > 3) {
      return i + 1;
    }

    // Multi-line docstring
    i++;
    while (i < lines.length) {
      if (lines[i].trim().endsWith(quote)) {
        return i + 1;
      }
      i++;
    }
  }

  return startIdx;
}
