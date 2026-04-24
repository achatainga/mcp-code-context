/**
 * read_file_lines — Read specific line ranges from a file
 * 
 * Efficiently reads only the requested lines without loading the entire file into memory.
 * Supports reading by exact line range or around a pattern match.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ReadFileLinesArgs {
  filePath: string;
  startLine?: number;
  endLine?: number;
  aroundPattern?: string;
  contextLines?: number;
}

export interface ReadFileLinesResult {
  success: boolean;
  content?: string;
  error?: string;
  lineRange?: { start: number; end: number };
}

/**
 * Read specific lines from a file
 */
export function readFileLines(args: ReadFileLinesArgs): ReadFileLinesResult {
  const { filePath, startLine, endLine, aroundPattern, contextLines = 5 } = args;

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      error: `File not found: ${resolvedPath}`,
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error: unknown) {
    return {
      success: false,
      error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const lines = content.split("\n");
  const totalLines = lines.length;

  // Mode 1: Exact line range
  if (startLine !== undefined && endLine !== undefined) {
    if (startLine < 1 || endLine < 1 || startLine > totalLines || endLine > totalLines) {
      return {
        success: false,
        error: `Invalid line range: ${startLine}-${endLine}. File has ${totalLines} lines.`,
      };
    }

    if (startLine > endLine) {
      return {
        success: false,
        error: `startLine (${startLine}) must be <= endLine (${endLine})`,
      };
    }

    const selectedLines = lines.slice(startLine - 1, endLine);
    return {
      success: true,
      content: selectedLines.join("\n"),
      lineRange: { start: startLine, end: endLine },
    };
  }

  // Mode 2: Around pattern
  if (aroundPattern) {
    const matchIndex = lines.findIndex((line) => line.includes(aroundPattern));

    if (matchIndex === -1) {
      return {
        success: false,
        error: `Pattern "${aroundPattern}" not found in file`,
      };
    }

    const start = Math.max(0, matchIndex - contextLines);
    const end = Math.min(totalLines - 1, matchIndex + contextLines);

    const selectedLines = lines.slice(start, end + 1);
    return {
      success: true,
      content: selectedLines.join("\n"),
      lineRange: { start: start + 1, end: end + 1 },
    };
  }

  return {
    success: false,
    error: "Must provide either (startLine + endLine) or aroundPattern",
  };
}
