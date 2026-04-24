/**
 * Test syntax validation
 */

import { validateSyntax } from "../src/utils/syntaxValidator.js";

console.log("🧪 Testing Syntax Validation...\n");

// Test 1: Valid TypeScript
console.log("Test 1: Valid TypeScript");
const validTS = `
export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
`;

const result1 = await validateSyntax("test.ts", validTS);
if (result1.valid) {
  console.log("✅ PASS: Valid TypeScript accepted\n");
} else {
  console.error("❌ FAIL: Valid TypeScript rejected");
  console.error(result1.error);
  console.error(result1.diagnostics);
}

// Test 2: Invalid TypeScript (missing closing brace)
console.log("Test 2: Invalid TypeScript (missing brace)");
const invalidTS = `
export function hello(name: string): string {
  return \`Hello, \${name}!\`;
`;

const result2 = await validateSyntax("test.ts", invalidTS);
if (!result2.valid && result2.error) {
  console.log("✅ PASS: Invalid TypeScript rejected");
  console.log(`   Error: ${result2.error}\n`);
} else {
  console.error("❌ FAIL: Invalid TypeScript accepted\n");
}

// Test 3: Valid JavaScript
console.log("Test 3: Valid JavaScript");
const validJS = `
export function add(a, b) {
  return a + b;
}
`;

const result3 = await validateSyntax("test.js", validJS);
if (result3.valid) {
  console.log("✅ PASS: Valid JavaScript accepted\n");
} else {
  console.error("❌ FAIL: Valid JavaScript rejected");
  console.error(result3.error);
}

// Test 4: Invalid JavaScript (syntax error)
console.log("Test 4: Invalid JavaScript (syntax error)");
const invalidJS = `
export function add(a, b {
  return a + b;
}
`;

const result4 = await validateSyntax("test.js", invalidJS);
if (!result4.valid) {
  console.log("✅ PASS: Invalid JavaScript rejected");
  console.log(`   Error: ${result4.error}\n`);
} else {
  console.error("❌ FAIL: Invalid JavaScript accepted\n");
}

// Test 5: Valid PHP
console.log("Test 5: Valid PHP");
const validPHP = `<?php
class User {
  public function getName() {
    return "John";
  }
}
`;

const result5 = await validateSyntax("test.php", validPHP);
if (result5.valid) {
  console.log("✅ PASS: Valid PHP accepted\n");
} else {
  console.error("❌ FAIL: Valid PHP rejected");
  console.error(result5.error);
}

// Test 6: Invalid PHP (missing semicolon)
console.log("Test 6: Invalid PHP (syntax error)");
const invalidPHP = `<?php
class User {
  public function getName() {
    return "John"
  }
}
`;

const result6 = await validateSyntax("test.php", invalidPHP);
if (!result6.valid) {
  console.log("✅ PASS: Invalid PHP rejected");
  console.log(`   Error: ${result6.error}\n`);
} else {
  console.error("❌ FAIL: Invalid PHP accepted\n");
}

// Test 7: Valid Dart (balanced braces)
console.log("Test 7: Valid Dart");
const validDart = `
class User {
  String getName() {
    return "John";
  }
}
`;

const result7 = await validateSyntax("test.dart", validDart);
if (result7.valid) {
  console.log("✅ PASS: Valid Dart accepted\n");
} else {
  console.error("❌ FAIL: Valid Dart rejected");
  console.error(result7.error);
}

// Test 8: Invalid Dart (unbalanced braces)
console.log("Test 8: Invalid Dart (unbalanced braces)");
const invalidDart = `
class User {
  String getName() {
    return "John";
  }
`;

const result8 = await validateSyntax("test.dart", invalidDart);
if (!result8.valid) {
  console.log("✅ PASS: Invalid Dart rejected");
  console.log(`   Error: ${result8.error}\n`);
} else {
  console.error("❌ FAIL: Invalid Dart accepted\n");
}

console.log("✨ Syntax validation tests completed!");
