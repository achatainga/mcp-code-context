import { describe, it, expect, beforeAll } from "vitest";
import { generateAstMocks } from "../../../src/operations/astMockGenerator.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("generate_ast_mocks (v5.6.0 Zero-Hallucination AST Mock Generator)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("generates a typed factory for a TypeScript interface", async () => {
    const code = `
export interface UserProfile {
  id: string;
  username: string;
  age: number;
  isActive: boolean;
  tags: string[];
  bio?: string;
}
`;
    const res = await generateAstMocks({
      code,
      symbolName: "UserProfile",
      format: "factory",
      registry,
    });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.symbolName).toBe("UserProfile");
    expect(report.propertiesCount).toBe(6);
    expect(report.mockCode).toContain("export const createMockUserProfile = (overrides?: Partial<UserProfile>): UserProfile => ({");
    expect(report.mockCode).toContain('id: "mock_id"');
    expect(report.mockCode).toContain("age: 100");
    expect(report.mockCode).toContain("isActive: true");
    expect(report.mockCode).toContain("tags: []");
    expect(report.mockCode).toContain("...overrides");
  });

  it("generates a fixture object format", async () => {
    const code = `
export interface OrderItem {
  sku: string;
  quantity: number;
}
`;
    const res = await generateAstMocks({
      code,
      symbolName: "OrderItem",
      format: "fixture",
      registry,
    });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.mockCode).toContain("export const mockOrderItem: OrderItem = {");
    expect(report.mockCode).toContain('sku: "mock_sku"');
    expect(report.mockCode).toContain("quantity: 100");
  });

  it("generates inline json format", async () => {
    const code = `
export interface Config {
  host: string;
  port: number;
  enabled: boolean;
}
`;
    const res = await generateAstMocks({
      code,
      symbolName: "Config",
      format: "inline_json",
      registry,
    });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    const parsed = JSON.parse(report.mockCode);
    expect(parsed.host).toBe("mock_host");
    expect(parsed.port).toBe(100);
    expect(parsed.enabled).toBe(true);
  });
});
