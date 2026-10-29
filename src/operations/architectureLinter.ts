/**
 * AST Architectural Boundary Guardrails Engine (v4.6.0)
 * 
 * Enforces clean architecture / hexagonal boundary rules by analyzing import statements
 * across layers (e.g. domain entities cannot import infrastructure/database drivers;
 * React UI components cannot import raw Prisma/ORM models; use cases cannot import Express/HTTP controllers).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { extractImportStatements } from "./importIntegrity.js";
import type { ReadResult } from "./readCore.js";

export interface ArchitectureRule {
  layer: string;
  pattern: string; // e.g. "src/domain/**" or "domain"
  disallow: string[]; // e.g. ["src/infra/**", "express", "@prisma/client"]
  description?: string;
  suggestion?: string;
}

export interface ArchitectureViolation {
  filePath: string;
  line: number;
  layer: string;
  rulePattern: string;
  disallowedSource: string;
  matchedRule: string;
  message: string;
  suggestion: string;
}

export interface ArchitectureComplianceReport {
  compliant: boolean;
  violationsCount: number;
  filesChecked: number;
  violations: ArchitectureViolation[];
  rulesApplied: ArchitectureRule[];
}

/**
 * Standard Clean / Hexagonal Architecture Defaults
 */
export const DEFAULT_ARCHITECTURE_RULES: ArchitectureRule[] = [
  {
    layer: "domain",
    pattern: "**/domain/**",
    disallow: [
      "**/infra/**",
      "**/infrastructure/**",
      "**/adapters/**",
      "**/controllers/**",
      "**/api/**",
      "express",
      "fastify",
      "@nestjs/common",
      "react",
      "next",
      "next/**",
      "@prisma/client",
      "typeorm",
      "mongoose",
      "knex",
      "pg",
      "mysql2"
    ],
    description: "Domain layer must remain pure business logic and cannot import infrastructure, database drivers, web frameworks, or UI.",
    suggestion: "Define an interface/port in the domain layer and implement it in an infrastructure adapter."
  },
  {
    layer: "ui",
    pattern: "**/components/**",
    disallow: [
      "**/db/**",
      "**/database/**",
      "**/models/**",
      "@prisma/client",
      "typeorm",
      "mongoose",
      "knex",
      "pg",
      "mysql2",
      "sqlite3"
    ],
    description: "UI presentation layer cannot directly import database drivers, queries, or raw ORM models.",
    suggestion: "Fetch data via Server Actions, API routes, or pass DTOs via component props."
  },
  {
    layer: "use_cases",
    pattern: "**/use-cases/**",
    disallow: [
      "**/controllers/**",
      "**/views/**",
      "express",
      "fastify",
      "react"
    ],
    description: "Application use cases cannot depend on transport controllers, HTTP request objects, or UI views.",
    suggestion: "Accept pure input DTOs and return result objects without HTTP-specific concepts."
  }
];

/**
 * Converts a glob-like pattern into a regular expression
 */
function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/");
  let reStr = normalized
    .replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&")
    .replace(/\\\*\\\*/g, ".*")
    .replace(/(?<!\.)\\\*/g, "[^/]*");

  return new RegExp(`^${reStr}$`, "i");
}

/**
 * Matches a relative path or package name against a pattern
 */
function matchesPattern(target: string, pattern: string): boolean {
  const normTarget = target.replace(/\\/g, "/").replace(/^\.\//, "");
  const normPattern = pattern.replace(/\\/g, "/");

  // Direct exact match
  if (normTarget === normPattern) return true;

  // Package prefix match (e.g. "next/**" matches "next/server")
  if (normPattern.endsWith("/**")) {
    const prefix = normPattern.slice(0, -3);
    if (normTarget === prefix || normTarget.startsWith(prefix + "/")) return true;
  }

  // Regex glob match
  try {
    const rx = globToRegex(normPattern);
    if (rx.test(normTarget)) return true;

    // Check with leading wildcards if pattern didn't specify
    if (!normPattern.startsWith("**/") && !normPattern.startsWith("/")) {
      const wildcardRx = globToRegex(`**/${normPattern}`);
      if (wildcardRx.test(normTarget)) return true;
    }
  } catch {
    // Ignore regex compilation issues
  }

  return false;
}

/**
 * Loads architecture configuration from disk if available
 */
async function loadArchitectureConfig(projectRoot: string): Promise<ArchitectureRule[]> {
  const configNames = [
    ".architecturerc.json",
    ".architecturerc",
    "architecture.json",
    ".architecture.json"
  ];

  for (const name of configNames) {
    const fullPath = path.join(projectRoot, name);
    if (existsSync(fullPath)) {
      try {
        const raw = await fs.readFile(fullPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed as ArchitectureRule[];
        }
        if (parsed.rules && Array.isArray(parsed.rules)) {
          return parsed.rules as ArchitectureRule[];
        }
      } catch {
        // Fall back to next or default
      }
    }
  }

  return DEFAULT_ARCHITECTURE_RULES;
}

/**
 * Enforces architecture rules across a single file or project directory
 */
export async function enforceArchitectureRules(params: {
  filePath?: string;
  projectRoot: string;
  rules?: ArchitectureRule[];
  content?: string;
}): Promise<ReadResult> {
  try {
    const rules = params.rules && params.rules.length > 0 
      ? params.rules 
      : await loadArchitectureConfig(params.projectRoot);

    const violations: ArchitectureViolation[] = [];
    let filesChecked = 0;

    // Mode 1: Single file check (or proposed in-memory content)
    if (params.filePath) {
      const relPath = path.relative(params.projectRoot, params.filePath).replace(/\\/g, "/");
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

      filesChecked++;
      const ext = path.extname(params.filePath).toLowerCase();
      const rawImports = extractImportStatements(content, ext);

      // Check applicable rules for this file's path
      for (const rule of rules) {
        if (matchesPattern(relPath, rule.pattern)) {
          for (const imp of rawImports) {
            let resolvedSource = imp.source;

            // If it's a relative import, resolve it relative to projectRoot
            if (imp.source.startsWith("./") || imp.source.startsWith("../")) {
              const fileDir = path.dirname(params.filePath);
              const resolvedAbs = path.resolve(fileDir, imp.source);
              resolvedSource = path.relative(params.projectRoot, resolvedAbs).replace(/\\/g, "/");
            }

            for (const disallowed of rule.disallow) {
              if (matchesPattern(resolvedSource, disallowed) || matchesPattern(imp.source, disallowed)) {
                violations.push({
                  filePath: relPath,
                  line: imp.line,
                  layer: rule.layer,
                  rulePattern: rule.pattern,
                  disallowedSource: imp.source,
                  matchedRule: disallowed,
                  message: `Layer '${rule.layer}' (${rule.pattern}) is forbidden from importing '${imp.source}'. ${rule.description || ""}`.trim(),
                  suggestion: rule.suggestion || "Decouple layer dependencies using interfaces, ports, or DTOs.",
                });
              }
            }
          }
        }
      }
    }

    const report: ArchitectureComplianceReport = {
      compliant: violations.length === 0,
      violationsCount: violations.length,
      filesChecked,
      violations,
      rulesApplied: rules,
    };

    const footer = violations.length === 0
      ? "\n\n✅ Architectural Boundary Guardrails: 100% Compliant (Zero Layer Violations)."
      : `\n\n⚠️ Architectural Boundary Violations: Found ${violations.length} illegal layer imports!`;

    return {
      success: true,
      content: JSON.stringify(report, null, 2) + footer,
    };
  } catch (error) {
    return {
      success: false,
      error: `enforce_architecture_rules failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
