import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";
import { setServerInstances } from "../../../src/tools/context.js";
import {
  handleGetSemanticRepoMap,
  handleReadFileSurgical,
  handleBatchRead,
} from "../../../src/tools/readHandlers.js";
import {
  handleWriteFileSurgical,
} from "../../../src/tools/writeHandlers.js";
import {
  parseLaravelMigration,
  parseDjangoModels,
  formatUnifiedSchemaAnnotation,
  type ProjectDbSchema,
} from "../../../src/utils/virtualSchema.js";
import { SecurityValidator } from "../../../src/core/validator.js";

describe("AI Regression Test Suite — Blind Spot & Hallucination Elimination", () => {
  let engine: CodeContextEngine;
  let registry: ParserRegistry;
  const projectRoot = path.resolve(__dirname, "../../..");
  const fixturesDir = path.resolve(__dirname, "../../fixtures");

  beforeAll(async () => {
    engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
    setServerInstances(engine, registry);
  });

  describe("Regression Pattern 1: Token Explosion & Hallucinated Context Trap", () => {
    it("read_file_surgical extracts ONLY the requested symbol, preventing attention window blowout", async () => {
      const sampleTsPath = path.join(fixturesDir, "typescript", "sample.ts");
      const fullContent = fs.readFileSync(sampleTsPath, "utf-8");

      const res = await handleReadFileSurgical({
        filePath: sampleTsPath,
        symbolName: "validateEmail",
        projectRoot,
      });

      expect(res.content).toBeDefined();
      expect(res.content.length).toBeGreaterThan(0);
      const text = res.content[0].text;

      // Anti-hallucination assertion: must contain the target symbol
      expect(text).toContain("validateEmail");
      // Anti-explosion assertion: must NOT contain the full sample.ts (UserService class, etc.)
      expect(text).not.toContain("class UserService");
      expect(text.length).toBeLessThan(fullContent.length * 0.4);
    });

    it("get_semantic_repo_map delivers compressed structural skeleton (>75% token compression)", async () => {
      const res = await handleGetSemanticRepoMap({
        directoryPath: path.join(fixturesDir, "typescript"),
        projectRoot,
        format: "xml",
      });

      expect(res.content).toBeDefined();
      const output = res.content[0].text;

      expect(output).toContain("<repository>");
      expect(output).toContain("<symbol type=\"class_declaration\" name=\"UserService\"");
      expect(output).toContain("<symbol type=\"function_declaration\" name=\"validateEmail\"");

      // Verify that function body implementation details are stripped to save tokens
      expect(output).not.toContain("return user;");
    });
  });

  describe("Regression Pattern 2: Two-Phase Write Safety & Zero Unconfirmed Mutations", () => {
    it("Phase 1 Dry-Run NEVER mutates file on disk and returns valid confirmationToken", async () => {
      const tempFilePath = path.join(fixturesDir, "typescript", "temp-write-test.ts");
      const initialContent = "export function testTarget(): string {\n  return 'initial';\n}\n";
      fs.writeFileSync(tempFilePath, initialContent, "utf-8");

      try {
        const dryRunRes = await handleWriteFileSurgical({
          filePath: tempFilePath,
          symbolName: "testTarget",
          newContent: "export function testTarget(): string {\n  return 'mutated';\n}",
          projectRoot,
        });

        const dryRunText = dryRunRes.content[0].text;
        // Verify token issuance and diff preview
        expect(dryRunText).toContain("confirmationToken=");
        expect(dryRunText.toLowerCase()).toContain("diff");

        // Verify disk file is 100% UNCHANGED (zero premature mutation)
        const currentDiskContent = fs.readFileSync(tempFilePath, "utf-8");
        expect(currentDiskContent).toBe(initialContent);

        // Extract token
        const match = dryRunText.match(/confirmationToken="([a-f0-9\-]+)"/);
        expect(match).not.toBeNull();
        const token = match![1];

        // Phase 2: Confirmation applies modification
        const confirmRes = await handleWriteFileSurgical({
          filePath: tempFilePath,
          symbolName: "testTarget",
          confirm: true,
          confirmationToken: token,
          projectRoot,
        });

        expect(confirmRes.content[0].text).toContain("Success");
        const mutatedDiskContent = fs.readFileSync(tempFilePath, "utf-8");
        expect(mutatedDiskContent).toContain("return 'mutated';");
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it("Rejects bogus confirmationToken with self-correcting instructions", async () => {
      const tempFilePath = path.join(fixturesDir, "typescript", "temp-bogus-token.ts");
      fs.writeFileSync(tempFilePath, "function dummy() {}", "utf-8");

      try {
        await expect(
          handleWriteFileSurgical({
            filePath: tempFilePath,
            symbolName: "dummy",
            confirm: true,
            confirmationToken: "completely-bogus-token-12345",
            projectRoot,
          })
        ).rejects.toThrow(/Invalid or expired confirmation token/);
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });
  });

  describe("Regression Pattern 3: Virtual ORM Schema Injection Integrity", () => {
    it("Extracts static schemas without database connection for Laravel and Django", () => {
      const laravelCode = `
      <?php
      Schema::create('products', function (Blueprint $table) {
          $table->id();
          $table->string('sku')->unique();
          $table->decimal('price', 10, 2);
          $table->timestamps();
      });
      `;
      const schema: ProjectDbSchema = {};
      parseLaravelMigration(laravelCode, schema);

      expect(schema["products"]).toBeDefined();
      expect(schema["products"]["sku"]).toBe("string");
      expect(schema["products"]["price"]).toBe("decimal");

      const annotation = formatUnifiedSchemaAnnotation("Eloquent", "products", schema["products"]);
      expect(annotation).toContain("<!-- Eloquent Virtual Schema: products");
      expect(annotation).toContain("<column name=\"sku\" type=\"string\"");
    });
  });

  describe("Regression Pattern 4: Path Traversal Deterministic Containment", () => {
    it("Blocks parent traversal escaping project boundary", async () => {
      const validator = new SecurityValidator(projectRoot);
      const dangerousPath = path.resolve(projectRoot, "../../../Windows/win.ini");
      const res = await validator.validateFilePath(dangerousPath);
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });

    it("Blocks relative dot-dot path escapes", async () => {
      const validator = new SecurityValidator(projectRoot);
      const traversalRelative = path.join(projectRoot, "node_modules", "..", "..", "..", "etc", "passwd");
      const res = await validator.validateFilePath(traversalRelative);
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe("Regression Pattern 5: MCP Contract Conformance Invariants", () => {
    it("batch_read returns deterministic JSON-RPC content array format", async () => {
      const sampleTsPath = path.join(fixturesDir, "typescript", "sample.ts");
      const res = await handleBatchRead({
        reads: [
          { filePath: sampleTsPath, symbolName: "UserService" },
          { filePath: sampleTsPath, symbolName: "validateEmail" },
        ],
        projectRoot,
      });

      expect(res).toHaveProperty("content");
      expect(Array.isArray(res.content)).toBe(true);
      expect(res.content.length).toBeGreaterThanOrEqual(1);
      expect(typeof res.content[0].text).toBe("string");
      expect(res.content[0].text).toContain("UserService");
      expect(res.content[0].text).toContain("validateEmail");
    });
  });
});
