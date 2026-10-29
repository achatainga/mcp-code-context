import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { getCallHierarchy } from "../../../src/operations/callHierarchy.js";

describe("3-Hop Call Hierarchy", () => {
  it("should extract callers, callees and generate Mermaid diagram", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "call-hier-"));
    try {
      const srcDir = path.join(tmpDir, "src");
      await fs.mkdir(srcDir, { recursive: true });

      // Target file: authService.ts
      const authFile = path.join(srcDir, "authService.ts");
      await fs.writeFile(
        authFile,
        `export class AuthService {
  async authenticate(token: string) {
    const verified = this.verifyJwt(token);
    const user = this.loadUserProfile(verified.id);
    return user;
  }

  verifyJwt(t: string) { return { id: "1" }; }
  loadUserProfile(id: string) { return { name: "Alex" }; }
}`,
        "utf-8"
      );

      // Caller file: apiController.ts
      const controllerFile = path.join(srcDir, "apiController.ts");
      await fs.writeFile(
        controllerFile,
        `import { AuthService } from "./authService";
export class ApiController {
  async handleRequest(req: any) {
    const auth = new AuthService();
    return auth.authenticate(req.token);
  }
}`,
        "utf-8"
      );

      const result = await getCallHierarchy({
        filePath: authFile,
        symbolName: "authenticate",
        direction: "both",
        maxHops: 2,
        projectRoot: tmpDir,
      });

      expect(result.root.symbol).toBe("authenticate");
      expect(result.totalNodes).toBeGreaterThan(1);

      // Check callees
      const calleeNames = result.nodes.filter(n => n.direction === "callee").map(n => n.name);
      expect(calleeNames).toContain("verifyJwt");
      expect(calleeNames).toContain("loadUserProfile");

      // Check callers
      const callerNames = result.nodes.filter(n => n.direction === "caller").map(n => n.name);
      expect(callerNames.some(c => c.includes("handleRequest") || c.includes("ApiController"))).toBe(true);

      // Check Mermaid
      expect(result.mermaid).toContain("graph TD");
      expect(result.mermaid).toContain('"authenticate" --> "verifyJwt"');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
