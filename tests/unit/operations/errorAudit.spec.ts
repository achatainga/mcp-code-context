import { describe, it, expect, beforeAll } from "vitest";
import { auditErrorHandlingContracts } from "../../../src/operations/errorAudit.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("audit_error_handling_contracts (v7.0.0 AST Exception & Error Swallowing Guard)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("flags empty catch blocks as CRITICAL", async () => {
    const code = `
try {
  doDangerousOperation();
} catch (e) {
  // swallowed
}
`;
    const res = await auditErrorHandlingContracts({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalCatchBlocks).toBe(1);
    expect(report.riskyCatchBlocks).toBe(1);
    expect(report.findings[0].findingType).toBe("EMPTY_CATCH");
    expect(report.findings[0].severity).toBe("CRITICAL");
  });

  it("certifies clean catch blocks with structured logging or rethrow", async () => {
    const code = `
try {
  doWork();
} catch (error) {
  console.error("Operation failed", error);
  throw error;
}
`;
    const res = await auditErrorHandlingContracts({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalCatchBlocks).toBe(1);
    expect(report.riskyCatchBlocks).toBe(0);
    expect(report.resilienceScore).toBe(100);
  });
});
