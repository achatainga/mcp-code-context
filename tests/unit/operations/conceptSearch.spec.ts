import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";
import { setServerInstances } from "../../../src/tools/context.js";
import {
  splitIdentifier,
  lightStem,
  tokenizeText,
  buildConceptVector,
  calculateConceptSimilarity,
} from "../../../src/utils/conceptEngine.js";
import { searchCodeConcept } from "../../../src/operations/conceptSearch.js";
import { handleSearchCodeConcept } from "../../../src/tools/readHandlers.js";

describe("search_code_concept (v5.0.0 Pure AST Offline Vector Search)", () => {
  let engine: CodeContextEngine;
  let registry: ParserRegistry;
  const projectRoot = path.resolve(__dirname, "../../..");
  const fixturesDir = path.resolve(__dirname, "../../fixtures/typescript");

  beforeAll(async () => {
    engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
    setServerInstances(engine, registry);
  });

  describe("Unit: Concept Tokenizer and Vector Space", () => {
    it("splits camelCase, snake_case, and PascalCase identifiers correctly", () => {
      expect(splitIdentifier("applyVipRebate")).toEqual(["apply", "vip", "rebate"]);
      expect(splitIdentifier("user_auth_token")).toEqual(["user", "auth", "token"]);
      expect(splitIdentifier("OrderCheckoutService")).toEqual(["order", "checkout", "service"]);
    });

    it("applies light stemming on software engineering terms", () => {
      expect(lightStem("discounts")).toBe("discount");
      expect(lightStem("calculating")).toBe("calculat");
      expect(lightStem("deductions")).toBe("deduct");
      expect(lightStem("authentications")).toBe("authenticat");
    });

    it("extracts concept vector and identifies category weights", () => {
      const tokens = tokenizeText("customer loyalty discount calculation promo voucher");
      const vec = buildConceptVector(tokens);
      expect(vec.categoryWeights.DISCOUNT_PRICING).toBeGreaterThan(0);
    });

    it("calculates high similarity between conceptual synonyms without exact term match", () => {
      // Query uses "discount" and "vip"
      const qTokens = tokenizeText("vip customer discount calculation");
      const qVec = buildConceptVector(qTokens);

      // Doc uses "rebate", "loyalty", "deduction", "promo"
      const docTokens = tokenizeText("compute loyalty rebate deduction voucher tier");
      const docVec = buildConceptVector(docTokens);

      const sim = calculateConceptSimilarity(qVec, docVec);
      expect(sim.score).toBeGreaterThan(0.5);
      expect(sim.matchedConcepts).toContain("DISCOUNT_PRICING");
    });
  });

  describe("Integration: AST Conceptual Code Discovery", () => {
    it("discovers computeLoyaltyRebate when searching for 'VIP discount calculation'", async () => {
      const result = await searchCodeConcept({
        rootDir: fixturesDir,
        projectRoot,
        query: "VIP customer discount calculation",
        threshold: 0.25,
        registry,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();

      const jsonStr = result.content!.split("\n\nFound ")[0];
      const parsed = JSON.parse(jsonStr);

      expect(parsed.length).toBeGreaterThan(0);
      const topMatch = parsed[0];
      expect(topMatch.name).toBe("computeLoyaltyRebate");
      expect(topMatch.score).toBeGreaterThanOrEqual(0.3);
      expect(topMatch.rationale).toContain("DISCOUNT_PRICING");
    });

    it("discovers cycleBearerAuth when searching for 'session token expiration and refresh'", async () => {
      const result = await searchCodeConcept({
        rootDir: fixturesDir,
        projectRoot,
        query: "session token expiration and refresh",
        threshold: 0.25,
        registry,
      });

      expect(result.success).toBe(true);
      const jsonStr = result.content!.split("\n\nFound ")[0];
      const parsed = JSON.parse(jsonStr);

      const authMatch = parsed.find((m: any) => m.name === "cycleBearerAuth");
      expect(authMatch).toBeDefined();
      expect(authMatch.rationale).toContain("AUTH_SECURITY");
    });

    it("discovers commitOrderTransaction when searching for 'payment charge invoice settlement'", async () => {
      const result = await searchCodeConcept({
        rootDir: fixturesDir,
        projectRoot,
        query: "payment charge invoice settlement",
        threshold: 0.25,
        registry,
      });

      expect(result.success).toBe(true);
      const jsonStr = result.content!.split("\n\nFound ")[0];
      const parsed = JSON.parse(jsonStr);

      const paymentMatch = parsed.find((m: any) => m.name === "commitOrderTransaction");
      expect(paymentMatch).toBeDefined();
      expect(paymentMatch.score).toBeGreaterThanOrEqual(0.3);
    });

    it("returns empty results for completely unrelated domain queries", async () => {
      const result = await searchCodeConcept({
        rootDir: fixturesDir,
        projectRoot,
        query: "astrophysics quantum gravitation relativistic dark matter",
        threshold: 0.4,
        registry,
      });

      expect(result.success).toBe(true);
      const jsonStr = result.content!.split("\n\nFound ")[0];
      const parsed = JSON.parse(jsonStr);
      expect(parsed.length).toBe(0);
    });
  });

  describe("MCP Handler Execution: handleSearchCodeConcept", () => {
    it("executes cleanly via MCP tool handler with valid output payload", async () => {
      const mcpRes = await handleSearchCodeConcept({
        rootDir: fixturesDir,
        projectRoot,
        query: "membership rebate and promotional deduction",
      });

      expect(mcpRes.content).toBeDefined();
      expect(mcpRes.content[0].type).toBe("text");
      expect(mcpRes.content[0].text).toContain("computeLoyaltyRebate");
      expect(mcpRes.content[0].text).toContain("DISCOUNT_PRICING");
    });
  });
});
