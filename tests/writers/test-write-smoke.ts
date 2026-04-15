/**
 * test-write-smoke.ts — Smoke Tests for Surgical Writing Tools
 *
 * Tests all 4 write operations (replace, insert, rename, remove)
 * across all 4 supported languages (TypeScript, PHP, Dart, Python).
 *
 * Run: npm run build && node dist/tests/writers/test-write-smoke.js
 */

import {
  replaceSymbol,
  insertCode,
  renameInFile,
  removeSymbolFromFile,
} from "../../src/ast/writers/symbolWriter.js";

import { generateDiff } from "../../src/utils/diffEngine.js";

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

const TS_FIXTURE = `
import { Something } from "./something.js";

const API_URL = "https://example.com";

export interface UserConfig {
  name: string;
  email: string;
}

export class UserService {
  private users: Map<string, UserConfig> = new Map();

  getUser(id: string): UserConfig | undefined {
    return this.users.get(id);
  }

  addUser(id: string, config: UserConfig): void {
    this.users.set(id, config);
  }

  deleteUser(id: string): boolean {
    return this.users.delete(id);
  }
}

export function formatUser(user: UserConfig): string {
  return \`\${user.name} <\${user.email}>\`;
}
`.trim();

const PHP_FIXTURE = `<?php

namespace App\\Services;

use App\\Models\\User;
use App\\Contracts\\UserRepositoryInterface;

/**
 * Manages user operations.
 */
class UserService
{
    private UserRepositoryInterface $repository;

    public function __construct(UserRepositoryInterface $repository)
    {
        $this->repository = $repository;
    }

    /**
     * Find a user by ID.
     */
    public function findUser(int $id): ?User
    {
        return $this->repository->find($id);
    }

    /**
     * Create a new user.
     */
    public function createUser(array $data): User
    {
        return $this->repository->create($data);
    }

    public function deleteUser(int $id): bool
    {
        return $this->repository->delete($id);
    }
}

function helperFunction(): string
{
    return 'hello';
}
`;

const DART_FIXTURE = `
import 'package:flutter/material.dart';

/// A service for managing user data.
class UserService {
  final Map<String, dynamic> _cache = {};

  /// Gets a user by ID.
  Future<Map<String, dynamic>?> getUser(String id) async {
    if (_cache.containsKey(id)) {
      return _cache[id];
    }
    return null;
  }

  /// Adds a user to the cache.
  void addUser(String id, Map<String, dynamic> data) {
    _cache[id] = data;
  }

  /// Removes a user from the cache.
  bool removeUser(String id) {
    return _cache.remove(id) != null;
  }
}

/// Formats a user name for display.
String formatUserName(String first, String last) {
  return '\$first \$last';
}
`.trim();

const PY_FIXTURE = `
from typing import Optional, Dict

class UserService:
    """Manages user operations."""

    def __init__(self):
        self._users: Dict[str, dict] = {}

    def get_user(self, user_id: str) -> Optional[dict]:
        """Get a user by ID."""
        return self._users.get(user_id)

    def add_user(self, user_id: str, data: dict) -> None:
        """Add a user."""
        self._users[user_id] = data

    def delete_user(self, user_id: str) -> bool:
        """Delete a user."""
        if user_id in self._users:
            del self._users[user_id]
            return True
        return False


def format_user(user: dict) -> str:
    """Format a user for display."""
    return f"{user['name']} <{user['email']}>"
`.trim();

// ─── TypeScript Tests ───────────────────────────────────────────────

