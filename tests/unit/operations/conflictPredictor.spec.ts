import { describe, it, expect } from "vitest";
import { predictSemanticConflicts } from "../../../src/operations/conflictPredictor.js";

describe("Semantic Merge Conflict Predictor", () => {
  it("should run prediction across git refs and return structured report", async () => {
    const result = await predictSemanticConflicts({
      baseBranch: "HEAD~1",
      targetBranch: "HEAD",
      projectRoot: process.cwd(),
    });

    expect(result).toBeDefined();
    expect(result.baseRef).toBe("HEAD~1");
    expect(result.targetRef).toBe("HEAD");
    expect(typeof result.hasConflicts).toBe("boolean");
    expect(Array.isArray(result.conflicts)).toBe(true);
    expect(result.summary).toBeDefined();
  });

  it("should reject malicious git ref inputs containing command injection syntax or flags", async () => {
    await expect(
      predictSemanticConflicts({
        baseBranch: "HEAD & echo PWNED",
        targetBranch: "HEAD",
        projectRoot: process.cwd(),
      })
    ).rejects.toThrow("Invalid git base reference");

    await expect(
      predictSemanticConflicts({
        baseBranch: "HEAD; calc.exe",
        targetBranch: "HEAD",
        projectRoot: process.cwd(),
      })
    ).rejects.toThrow("Invalid git base reference");

    await expect(
      predictSemanticConflicts({
        baseBranch: "--upload-pack=evil",
        targetBranch: "HEAD",
        projectRoot: process.cwd(),
      })
    ).rejects.toThrow("Invalid git base reference");
  });
});
