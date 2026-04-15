/**
 * phpWriter.ts — PHP Surgical Writer
 *
 * Uses php-parser to parse the AST for symbol location data,
 * then performs line-splice operations on the raw source text.
 * php-parser doesn't have a write API like ts-morph, so we locate
 * symbols via AST → get line numbers → splice in the replacement.
 *
 * Supports: .php, .phtml
 */

import { createRequire } from "node:module";

// ─── Types ──────────────────────────────────────────────────────────

export interface WriteResult {
  success: boolean;
  newContent: string;
  symbolsAffected: string[];
  error?: string;
}

export type InsertPosition = "before" | "after" | "inside_start" | "inside_end";

interface PhpNode {
  kind: string;
  name?: string | { name: string; kind: string };
  children?: PhpNode[];
  body?: PhpNode[] | PhpNode;
  items?: PhpNode[];
  loc?: {
    start: { line: number; column: number; offset: number };
    end: { line: number; column: number; offset: number };
  };
  leadingComments?: Array<{ kind: string; value: string }>;
}

// ─── Parser ─────────────────────────────────────────────────────────

let _parser: any = null;

function getParser(): any {
  if (!_parser) {
    const require = createRequire(import.meta.url);
    const phpParser = require("php-parser");
    _parser = new phpParser.Engine({
      parser: {
        extractDoc: true,
        php7: true,
        locations: true,
        suppressErrors: true,
      },
      ast: { withPositions: true },
    });
  }
  return _parser;
}

function parsePhp(content: string): PhpNode | null {
  try {
    return getParser().parseCode(content, "file.php");
  } catch {
    return null;
  }
}

// ─── Replace Symbol ─────────────────────────────────────────────────

/**
 * Replace the full text of a named symbol in a PHP file.
 */
