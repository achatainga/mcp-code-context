/**
 * Source-to-Sink Static AST Taint Analyzer
 * 
 * Traces data flow from untrusted user sources (req.query, req.body, $_GET, etc.)
 * through variable assignments and string interpolations to dangerous execution sinks
 * (db.query, child_process.exec, eval, fs.readFile, innerHTML) without sanitizers.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export type VulnerabilityCategory =
  | "SQL_INJECTION"
  | "COMMAND_INJECTION"
  | "CODE_INJECTION"
  | "PATH_TRAVERSAL"
  | "SSRF"
  | "CROSS_SITE_SCRIPTING";

export interface TaintFinding {
  vulnerabilityType: VulnerabilityCategory;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  source: {
    expression: string;
    variable: string;
    line: number;
  };
  propagationPath: Array<{
    variable: string;
    line: number;
    expression: string;
  }>;
  sink: {
    name: string;
    line: number;
    expression: string;
  };
  isSanitized: boolean;
  recommendation: string;
}

export interface TaintAnalysisReport {
  filePath: string;
  vulnerable: boolean;
  findingsCount: number;
  findings: TaintFinding[];
  analyzedLines: number;
}

// 1. Untrusted Sources (User Input Entry Points)
const TAINT_SOURCES: Array<{ regex: RegExp; name: string }> = [
  { regex: /(?:req|request|ctx\.request)\.(?:query|body|params|headers|cookies)(?:\.([a-zA-Z0-9_$]+)|\[['"]([^'"]+)['"]\])?/, name: "HTTP Request Input" },
  { regex: /\$_(?:GET|POST|REQUEST|COOKIE)\[['"]?([a-zA-Z0-9_$]+)['"]?\]/, name: "PHP Global Input" },
  { regex: /request\.(?:args|form|values|json|headers)\[['"]([a-zA-Z0-9_$]+)['"]\]/, name: "Python Flask/Django Input" },
  { regex: /process\.argv(?:\[\d+\])?/, name: "CLI Argument" },
];

// 2. Dangerous Sinks (Destructive / Execution Endpoints)
const DANGEROUS_SINKS: Array<{
  regex: RegExp;
  category: VulnerabilityCategory;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  name: string;
  recommendation: string;
}> = [
  {
    regex: /(?:db|pool|client|connection|knex|sequelize|prisma)\.(?:query|raw|\$queryRawUnsafe|execute)\s*\(([^)]+)\)/,
    category: "SQL_INJECTION",
    severity: "CRITICAL",
    name: "db.query / raw SQL execution",
    recommendation: "Use parameterized queries ($1, ?), prepared statements, or ORM type-safe query builders.",
  },
  {
    regex: /(?:exec|execSync|spawn|popen|os\.system|subprocess\.(?:call|run|Popen)|shell_exec|system|passthru)\s*\(([^)]+)\)/,
    category: "COMMAND_INJECTION",
    severity: "CRITICAL",
    name: "System Shell / Process Execution",
    recommendation: "Use execFile with argument arrays without subshell, or strictly whitelist allowed inputs.",
  },
  {
    regex: /(?:eval|Function|vm\.runInThisContext|vm\.runInContext)\s*\(([^)]+)\)/,
    category: "CODE_INJECTION",
    severity: "CRITICAL",
    name: "Dynamic Code Evaluation",
    recommendation: "Eliminate eval()/Function() calls; parse structured data using JSON.parse() instead.",
  },
  {
    regex: /(?:fs\.(?:readFile|readFileSync|writeFile|writeFileSync|unlink|unlinkSync)|open|file_get_contents)\s*\(([^,)]+)/,
    category: "PATH_TRAVERSAL",
    severity: "HIGH",
    name: "Filesystem Access (Path Traversal)",
    recommendation: "Normalize paths using path.resolve(), verify against project boundary, or reject path separators ('..', '/').",
  },
  {
    regex: /(?:fetch|axios\.(?:get|post|put|delete)|http\.get|https\.get|requests\.(?:get|post)|curl_exec)\s*\(([^,)]+)/,
    category: "SSRF",
    severity: "HIGH",
    name: "External HTTP Request (SSRF)",
    recommendation: "Validate URLs against a strict whitelist of domains and reject private IP ranges (127.0.0.1, 169.254.x).",
  },
  {
    regex: /(?:res\.(?:send|write)|innerHTML|document\.write|echo)\s*(?:\(([^)]+)\)|=([^;]+))/,
    category: "CROSS_SITE_SCRIPTING",
    severity: "MEDIUM",
    name: "Unescaped DOM / HTML Output",
    recommendation: "Sanitize output using DOMPurify, textContent, or HTML entity escaping.",
  },
];

// 3. Known Sanitizers (Neutralize Taint)
const SANITIZERS = [
  /\bparseInt\s*\(/,
  /\bparseFloat\s*\(/,
  /\bNumber\s*\(/,
  /\bint\s*\(/,
  /\bfloat\s*\(/,
  /\b\(int\)/,
  /\bencodeURIComponent\s*\(/,
  /\bDOMPurify\.sanitize\s*\(/,
  /\bescapeHtml\s*\(/,
  /\bhtmlspecialchars\s*\(/,
  /\bshlex\.quote\s*\(/,
  /\bvalidator\.is[A-Za-z0-9_]+\s*\(/,
];

interface TaintVariable {
  name: string;
  sourceExpression: string;
  sourceLine: number;
  currentExpression: string;
  history: Array<{ variable: string; line: number; expression: string }>;
  isSanitized: boolean;
}

export async function traceTaintFlow(params: {
  filePath: string;
  projectRoot: string;
  sourceParam?: string;
  dangerousSink?: string;
  content?: string;
  registry?: ParserRegistry;
}): Promise<ReadResult> {
  try {
    let content = params.content;

    if (!content) {
      if (!existsSync(params.filePath)) {
        return {
          success: false,
          error: `File does not exist: ${params.filePath}`,
        };
      }
      content = await fs.readFile(params.filePath, "utf-8");
    }

    const lines = content.split("\n");
    const taintedVars = new Map<string, TaintVariable>();
    const findings: TaintFinding[] = [];

    // Optional: If user specified a specific sourceParam, track it as initially tainted
    if (params.sourceParam) {
      taintedVars.set(params.sourceParam, {
        name: params.sourceParam,
        sourceExpression: `Parameter: ${params.sourceParam}`,
        sourceLine: 1,
        currentExpression: params.sourceParam,
        history: [{ variable: params.sourceParam, line: 1, expression: params.sourceParam }],
        isSanitized: false,
      });
    }

    // Step 1: Scan lines for source introductions, variable propagations, and sinks
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineNum = lineIdx + 1;
      const rawLine = lines[lineIdx];
      const trimmed = rawLine.trim();

      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("#")) {
        continue;
      }

      // Check if sanitizer is applied on this line
      const lineHasSanitizer = SANITIZERS.some(s => s.test(trimmed));

      // ── A. Taint Source Detection ──────────────────────────────────────────
      for (const src of TAINT_SOURCES) {
        const srcMatch = trimmed.match(src.regex);
        if (srcMatch) {
          // Check if this source assignment assigns to a variable: const/let/var x = ... or $x = ...
          const assignMatch = trimmed.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(.+)/) ||
                              trimmed.match(/\$([a-zA-Z0-9_]+)\s*=\s*(.+)/);
          if (assignMatch) {
            const varName = assignMatch[1];
            const expr = assignMatch[2];
            taintedVars.set(varName, {
              name: varName,
              sourceExpression: srcMatch[0],
              sourceLine: lineNum,
              currentExpression: expr,
              history: [{ variable: varName, line: lineNum, expression: expr }],
              isSanitized: lineHasSanitizer,
            });
          }
        }
      }

      // ── B. Taint Propagation across Assignments ────────────────────────────
      // If variable Y is assigned an expression containing tainted variable X
      const assignmentMatch = trimmed.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(.+)/) ||
                              trimmed.match(/\$([a-zA-Z0-9_]+)\s*=\s*(.+)/);
      if (assignmentMatch) {
        const targetVar = assignmentMatch[1];
        const assignedExpr = assignmentMatch[2];

        // Check if any currently tainted variable appears in assignedExpr
        for (const [taintedName, taintInfo] of taintedVars.entries()) {
          const varRegex = new RegExp(`\\b${taintedName}\\b`);
          if (varRegex.test(assignedExpr) && targetVar !== taintedName) {
            const isSanitizedNow = taintInfo.isSanitized || lineHasSanitizer;
            taintedVars.set(targetVar, {
              name: targetVar,
              sourceExpression: taintInfo.sourceExpression,
              sourceLine: taintInfo.sourceLine,
              currentExpression: assignedExpr,
              history: [
                ...taintInfo.history,
                { variable: targetVar, line: lineNum, expression: assignedExpr },
              ],
              isSanitized: isSanitizedNow,
            });
          }
        }
      }

      // ── C. Dangerous Sink Detection ─────────────────────────────────────────
      for (const sink of DANGEROUS_SINKS) {
        if (params.dangerousSink && !sink.regex.test(params.dangerousSink) && !sink.category.toLowerCase().includes(params.dangerousSink.toLowerCase())) {
          continue;
        }

        const sinkMatch = trimmed.match(sink.regex);
        if (sinkMatch) {
          const sinkArgs = sinkMatch[1] || sinkMatch[2] || "";

          // Check if any tainted variable is passed to the sink arguments
          for (const [taintedName, taintInfo] of taintedVars.entries()) {
            const varRegex = new RegExp(`\\b${taintedName}\\b`);
            if (varRegex.test(sinkArgs) && !taintInfo.isSanitized && !lineHasSanitizer) {
              findings.push({
                vulnerabilityType: sink.category,
                severity: sink.severity,
                source: {
                  expression: taintInfo.sourceExpression,
                  variable: taintInfo.history[0]?.variable || taintedName,
                  line: taintInfo.sourceLine,
                },
                propagationPath: taintInfo.history,
                sink: {
                  name: sink.name,
                  line: lineNum,
                  expression: trimmed,
                },
                isSanitized: false,
                recommendation: sink.recommendation,
              });
            }
          }
        }
      }
    }

    const report: TaintAnalysisReport = {
      filePath: path.relative(params.projectRoot, params.filePath).replace(/\\/g, "/"),
      vulnerable: findings.length > 0,
      findingsCount: findings.length,
      findings,
      analyzedLines: lines.length,
    };

    const footer = findings.length === 0
      ? `\n\n✅ Taint Flow Audit Clean: Zero un-sanitized source-to-sink vulnerability paths detected across ${lines.length} lines.`
      : `\n\n🚨 VULNERABILITY DETECTED: Found ${findings.length} un-sanitized taint paths reaching dangerous sinks.`;

    return {
      success: true,
      content: JSON.stringify(report, null, 2) + footer,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `trace_taint_flow failed: ${error.message || String(error)}`,
    };
  }
}
