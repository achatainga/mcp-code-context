import { describe, it, expect, beforeAll } from "vitest";
import { verifyEnvContractDrift } from "../../../src/operations/envContract.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("verify_env_contract_drift (v7.0.0 Env Var AST Drift & Parity Verifier)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("detects undocumented environment variables in TypeScript", async () => {
    const code = `
const apiKey = process.env.STRIPE_API_KEY;
const port = process.env.PORT || 3000;
const secret = process.env.UNDOCUMENTED_SECRET;
`;
    const envExample = `
PORT=8080
STRIPE_API_KEY=sk_test_123
UNUSED_DATABASE_URL=postgres://localhost:5432
`;
    const res = await verifyEnvContractDrift({
      code,
      envExampleContent: envExample,
      registry,
    });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalReferencedInCode).toBe(3);
    expect(report.undocumentedInCode).toContain("UNDOCUMENTED_SECRET");
    expect(report.zombieInExample).toContain("UNUSED_DATABASE_URL");
    expect(report.coveragePercent).toBe(67);
  });

  it("extracts Python os.getenv and os.environ calls", async () => {
    const code = `
import os
binance_key = os.getenv("BINANCE_API_KEY")
binance_secret = os.environ["BINANCE_SECRET"]
`;
    const envExample = `
BINANCE_API_KEY=your_key_here
BINANCE_SECRET=your_secret_here
`;
    const res = await verifyEnvContractDrift({
      code,
      filePath: "config.py",
      envExampleContent: envExample,
      registry,
    });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalReferencedInCode).toBe(2);
    expect(report.undocumentedInCode.length).toBe(0);
    expect(report.coveragePercent).toBe(100);
  });
});
