import { describe, it, expect, beforeAll } from "vitest";
import { compactContextLedger, ContextCompactorReport } from "../../../src/operations/contextCompactor.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("compact_context_ledger (v4.7.0 Lossless AST Context Compactor)", () => {
  let registry: ParserRegistry;
  const projectRoot = "C:/code/my-app";

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("should compress TypeScript classes and functions to contract outlines with >60% token savings", async () => {
    const tsCode = `
      export interface UserSession {
        id: string;
        roles: string[];
      }

      export class OrderManager {
        private dbConnection: string = "postgres://...";

        constructor(private session: UserSession) {}

        public async calculateTotal(orderId: string, items: Array<{ id: string; price: number }>): Promise<number> {
          let sum = 0;
          for (const item of items) {
            sum += item.price;
            console.log("Adding item: " + item.id);
          }
          if (sum > 1000) {
            sum = sum * 0.9;
          }
          return sum;
        }

        private logAudit(action: string): void {
          const timestamp = Date.now();
          console.log("[AUDIT] " + action + " at " + timestamp);
        }
      }
    `;

    const result = await compactContextLedger({
      filePaths: ["src/services/orderManager.ts"],
      projectRoot,
      content: tsCode,
      registry,
    });

    expect(result.success).toBe(true);
    const report = JSON.parse(result.content!) as ContextCompactorReport;

    expect(report.filesCount).toBe(1);
    expect(report.overallSavingsPercentage).toBeGreaterThan(40);

    const file = report.files[0];
    expect(file.astOutline).toContain("export interface UserSession");
    expect(file.astOutline).toContain("public async calculateTotal(orderId: string, items: Array<{ id: string; price: number }>): Promise<number> { /* ... */ }");
    expect(file.astOutline).not.toContain("Adding item:");
  });

  it("should drop private methods when dropPrivate is true", async () => {
    const tsCode = `
      export class SecretService {
        public getPublicToken(): string {
          return "pub-123";
        }
        private getPrivateMasterKey(): string {
          return "super-secret-key-999";
        }
      }
    `;

    const result = await compactContextLedger({
      filePaths: ["src/services/secret.ts"],
      projectRoot,
      content: tsCode,
      dropPrivate: true,
      registry,
    });

    expect(result.success).toBe(true);
    const report = JSON.parse(result.content!) as ContextCompactorReport;

    const outline = report.files[0].astOutline;
    expect(outline).toContain("getPublicToken");
    expect(outline).not.toContain("getPrivateMasterKey");
  });

  it("should compress Python classes and functions to signatures", async () => {
    const pyCode = `
class InvoiceProcessor:
    api_key: str

    def process(self, invoice_id: str, amount: float) -> bool:
        \"\"\"Processes an invoice with payment gateway.\"\"\"
        validation = amount > 0
        if not validation:
            raise ValueError("Invalid amount")
        return True

    def _internal_helper(self):
        print("helper called")
`;

    const result = await compactContextLedger({
      filePaths: ["src/billing/processor.py"],
      projectRoot,
      content: pyCode,
      registry,
    });

    expect(result.success).toBe(true);
    const report = JSON.parse(result.content!) as ContextCompactorReport;

    expect(report.filesCount).toBe(1);
    const outline = report.files[0].astOutline;
    expect(outline).toContain("class InvoiceProcessor:");
    expect(outline).toContain("def process(self, invoice_id: str, amount: float) -> bool:");
    expect(outline).toContain("...");
    expect(outline).not.toContain("raise ValueError");
  });
});
