/**
 * Write Operations - v3.7.0
 * FIXES: SecurityValidator in renameSymbol, atomic writes, AST-based positioning
 * CRITICAL: renameSymbol Phase 1 is now pure-functional (no disk writes)
 */

import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { BaseParser } from "../parsers/base.js";
import { SecurityValidator } from "../core/validator.js";
import { generateUnifiedDiff } from "../utils/diff.js";

export { renameSymbol } from "./rename.js";

export interface WriteResult {
  success: boolean;
  newContent?: string;
  error?: string;
  diff?: string;
  originalHash?: string;
  /** Multi-file changes for rename operations (Phase 1 accumulation) */
  pendingWrites?: Array<{ filePath: string; newContent: string; originalHash?: string }>;
}

export interface ReplaceOptions {
  filePath: string;
  projectRoot: string;
  symbolName: string;
  newContent: string;
  className?: string;
  parser: BaseParser;
}

export interface InsertOptions {
  filePath: string;
  projectRoot: string;
  code: string;
  anchorSymbol?: string;
  position?: "before" | "after" | "inside_start" | "inside_end";
  className?: string;
  parser: BaseParser;
}

export interface RemoveOptions {
  filePath: string;
  projectRoot: string;
  symbolName: string;
  className?: string;
  parser: BaseParser;
}

/**
 * Validate syntax of generated code
 */
export function validateSyntax(content: string, parser: BaseParser): { valid: boolean; error?: string } {
  try {
    const tree = parser.parse(content);
    if (tree.rootNode.hasError) {
      return { valid: false, error: "Generated code has syntax errors" };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Syntax validation failed: ${error}` };
  }
}

/**
 * Replace a symbol with new content
 */
export async function replaceSymbol(options: ReplaceOptions): Promise<WriteResult> {
  const { filePath, projectRoot, symbolName, newContent, className, parser } = options;

  // Validate path boundary
  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const content = await fs.readFile(validation.resolvedPath!, "utf-8");
    const originalHash = createHash('md5').update(content).digest('hex');
    const tree = parser.parse(content);

    // Use AST-based replacement
    let result: string;
    try {
      result = parser.replaceSymbol(content, tree, symbolName, newContent, className);
    } catch (replaceError) {
      return {
        success: false,
        error: replaceError instanceof Error ? replaceError.message : String(replaceError),
      };
    }

    // Validate syntax of the resulting file
    const syntaxCheck = validateSyntax(result, parser);
    if (!syntaxCheck.valid) {
      return { success: false, error: syntaxCheck.error };
    }

    const diff = generateDiff(content, result);

    return {
      success: true,
      newContent: result,
      diff,
      originalHash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Insert code at a specific location using AST positioning
 */
export async function insertCode(options: InsertOptions): Promise<WriteResult> {
  const { filePath, projectRoot, code, anchorSymbol, position = "after", className, parser } = options;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const content = await fs.readFile(validation.resolvedPath!, "utf-8");
    const originalHash = createHash('md5').update(content).digest('hex');
    const tree = parser.parse(content);

    let insertIndex: number;

    if (!anchorSymbol) {
      // Insert at end
      insertIndex = content.length;
    } else {
      // Find anchor using AST
      const symbols = parser.findSymbols(tree);
      const anchorNode = symbols.find(s =>
        s.name === anchorSymbol && (!className || s.className === className)
      );

      if (!anchorNode) {
        return { success: false, error: `Anchor symbol "${anchorSymbol}" not found` };
      }

      // Use AST indices for positioning
      switch (position) {
        case "before":
          insertIndex = anchorNode.startIndex;
          break;
        case "after":
          insertIndex = anchorNode.endIndex;
          break;
        case "inside_start":
          insertIndex = content.indexOf("{", anchorNode.startIndex) + 1;
          break;
        case "inside_end":
          insertIndex = content.lastIndexOf("}", anchorNode.endIndex);
          break;
        default:
          insertIndex = anchorNode.endIndex;
      }
    }

    const result = content.substring(0, insertIndex) + "\n" + code + "\n" + content.substring(insertIndex);

    // Validate syntax
    const syntaxCheck = validateSyntax(result, parser);
    if (!syntaxCheck.valid) {
      return { success: false, error: syntaxCheck.error };
    }

    const diff = generateDiff(content, result);

    return {
      success: true,
      newContent: result,
      diff,
      originalHash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Remove a symbol from file
 */
export async function removeSymbol(options: RemoveOptions): Promise<WriteResult> {
  const { filePath, projectRoot, symbolName, className, parser } = options;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const content = await fs.readFile(validation.resolvedPath!, "utf-8");
    const tree = parser.parse(content);

    // Use findSymbols for AST-based location
    const symbols = parser.findSymbols(tree);
    const target = symbols.find(s =>
      s.name === symbolName && (!className || s.className === className)
    );

    if (!target) {
      return { success: false, error: `Symbol "${symbolName}" not found` };
    }

    // Use AST startIndex/endIndex instead of indexOf
    const result = content.substring(0, target.startIndex) + content.substring(target.endIndex);

    // Validate syntax
    const syntaxCheck = validateSyntax(result, parser);
    if (!syntaxCheck.valid) {
      return { success: false, error: syntaxCheck.error };
    }

    const diff = generateDiff(content, result);

    return {
      success: true,
      newContent: result,
      diff,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Atomic file write: write to .tmp then rename
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}

export function generateDiff(oldContent: string, newContent: string): string {
  return generateUnifiedDiff(oldContent, newContent);
}
