/**
 * Write Operations - v3.4.0
 * FIXES: SecurityValidator in renameSymbol, atomic writes, AST-based positioning
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseParser } from "../parsers/base.js";
import { SecurityValidator } from "../core/validator.js";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";
import { generateUnifiedDiff } from "../utils/diff.js";
import { sanitizeRegexPattern } from "../utils/safeRegex.js";

export interface WriteResult {
  success: boolean;
  newContent?: string;
  error?: string;
  diff?: string;
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
function validateSyntax(content: string, parser: BaseParser): { valid: boolean; error?: string } {
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
    const tree = parser.parse(content);

    // Use AST-based replacement
    const result = parser.replaceSymbol(content, tree, symbolName, newContent, className);

    // Validate syntax of generated code
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
 * Rename symbol using AST-aware replacement
 * v3.4.0 - SECURITY FIX: Validates all paths + uses atomic writes
 */
export async function renameSymbol(params: {
  filePath: string;
  projectRoot: string;
  oldName: string;
  newName: string;
  rootDir: string;
  parser: BaseParser;
}): Promise<WriteResult> {
  try {
    const validator = new SecurityValidator(params.projectRoot);

    // Validate definition file path
    const defValidation = await validator.validateFilePath(params.filePath);
    if (!defValidation.valid) {
      return { success: false, error: defValidation.error };
    }

    // Sanitize to prevent regex injection
    const sanitizedOld = sanitizeRegexPattern(params.oldName);

    // Step 1: Rename in definition file using AST
    const content = await fs.readFile(defValidation.resolvedPath!, "utf-8");
    const tree = params.parser.parse(content);
    const symbols = params.parser.findSymbols(tree);

    const targetSymbol = symbols.find(s => s.name === params.oldName);
    if (!targetSymbol) {
      return {
        success: false,
        error: `Symbol "${params.oldName}" not found in ${params.filePath}`,
      };
    }

    // Replace only in symbol definition (AST-based)
    let newContent = content.substring(0, targetSymbol.startIndex) +
      content.substring(targetSymbol.startIndex, targetSymbol.endIndex)
        .replace(new RegExp(`\\b${sanitizedOld}\\b`, "g"), params.newName) +
      content.substring(targetSymbol.endIndex);

    // Step 2: Find dependent files (within project boundary)
    const dependents: string[] = [];

    async function walkDir(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!EXCLUDE_DIRS.includes(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (SUPPORTED_EXTENSIONS.includes(ext as any)) {
            // SECURITY FIX: Validate each dependent file path
            const depValidation = await validator.validateFilePath(fullPath);
            if (!depValidation.valid) continue;

            const fileContent = await fs.readFile(fullPath, "utf-8");
            const importPatterns = [
              new RegExp(`import.*\\b${sanitizedOld}\\b`, "g"),
              new RegExp(`from.*\\b${sanitizedOld}\\b`, "g"),
              new RegExp(`require.*\\b${sanitizedOld}\\b`, "g"),
              new RegExp(`use.*\\b${sanitizedOld}\\b`, "g"),
            ];
            if (importPatterns.some(p => p.test(fileContent))) {
              dependents.push(fullPath);
            }
          }
        }
      }
    }

    await walkDir(params.rootDir);

    // Step 3: Rename in dependent files using atomic writes
    for (const depFile of dependents) {
      const depContent = await fs.readFile(depFile, "utf-8");
      const depNewContent = depContent.replace(
        new RegExp(`\\b${sanitizedOld}\\b`, "g"),
        params.newName
      );
      // SECURITY FIX: Use atomic write
      await writeFile(depFile, depNewContent);
    }

    // Step 4: Write definition file atomically
    await writeFile(defValidation.resolvedPath!, newContent);

    return {
      success: true,
      newContent,
      diff: `Renamed "${params.oldName}" → "${params.newName}" in ${dependents.length + 1} files`,
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

/**
 * Generate unified diff
 */
function generateDiff(oldContent: string, newContent: string): string {
  return generateUnifiedDiff(oldContent, newContent, 3);
}
