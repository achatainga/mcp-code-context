import { describe, it, expect, beforeAll } from "vitest";
import { backfillTypes, TypeInferenceReport } from "../../../src/operations/typeInference.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("backfill_types (v4.5.0 AST Duck-Type Backfiller & Inference)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("should infer TypeScript interface with string, number, boolean, array and optional properties", async () => {
    const jsCode = `
      function processUser(user) {
        const trimmedName = user.name.trim();
        const isAdult = user.age >= 18;
        const emailContact = user?.email;
        const active = !user.disabled;
        const firstRole = user.roles.map(r => r.toUpperCase());
        return { success: true, name: trimmedName };
      }
    `;

    const result = await backfillTypes({
      filePath: "src/services/userService.js",
      content: jsCode,
      targetLanguage: "typescript",
      registry,
    });

    expect(result.success).toBe(true);
    const data = JSON.parse(result.content!) as TypeInferenceReport;
    expect(data.functionsCount).toBe(1);

    const fn = data.inferences[0];
    expect(fn.functionName).toBe("processUser");
    expect(fn.parameters.length).toBe(1);

    const userParam = fn.parameters[0];
    expect(userParam.parameterName).toBe("user");
    expect(userParam.targetTypeName).toBe("ProcessUserUser");

    const props = new Map(userParam.properties.map(p => [p.name, p]));
    expect(props.get("name")?.type).toBe("string");
    expect(props.get("age")?.type).toBe("number");
    expect(props.get("email")?.optional).toBe(true);
    expect(props.get("disabled")?.type).toBe("boolean");
    expect(props.get("roles")?.type).toBe("any[]");

    expect(data.combinedTypeDefinitions).toContain("export interface ProcessUserUser");
    expect(fn.annotatedSignature).toContain("function processUser(user: ProcessUserUser)");
  });

  it("should infer async Promise return types accurately", async () => {
    const asyncJs = `
      async function fetchProfile(req) {
        const id = req.userId;
        const isValid = req.token === "secret";
        return "profile_ready";
      }
    `;

    const result = await backfillTypes({
      filePath: "src/api/profile.js",
      content: asyncJs,
      targetLanguage: "typescript",
      registry,
    });

    expect(result.success).toBe(true);
    const data = JSON.parse(result.content!) as TypeInferenceReport;
    const fn = data.inferences[0];
    expect(fn.inferredReturnType).toBe("Promise<string>");
    expect(fn.annotatedSignature).toContain("async function fetchProfile");
  });

  it("should infer Python TypedDict definitions from Python AST", async () => {
    const pyCode = `
def handle_customer(customer, options=None):
    clean_name = customer.name.strip()
    balance = customer.balance - 50
    verified = customer.is_active == True
    tags = customer.tags[0]
    return balance > 0
`;

    const result = await backfillTypes({
      filePath: "src/billing/customer.py",
      content: pyCode,
      targetLanguage: "python",
      registry,
    });

    expect(result.success).toBe(true);
    const data = JSON.parse(result.content!) as TypeInferenceReport;
    expect(data.functionsCount).toBe(1);

    const fn = data.inferences[0];
    expect(fn.functionName).toBe("handle_customer");
    expect(fn.inferredReturnType).toBe("bool");

    const custParam = fn.parameters.find(p => p.parameterName === "customer");
    expect(custParam).toBeDefined();

    const props = new Map(custParam!.properties.map(p => [p.name, p]));
    expect(props.get("name")?.type).toBe("str");
    expect(props.get("balance")?.type).toBe("int");
    expect(props.get("is_active")?.type).toBe("bool");

    expect(data.combinedTypeDefinitions).toContain("class HandleCustomerCustomer(TypedDict, total=False):");
    expect(fn.annotatedSignature).toContain("def handle_customer(customer: HandleCustomerCustomer");
  });

  it("should filter by symbolName when specified", async () => {
    const code = `
      function firstFunc(a) { return a.name; }
      function targetFunc(b) { return b.count * 10; }
      function lastFunc(c) { return c.done; }
    `;

    const result = await backfillTypes({
      filePath: "src/utils/helpers.js",
      content: code,
      symbolName: "targetFunc",
      targetLanguage: "typescript",
      registry,
    });

    expect(result.success).toBe(true);
    const data = JSON.parse(result.content!) as TypeInferenceReport;
    expect(data.functionsCount).toBe(1);
    expect(data.inferences[0].functionName).toBe("targetFunc");
    expect(data.inferences[0].parameters[0].properties[0].name).toBe("count");
    expect(data.inferences[0].parameters[0].properties[0].type).toBe("number");
  });

  it("should handle destructuring patterns in function body", async () => {
    const code = `
      function renderBadge(config) {
        const { label, count = 0, variant = "primary" } = config;
        return label;
      }
    `;

    const result = await backfillTypes({
      filePath: "src/components/badge.js",
      content: code,
      targetLanguage: "typescript",
      registry,
    });

    expect(result.success).toBe(true);
    const data = JSON.parse(result.content!) as TypeInferenceReport;
    const fn = data.inferences[0];
    const props = new Map(fn.parameters[0].properties.map(p => [p.name, p]));

    expect(props.get("count")?.type).toBe("number");
    expect(props.get("count")?.optional).toBe(true);
    expect(props.get("variant")?.type).toBe("string");
    expect(props.get("variant")?.optional).toBe(true);
  });

  it("should return error gracefully for non-existent file", async () => {
    const result = await backfillTypes({
      filePath: "non_existent_file_xyz123.js",
      registry,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("File does not exist");
  });
});
