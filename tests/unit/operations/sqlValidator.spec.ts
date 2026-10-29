import { describe, it, expect, beforeAll } from "vitest";
import { validateSqlAst } from "../../../src/operations/sqlValidator.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("sql_ast_validator (v6.0.0 Embedded SQL WASM Parser & Validator)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("detects valid parameterized SQL queries", async () => {
    const code = `
const query = "SELECT id, name, email FROM users WHERE id = ?";
await db.query(query, [123]);
`;
    const res = await validateSqlAst({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.queriesDetected).toBe(1);
    const f = report.findings[0];
    expect(f.statementType).toBe("SELECT");
    expect(f.tablesReferenced).toContain("users");
    expect(f.isParameterized).toBe(true);
    expect(f.hasUnboundedMutation).toBe(false);
  });

  it("flags dangerous unbounded DELETE without WHERE clause", async () => {
    const code = `
await db.query("DELETE FROM orders");
`;
    const res = await validateSqlAst({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    const f = report.findings[0];
    expect(f.statementType).toBe("DELETE");
    expect(f.hasUnboundedMutation).toBe(true);
    expect(f.syntaxErrors.some((e: string) => e.includes("unbounded DELETE"))).toBe(true);
  });

  it("flags SQL injection interpolation in template string", async () => {
    const code = "const q = `SELECT * FROM accounts WHERE owner_id = ${userId}`;";
    const res = await validateSqlAst({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    const f = report.findings[0];
    expect(f.hasInterpolationWarning).toBe(true);
  });
});
