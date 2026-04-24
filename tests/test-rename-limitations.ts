/**
 * test-rename-limitations.ts — Tests for rename_symbol limitations
 * 
 * Validates that Dart/Python cross-file rename is properly blocked
 * with clear error messages.
 * 
 * Run: npm run build && node dist/tests/test-rename-limitations.js
 */

import { handleRenameSymbol } from "../src/handlers/writeHandlers.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Test Harness ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
    if (detail) console.error(`     ${detail}`);
  }
}

function section(title: string): void {
  console.log(`\n━━━ ${title} ━━━`);
}

// ─── Test Fixtures ──────────────────────────────────────────────────

const DART_FIXTURE = `
class UserService {
  void getUser() {
    print('user');
  }
}
`.trim();

const PYTHON_FIXTURE = `
class UserService:
    def get_user(self):
        return "user"
`.trim();

// ─── Tests ──────────────────────────────────────────────────────────

async function testDartRenameBlocked(): Promise<void> {
  section("Dart Rename Blocked");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
  const dartFile = path.join(tempDir, "test.dart");
  
  try {
    // Create a valid project structure with package.json
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
    fs.writeFileSync(dartFile, DART_FIXTURE, "utf-8");

    const result = await handleRenameSymbol({
      filePath: dartFile,
      oldName: "UserService",
      newName: "AccountService",
    });

    assert(
      (result as any).isError === true,
      "Dart rename returns error"
    );

    const errorText = result.content[0].text;
    assert(
      errorText.includes("⚠️") || errorText.includes("not supported"),
      "Error message has warning or 'not supported'"
    );
    assert(
      errorText.includes(".dart") || errorText.includes("Dart"),
      "Error mentions Dart"
    );
    assert(
      errorText.includes("AST") || errorText.includes("IDE") || errorText.includes("refactoring"),
      "Error explains reason or suggests alternative"
    );
    assert(
      errorText.includes("VS Code") || errorText.includes("write_file_surgical"),
      "Error suggests specific tool"
    );

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testPythonRenameBlocked(): Promise<void> {
  section("Python Rename Blocked");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
  const pyFile = path.join(tempDir, "test.py");
  
  try {
    // Create a valid project structure
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
    fs.writeFileSync(pyFile, PYTHON_FIXTURE, "utf-8");

    const result = await handleRenameSymbol({
      filePath: pyFile,
      oldName: "UserService",
      newName: "AccountService",
    });

    assert(
      (result as any).isError === true,
      "Python rename returns error"
    );

    const errorText = result.content[0].text;
    assert(
      errorText.includes("⚠️") || errorText.includes("not supported"),
      "Error message has warning"
    );
    assert(
      errorText.includes(".py") || errorText.includes("Python"),
      "Error mentions Python"
    );
    assert(
      errorText.includes("PyCharm") || errorText.includes("IDE"),
      "Error suggests IDE"
    );
    assert(
      errorText.includes("Pylance") || errorText.includes("refactoring"),
      "Error suggests tool"
    );

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testTypeScriptRenameStillWorks(): Promise<void> {
  section("TypeScript Rename Still Works");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
  const tsFile = path.join(tempDir, "test.ts");
  
  try {
    const tsFixture = `
export class UserService {
  getUser() {
    return "user";
  }
}
`.trim();

    // Create valid project
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
    fs.writeFileSync(tsFile, tsFixture, "utf-8");

    const result = await handleRenameSymbol({
      filePath: tsFile,
      oldName: "UserService",
      newName: "AccountService",
    });

    assert(
      (result as any).isError !== true,
      "TypeScript rename does NOT return error"
    );

    const responseText = result.content[0].text;
    assert(
      responseText.includes("DRY-RUN") || responseText.includes("Review"),
      "TypeScript rename returns preview"
    );
    assert(
      responseText.includes("confirmationToken") || responseText.includes("confirm"),
      "TypeScript rename returns token"
    );

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testPHPRenameStillWorks(): Promise<void> {
  section("PHP Rename Still Works");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
  const phpFile = path.join(tempDir, "test.php");
  
  try {
    const phpFixture = `<?php
class UserService {
  public function getUser() {
    return "user";
  }
}
`;

    // Create valid project
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
    fs.writeFileSync(phpFile, phpFixture, "utf-8");

    const result = await handleRenameSymbol({
      filePath: phpFile,
      oldName: "UserService",
      newName: "AccountService",
    });

    assert(
      (result as any).isError !== true,
      "PHP rename does NOT return error"
    );

    const responseText = result.content[0].text;
    assert(
      responseText.includes("DRY-RUN") || responseText.includes("Review"),
      "PHP rename returns preview"
    );

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ─── Run All ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🔬 Rename Limitations Tests\n");

  await testDartRenameBlocked();
  await testPythonRenameBlocked();
  await testTypeScriptRenameStillWorks();
  await testPHPRenameStillWorks();

  console.log(`\n${"═".repeat(50)}`);
  console.log(`📊 Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

  if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) FAILED`);
    process.exit(1);
  } else {
    console.log(`\n✅ All tests passed!`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
