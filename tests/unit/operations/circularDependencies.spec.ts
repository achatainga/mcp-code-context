import { describe, it, expect, beforeAll } from "vitest";
import { detectCircularDependencies } from "../../../src/operations/circularDependencies.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("detect_circular_dependencies (v7.0.0 AST Tarjan Circular Import Detector)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("detects 3-node circular dependency cycle (A -> B -> C -> A)", async () => {
    const filesMap = {
      "src/moduleA.ts": 'import { b } from "./moduleB"; export const a = 1;',
      "src/moduleB.ts": 'import { c } from "./moduleC"; export const b = 2;',
      "src/moduleC.ts": 'import { a } from "./moduleA"; export const c = 3;',
      "src/moduleD.ts": 'import { a } from "./moduleA"; export const d = 4;', // Clean leaf node
    };

    const res = await detectCircularDependencies({ filesMap, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalFilesAnalyzed).toBe(4);
    expect(report.totalCyclesFound).toBe(1);
    const cycle = report.cycles[0];
    expect(cycle.cycleLength).toBe(3);
    expect(cycle.cyclePath).toContain("src/moduleA");
    expect(cycle.cyclePath).toContain("src/moduleB");
    expect(cycle.cyclePath).toContain("src/moduleC");
    expect(cycle.recommendation).toContain("Break circular dependency");
  });

  it("passes cleanly when there are no dependency cycles", async () => {
    const filesMap = {
      "src/leaf.ts": "export const leaf = 10;",
      "src/service.ts": 'import { leaf } from "./leaf"; export const service = leaf + 1;',
      "src/index.ts": 'import { service } from "./service"; console.log(service);',
    };

    const res = await detectCircularDependencies({ filesMap, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalCyclesFound).toBe(0);
  });
});
