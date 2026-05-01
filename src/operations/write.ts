/**
 * Write Operations - v3.6.1
 * FIXES: SecurityValidator in renameSymbol, atomic writes, AST-based positioning
 * CRITICAL: renameSymbol Phase 1 is now pure-functional (no disk writes)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { BaseParser } from "../parsers/base.js";
import { SecurityValidator } from "../core/validator.js";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";
import { generateUnifiedDiff } from "../utils/diff.js";
import { sanitizeRegexPattern } from "../utils/safeRegex.js";
import { walkDir } from "../utils/fileWalker.js";

export interface WriteResult {
  success: boolean;
  newContent?: string;
  error?: string;
  diff?: string;
  originalHash?: string;
  /** Multi-file changes for rename operations (Phase 1 accumulation) */
  pendingWrites?: Array<{ filePath: string; newContent: string }>;
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
 * Validate rename parameters and return validated paths
 */
async function validateRenameParams(params: {
  filePath: string;
  projectRoot: string;
  oldName: string;
}): Promise<{ valid: boolean; error?: string; resolvedPath?: string; sanitizedOld?: string }> {
  const validator = new SecurityValidator(params.projectRoot);
  
  // Validate definition file path
  const defValidation = await validator.validateFilePath(params.filePath);
  if (!defValidation.valid) {
    return { valid: false, error: defValidation.error };
  }
  
  // Sanitize to prevent regex injection
  const sanitizedOld = sanitizeRegexPattern(params.oldName);
  
  return { 
    valid: true, 
    resolvedPath: defValidation.resolvedPath!, 
    sanitizedOld 
  };
}

/**
 * Find all files that depend on the symbol being renamed
 */
async function findDependentFiles(
  rootDir: string,
  sanitizedOldName: string,
  projectRoot: string
): Promise<Array<{ path: string; content: string }>> {
  const dependents: Array<{ path: string; content: string }> = [];
  const validator = new SecurityValidator(projectRoot);
  
  await walkDir(rootDir, {
    extensions: SUPPORTED_EXTENSIONS,
    excludeDirs: EXCLUDE_DIRS,
    onFile: async (fullPath) => {
      const depValidation = await validator.validateFilePath(fullPath);
      if (!depValidation.valid) return;
      
      const fileContent = await fs.readFile(fullPath, "utf-8");
      const importPatterns = [
        new RegExp(`import.*\\b${sanitizedOldName}\\b`, "g"),
        new RegExp(`from.*\\b${sanitizedOldName}\\b`, "g"),
        new RegExp(`require.*\\b${sanitizedOldName}\\b`, "g"),
        new RegExp(`use.*\\b${sanitizedOldName}\\b`, "g"),
      ];
      if (importPatterns.some(p => p.test(fileContent))) {
        dependents.push({ path: fullPath, content: fileContent });
      }
    },
  });
  
  return dependents;
}

/**
 * Generate all rename changes (definition + dependents) and consolidated diff
 */
function generateRenameChanges(
  oldName: string,
  newName: string,
  sanitizedOld: string,
  definitionPath: string,
  definitionContent: string,
  definitionNewContent: string,
  dependents: Array<{ path: string; content: string }>
): { pendingWrites: Array<{ filePath: string; newContent: string }>; diff: string } {
  const pendingWrites: Array<{ filePath: string; newContent: string }> = [];
  const diffParts: string[] = [];
  
  // Accumulate dependent file changes (reuse cached content — no second read)
  for (const dep of dependents) {
    const depNewContent = dep.content.replace(
      new RegExp(`\\b${sanitizedOld}\\b`, "g"),
      newName
    );
    pendingWrites.push({ filePath: dep.path, newContent: depNewContent });
    diffParts.push(`--- ${dep.path}\n${generateDiff(dep.content, depNewContent)}`);
  }
  
  // Accumulate definition file change
  pendingWrites.push({ filePath: definitionPath, newContent: definitionNewContent });
  diffParts.push(`--- ${definitionPath}\n${generateDiff(definitionContent, definitionNewContent)}`);
  
  const consolidatedDiff = `Renamed "${oldName}" \u2192 "${newName}" in ${pendingWrites.length} files\n\n${diffParts.join("\n\n")}`;
  
  return { pendingWrites, diff: consolidatedDiff };
}

/**
 * Rename symbol using AST-aware replacement
 * v3.6.1 - CRITICAL FIX: Pure-functional Phase 1 (no writes to disk)
 * All changes are accumulated in pendingWrites for Phase 2 confirmation.
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
    // Step 1: Validate parameters
    const validation = await validateRenameParams({
      filePath: params.filePath,
      projectRoot: params.projectRoot,
      oldName: params.oldName,
    });
    
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    const { resolvedPath, sanitizedOld } = validation;
    
    // Step 2: Rename in definition file using AST
    const content = await fs.readFile(resolvedPath!, "utf-8");
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
    const newContent = content.substring(0, targetSymbol.startIndex) +
      content.substring(targetSymbol.startIndex, targetSymbol.endIndex)
        .replace(new RegExp(`\\b${sanitizedOld}\\b`, "g"), params.newName) +
      content.substring(targetSymbol.endIndex);
    
    // Step 3: Find dependent files
    const dependents = await findDependentFiles(
      params.rootDir,
      sanitizedOld!,
      params.projectRoot
    );
    
    // Step 4: Generate all changes and consolidated diff
    const { pendingWrites, diff } = generateRenameChanges(
      params.oldName,
      params.newName,
      sanitizedOld!,
      resolvedPath!,
      content,
      newContent,
      dependents
    );
    
    return {
      success: true,
      newContent,
      diff,
      pendingWrites,
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
  return generateUnifiedDiff(oldContent, newContent);
}
