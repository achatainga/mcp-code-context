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
import { safeRegexAnyTest, safeRegexReplaceAll } from "../utils/safeRegex.js";
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
        `import.*\\b${sanitizedOldName}\\b`,
        `from.*\\b${sanitizedOldName}\\b`,
        `require.*\\b${sanitizedOldName}\\b`,
        `use.*\\b${sanitizedOldName}\\b`,
      ];
      const matchResult = await safeRegexAnyTest(importPatterns, fileContent);
      if (matchResult.timedOut) {
        throw new Error(matchResult.error ?? "Regex timed out finding rename dependents (ReDoS prevented)");
      }
      if (!matchResult.success) {
        throw new Error(matchResult.error ?? "Rename dependent scan failed");
      }
      if (matchResult.matched) {
        dependents.push({ path: fullPath, content: fileContent });
      }
    },
  });

  return dependents;
}

async function generateRenameChanges(
  oldName: string,
  newName: string,
  sanitizedOld: string,
  definitionPath: string,
  definitionContent: string,
  definitionNewContent: string,
  dependents: Array<{ path: string; content: string }>
): Promise<{ pendingWrites: Array<{ filePath: string; newContent: string; originalHash?: string }>; diff: string }> {
  const pendingWrites: Array<{ filePath: string; newContent: string; originalHash?: string }> = [];
  const diffParts: string[] = [];
  const wordPattern = `\\b${sanitizedOld}\\b`;

  for (const dep of dependents) {
    const replaceResult = await safeRegexReplaceAll(wordPattern, newName, dep.content);
    if (replaceResult.timedOut) {
      throw new Error(replaceResult.error ?? "Regex timed out during rename (ReDoS prevented)");
    }
    if (!replaceResult.success || replaceResult.output === undefined) {
      throw new Error(replaceResult.error ?? "Rename replace failed");
    }
    const depNewContent = replaceResult.output;
    pendingWrites.push({
      filePath: dep.path,
      newContent: depNewContent,
      originalHash: createHash("sha256").update(dep.content).digest("hex"),
    });
    diffParts.push(`--- ${dep.path}\n${generateUnifiedDiff(dep.content, depNewContent)}`);
  }

  pendingWrites.push({
    filePath: definitionPath,
    newContent: definitionNewContent,
    originalHash: createHash("sha256").update(definitionContent).digest("hex"),
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

    const symbolSlice = content.substring(targetSymbol.startIndex, targetSymbol.endIndex);
    const symbolReplace = await safeRegexReplaceAll(`\\b${sanitizedOld}\\b`, params.newName, symbolSlice);
    if (symbolReplace.timedOut) {
      return { success: false, error: symbolReplace.error ?? "Regex timed out during rename (ReDoS prevented)" };
    }
    if (!symbolReplace.success || symbolReplace.output === undefined) {
      return { success: false, error: symbolReplace.error ?? "Rename replace failed" };
    }

    const newContent =
      content.substring(0, targetSymbol.startIndex) +
      symbolReplace.output +
      content.substring(targetSymbol.endIndex);

    const dependents = await findDependentFiles(params.rootDir, sanitizedOld!, params.projectRoot);
    const { pendingWrites, diff } = await generateRenameChanges(
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
      originalHash: createHash("sha256").update(content).digest("hex"),
      pendingWrites,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
