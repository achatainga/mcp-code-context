import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { validateWireContract } from "../../../src/operations/wireContract.js";

describe("Cross-Language Wire Contract Validator", () => {
  it("should detect synced fields and casing conventions across frontend and backend", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wire-contract-"));
    try {
      // Frontend file with TypeScript interface
      const feFile = path.join(tmpDir, "UserTypes.ts");
      await fs.writeFile(
        feFile,
        `export interface UserProfileDTO {
  id: string;
  email: string;
  fullName: string;
  age: number;
  isActive: boolean;
  legacyField: string;
}`,
        "utf-8"
      );

      // Backend model file (e.g. PHP/Laravel or generic backend model)
      const beFile = path.join(tmpDir, "UserModel.php");
      await fs.writeFile(
        beFile,
        `<?php
class UserModel {
  public string $id;
  public string $email;
  public string $full_name;
  public int $age;
  public bool $is_active;
}`,
        "utf-8"
      );

      const result = await validateWireContract({
        frontendFile: feFile,
        backendFile: beFile,
        projectRoot: tmpDir,
      });

      expect(result.frontendContract.interfaceName).toBe("UserProfileDTO");
      expect(result.syncedFields.length).toBeGreaterThan(0);

      // Check direct matches
      const directMatch = result.syncedFields.find(s => s.frontend === "email");
      expect(directMatch).toBeDefined();

      // Check casing drift
      const casingIssue = result.discrepancies.find(d => d.field === "fullName");
      expect(casingIssue).toBeDefined();
      expect(casingIssue?.issue).toBe("CASING_CONVENTION_DRIFT");

      // Check missing field
      const missingIssue = result.discrepancies.find(d => d.field === "legacyField");
      expect(missingIssue).toBeDefined();
      expect(missingIssue?.issue).toBe("MISSING_IN_BACKEND");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
