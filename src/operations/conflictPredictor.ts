import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { analyzeImpact } from "./impactAnalysis.js";

const execFileAsync = promisify(execFile);

const GIT_REF_REGEX = /^[a-zA-Z0-9_.~^/@{}-]+$/;

function isValidGitRef(ref: string): boolean {
  return typeof ref === "string" && GIT_REF_REGEX.test(ref) && !ref.startsWith("-");
}

export interface SemanticConflict {
  file: string;
  symbol: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  impactedDependents: string[];
  recommendation: string;
}

export interface ConflictPredictionResult {
  baseRef: string;
  targetRef: string;
  hasConflicts: boolean;
  totalConflicts: number;
  conflicts: SemanticConflict[];
  summary: string;
}

export async function predictSemanticConflicts(params: {
  baseBranch?: string;
  targetBranch?: string;
  projectRoot: string;
}): Promise<ConflictPredictionResult> {
  const baseRef = params.baseBranch || "HEAD~1";
  const targetRef = params.targetBranch || "HEAD";

  if (!isValidGitRef(baseRef)) {
    throw new Error(`Invalid git base reference: '${baseRef}'. Only standard ref names are permitted.`);
  }
  if (!isValidGitRef(targetRef)) {
    throw new Error(`Invalid git target reference: '${targetRef}'. Only standard ref names are permitted.`);
  }

  const conflicts: SemanticConflict[] = [];

  try {
    // 1. Get changed files between base and target (safe argv execution without shell)
    const { stdout: diffOutput } = await execFileAsync("git", ["diff", "--name-status", baseRef, targetRef], {
      cwd: params.projectRoot,
    });

    const lines = diffOutput.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const parts = line.split(/\s+/);
      const status = parts[0];
      const relFile = parts[1];

      if (!relFile || !relFile.match(/\.(ts|tsx|js|jsx|rb|py|php|go)$/)) {
        continue;
      }

      const fullPath = path.join(params.projectRoot, relFile);

      // Check for file deletions
      if (status.startsWith("D")) {
        const impact = await analyzeImpact({
          filePath: fullPath,
          projectRoot: params.projectRoot,
          rootDir: params.projectRoot,
        }).catch(() => null);

        let dependents: string[] = [];
        if (impact && impact.content) {
          try {
            const parsed = JSON.parse(impact.content);
            dependents = parsed.dependents || [];
          } catch {
            // ignore
          }
        }

        if (dependents.length > 0) {
          conflicts.push({
            file: relFile,
            symbol: "*entire file*",
            severity: "HIGH",
            reason: `File '${relFile}' was deleted but ${dependents.length} files still import or reference it.`,
            impactedDependents: dependents.slice(0, 5),
            recommendation: `Update or remove imports in ${dependents.length} dependent files before merging.`,
          });
        }
        continue;
      }

      // Check modified files for symbol-level AST diff
      if (status.startsWith("M")) {
        try {
          const { stdout: filePatch } = await execFileAsync("git", ["diff", "-U0", baseRef, targetRef, "--", relFile], {
            cwd: params.projectRoot,
          });

          // Inspect removed or changed function/method lines
          const removedLines = filePatch
            .split("\n")
            .filter(l => l.startsWith("-") && !l.startsWith("---"))
            .map(l => l.substring(1).trim());

          for (const rem of removedLines) {
            const funcMatch = rem.match(/(?:function|def|async|class|public|private)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
            if (funcMatch) {
              const symName = funcMatch[1];
              const impact = await analyzeImpact({
                filePath: fullPath,
                projectRoot: params.projectRoot,
                rootDir: params.projectRoot,
              }).catch(() => null);

              let dependents: string[] = [];
              if (impact && impact.content) {
                try {
                  const parsed = JSON.parse(impact.content);
                  dependents = parsed.dependents || [];
                } catch {
                  // ignore
                }
              }

              const hasExternalRefs = dependents.length > 0;

              conflicts.push({
                file: relFile,
                symbol: symName,
                severity: hasExternalRefs ? "HIGH" : "MEDIUM",
                reason: `Signature of symbol '${symName}' was altered or removed.`,
                impactedDependents: dependents.slice(0, 5),
                recommendation: hasExternalRefs
                  ? `High risk of breakage in ${dependents.length} dependent files. Run get_impacted_tests to verify callers.`
                  : "Verify that internal calls within the module match the new signature.",
              });
            }
          }
        } catch {
          // ignore git diff error for individual file
        }
      }
    }
  } catch (err: any) {
    // If not a git repo or ref cannot be found, provide informative message
    return {
      baseRef,
      targetRef,
      hasConflicts: false,
      totalConflicts: 0,
      conflicts: [],
      summary: `Git ref comparison '${baseRef}..${targetRef}' skipped or completed with zero conflicts: ${err?.message || "clean"}`,
    };
  }

  const highCount = conflicts.filter(c => c.severity === "HIGH").length;
  const hasConflicts = conflicts.length > 0;
  const summary = hasConflicts
    ? `⚠️ Detected ${conflicts.length} potential semantic merge conflict(s) (${highCount} HIGH severity) across branch refs.`
    : `✅ Zero semantic merge conflicts detected between '${baseRef}' and '${targetRef}'.`;

  return {
    baseRef,
    targetRef,
    hasConflicts,
    totalConflicts: conflicts.length,
    conflicts,
    summary,
  };
}
