/**
 * Test suite for new tools: read_file_lines and search_code_pattern
 */

import { readFileLines } from "../src/tools/readFileLines.js";
import { searchCodePattern } from "../src/tools/searchCodePattern.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create test file
const testDir = path.join(__dirname, "test-data");
const testFile = path.join(testDir, "sample.ts");

if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

const testContent = `// Sample TypeScript file
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }

  divide(a: number, b: number): number {
    if (b === 0) throw new Error("Division by zero");
    return a / b;
  }
}

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`;

fs.writeFileSync(testFile, testContent, "utf-8");

console.log("🧪 Testing read_file_lines...\n");

// Test 1: Read exact line range
console.log("Test 1: Read lines 3-7");
const result1 = readFileLines({
  filePath: testFile,
  startLine: 3,
  endLine: 7,
});

if (result1.success && result1.content?.includes("add")) {
  console.log("✅ PASS: Exact line range");
} else {
  console.error("❌ FAIL: Exact line range");
  console.error(result1);
}

// Test 2: Read around pattern
console.log("\nTest 2: Read around pattern 'multiply'");
const result2 = readFileLines({
  filePath: testFile,
  aroundPattern: "multiply",
  contextLines: 2,
});

if (result2.success && result2.content?.includes("multiply")) {
  console.log("✅ PASS: Pattern search");
} else {
  console.error("❌ FAIL: Pattern search");
  console.error(result2);
}

// Test 3: Invalid line range
console.log("\nTest 3: Invalid line range (should fail)");
const result3 = readFileLines({
  filePath: testFile,
  startLine: 100,
  endLine: 200,
});

if (!result3.success && result3.error?.includes("Invalid line range")) {
  console.log("✅ PASS: Error handling for invalid range");
} else {
  console.error("❌ FAIL: Should have failed with invalid range");
}

// Test 4: Pattern not found
console.log("\nTest 4: Pattern not found (should fail)");
const result4 = readFileLines({
  filePath: testFile,
  aroundPattern: "nonexistent_pattern_xyz",
});

if (!result4.success && result4.error?.includes("not found")) {
  console.log("✅ PASS: Error handling for pattern not found");
} else {
  console.error("❌ FAIL: Should have failed with pattern not found");
}

console.log("\n🧪 Testing search_code_pattern...\n");

// Test 5: Search for pattern
console.log("Test 5: Search for 'Calculator'");
const result5 = await searchCodePattern({
  rootDir: testDir,
  pattern: "Calculator",
  fileExtensions: [".ts"],
  maxResults: 10,
});

if (result5.success && result5.matches && result5.matches.length > 0) {
  console.log(`✅ PASS: Found ${result5.totalMatches} matches`);
} else {
  console.error("❌ FAIL: Should have found matches");
  console.error(result5);
}

// Test 6: Search with no matches
console.log("\nTest 6: Search for non-existent pattern");
const result6 = await searchCodePattern({
  rootDir: testDir,
  pattern: "NonExistentClass123",
  fileExtensions: [".ts"],
});

if (result6.success && result6.totalMatches === 0) {
  console.log("✅ PASS: No matches found (as expected)");
} else {
  console.error("❌ FAIL: Should have found no matches");
}

// Test 7: Search with context
console.log("\nTest 7: Search with context lines");
const result7 = await searchCodePattern({
  rootDir: testDir,
  pattern: "divide",
  fileExtensions: [".ts"],
  showContext: true,
  contextLines: 2,
});

if (
  result7.success &&
  result7.matches &&
  result7.matches[0]?.context &&
  result7.matches[0].context.length > 0
) {
  console.log("✅ PASS: Context lines included");
} else {
  console.error("❌ FAIL: Context lines not included");
  console.error(result7);
}

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });

console.log("\n✨ All tests completed!");
