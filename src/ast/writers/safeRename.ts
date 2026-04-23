/**
 * AST-Aware Safe Rename Module
 * Replaces dangerous regex-based renaming with language-specific AST/tokenizer approaches
 */

import * as ts from "typescript";
import * as path from "path";
import { createRequire } from "module";

export interface SafeRenameResult {
  success: boolean;
  newContent: string;
  symbolsAffected: string[];
  error?: string;
}

/**
 * Main entry point for safe renaming across all supported languages
 */
export function safeRenameReferences(
  filePath: string,
  content: string,
  oldName: string,
  newName: string
): SafeRenameResult {
  const ext = path.extname(filePath).toLowerCase();

  try {
    switch (ext) {
      case ".ts":
      case ".tsx":
      case ".js":
      case ".jsx":
      case ".mjs":
      case ".cjs":
        return renameTypeScript(content, oldName, newName);
      
      case ".php":
        return renamePHP(content, oldName, newName);
      
      case ".dart":
        return renameDart(content, oldName, newName);
      
      case ".py":
        return renamePython(content, oldName, newName);
      
      default:
        // Fallback to conservative token-based approach
        return renameGeneric(content, oldName, newName);
    }
  } catch (error) {
    return {
      success: false,
      newContent: content,
      symbolsAffected: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * TypeScript/JavaScript: Use TypeScript compiler API
 */
function renameTypeScript(
  content: string,
  oldName: string,
  newName: string
): SafeRenameResult {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const replacements: Array<{ start: number; end: number }> = [];

  function visit(node: ts.Node) {
    // Only rename identifiers that are actual references (not in strings/comments)
    if (ts.isIdentifier(node) && node.text === oldName) {
      // Verify it's not part of a string literal or comment
      const parent = node.parent;
      if (
        !ts.isStringLiteral(parent) &&
        !ts.isNoSubstitutionTemplateLiteral(parent) &&
        !ts.isTemplateHead(parent) &&
        !ts.isTemplateMiddle(parent) &&
        !ts.isTemplateTail(parent)
      ) {
        replacements.push({ start: node.getStart(), end: node.getEnd() });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (replacements.length === 0) {
    return { success: true, newContent: content, symbolsAffected: [] };
  }

  // Apply replacements in reverse order to maintain positions
  let result = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end } = replacements[i];
    result = result.slice(0, start) + newName + result.slice(end);
  }

  return {
    success: true,
    newContent: result,
    symbolsAffected: [oldName]
  };
}

/**
 * PHP: Use php-parser AST
 */
function renamePHP(
  content: string,
  oldName: string,
  newName: string
): SafeRenameResult {
  try {
    const require = createRequire(import.meta.url);
    const phpParser = require("php-parser");
    const parser = new phpParser.Engine({
      parser: { extractDoc: true, php7: true, locations: true },
      ast: { withPositions: true }
    });

    const ast = parser.parseCode(content);
    const replacements: Array<{ start: number; end: number }> = [];

    function traverse(node: any) {
      if (!node || typeof node !== "object") return;

      // Rename identifiers (variables, functions, classes)
      if (node.kind === "identifier" && node.name === oldName) {
        if (node.loc) {
          replacements.push({
            start: node.loc.start.offset,
            end: node.loc.end.offset
          });
        }
      }

      // Traverse children
      for (const key in node) {
        if (key === "loc" || key === "kind") continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(traverse);
        } else if (typeof child === "object") {
          traverse(child);
        }
      }
    }

    traverse(ast);

    if (replacements.length === 0) {
      return { success: true, newContent: content, symbolsAffected: [] };
    }

    // Apply replacements in reverse
    let result = content;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { start, end } = replacements[i];
      result = result.slice(0, start) + newName + result.slice(end);
    }

    return {
      success: true,
      newContent: result,
      symbolsAffected: [oldName]
    };
  } catch (error) {
    // Fallback to generic if PHP parsing fails
    return renameGeneric(content, oldName, newName);
  }
}

/**
 * Dart: Token-based approach (no full AST parser available)
 * Skips strings and comments
 */
function renameDart(
  content: string,
  oldName: string,
  newName: string
): SafeRenameResult {
  return renameTokenBased(content, oldName, newName, {
    singleLineComment: "//",
    multiLineCommentStart: "/*",
    multiLineCommentEnd: "*/",
    stringDelimiters: ['"', "'"],
    identifierPattern: /[a-zA-Z_$][a-zA-Z0-9_$]*/g
  });
}

/**
 * Python: Token-based approach
 * Skips strings, comments, and respects indentation
 */
function renamePython(
  content: string,
  oldName: string,
  newName: string
): SafeRenameResult {
  return renameTokenBased(content, oldName, newName, {
    singleLineComment: "#",
    multiLineCommentStart: '"""',
    multiLineCommentEnd: '"""',
    stringDelimiters: ['"', "'", '"""', "'''"],
    identifierPattern: /[a-zA-Z_][a-zA-Z0-9_]*/g
  });
}

/**
 * Generic fallback: Conservative token-based renaming
 */
function renameGeneric(
  content: string,
  oldName: string,
  newName: string
): SafeRenameResult {
  return renameTokenBased(content, oldName, newName, {
    singleLineComment: "//",
    multiLineCommentStart: "/*",
    multiLineCommentEnd: "*/",
    stringDelimiters: ['"', "'", "`"],
    identifierPattern: /[a-zA-Z_$][a-zA-Z0-9_$]*/g
  });
}

/**
 * Token-based renaming that skips strings and comments
 */
interface TokenConfig {
  singleLineComment: string;
  multiLineCommentStart: string;
  multiLineCommentEnd: string;
  stringDelimiters: string[];
  identifierPattern: RegExp;
}

function renameTokenBased(
  content: string,
  oldName: string,
  newName: string,
  config: TokenConfig
): SafeRenameResult {
  const lines = content.split("\n");
  const result: string[] = [];
  let inMultiLineComment = false;
  let changed = false;

  for (let line of lines) {
    let processedLine = "";
    let i = 0;

    while (i < line.length) {
      // Check for multi-line comment start
      if (!inMultiLineComment && line.slice(i).startsWith(config.multiLineCommentStart)) {
        inMultiLineComment = true;
        processedLine += config.multiLineCommentStart;
        i += config.multiLineCommentStart.length;
        continue;
      }

      // Check for multi-line comment end
      if (inMultiLineComment && line.slice(i).startsWith(config.multiLineCommentEnd)) {
        inMultiLineComment = false;
        processedLine += config.multiLineCommentEnd;
        i += config.multiLineCommentEnd.length;
        continue;
      }

      // Skip if inside multi-line comment
      if (inMultiLineComment) {
        processedLine += line[i];
        i++;
        continue;
      }

      // Check for single-line comment
      if (line.slice(i).startsWith(config.singleLineComment)) {
        processedLine += line.slice(i);
        break;
      }

      // Check for string literals
      let inString = false;
      for (const delim of config.stringDelimiters) {
        if (line.slice(i).startsWith(delim)) {
          const endIndex = line.indexOf(delim, i + delim.length);
          if (endIndex !== -1) {
            processedLine += line.slice(i, endIndex + delim.length);
            i = endIndex + delim.length;
            inString = true;
            break;
          }
        }
      }

      if (inString) continue;

      // Check for identifier match
      const remaining = line.slice(i);
      const match = remaining.match(config.identifierPattern);
      
      if (match && match.index === 0 && match[0] === oldName) {
        // Verify word boundaries
        const before = i > 0 ? line[i - 1] : " ";
        const after = i + oldName.length < line.length ? line[i + oldName.length] : " ";
        
        if (!/[a-zA-Z0-9_$]/.test(before) && !/[a-zA-Z0-9_$]/.test(after)) {
          processedLine += newName;
          i += oldName.length;
          changed = true;
          continue;
        }
      }

      processedLine += line[i];
      i++;
    }

    result.push(processedLine);
  }

  return {
    success: true,
    newContent: result.join("\n"),
    symbolsAffected: changed ? [oldName] : []
  };
}