function testTypeScript(): void {
  section("TypeScript / JavaScript");

  // Replace
  const replaceResult = replaceSymbol(
    "test.ts",
    TS_FIXTURE,
    "formatUser",
    `export function formatUser(user: UserConfig): string {\n  return \`User: \${user.name} (\${user.email})\`;\n}`,
  );
  assert(replaceResult.success, "Replace: formatUser");
  assert(
    replaceResult.newContent.includes("User: ${user.name}"),
    "Replace: new content is present",
  );
  assert(
    replaceResult.newContent.includes("class UserService"),
    "Replace: other symbols preserved",
  );

  // Insert
  const insertResult = insertCode(
    "test.ts",
    TS_FIXTURE,
    `export function greetUser(user: UserConfig): string {\n  return \`Hello, \${user.name}!\`;\n}`,
    "formatUser",
    "after",
  );
  assert(insertResult.success, "Insert: after formatUser");
  assert(
    insertResult.newContent.includes("greetUser"),
    "Insert: new function is present",
  );

  // Insert inside class
  const insertClassResult = insertCode(
    "test.ts",
    TS_FIXTURE,
    `getUserCount(): number {\n  return this.users.size;\n}`,
    "UserService",
    "inside_end",
  );
  assert(insertClassResult.success, "Insert: inside_end of UserService");
  assert(
    insertClassResult.newContent.includes("getUserCount"),
    "Insert: method added to class",
  );

  // Rename
  const renameResult = renameInFile("test.ts", TS_FIXTURE, "UserService", "AccountService");
  assert(renameResult.success, "Rename: UserService → AccountService");
  assert(
    renameResult.newContent.includes("class AccountService"),
    "Rename: class declaration updated",
  );
  assert(
    !renameResult.newContent.includes("class UserService"),
    "Rename: old name removed",
  );

  // Remove
  const removeResult = removeSymbolFromFile("test.ts", TS_FIXTURE, "formatUser");
  assert(removeResult.success, "Remove: formatUser");
  assert(
    !removeResult.newContent.includes("function formatUser"),
    "Remove: function is gone",
  );
  assert(
    removeResult.newContent.includes("class UserService"),
    "Remove: other symbols still exist",
  );

  // Remove interface
  const removeIfaceResult = removeSymbolFromFile("test.ts", TS_FIXTURE, "UserConfig");
  assert(removeIfaceResult.success, "Remove: UserConfig interface");
  assert(
    !removeIfaceResult.newContent.includes("interface UserConfig"),
    "Remove: interface is gone",
  );
}

// ─── PHP Tests ──────────────────────────────────────────────────────

function testPHP(): void {
  section("PHP");

  // Replace
  const replaceResult = replaceSymbol(
    "test.php",
    PHP_FIXTURE,
    "findUser",
    `    public function findUser(int $id): ?User\n    {\n        $cached = $this->cache->get($id);\n        return $cached ?? $this->repository->find($id);\n    }`,
  );
  assert(replaceResult.success, "Replace: findUser method");
  assert(
    replaceResult.newContent.includes("$cached"),
    "Replace: new content present",
  );

  // Insert
  const insertResult = insertCode(
    "test.php",
    PHP_FIXTURE,
    `    public function updateUser(int $id, array $data): User\n    {\n        return $this->repository->update($id, $data);\n    }`,
    "createUser",
    "after",
  );
  assert(insertResult.success, "Insert: after createUser");
  assert(
    insertResult.newContent.includes("updateUser"),
    "Insert: method present",
  );

  // Rename
  const renameResult = renameInFile("test.php", PHP_FIXTURE, "UserService", "AccountService");
  assert(renameResult.success, "Rename: UserService → AccountService");
  assert(
    renameResult.newContent.includes("class AccountService"),
    "Rename: class updated",
  );

  // Remove
  const removeResult = removeSymbolFromFile("test.php", PHP_FIXTURE, "helperFunction");
  assert(removeResult.success, "Remove: helperFunction");
  assert(
    !removeResult.newContent.includes("function helperFunction"),
    "Remove: function gone",
  );
  assert(
    removeResult.newContent.includes("class UserService"),
    "Remove: class preserved",
  );
}

// ─── Dart Tests ─────────────────────────────────────────────────────

