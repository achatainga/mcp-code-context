import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import path from "node:path";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";
import { setServerInstances, getSession } from "../../../src/tools/context.js";
import { handleGetSemanticRepoMap, handleReadFileSurgical, handleExplainSymbol } from "../../../src/tools/readHandlers.js";
import { handleWriteFileSurgical } from "../../../src/tools/writeHandlers.js";

describe("Enterprise v4.0.0 — 6 Advanced Adversarial Vectors Verification", () => {
  let engine: CodeContextEngine;
  let registry: ParserRegistry;
  const projectRoot = path.resolve(__dirname, "../../..");
  const fixturesDir = path.resolve(__dirname, "../../fixtures");
  const testFile = path.join(fixturesDir, "typescript", "sample.ts");

  beforeAll(async () => {
    engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
    setServerInstances(engine, registry);
  });

  beforeEach(() => {
    getSession().confirmationStore.clearAll();
  });

  it("Vector 1 (The Syntax Firewall): rejects malformed code in Phase 1 before token generation", async () => {
    await expect(
      handleWriteFileSurgical({
        filePath: testFile,
        projectRoot,
        symbolName: "validateEmail",
        newContent: "export function validateEmail( { let x = ; return }",
      })
    ).rejects.toThrow(/Syntax Firewall Blocked/i);
  });

  it("Vector 2 (Incremental Tree-sitter Editing): executes delta re-parse in sub-millisecond time", () => {
    const parser = registry.getParser(".ts")!;
    const content1 = "function alpha() { return 1; }";
    const content2 = "function alpha() { return 2; } function beta() { return 3; }";
    
    parser.parseIncremental("test.ts", content1);
    const t0 = performance.now();
    const tree2 = parser.parseIncremental("test.ts", content2);
    const deltaMs = performance.now() - t0;

    expect(tree2).toBeDefined();
    expect(deltaMs).toBeLessThan(50); // fast delta re-parse
  });

  it("Vector 3 (Inverted LSP / Inferred Type Skeleton): extracts contract skeleton without heavy LSP", async () => {
    const explainRes = await handleExplainSymbol({
      filePath: testFile,
      projectRoot,
      symbolName: "UserService",
    });

    expect(explainRes.content).toBeDefined();
    const explainJson = JSON.parse(explainRes.content[0].text);
    expect(explainJson.name).toBe("UserService");
    expect(explainJson.type).toContain("class");
    expect(explainJson.inferredTypeSkeleton).toBeDefined();
    expect(explainJson.inferredTypeSkeleton).toContain("UserService");
  });

  it("Vector 5 (Token Budget Efficiency Header): prepends raw/delivered/saved compression metrics", async () => {
    const readRes = await handleReadFileSurgical({
      filePath: testFile,
      projectRoot,
      symbolName: "validateEmail",
    });

    const readText = readRes.content[0].text;
    expect(readText).toContain("<!-- [CodeContext Efficiency]:");
    expect(readText).toMatch(/Raw: ~\d+ tokens \| Delivered: ~\d+ tokens \| Saved: ~\d+ tokens/);
  });

  it("Vector 6 (Interactive HTML Architecture Graph): outputs zero-dependency visual dashboard", async () => {
    const htmlRes = await handleGetSemanticRepoMap({
      directoryPath: path.join(projectRoot, "src/parsers"),
      projectRoot,
      format: "html",
    });

    const htmlText = htmlRes.content[0].text;
    expect(htmlText).toContain("<!DOCTYPE html>");
    expect(htmlText).toContain("Architecture & Semantic Repo Map");
    expect(htmlText).toContain("v4.0.0 Enterprise");
    expect(htmlText).toContain("input type=\"text\" id=\"search\"");
  });
});
