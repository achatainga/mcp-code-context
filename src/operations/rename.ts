/**
 * Rename symbol operations — AST definition + text-based dependents
 */

import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { BaseParser } from "../parsers/base.js";
import { SecurityValidator } from "../core/validator.js";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";
import { generateUnifiedDiff } from "../utils/diff.js";
import { sanitizeRegexPattern } from "../utils/regexValidator.js";
import { walkDir } from "../utils/fileWalker.js";
import type { WriteResult } from "./write.js";

async function validateRenameParams(params: {
  filePath: string;
  projectRoot: string;
  oldName: string;
}): Promise<{ valid: boolean; error?: string; resolvedPath?: string; sanitizedOld?: string }> {
  const validator = new SecurityValidator(params.projectRoot);
  const defValidation = await validator.validateFilePath(params.filePath);
  if (!defValidation.valid) {
    return { valid: false, error: defValidation.error };
  }
  return {
    valid: true,
    resolvedPath: defValidation.resolvedPath!,
    sanitizedOld: sanitizeRegexPattern(params.oldName),
  };
}

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
      if (importPatterns.some((p) => p.test(fileContent))) {
        dependents.push({ path: fullPath, content: fileContent });
      }
    },
  });

  return dependents;
}

function generateRenameChanges(
  oldName: string,
  newName: string,
  sanitizedOld: string,
  definitionPath: string,
  definitionContent: string,
  definitionNewContent: string,
  dependents: Array<{ path: string; content: string }>
): { pendingWrites: Array<{ filePath: string; newContent: string; originalHash?: string }>; diff: string } {
  const pendingWrites: Array<{ filePath: string; newContent: string; originalHash?: string }> = [];
  const diffParts: string[] = [];

  for (const dep of dependents) {
    const depNewContent = dep.content.replace(new RegExp(`\\b${sanitizedOld}\\b`, "g"), newName);
    pendingWrites.push({
      filePath: dep.path,
      newContent: depNewContent,
      originalHash: createHash("md5").update(dep.content).digest("hex"),
    });
    diffParts.push(`--- ${dep.path}\n${generateUnifiedDiff(dep.content, depNewContent)}`);
  }

  pendingWrites.push({
    filePath: definitionPath,
    newContent: definitionNewContent,
    originalHash: createHash("md5").update(definitionContent).digest("hex"),
  });
  diffParts.push(`--- ${definitionPath}\n${generateUnifiedDiff(definitionContent, definitionNewContent)}`);

  const textWarning =
    dependents.length > 0
      ? `\n⚠️ Dependent files (${dependents.length}) use text-based rename — strings/comments may be affected. Definition file uses AST.`
      : "";
  const consolidatedDiff = `Renamed "${oldName}" \u2192 "${newName}" in ${pendingWrites.length} files${textWarning}\n\n${diffParts.join("\n\n")}`;

  return { pendingWrites, diff: consolidatedDiff };
}

export async function renameSymbol(params: {
  filePath: string;
  projectRoot: string;
  oldName: string;
  newName: string;
  rootDir: string;
  parser: BaseParser;
}): Promise<WriteResult> {
  try {
    const validation = await validateRenameParams({
      filePath: params.filePath,
      projectRoot: params.projectRoot,
      oldName: params.oldName,
    });

    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const { resolvedPath, sanitizedOld } = validation;
    const content = await fs.readFile(resolvedPath!, "utf-8");
    const tree = params.parser.parse(content);
    const symbols = params.parser.findSymbols(tree);

    const targetSymbol = symbols.find((s) => s.name === params.oldName);
    if (!targetSymbol) {
      return { success: false, error: `Symbol "${params.oldName}" not found in ${params.filePath}` };
    }

    const newContent =
      content.substring(0, targetSymbol.startIndex) +
      content
        .substring(targetSymbol.startIndex, targetSymbol.endIndex)
        .replace(new RegExp(`\\b${sanitizedOld}\\b`, "g"), params.newName) +
      content.substring(targetSymbol.endIndex);

    const dependents = await findDependentFiles(params.rootDir, sanitizedOld!, params.projectRoot);
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
      originalHash: createHash("md5").update(content).digest("hex"),
      pendingWrites,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