function testDart(): void {
  section("Dart");

  // Replace
  const replaceResult = replaceSymbol(
    "test.dart",
    DART_FIXTURE,
    "formatUserName",
    `String formatUserName(String first, String last) {\n  return '\${last.toUpperCase()}, \$first';\n}`,
  );
  assert(replaceResult.success, "Replace: formatUserName");
  assert(
    replaceResult.newContent.includes("toUpperCase"),
    "Replace: new content present",
  );

  // Insert
  const insertResult = insertCode(
    "test.dart",
    DART_FIXTURE,
    `/// Checks if a user exists.\nbool userExists(String id) {\n  return false;\n}`,
    "formatUserName",
    "after",
  );
  assert(insertResult.success, "Insert: after formatUserName");
  assert(
    insertResult.newContent.includes("userExists"),
    "Insert: function present",
  );

  // Insert inside class
  const insertClassResult = insertCode(
    "test.dart",
    DART_FIXTURE,
    `  /// Clears the entire cache.\n  void clearCache() {\n    _cache.clear();\n  }`,
    "UserService",
    "inside_end",
  );
  assert(insertClassResult.success, "Insert: inside_end of UserService");
  assert(
    insertClassResult.newContent.includes("clearCache"),
    "Insert: method in class",
  );

  // Rename
  const renameResult = renameInFile("test.dart", DART_FIXTURE, "UserService", "ProfileService");
  assert(renameResult.success, "Rename: UserService → ProfileService");
  assert(
    renameResult.newContent.includes("class ProfileService"),
    "Rename: class updated",
  );

  // Remove
  const removeResult = removeSymbolFromFile("test.dart", DART_FIXTURE, "formatUserName");
  assert(removeResult.success, "Remove: formatUserName");
  assert(
    !removeResult.newContent.includes("formatUserName"),
    "Remove: function gone",
  );
  assert(
    removeResult.newContent.includes("class UserService"),
    "Remove: class preserved",
  );
}

// ─── Python Tests ───────────────────────────────────────────────────

function testPython(): void {
  section("Python");

  // Replace
  const replaceResult = replaceSymbol(
    "test.py",
    PY_FIXTURE,
    "format_user",
    `def format_user(user: dict) -> str:\n    """Format a user for display with title."""\n    name = user['name'].title()\n    return f"{name} <{user['email']}>"`,
  );
  assert(replaceResult.success, "Replace: format_user");
  assert(
    replaceResult.newContent.includes(".title()"),
    "Replace: new content present",
  );

  // Insert
  const insertResult = insertCode(
    "test.py",
    PY_FIXTURE,
    `def validate_email(email: str) -> bool:\n    """Check if email is valid."""\n    return "@" in email and "." in email`,
    "format_user",
    "after",
  );
  assert(insertResult.success, "Insert: after format_user");
  assert(
    insertResult.newContent.includes("validate_email"),
    "Insert: function present",
  );

  // Rename
  const renameResult = renameInFile("test.py", PY_FIXTURE, "UserService", "AccountService");
  assert(renameResult.success, "Rename: UserService → AccountService");
  assert(
    renameResult.newContent.includes("class AccountService"),
    "Rename: class updated",
  );

  // Remove
  const removeResult = removeSymbolFromFile("test.py", PY_FIXTURE, "format_user");
  assert(removeResult.success, "Remove: format_user");
  assert(
    !removeResult.newContent.includes("def format_user"),
    "Remove: function gone",
  );
  assert(
    removeResult.newContent.includes("class UserService"),
    "Remove: class preserved",
  );
}

// ─── Diff Engine Tests ──────────────────────────────────────────────

function testDiffEngine(): void {
  section("Diff Engine");

  const oldContent = "line1\nline2\nline3\nline4\nline5";
  const newContent = "line1\nline2_modified\nline3\nline4\nline5\nline6_added";

  const diff = generateDiff(oldContent, newContent, "test.txt");

  assert(diff.includes("---"), "Diff: has header");
  assert(diff.includes("+++"), "Diff: has header (new)");
  assert(diff.includes("-line2"), "Diff: shows removal");
  assert(diff.includes("+line2_modified"), "Diff: shows addition");
  assert(diff.includes("+line6_added"), "Diff: shows appended line");

  // No-change diff
  const noDiff = generateDiff("same", "same", "noop.txt");
  assert(noDiff.includes("no changes"), "Diff: no-change case handled");
}

// ─── Unsupported Language Tests ─────────────────────────────────────

function testUnsupported(): void {
  section("Unsupported Languages (Graceful Failures)");

  const result = replaceSymbol("test.rs", "fn main() {}", "main", "fn main() { println!(\"hi\"); }");
  assert(!result.success, "Unsupported: Rust returns failure");
  assert(
    result.error?.includes("Unsupported") ?? false,
    "Unsupported: error message is descriptive",
  );
}

// ─── Run All ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🔬 Surgical Writing Tools — Smoke Tests\n");

  testTypeScript();
  testPHP();
  testDart();
  testPython();
  testDiffEngine();
  testUnsupported();

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
