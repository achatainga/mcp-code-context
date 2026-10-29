import { describe, it, expect, beforeAll } from "vitest";
import { getAstComplexityMatrix } from "../../../src/operations/astComplexity.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("get_ast_complexity_matrix (v5.6.0 Cognitive & Cyclomatic AST Profiler)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("calculates low complexity for straightforward linear functions", async () => {
    const code = `
function add(a: number, b: number): number {
  return a + b;
}
`;
    const res = await getAstComplexityMatrix({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalFunctionsAnalyzed).toBe(1);
    expect(report.metrics[0].name).toBe("add");
    expect(report.metrics[0].cyclomaticComplexity).toBe(1);
    expect(report.metrics[0].cognitiveComplexity).toBe(0);
    expect(report.metrics[0].riskLevel).toBe("LOW");
  });

  it("detects high cognitive complexity with nested branching & loops", async () => {
    const code = `
function processOrders(orders: any[]): void {
  for (const order of orders) {
    if (order.isValid) {
      if (order.isPaid) {
        for (const item of order.items) {
          if (item.inStock && item.price > 100) {
            console.log("VIP Item", item);
          }
        }
      } else {
        console.warn("Unpaid order");
      }
    }
  }
}
`;
    const res = await getAstComplexityMatrix({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalFunctionsAnalyzed).toBe(1);
    const metric = report.metrics[0];
    expect(metric.name).toBe("processOrders");
    expect(metric.cyclomaticComplexity).toBeGreaterThanOrEqual(6);
    expect(metric.cognitiveComplexity).toBeGreaterThanOrEqual(10);
    expect(metric.maxNestingDepth).toBeGreaterThanOrEqual(3);
    expect(["HIGH", "CRITICAL"]).toContain(metric.riskLevel);
  });

  it("supports threshold filtering", async () => {
    const code = `
function simple() { return 1; }
function complex(x: number) {
  if (x > 0) {
    if (x > 10) return 2;
  }
  return 0;
}
`;
    const res = await getAstComplexityMatrix({ code, threshold: 2, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.metrics.length).toBe(1);
    expect(report.metrics[0].name).toBe("complex");
  });
});
