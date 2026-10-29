import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { getImpactedTests, detectTestRunner } from "../../../src/operations/testImpact.js";

describe("Test Impact Analysis (TIA)", () => {
  it("should accurately detect Vitest runner from projectRoot", async () => {
    const runner = await detectTestRunner(process.cwd());
    expect(runner.framework).toBe("Vitest");
    expect(runner.command).toContain("vitest");
  });

  it("should identify impacted tests from modified symbol and source file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tia-test-"));
    try {
      // Create fake package.json
      await fs.writeFile(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }),
        "utf-8"
      );

      // Create fake src/userService.ts
      await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
      const srcFile = path.join(tmpDir, "src", "userService.ts");
      await fs.writeFile(
        srcFile,
        `export class UserService {\n  findUser(id: string) { return id; }\n  deleteUser(id: string) { return true; }\n}`,
        "utf-8"
      );

      // Create fake tests/userService.spec.ts
      await fs.mkdir(path.join(tmpDir, "tests"), { recursive: true });
      const testFile1 = path.join(tmpDir, "tests", "userService.spec.ts");
      await fs.writeFile(
        testFile1,
        `import { UserService } from "../src/userService";\ndescribe("UserService", () => {\n  it("should findUser by id", () => {});\n});`,
        "utf-8"
      );

      // Create unrelated tests/orderService.spec.ts
      const testFile2 = path.join(tmpDir, "tests", "orderService.spec.ts");
      await fs.writeFile(
        testFile2,
        `describe("OrderService", () => {\n  it("should create order", () => {});\n});`,
        "utf-8"
      );

      const result = await getImpactedTests({
        filePath: srcFile,
        symbolName: "findUser",
        projectRoot: tmpDir,
      });

      expect(result.totalImpactedTests).toBe(1);
      expect(result.impactedTests[0].testFile).toContain("userService.spec.ts");
      expect(result.impactedTests[0].reason).toContain("findUser");
      expect(result.impactedTests[0].matchedCases).toContain("should findUser by id");
      expect(result.testRunner.command).toContain("vitest run tests/userService.spec.ts");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
