import { describe, it, expect, beforeAll } from "vitest";
import { resolveLexicalScope } from "../../../src/operations/lexicalScope.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("resolve_lexical_scope (v5.7.0 Scope-Aware Semantic Renamer & Shadowing Guard)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("detects variable shadowing in nested closures", async () => {
    const code = `
const total = 100;

function calculate(items: any[]) {
  const total = items.length;
  return total;
}
`;
    const res = await resolveLexicalScope({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.shadowingIncidents.length).toBeGreaterThanOrEqual(1);
    const incident = report.shadowingIncidents[0];
    expect(incident.identifier).toBe("total");
    expect(incident.warning).toContain("shadows outer declaration");
  });

  it("validates safe renames vs collision detection", async () => {
    const code = `
function demo() {
  const existingId = "abc";
  const oldVal = 123;
  return oldVal;
}
`;
    // Attempt collision rename
    const collRes = await resolveLexicalScope({
      code,
      proposedRename: {
        targetSymbol: "oldVal",
        newSymbolName: "existingId",
        atLine: 4,
      },
      registry,
    });
    expect(collRes.success).toBe(true);
    const collReport = JSON.parse(collRes.content!);
    expect(collReport.canSafelyRename).toBe(false);
    expect(collReport.renameCollisionWarning).toContain("Cannot safely rename");

    // Safe rename
    const safeRes = await resolveLexicalScope({
      code,
      proposedRename: {
        targetSymbol: "oldVal",
        newSymbolName: "freshName",
        atLine: 4,
      },
      registry,
    });
    expect(safeRes.success).toBe(true);
    const safeReport = JSON.parse(safeRes.content!);
    expect(safeReport.canSafelyRename).toBe(true);
  });
});