export function replacePHPSymbol(
  content: string,
  symbolName: string,
  newContent: string,
): WriteResult {
  const ast = parsePhp(content);
  if (!ast) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: "Failed to parse PHP file",
    };
  }

  const node = findSymbolNode(ast, symbolName);
  if (!node || !node.loc) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Symbol "${symbolName}" not found in PHP file`,
    };
  }

  const lines = content.split("\n");

  // Find the actual start including doc comments
  const startLine = findActualStart(lines, node);
  const endLine = node.loc.end.line; // 1-indexed, inclusive

  // Detect the indentation of the original symbol
  const originalIndent = getIndent(lines[startLine - 1] || "");

  // Re-indent the new content to match
  const reindented = reindentCode(newContent.trim(), originalIndent);

  // Splice in the replacement
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  const result = [...before, reindented, ...after].join("\n");

  // Validate: try to parse the result
  const validationAst = parsePhp(result);
  if (!validationAst) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Replacement produced invalid PHP syntax. Aborting.`,
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
export function insertPHPCode(
  content: string,
  code: string,
  anchorSymbol: string | null,
  position: InsertPosition,
): WriteResult {
  const lines = content.split("\n");

  if (!anchorSymbol) {
    // No anchor — insert before the final closing tag or at end
    const lastClosingBrace = findLastClosingBrace(lines);
    if (lastClosingBrace !== -1) {
      // Insert before the last } (likely end of namespace or class)
      lines.splice(lastClosingBrace, 0, "", code.trim(), "");
    } else {
      lines.push("", code.trim());
    }
    return {
      success: true,
      newContent: lines.join("\n"),
      symbolsAffected: [],
    };
  }

  const ast = parsePhp(content);
  if (!ast) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: "Failed to parse PHP file",
    };
  }

  const node = findSymbolNode(ast, anchorSymbol);
  if (!node || !node.loc) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Anchor symbol "${anchorSymbol}" not found`,
    };
  }

  const startLine = findActualStart(lines, node);
  const endLine = node.loc.end.line;

  const indent = getIndent(lines[startLine - 1] || "");
  const reindented = reindentCode(code.trim(), indent);

  switch (position) {
    case "before":
      lines.splice(startLine - 1, 0, reindented, "");
      break;
    case "after":
      lines.splice(endLine, 0, "", reindented);
      break;
    case "inside_start": {
      // Find the opening brace of the class/interface
      const braceIdx = findOpeningBrace(lines, startLine - 1);
      if (braceIdx === -1) {
        return {
          success: false,
          newContent: content,
          symbolsAffected: [],
          error: `Cannot find opening brace for "${anchorSymbol}"`,
        };
      }
      const innerIndent = indent + "    ";
      const innerCode = reindentCode(code.trim(), innerIndent);
      lines.splice(braceIdx + 1, 0, innerCode, "");
      break;
    }
    case "inside_end": {
      // Insert before the closing brace
      const innerIndent = indent + "    ";
      const innerCode = reindentCode(code.trim(), innerIndent);
      lines.splice(endLine - 1, 0, "", innerCode);
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
 * Rename all occurrences of a symbol within a PHP file.
 * Performs whole-word replacement respecting PHP identifier boundaries.
 */
export function renamePHPSymbol(
  content: string,
  oldName: string,
  newName: string,
): WriteResult {
  const ast = parsePhp(content);
  if (!ast) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: "Failed to parse PHP file",
    };
  }

  // Verify the symbol exists
  const node = findSymbolNode(ast, oldName);
  if (!node) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Symbol "${oldName}" not found for renaming`,
    };
  }

  // Perform whole-word replacement
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "g");
  const result = content.replace(regex, newName);

  // Validate
  const validationAst = parsePhp(result);
  if (!validationAst) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Rename produced invalid PHP syntax`,
    };
  }

  return {
    success: true,
    newContent: result,
    symbolsAffected: [oldName],
  };
}

// ─── Remove Symbol ──────────────────────────────────────────────────

/**
 * Remove a named symbol from a PHP file.
 */
export function removePHPSymbol(
  content: string,
  symbolName: string,
): WriteResult {
  const ast = parsePhp(content);
  if (!ast) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: "Failed to parse PHP file",
    };
  }

  const node = findSymbolNode(ast, symbolName);
  if (!node || !node.loc) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: `Symbol "${symbolName}" not found for removal`,
    };
  }

  const lines = content.split("\n");
  const startLine = findActualStart(lines, node);
  const endLine = node.loc.end.line;

  // Remove the lines
  lines.splice(startLine - 1, endLine - startLine + 1);

  // Clean up consecutive blank lines
  let result = lines.join("\n");
  result = result.replace(/\n{3,}/g, "\n\n");

  return {
    success: true,
    newContent: result,
    symbolsAffected: [symbolName],
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────

function getNodeName(node: PhpNode | undefined | null): string {
  if (!node || !node.name) return "";
  if (typeof node.name === "string") return node.name;
  if (typeof node.name === "object" && "name" in node.name)
    return node.name.name;
  return "";
}

function findSymbolNode(
  node: PhpNode,
  symbolName: string,
): PhpNode | null {
  if (!node) return null;

  const nodeName = getNodeName(node);

  // Direct match on class, interface, trait, enum, function
  if (
    ["class", "interface", "trait", "enum", "function"].includes(node.kind) &&
    nodeName === symbolName
  ) {
    return node;
  }

  // Search methods inside classes/interfaces/traits/enums
  if (["class", "interface", "trait", "enum"].includes(node.kind)) {
    const body = Array.isArray(node.body) ? node.body : [];
    for (const member of body) {
      if (member.kind === "method" && getNodeName(member) === symbolName) {
        return member;
      }
    }
  }

  // Recursive search through children
  const allChildren = [
    ...(node.children || []),
    ...(Array.isArray(node.body) ? node.body : []),
  ];

  for (const child of allChildren) {
    const found = findSymbolNode(child, symbolName);
    if (found) return found;
  }

  return null;
}

/**
 * Walk backward from a symbol's start to capture leading doc comments.
 * Returns the 1-indexed line number of the actual start.
 */
function findActualStart(lines: string[], node: PhpNode): number {
  if (!node.loc) return 1;

  let startLine = node.loc.start.line; // 1-indexed

  if (node.leadingComments && node.leadingComments.length > 0) {
    for (let i = startLine - 2; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (
        trimmed.startsWith("/**") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("*/") ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("#[")
      ) {
        startLine = i + 1; // Convert back to 1-indexed
      } else if (trimmed === "") {
        continue;
      } else {
        break;
      }
    }
  }

  return startLine;
}

function getIndent(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

/**
 * Re-indent a block of code to match a target indentation level.
 * Detects the minimum indentation of the input and replaces it with target.
 */
function reindentCode(code: string, targetIndent: string): string {
  const lines = code.split("\n");
  if (lines.length === 0) return code;

  // Find minimum non-empty indentation
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }

  if (minIndent === Infinity) minIndent = 0;

  // Re-indent each line
  return lines
    .map((line) => {
      if (line.trim() === "") return "";
      return targetIndent + line.slice(minIndent);
    })
    .join("\n");
}

function findOpeningBrace(lines: string[], startIdx: number): number {
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].includes("{")) return i;
  }
  return -1;
}

function findLastClosingBrace(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "}") return i;
  }
  return -1;
}
