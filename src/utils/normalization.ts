/**
 * normalization.ts — Code Normalization Utilities
 * 
 * Centralizes line ending normalization and indentation logic
 * to eliminate duplication across writer modules.
 */

import { DART_INDENT, TS_INDENT, PHP_INDENT, PYTHON_INDENT } from "./constants.js";

// ─── Line Ending Normalization ──────────────────────────────────────

/**
 * Normalize line endings to LF (\n) for consistent processing.
 * Handles CRLF (\r\n), CR (\r), and mixed line endings.
 * 
 * Why: Windows files use CRLF, which breaks brace-counting and line-based
 * operations. Normalizing to LF ensures consistent behavior across platforms.
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// ─── Indentation Detection ──────────────────────────────────────────

/**
 * Extract the leading whitespace from a line.
 */
export function getIndent(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

/**
 * Measure the indentation level of a line (number of spaces/tabs).
 */
export function measureIndent(line: string): number {
  const indent = getIndent(line);
  // Convert tabs to 4 spaces for measurement
  return indent.replace(/\t/g, "    ").length;
}

/**
 * Detect the predominant indentation style in a file.
 * Returns the most common indentation string (e.g., "  ", "    ", "\t").
 */
export function detectIndentStyle(content: string): string {
  const lines = content.split("\n");
  const indents = new Map<string, number>();

  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = getIndent(line);
    if (indent.length === 0) continue;

    // Extract the base indent unit (first level of indentation)
    const match = indent.match(/^(\s+)/);
    if (match) {
      const unit = match[1];
      indents.set(unit, (indents.get(unit) || 0) + 1);
    }
  }

  if (indents.size === 0) return "  "; // Default to 2 spaces

  // Return the most common indent
  let maxCount = 0;
  let commonIndent = "  ";
  for (const [indent, count] of indents.entries()) {
    if (count > maxCount) {
      maxCount = count;
      commonIndent = indent;
    }
  }

  return commonIndent;
}

// ─── Code Reindentation ─────────────────────────────────────────────

/**
 * Reindent code to match a target indentation level.
 * Preserves relative indentation between lines.
 * 
 * @param code - The code to reindent
 * @param targetIndent - The base indentation to apply
 * @param language - Optional language hint for default indent style
 */
export function reindentCode(
  code: string,
  targetIndent: string,
  language?: "dart" | "typescript" | "php" | "python"
): string {
  // Normalize line endings first
  code = normalizeLineEndings(code);

  const lines = code.split("\n");
  if (lines.length === 0) return code;

  // Find minimum indentation (excluding empty lines)
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = measureIndent(line);
    if (indent < minIndent) minIndent = indent;
  }

  if (minIndent === Infinity) minIndent = 0;

  // Apply target indentation while preserving relative indentation
  return lines
    .map((line) => {
      if (line.trim() === "") return "";
      const currentIndent = measureIndent(line);
      const relativeIndent = currentIndent - minIndent;
      
      // Calculate how many indent units are needed
      const indentUnit = getIndentUnit(language);
      const indentUnitSize = indentUnit.length;
      const numUnits = Math.floor(relativeIndent / indentUnitSize);
      
      return targetIndent + indentUnit.repeat(numUnits) + line.trimStart();
    })
    .join("\n");
}

/**
 * Get the standard indentation unit for a language.
 */
function getIndentUnit(language?: "dart" | "typescript" | "php" | "python"): string {
  switch (language) {
    case "dart":
    case "typescript":
      return TS_INDENT;
    case "php":
      return PHP_INDENT;
    case "python":
      return PYTHON_INDENT;
    default:
      return "  "; // Default to 2 spaces
  }
}

/**
 * Reindent code for Python (indentation-aware language).
 * Handles Python's strict indentation requirements.
 */
export function reindentPython(code: string, targetIndent: string): string {
  code = normalizeLineEndings(code);
  const lines = code.split("\n");
  if (lines.length === 0) return code;

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
      const currentIndent = measureIndent(line);
      const relativeIndent = currentIndent - minIndent;
      
      // Python uses 4-space indentation by convention
      const numLevels = Math.floor(relativeIndent / 4);
      return targetIndent + PYTHON_INDENT.repeat(numLevels) + line.trimStart();
    })
    .join("\n");
}

// ─── Whitespace Cleanup ─────────────────────────────────────────────

/**
 * Remove excessive blank lines (more than 2 consecutive).
 */
export function normalizeBlankLines(content: string): string {
  return content.replace(/\n{3,}/g, "\n\n");
}

/**
 * Ensure file ends with a single newline (POSIX standard).
 */
export function ensureTrailingNewline(content: string): string {
  if (!content.endsWith("\n")) {
    return content + "\n";
  }
  // Remove multiple trailing newlines
  return content.replace(/\n+$/, "\n");
}
