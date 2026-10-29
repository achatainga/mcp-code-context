import { describe, it, expect, beforeAll } from "vitest";
import { incrementalAstDiff, IncrementalAstDiffReport } from "../../../src/operations/incrementalDiff.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("incremental_ast_diff (v5.5.0 WASM Incremental AST Re-Parsing)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("should incrementally re-parse a clean method modification in sub-milliseconds", async () => {
    const oldCode = `
      export class PaymentGateway {
        public processCharge(amount: number): boolean {
          const fee = amount * 0.02;
          return amount > 0;
        }
      }
    `;

    const newCode = `
      export class PaymentGateway {
        public processCharge(amount: number): boolean {
          const fee = amount * 0.03;
          return amount > 10;
        }
      }
    `;

    const result = await incrementalAstDiff({
      filePath: "src/billing/payment.ts",
      oldContent: oldCode,
      newContent: newCode,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n✅")[0];
    const report = JSON.parse(jsonStr) as IncrementalAstDiffReport;

    expect(report.isSyntaxValid).toBe(true);
    expect(report.hasErrors).toBe(false);
    expect(report.errorNodesCount).toBe(0);
    expect(report.reparseDurationMs).toBeLessThan(50);
    expect(report.affectedNode.symbolName).toBe("processCharge");
    expect(report.affectedNode.enclosingScope).toContain("method_definition processCharge");
  });

  it("should detect syntax error introduced by incomplete edit", async () => {
    const oldCode = `function calculate() { return 42; }`;
    const newCode = `function calculate() { return 42 + ; }`; // Syntax error

    const result = await incrementalAstDiff({
      filePath: "src/math.ts",
      oldContent: oldCode,
      newContent: newCode,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n⚠️")[0];
    const report = JSON.parse(jsonStr) as IncrementalAstDiffReport;

    expect(report.isSyntaxValid).toBe(false);
    expect(report.hasErrors).toBe(true);
    expect(report.errorNodesCount).toBeGreaterThan(0);
    expect(report.summary).toContain("Syntax Error introduced");
  });

  it("should incrementally re-parse Python function modifications", async () => {
    const oldCode = `
def compute_metrics(data):
    total = sum(data)
    return total
`;

    const newCode = `
def compute_metrics(data):
    total = sum(data) * 1.05
    return total
`;

    const result = await incrementalAstDiff({
      filePath: "src/stats.py",
      oldContent: oldCode,
      newContent: newCode,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n✅")[0];
    const report = JSON.parse(jsonStr) as IncrementalAstDiffReport;

    expect(report.isSyntaxValid).toBe(true);
    expect(report.hasErrors).toBe(false);
    expect(report.affectedNode.symbolName).toBe("compute_metrics");
  });
});
