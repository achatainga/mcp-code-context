/**
 * Smoke test for PHP AST compression — tests against real DT24 PHP files.
 */
import { compressPHP, extractPHPSymbol } from "../src/ast/phpCompressor.js";
import * as fs from "node:fs";
import * as path from "node:path";

function log(label: string, value: string | number) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`✅ ${label}`);
  console.log(`${"─".repeat(60)}`);
  console.log(typeof value === "number" ? String(value) : value);
}

function fail(label: string, reason: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`❌ FAIL: ${label}`);
  console.log(`${"─".repeat(60)}`);
  console.log(reason);
  process.exitCode = 1;
}

async function main() {
  let passed = 0;
  let failed = 0;

  // ─── Test 1: Compress a class with namespace ───────────────────
  console.log("\n\n🧪 TEST 1: Compress Dt24Config.php (namespace + static class)");
  
  const configPath = "c:/code/dt24-core-plugin/includes/Dt24Config.php";
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    const compressed = compressPHP(content);
    const originalLines = content.split("\n").length;
    const compressedLines = compressed.split("\n").length;
    const ratio = ((1 - compressedLines / originalLines) * 100).toFixed(1);
    
    log(
      `Dt24Config.php: ${originalLines} → ${compressedLines} lines (${ratio}% reduction)`,
      compressed,
    );

    // Verify key structures are present
    const checks = [
      ["namespace", /namespace\s+Dt24ApiAuth/],
      ["class declaration", /class\s+Dt24Config/],
      ["static property", /\$cache/],
      ["env() method signature", /public\s+static\s+function\s+env\(/],
      ["set_config() method", /public\s+static\s+function\s+set_config\(/],
      ["body stripped", /\/\* \.\.\. \*\//],
    ] as const;

    for (const [name, pattern] of checks) {
      if (pattern.test(compressed)) {
        console.log(`  ✓ Found: ${name}`);
        passed++;
      } else {
        fail(`Missing: ${name}`, `Pattern ${pattern} not found in compressed output`);
        failed++;
      }
    }
  } else {
    console.log("  ⚠️ Skipped (file not found)");
  }

  // ─── Test 2: Compress a large class with docblocks ─────────────
  console.log("\n\n🧪 TEST 2: Compress Dt24_Api_Auth_Admin.php (class + constants + docblocks)");

  const adminPath = "c:/code/dt24-core-plugin/admin/class-dt24-api-auth-admin.php";
  if (fs.existsSync(adminPath)) {
    const content = fs.readFileSync(adminPath, "utf-8");
    const compressed = compressPHP(content);
    const originalLines = content.split("\n").length;
    const compressedLines = compressed.split("\n").length;
    const ratio = ((1 - compressedLines / originalLines) * 100).toFixed(1);

    log(
      `Admin: ${originalLines} → ${compressedLines} lines (${ratio}% reduction)`,
      compressed,
    );

    const checks = [
      ["class declaration", /class\s+Dt24_Api_Auth_Admin/],
      ["private property", /private\s+(.*\$plugin_name|\$plugin_name)/],
      ["const", /const\s+DT24_SECONDS_IN_MINUTES/],
      ["constructor", /function\s+__construct/],
      ["docblock", /\*\s+@param/],
      ["method signature", /function\s+check_the_elapsed_time\(/],
      ["body stripped", /\/\*\s*\.\.\.\s*\*\//],
      ["private method", /private\s+function\s+get_custom_statuses/],
    ] as const;

    for (const [name, pattern] of checks) {
      if (pattern.test(compressed)) {
        console.log(`  ✓ Found: ${name}`);
        passed++;
      } else {
        fail(`Missing: ${name}`, `Pattern ${pattern} not found`);
        failed++;
      }
    }
  } else {
    console.log("  ⚠️ Skipped (file not found)");
  }

  // ─── Test 3: Extract specific symbol ──────────────────────────
  console.log("\n\n🧪 TEST 3: Extract symbol 'env' from Dt24Config.php");

  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    const symbol = extractPHPSymbol(content, "env");

    if (symbol) {
      log("Extracted 'env' method:", symbol);
      if (symbol.includes("function env(") && symbol.includes("$cache")) {
        console.log("  ✓ Symbol extraction contains both signature and body");
        passed++;
      } else {
        fail("Symbol content", "Missing expected content");
        failed++;
      }
    } else {
      fail("Symbol 'env'", "extractPHPSymbol returned null");
      failed++;
    }
  }

  // ─── Test 4: Extract class symbol ─────────────────────────────
  console.log("\n\n🧪 TEST 4: Extract symbol 'Dt24Config' from Dt24Config.php");

  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    const symbol = extractPHPSymbol(content, "Dt24Config");

    if (symbol) {
      log("Extracted 'Dt24Config' class:", symbol.substring(0, 200) + "...");
      if (symbol.includes("class Dt24Config") && symbol.includes("function env")) {
        console.log("  ✓ Class extraction includes full body");
        passed++;
      } else {
        fail("Class content", "Missing expected content");
        failed++;
      }
    } else {
      fail("Symbol 'Dt24Config'", "extractPHPSymbol returned null");
      failed++;
    }
  }

  // ─── Test 5: Synthetic PHP with all features ──────────────────
  console.log("\n\n🧪 TEST 5: Synthetic PHP (namespace, interface, trait, enum, abstract class)");

  const syntheticPHP = `<?php
namespace App\\Services;

use App\\Models\\User;
use App\\Contracts\\Cacheable;

interface Loggable {
    public function getLogName(): string;
}

trait HasTimestamps {
    /** Get current timestamp */
    private function now(): int {
        return time();
    }
}

abstract class BaseService {
    abstract public function execute(): void;

    protected function log(string $msg): void {
        echo $msg;
    }
}

class UserService extends BaseService implements Loggable, Cacheable {
    use HasTimestamps;

    private string $name;
    public const VERSION = '1.0';

    /**
     * Create a new UserService instance.
     * @param string $name The user name
     */
    public function __construct(string $name) {
        $this->name = $name;
    }

    public function execute(): void {
        $this->log($this->name);
    }

    public function getLogName(): string {
        return $this->name;
    }

    public static function create(string $n): self {
        return new self($n);
    }
}

function helper(int $x, string $y = 'default'): bool {
    return $x > 0;
}

enum Color: string {
    case Red = 'red';
    case Blue = 'blue';
}
`;

  const compressed = compressPHP(syntheticPHP);
  const originalLines = syntheticPHP.split("\n").length;
  const compressedLines = compressed.split("\n").length;
  const ratio = ((1 - compressedLines / originalLines) * 100).toFixed(1);

  log(
    `Synthetic: ${originalLines} → ${compressedLines} lines (${ratio}% reduction)`,
    compressed,
  );

  const syntheticChecks = [
    ["namespace", /namespace App\\Services/],
    ["use statement", /use App\\Models\\User/],
    ["interface", /interface Loggable/],
    ["trait", /trait HasTimestamps/],
    ["abstract class", /abstract class BaseService/],
    ["abstract method", /abstract public function execute/],
    ["class extends+implements", /class UserService extends BaseService implements Loggable, Cacheable/],
    ["trait use", /use HasTimestamps/],
    ["const", /public const VERSION/],
    ["docblock", /@param string \$name/],
    ["static method", /public static function create/],
    ["return type self", /: self/],
    ["top-level function", /function helper\(/],
    ["default param", /\$y = 'default'/],
    ["enum", /enum Color: string/],
    ["enum case", /case Red = 'red'/],
    ["body stripped", /\/\* \.\.\. \*\//],
  ] as const;

  for (const [name, pattern] of syntheticChecks) {
    if (pattern.test(compressed)) {
      console.log(`  ✓ Found: ${name}`);
      passed++;
    } else {
      fail(`Missing: ${name}`, `Pattern ${pattern} not found`);
      failed++;
    }
  }

  // ─── Summary ─────────────────────────────────────────────────
  console.log(`\n\n${"═".repeat(60)}`);
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch(console.error);
