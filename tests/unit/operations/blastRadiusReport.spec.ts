import { describe, it, expect } from "vitest";
import { generateAstImpactReport, AstImpactReportData } from "../../../src/operations/blastRadiusReport.js";

describe("generate_ast_impact_report (v5.0.0 Cryptographic AST Impact & Blast Radius)", () => {
  const projectRoot = process.cwd();

  it("should reject malicious git refs with command injection attempts", async () => {
    const maliciousRef = "main; rm -rf /; echo pwned";
    const result = await generateAstImpactReport({
      baseBranch: maliciousRef,
      projectRoot,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid base git reference");
  });

  it("should generate a cryptographic report with SHA-256 digest across commits or working tree", async () => {
    const result = await generateAstImpactReport({
      baseBranch: "HEAD~1",
      targetBranch: "HEAD",
      projectRoot,
      includeTests: true,
      includeArchitecture: true,
    });

    expect(result.success).toBe(true);
    const data = JSON.parse(result.content!) as AstImpactReportData;

    expect(data.sha256Digest).toBeDefined();
    expect(data.sha256Digest.length).toBe(64); // SHA-256 hex length
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(data.riskLevel);
    expect(data.markdownReport).toContain("# 🛡️ AST Impact & Blast Radius Audit Report");
    expect(data.markdownReport).toContain(data.sha256Digest);
    expect(data.markdownReport).toContain("Targeted Minimal Test Execution Plan");
  });

  it("should support targetBranch: WORKING_TREE for uncommitted edits", async () => {
    const result = await generateAstImpactReport({
      baseBranch: "HEAD",
      targetBranch: "WORKING_TREE",
      projectRoot,
    });

    expect(result.success).toBe(true);
    const data = JSON.parse(result.content!) as AstImpactReportData;
    expect(data.targetRef).toBe("WORKING_TREE");
    expect(data.sha256Digest).toHaveLength(64);
  });
});
