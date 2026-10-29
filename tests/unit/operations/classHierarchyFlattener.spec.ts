import { describe, it, expect, beforeAll } from "vitest";
import { flattenClassHierarchy } from "../../../src/operations/classHierarchyFlattener.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("flatten_class_hierarchy (v7.0.0 Trait, Mixin & Class Hierarchy Flattener)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("flattens PHP class using traits (from bedrock-cli architecture)", async () => {
    const code = `<?php
trait PluginManagementTrait {
    public function installPlugin(string $slug): bool {
        return true;
    }
}

class ProfileCommand extends BaseCommand {
    use PluginManagementTrait;

    public function execute(): void {
        $this->installPlugin("woocommerce");
    }
}
`;
    const res = await flattenClassHierarchy({
      code,
      className: "ProfileCommand",
      filePath: "ProfileCommand.php",
      registry,
    });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.className).toBe("ProfileCommand");
    expect(report.traitsUsed).toContain("PluginManagementTrait");
    expect(report.totalMethods).toBe(2);
    const selfM = report.methods.find((m: any) => m.name === "execute");
    expect(selfM.source).toBe("self");
    const traitM = report.methods.find((m: any) => m.name === "installPlugin");
    expect(traitM.source).toBe("trait");
    expect(traitM.originName).toBe("PluginManagementTrait");
  });

  it("handles TypeScript / JavaScript classes", async () => {
    const code = `
class OrderService extends BaseService {
  public async createOrder(id: string): Promise<void> {}
  private validateStock(): boolean { return true; }
}
`;
    const res = await flattenClassHierarchy({
      code,
      className: "OrderService",
      filePath: "OrderService.ts",
      registry,
    });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.className).toBe("OrderService");
    expect(report.totalMethods).toBe(2);
  });
});
