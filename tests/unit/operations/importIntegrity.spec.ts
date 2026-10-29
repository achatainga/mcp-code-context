import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";
import { setServerInstances } from "../../../src/tools/context.js";
import { verifyImportIntegrity } from "../../../src/operations/importIntegrity.js";
import { handleVerifyImportIntegrity } from "../../../src/tools/readHandlers.js";

describe("verify_import_integrity (v5.0.0 Anti-Hallucination Import Verifier)", () => {
  let engine: CodeContextEngine;
  let registry: ParserRegistry;
  const projectRoot = path.resolve(__dirname, "../../..");
  const fixturesDir = path.resolve(__dirname, "../../fixtures/typescript");
  const sampleFile = path.join(fixturesDir, "sample.ts");

  beforeAll(async () => {
    engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
    setServerInstances(engine, registry);
  });

  it("verifies built-in node imports and installed external packages cleanly", async () => {
    const validContent = `
import * as fs from "node:fs/promises";
import * as path from "path";
import initSqlJs from "sql.js";
`;

    const result = await verifyImportIntegrity({
      filePath: sampleFile,
      projectRoot,
      content: validContent,
      registry,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();

    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.valid).toBe(true);
    expect(report.issueCount).toBe(0);
    expect(report.totalImportsChecked).toBe(3);
    expect(report.resolvedImports.some((r: any) => r.type === "builtin")).toBe(true);
    expect(report.resolvedImports.some((r: any) => r.importSource === "sql.js")).toBe(true);
  });

  it("detects UNRESOLVED_PACKAGE when an external library is hallucinated", async () => {
    const hallucinatedPackageContent = `
import { useMagicState } from "react-super-hallucination-pkg-2026";
`;

    const result = await verifyImportIntegrity({
      filePath: sampleFile,
      projectRoot,
      content: hallucinatedPackageContent,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.valid).toBe(false);
    expect(report.issueCount).toBe(1);
    expect(report.issues[0].type).toBe("UNRESOLVED_PACKAGE");
    expect(report.issues[0].importSource).toBe("react-super-hallucination-pkg-2026");
    expect(report.issues[0].message).toContain("neither declared in package.json nor installed in node_modules");
  });

  it("detects UNRESOLVED_PATH when importing a local file that does not exist", async () => {
    const nonExistentLocalContent = `
import { Something } from "./does_not_exist_at_all";
`;

    const result = await verifyImportIntegrity({
      filePath: sampleFile,
      projectRoot,
      content: nonExistentLocalContent,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.valid).toBe(false);
    expect(report.issues[0].type).toBe("UNRESOLVED_PATH");
    expect(report.issues[0].importSource).toBe("./does_not_exist_at_all");
  });

  it("detects MISSING_EXPORT when local file exists but target symbol is not exported", async () => {
    // sample.ts exports: User, UserService, validateEmail.
    // It does NOT export: nonExistentHelperFunction.
    const missingExportContent = `
import { validateEmail, nonExistentHelperFunction } from "./sample";
`;

    const testFileInSameDir = path.join(fixturesDir, "billingService.ts");
    const result = await verifyImportIntegrity({
      filePath: testFileInSameDir,
      projectRoot,
      content: missingExportContent,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.valid).toBe(false);
    expect(report.issues.length).toBe(1);
    expect(report.issues[0].type).toBe("MISSING_EXPORT");
    expect(report.issues[0].symbolName).toBe("nonExistentHelperFunction");
    expect(report.issues[0].suggestion).toContain("validateEmail");
  });

  it("passes when all local named exports match actual AST exports", async () => {
    const validNamedExportContent = `
import { validateEmail, UserService } from "./sample";
`;

    const testFileInSameDir = path.join(fixturesDir, "billingService.ts");
    const result = await verifyImportIntegrity({
      filePath: testFileInSameDir,
      projectRoot,
      content: validNamedExportContent,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.valid).toBe(true);
    expect(report.issueCount).toBe(0);
  });

  it("executes cleanly via MCP tool handler handleVerifyImportIntegrity", async () => {
    const mcpRes = await handleVerifyImportIntegrity({
      filePath: sampleFile,
      projectRoot,
      content: `import { calculateSomething } from "phantom-package-xyz";`,
    });

    expect(mcpRes.content).toBeDefined();
    expect(mcpRes.content[0].text).toContain("UNRESOLVED_PACKAGE");
    expect(mcpRes.content[0].text).toContain("phantom-package-xyz");
  });
});
