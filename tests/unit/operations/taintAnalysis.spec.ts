import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";
import { setServerInstances } from "../../../src/tools/context.js";
import { traceTaintFlow } from "../../../src/operations/taintAnalysis.js";
import { handleTraceTaintFlow } from "../../../src/tools/readHandlers.js";

describe("trace_taint_flow (v5.1.0 Static Source-to-Sink Taint Flow Analyzer)", () => {
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

  it("detects SQL_INJECTION through multi-variable propagation to db.query", async () => {
    const vulnerableSqlCode = `
export async function getUserOrders(req: any, res: any) {
  const userId = req.query.id;
  const query = "SELECT * FROM orders WHERE user_id = " + userId;
  const results = await db.query(query);
  return results;
}
`;

    const result = await traceTaintFlow({
      filePath: sampleFile,
      projectRoot,
      content: vulnerableSqlCode,
      registry,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();

    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.vulnerable).toBe(true);
    expect(report.findingsCount).toBe(1);

    const finding = report.findings[0];
    expect(finding.vulnerabilityType).toBe("SQL_INJECTION");
    expect(finding.severity).toBe("CRITICAL");
    expect(finding.source.variable).toBe("userId");
    expect(finding.sink.name).toContain("db.query");
    expect(finding.propagationPath.length).toBeGreaterThanOrEqual(2);
  });

  it("detects COMMAND_INJECTION from request body to exec()", async () => {
    const vulnerableCommandCode = `
import { exec } from "child_process";

export function handlePing(req: any) {
  const targetHost = req.body.host;
  const command = \`ping -c 4 \${targetHost}\`;
  exec(command);
}
`;

    const result = await traceTaintFlow({
      filePath: sampleFile,
      projectRoot,
      content: vulnerableCommandCode,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.vulnerable).toBe(true);
    const finding = report.findings.find((f: any) => f.vulnerabilityType === "COMMAND_INJECTION");
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("CRITICAL");
    expect(finding.sink.name).toContain("System Shell");
  });

  it("detects PATH_TRAVERSAL when req.params flow directly into fs.readFile", async () => {
    const vulnerablePathCode = `
import * as fs from "fs";

export function downloadUserFile(req: any) {
  const userPath = req.params.filePath;
  const data = fs.readFile(userPath);
}
`;

    const result = await traceTaintFlow({
      filePath: sampleFile,
      projectRoot,
      content: vulnerablePathCode,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.vulnerable).toBe(true);
    const finding = report.findings.find((f: any) => f.vulnerabilityType === "PATH_TRAVERSAL");
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("HIGH");
  });

  it("neutralizes taint and reports clean when input is sanitized via parseInt", async () => {
    const sanitizedCode = `
export async function getSafeOrder(req: any) {
  const rawId = req.query.id;
  const cleanId = parseInt(rawId, 10);
  const sql = \`SELECT * FROM orders WHERE id = \${cleanId}\`;
  await db.query(sql);
}
`;

    const result = await traceTaintFlow({
      filePath: sampleFile,
      projectRoot,
      content: sanitizedCode,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.vulnerable).toBe(false);
    expect(report.findingsCount).toBe(0);
  });

  it("reports clean baseline on secure sample fixture", async () => {
    const result = await traceTaintFlow({
      filePath: sampleFile,
      projectRoot,
      registry,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n")[0];
    const report = JSON.parse(jsonStr);

    expect(report.vulnerable).toBe(false);
    expect(report.findingsCount).toBe(0);
  });

  it("executes cleanly via MCP tool handler handleTraceTaintFlow", async () => {
    const mcpRes = await handleTraceTaintFlow({
      filePath: sampleFile,
      projectRoot,
      content: `
export function dangerousRun(req: any) {
  const cmd = req.query.c;
  exec(cmd);
}
`,
    });

    expect(mcpRes.content).toBeDefined();
    expect(mcpRes.content[0].text).toContain("COMMAND_INJECTION");
    expect(mcpRes.content[0].text).toContain("VULNERABILITY DETECTED");
  });

  it("handles sourceParam containing regex special characters without syntax errors", async () => {
    const result = await traceTaintFlow({
      filePath: sampleFile,
      projectRoot,
      sourceParam: "user[id]",
      dangerousSink: "COMMAND_INJECTION",
      content: `
export function runCustom(param: any) {
  const clean = param;
  exec(clean);
}
`,
      registry,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();
  });
});
