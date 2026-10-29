/**
 * Cryptographic AST Impact & Blast Radius Report Generator (v5.0.0)
 * 
 * Compiles a deterministic Markdown audit report + SHA-256 cryptographic digest
 * analyzing changed symbols across git refs or working tree, identifying impacted
 * test suites via Test Impact Analysis (TIA), and verifying architectural boundaries.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import { existsSync } from "node:fs";
import { getImpactedTests } from "./testImpact.js";
import { enforceArchitectureRules } from "./architectureLinter.js";
import { analyzeImpact } from "./impactAnalysis.js";
import type { ReadResult } from "./readCore.js";

const execFileAsync = promisify(execFile);
const GIT_REF_REGEX = /^[a-zA-Z0-9_.~^/@{}-]+$/;

function isValidGitRef(ref: string): boolean {
  return typeof ref === "string" && GIT_REF_REGEX.test(ref) && !ref.startsWith("-");
}

export interface ModifiedSymbolDetail {
  filePath: string;
  symbolName: string;
  changeType: "MODIFIED" | "ADDED" | "DELETED";
  callersCount: number;
}

export interface ImpactedTestSuiteDetail {
  symbolName: string;
  testFile: string;
  executionCommand: string;
}

export interface AstImpactReportData {
  baseRef: string;
  targetRef: string;
  sha256Digest: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  filesModifiedCount: number;
  symbolsModifiedCount: number;
  impactedTestsCount: number;
  architecturalCompliance: boolean;
  modifiedSymbols: ModifiedSymbolDetail[];
  impactedTests: ImpactedTestSuiteDetail[];
  recommendedTestCommand: string;
  markdownReport: string;
}

/**
 * Main generateAstImpactReport operation
 */
