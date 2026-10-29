import { describe, it, expect, beforeAll } from "vitest";
import { astCodemodTranspile } from "../../../src/operations/cstCodemod.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("ast_codemod_transpile (v6.0.0 Lossless CST Structural Codemod Engine)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("transforms CommonJS require to ESM import", async () => {
    const code = `
const path = require("node:path");
const fs = require("node:fs/promises");

module.exports = { path, fs };
`;
    const res = await astCodemodTranspile({
      code,
      rule: "cjs-to-esm",
      registry,
    });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.changesApplied).toBeGreaterThanOrEqual(2);
    expect(report.transformedCode).toContain('import path from "node:path";');
    expect(report.transformedCode).toContain('import fs from "node:fs/promises";');
    expect(report.transformedCode).toContain("export default { path, fs };");
  });

  it("strips console statements cleanly without corrupting other code", async () => {
    const code = `
function calculate(x: number): number {
  console.log("Starting calculation...");
  const y = x * 2;
  console.debug("Intermediate y:", y);
  return y;
}
`;
    const res = await astCodemodTranspile({
      code,
      rule: "strip-console",
      registry,
    });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.changesApplied).toBe(2);
    expect(report.transformedCode).not.toContain('console.log("Starting calculation...");');
    expect(report.transformedCode).toContain("const y = x * 2;");
    expect(report.transformedCode).toContain("return y;");
  });
});
