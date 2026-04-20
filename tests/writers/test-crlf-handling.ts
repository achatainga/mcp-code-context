/**
 * Test CRLF handling in Dart writer
 */

import { replaceDartSymbol, insertDartCode, renameDartSymbol, removeDartSymbol } from "../../src/ast/writers/dartWriter.js";

function assert(condition: boolean, label: string, detail?: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${label}`);
    if (detail) console.error(`   ${detail}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${label}`);
}

function section(title: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(title);
  console.log("=".repeat(60));
}

function testCRLFReplace(): void {
  section("CRLF: Replace Symbol");

  const dartCRLF = "class BadgeService {\r\n  static void update({int? cart}) {\r\n    if (cart != null) {\r\n      print(cart);\r\n    }\r\n  }\r\n}\r\n";

  const newMethod = "  static void update({int? cart}) {\r\n    if (cart != null) {\r\n      print('Updated: $cart');\r\n    }\r\n  }";

  const result = replaceDartSymbol(dartCRLF, "update", newMethod);

  assert(result.success, "CRLF Replace: Should succeed", result.error);
  assert(result.newContent.includes("Updated"), "CRLF Replace: Should contain new content");
  assert(!result.error, "CRLF Replace: Should not have error", result.error);
}

function testCRLFInsert(): void {
  section("CRLF: Insert Symbol");

  const dartCRLF = "class Test {\r\n  void method1() {\r\n    print('1');\r\n  }\r\n}\r\n";

  const newMethod = "void method2() {\r\n  print('2');\r\n}";

  const result = insertDartCode(dartCRLF, newMethod, "method1", "after");

  assert(result.success, "CRLF Insert: Should succeed", result.error);
  assert(result.newContent.includes("method2"), "CRLF Insert: Should contain new method");
}

function testCRLFRename(): void {
  section("CRLF: Rename Symbol");

  const dartCRLF = "class Test {\r\n  void oldName() {\r\n    print('test');\r\n  }\r\n}\r\n";

  const result = renameDartSymbol(dartCRLF, "oldName", "newName");

  assert(result.success, "CRLF Rename: Should succeed");
  assert(result.newContent.includes("newName"), "CRLF Rename: Should contain new name");
  assert(!result.newContent.includes("oldName"), "CRLF Rename: Should not contain old name");
}

function testCRLFRemove(): void {
  section("CRLF: Remove Symbol");

  const dartCRLF = "class Test {\r\n  void method1() {\r\n    print('1');\r\n  }\r\n  void method2() {\r\n    print('2');\r\n  }\r\n}\r\n";

  const result = removeDartSymbol(dartCRLF, "method1");

  assert(result.success, "CRLF Remove: Should succeed");
  assert(!result.newContent.includes("method1"), "CRLF Remove: Should not contain removed method");
  assert(result.newContent.includes("method2"), "CRLF Remove: Should preserve other methods");
}

function testMixedLineEndings(): void {
  section("Mixed Line Endings");

  // Mixed CRLF and LF
  const mixed = "class Test {\r\n  void method1() {\n    print('1');\r\n  }\n}\r\n";

  const result = replaceDartSymbol(mixed, "method1", "  void method1() {\n    print('updated');\n  }");

  assert(result.success, "Mixed: Should handle mixed line endings");
  assert(result.newContent.includes("updated"), "Mixed: Should contain new content");
}

async function main(): Promise<void> {
  console.log("\n🧪 Testing CRLF Handling in Dart Writer\n");

  testCRLFReplace();
  testCRLFInsert();
  testCRLFRename();
  testCRLFRemove();
  testMixedLineEndings();

  console.log("\n✅ All CRLF tests passed!\n");
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
