import { describe, it, expect, beforeAll } from "vitest";
import { queryCodeAst, AstQueryReport } from "../../../src/operations/astQuery.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("query_code_ast (v5.5.0 Tree-sitter S-Expression Query DSL)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("should execute custom S-Expression query to find function declarations", async () => {
    const code = `
      function calculateTax(amount, rate) { return amount * rate; }
      function applyDiscount(total) { return total - 10; }
    `;

    const result = await queryCodeAst({
      filePath: "src/billing.ts",
      content: code,
      query: "(function_declaration name: (identifier) @fn_name)",
      registry,
    });

    expect(result.success).toBe(true);
    const jsonPart = result.content!.split("\n\n🎯")[0];
    const report = JSON.parse(jsonPart) as AstQueryReport;

    expect(report.matchesCount).toBe(2);
    expect(report.captures.map(c => c.text)).toEqual(["calculateTax", "applyDiscount"]);
    expect(report.captures[0].captureName).toBe("fn_name");
  });

  it("should match predefined query template 'empty-catch'", async () => {
    const code = `
      try {
        doSomethingDangerous();
      } catch (err) {
      }

      try {
        doSafe();
      } catch (e) {
        console.error(e);
      }
    `;

    const result = await queryCodeAst({
      filePath: "src/danger.ts",
      content: code,
      query: "empty-catch",
      registry,
    });

    expect(result.success).toBe(true);
    const jsonPart = result.content!.split("\n\n🎯")[0];
    const report = JSON.parse(jsonPart) as AstQueryReport;

    expect(report.matchesCount).toBe(1);
    expect(report.captures[0].captureName).toBe("empty_catch");
    expect(report.captures[0].startLine).toBe(4);
  });

  it("should match predefined query template 'excessive-params'", async () => {
    const code = `
      function cleanFunc(a, b) { return a + b; }
      function monsterFunc(p1, p2, p3, p4, p5, p6) { return p1; }
    `;

    const result = await queryCodeAst({
      filePath: "src/params.ts",
      content: code,
      query: "excessive-params",
      registry,
    });

    expect(result.success).toBe(true);
    const jsonPart = result.content!.split("\n\n🎯")[0];
    const report = JSON.parse(jsonPart) as AstQueryReport;

    expect(report.matchesCount).toBeGreaterThanOrEqual(1);
    expect(report.captures.some(c => c.snippet.includes("monsterFunc"))).toBe(true);
  });

  it("should query Python AST using S-Expressions", async () => {
    const pyCode = `
def process_user(user_id):
    return user_id

def delete_account(account_id, force=False):
    pass
`;

    const result = await queryCodeAst({
      filePath: "src/accounts.py",
      content: pyCode,
      query: "(function_definition name: (identifier) @fn)",
      registry,
    });

    expect(result.success).toBe(true);
    const jsonPart = result.content!.split("\n\n🎯")[0];
    const report = JSON.parse(jsonPart) as AstQueryReport;

    expect(report.matchesCount).toBe(2);
    expect(report.captures.map(c => c.text)).toEqual(["process_user", "delete_account"]);
  });

  it("should gracefully handle syntax errors in S-Expression queries", async () => {
    const result = await queryCodeAst({
      filePath: "src/test.ts",
      content: "const x = 1;",
      query: "(invalid_syntax_not_closed",
      registry,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid Tree-sitter S-Expression query syntax");
  });
});