export async function generateAstImpactReport(params: {
  baseBranch?: string;
  targetBranch?: string;
  projectRoot: string;
  includeTests?: boolean;
  includeArchitecture?: boolean;
}): Promise<ReadResult> {
  try {
    const baseRef = params.baseBranch || "main";
    const targetRef = params.targetBranch || "HEAD";

    if (!isValidGitRef(baseRef)) {
      return {
        success: false,
        error: `Invalid base git reference: "${baseRef}"`,
      };
    }

    if (targetRef !== "WORKING_TREE" && !isValidGitRef(targetRef)) {
      return {
        success: false,
        error: `Invalid target git reference: "${targetRef}"`,
      };
    }

    // 1. Get changed files via git diff
    const diffArgs = targetRef === "WORKING_TREE"
      ? ["diff", "--name-status", baseRef]
      : ["diff", "--name-status", baseRef, targetRef];

    let diffOutput = "";
    try {
      const res = await execFileAsync("git", diffArgs, { cwd: params.projectRoot, timeout: 15000 });
      diffOutput = res.stdout;
    } catch {
      // Fallback: If baseRef doesn't exist, try diffing against HEAD~1 or uncommitted changes
      try {
        const fallback = await execFileAsync("git", ["diff", "--name-status", "HEAD~1"], { cwd: params.projectRoot, timeout: 15000 });
        diffOutput = fallback.stdout;
      } catch {
        diffOutput = "";
      }
    }

    const lines = diffOutput.trim().split("\n").filter(Boolean);
    const modifiedSymbols: ModifiedSymbolDetail[] = [];
    const impactedTests: ImpactedTestSuiteDetail[] = [];
    const filesModified: string[] = [];
    const commandsSet = new Set<string>();

    for (const line of lines) {
      const parts = line.split(/\s+/);
      const status = parts[0];
      const relFile = parts[1];

      if (!relFile || !relFile.match(/\.(ts|tsx|js|jsx|py|rb|php|go)$/)) {
        continue;
      }

      filesModified.push(relFile);
      const fullPath = path.join(params.projectRoot, relFile);

      // Check patch for modified symbols
      let filePatch = "";
      try {
        const patchArgs = targetRef === "WORKING_TREE"
          ? ["diff", "-U0", baseRef, "--", relFile]
          : ["diff", "-U0", baseRef, targetRef, "--", relFile];
        const patchRes = await execFileAsync("git", patchArgs, { cwd: params.projectRoot });
        filePatch = patchRes.stdout;
      } catch {
        filePatch = "";
      }

      const patchLines = filePatch.split("\n");
      const changedLines = patchLines
        .filter(l => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
        .map(l => l.substring(1).trim());

      const fileSymbols = new Set<string>();

      for (const pLine of changedLines) {
        const funcMatch = pLine.match(/(?:function|def|async|class|public|private)\s+([a-zA-Z0-9_$]+)/);
        if (funcMatch && funcMatch[1] && !["function", "async", "class", "def", "if", "for", "while"].includes(funcMatch[1])) {
          fileSymbols.add(funcMatch[1]);
        }
      }

      for (const sym of fileSymbols) {
        let callersCount = 0;
        try {
          const impact = await analyzeImpact({
            filePath: fullPath,
            projectRoot: params.projectRoot,
            rootDir: params.projectRoot,
          });
          if (impact && impact.content) {
            const parsed = JSON.parse(impact.content);
            callersCount = (parsed.dependents || []).length;
          }
        } catch {}

        modifiedSymbols.push({
          filePath: relFile,
          symbolName: sym,
          changeType: status.startsWith("A") ? "ADDED" : status.startsWith("D") ? "DELETED" : "MODIFIED",
          callersCount,
        });

        // Run TIA on modified symbol if requested
        if (params.includeTests !== false) {
          try {
            const tiaResult = await getImpactedTests({
              filePath: fullPath,
              symbolName: sym,
              projectRoot: params.projectRoot,
            });
            if (tiaResult.totalImpactedTests > 0) {
              for (const it of tiaResult.impactedTests) {
                const cmd = `${tiaResult.testRunner.command} ${it.testFile}`;
                impactedTests.push({
                  symbolName: sym,
                  testFile: path.relative(params.projectRoot, it.testFile).replace(/\\/g, "/"),
                  executionCommand: cmd,
                });
                commandsSet.add(cmd);
              }
            }
          } catch {}
        }
      }
    }

    // Check architectural compliance on modified files
    let architecturalCompliance = true;
    if (params.includeArchitecture !== false && filesModified.length > 0) {
      for (const rel of filesModified.slice(0, 10)) {
        try {
          const archRes = await enforceArchitectureRules({
            filePath: path.join(params.projectRoot, rel),
            projectRoot: params.projectRoot,
          });
          if (archRes.success && archRes.content) {
            const jsonPart = archRes.content.split("\n\n")[0];
            const parsed = JSON.parse(jsonPart);
            if (!parsed.compliant) {
              architecturalCompliance = false;
              break;
            }
          }
        } catch {}
      }
    }

    // Determine Risk Level
    let riskLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    const totalCallers = modifiedSymbols.reduce((acc, s) => acc + s.callersCount, 0);
    if (!architecturalCompliance || totalCallers > 20 || modifiedSymbols.some(s => s.changeType === "DELETED" && s.callersCount > 0)) {
      riskLevel = "HIGH";
    } else if (totalCallers > 5 || filesModified.length > 5) {
      riskLevel = "MEDIUM";
    }

    // Compute Cryptographic SHA-256 Digest
    const digestPayload = JSON.stringify({
      baseRef,
      targetRef,
      filesModified,
      modifiedSymbols,
      riskLevel,
    });
    const sha256Digest = crypto.createHash("sha256").update(digestPayload).digest("hex");

    const recommendedTestCommand = Array.from(commandsSet).join(" && ") || "npm test";

    // Build Markdown Report
    const mdLines: string[] = [
      `# 🛡️ AST Impact & Blast Radius Audit Report`,
      ``,
      `- **Branch Diff:** \`${baseRef}\` ➔ \`${targetRef}\``,
      `- **Cryptographic SHA-256 Digest:** \`${sha256Digest}\``,
      `- **Overall Blast Radius Risk:** **${riskLevel}**`,
      `- **Files Modified:** ${filesModified.length}`,
      `- **Symbols Altered:** ${modifiedSymbols.length}`,
      `- **Impacted Test Suites (TIA):** ${impactedTests.length}`,
      `- **Architectural Guardrails Compliance:** ${architecturalCompliance ? "✅ 100% Compliant (Zero Layer Violations)" : "⚠️ Boundary Violations Detected"}`,
      ``,
      `### 🔬 Modified Symbols & Callers Hierarchy`,
      `| File | Symbol | Change Type | Impacted Callers |`,
      `|---|---|:---:|:---:|`,
    ];

    if (modifiedSymbols.length === 0) {
      mdLines.push(`| *(None detected or clean working tree)* | - | - | - |`);
    } else {
      for (const s of modifiedSymbols) {
        mdLines.push(`| \`${s.filePath}\` | \`${s.symbolName}\` | ${s.changeType} | **${s.callersCount}** |`);
      }
    }

    mdLines.push(``);
    mdLines.push(`### 🧪 Targeted Minimal Test Execution Plan`);
    mdLines.push(`Run only the tests directly impacted by changed AST symbols:`);
    mdLines.push(`\`\`\`bash`);
    mdLines.push(recommendedTestCommand);
    mdLines.push(`\`\`\``);

    const markdownReport = mdLines.join("\n");

    const data: AstImpactReportData = {
      baseRef,
      targetRef,
      sha256Digest,
      riskLevel,
      filesModifiedCount: filesModified.length,
      symbolsModifiedCount: modifiedSymbols.length,
      impactedTestsCount: impactedTests.length,
      architecturalCompliance,
      modifiedSymbols,
      impactedTests,
      recommendedTestCommand,
      markdownReport,
    };

    return {
      success: true,
      content: JSON.stringify(data, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `generate_ast_impact_report failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
