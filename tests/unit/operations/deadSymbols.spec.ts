import { describe, it, expect, beforeAll } from "vitest";
import { detectDeadAstSymbols } from "../../../src/operations/deadSymbols.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("detect_dead_ast_symbols (v5.7.0 AST Reachability & Zombie Export Eliminator)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("identifies unused internal helper function", async () => {
    const code = `
function activeFunction(): number {
  return 42;
}

function deadHelper(): void {
  console.log("I am never called");
}

const res = activeFunction();
`;
    const res = await detectDeadAstSymbols({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    const dead = report.deadSymbols.find((s: any) => s.name === "deadHelper");
    expect(dead).toBeDefined();
    expect(dead.reason).toBe("UNUSED_INTERNAL");
  });

  it("identifies unreachable code after return statement", async () => {
    const code = `
function compute(x: number): number {
  if (x > 10) {
    return x * 2;
    const deadVar = 999;
    console.log("unreachable");
  }
  return x;
}
`;
    const res = await detectDeadAstSymbols({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    const unreachable = report.deadSymbols.filter((s: any) => s.reason === "UNREACHABLE_AFTER_RETURN");
    expect(unreachable.length).toBeGreaterThanOrEqual(1);
  });
});
