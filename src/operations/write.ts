/**
 * Write Operations - v3.0.0
 * Surgical code modifications with Tree-sitter
 */

import Parser from "web-tree-sitter";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseParser } from "../parsers/base.js";
import { SecurityValidator } from "../core/validator.js";

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
 * Replace a symbol with new content
 */
export async function replaceSymbol(options: ReplaceOptions): Promise<WriteResult> {
  const { filePath, projectRoot, symbolName, newContent, className, parser } = options;

  // Validate
  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    // Read file
    const content = await fs.readFile(validation.resolvedPath!, "utf-8");
    
    // Parse
    const tree = parser.parse(content);
    
    // Replace
    const result = parser.replaceSymbol(content, tree, symbolName, newContent, className);
    
    // Generate diff
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
 * Insert code at a specific location
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
      // Find anchor
      const extracted = parser.extractSymbol(tree, anchorSymbol, className);
      if (!extracted) {
        return { success: false, error: `Anchor symbol "${anchorSymbol}" not found` };
      }

      const anchorIndex = content.indexOf(extracted);
      if (anchorIndex === -1) {
        return { success: false, error: "Could not locate anchor in content" };
      }

      switch (position) {
        case "before":
          insertIndex = anchorIndex;
          break;
        case "after":
          insertIndex = anchorIndex + extracted.length;
          break;
        case "inside_start":
          // Find first { after anchor
          insertIndex = content.indexOf("{", anchorIndex) + 1;
          break;
        case "inside_end":
          // Find last } of anchor
          insertIndex = anchorIndex + extracted.lastIndexOf("}");
          break;
        default:
          insertIndex = anchorIndex + extracted.length;
      }
    }

    const result = content.substring(0, insertIndex) + "\n" + code + "\n" + content.substring(insertIndex);
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

    const extracted = parser.extractSymbol(tree, symbolName, className);
    if (!extracted) {
      return { success: false, error: `Symbol "${symbolName}" not found` };
    }

    const index = content.indexOf(extracted);
    if (index === -1) {
      return { success: false, error: "Could not locate symbol in content" };
    }

    const result = content.substring(0, index) + content.substring(index + extracted.length);
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
 * Write content to file (atomic)
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Generate unified diff (simple line-by-line)
 */
function generateDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const diff: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      diff.push(`  ${oldLine || ""}`);
    } else {
      if (oldLine !== undefined) diff.push(`- ${oldLine}`);
      if (newLine !== undefined) diff.push(`+ ${newLine}`);
    }
  }

  return diff.join("\n");
}
