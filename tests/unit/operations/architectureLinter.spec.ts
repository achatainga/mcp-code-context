import { describe, it, expect } from "vitest";
import { enforceArchitectureRules, ArchitectureComplianceReport } from "../../../src/operations/architectureLinter.js";

describe("enforce_architecture_rules (v4.6.0 AST Architectural Boundary Guardrails)", () => {
  const projectRoot = "C:/code/my-app";

  it("should flag illegal infrastructure and framework imports inside domain entities", async () => {
    const domainCode = `
      import { UserEntity } from "./userEntity.js";
      import { DatabasePool } from "../infra/database.js";
      import express from "express";

      export class UserService {
        constructor(private db: DatabasePool) {}
      }
    `;

    const result = await enforceArchitectureRules({
      filePath: "C:/code/my-app/src/domain/userService.ts",
      projectRoot,
      content: domainCode,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n⚠️")[0];
    const report = JSON.parse(jsonStr) as ArchitectureComplianceReport;

    expect(report.compliant).toBe(false);
    expect(report.violationsCount).toBe(2);

    const sources = report.violations.map(v => v.disallowedSource);
    expect(sources).toContain("../infra/database.js");
    expect(sources).toContain("express");
  });

  it("should flag direct ORM and database client imports in UI components", async () => {
    const uiCode = `
      import React from "react";
      import { PrismaClient } from "@prisma/client";

      export const UserList = () => {
        const prisma = new PrismaClient();
        return <div>Users</div>;
      };
    `;

    const result = await enforceArchitectureRules({
      filePath: "C:/code/my-app/src/components/UserList.tsx",
      projectRoot,
      content: uiCode,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n⚠️")[0];
    const report = JSON.parse(jsonStr) as ArchitectureComplianceReport;

    expect(report.compliant).toBe(false);
    expect(report.violationsCount).toBe(1);
    expect(report.violations[0].disallowedSource).toBe("@prisma/client");
    expect(report.violations[0].layer).toBe("ui");
  });

  it("should return compliant true when code respects all architectural boundaries", async () => {
    const cleanDomain = `
      import { User } from "./user.js";
      import { UserRepositoryPort } from "./ports.js";

      export class CreateUserUseCase {
        constructor(private repo: UserRepositoryPort) {}
      }
    `;

    const result = await enforceArchitectureRules({
      filePath: "C:/code/my-app/src/domain/createUser.ts",
      projectRoot,
      content: cleanDomain,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n✅")[0];
    const report = JSON.parse(jsonStr) as ArchitectureComplianceReport;

    expect(report.compliant).toBe(true);
    expect(report.violationsCount).toBe(0);
    expect(result.content).toContain("100% Compliant");
  });

  it("should enforce custom user-defined architectural rules", async () => {
    const customRules = [
      {
        layer: "security",
        pattern: "**/auth/**",
        disallow: ["crypto", "bcrypt"],
        description: "Direct legacy crypto calls are forbidden; use SecurityVault wrapper."
      }
    ];

    const authCode = `
      import crypto from "crypto";
      export function generateToken() { return crypto.randomBytes(16); }
    `;

    const result = await enforceArchitectureRules({
      filePath: "C:/code/my-app/src/auth/token.ts",
      projectRoot,
      rules: customRules,
      content: authCode,
    });

    expect(result.success).toBe(true);
    const jsonStr = result.content!.split("\n\n⚠️")[0];
    const report = JSON.parse(jsonStr) as ArchitectureComplianceReport;

    expect(report.compliant).toBe(false);
    expect(report.violationsCount).toBe(1);
    expect(report.violations[0].disallowedSource).toBe("crypto");
  });
});
