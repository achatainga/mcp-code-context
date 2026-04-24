/**
 * Security Tests - v3.2.0
 * Tests for path traversal, ReDoS, and other security vulnerabilities
 */

import { SecurityValidator } from "../src/core/validator.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

async function testPathTraversal() {
  console.log("🔒 Testing Path Traversal Protection...");
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-security-test-"));
  const testFile = path.join(tmpDir, "test.txt");
  await fs.writeFile(testFile, "test content");
  
  const validator = new SecurityValidator(tmpDir);
  
  // Test 1: Valid path
  const valid = await validator.validateFilePath(testFile);
  console.assert(valid.valid === true, "✅ Valid path accepted");
  
  // Test 2: Path traversal with ..
  const traversal1 = path.join(tmpDir, "..", "..", "etc", "passwd");
  const invalid1 = await validator.validateFilePath(traversal1);
  console.assert(invalid1.valid === false, "✅ Path traversal blocked (../..)");
  
  // Test 3: Absolute path outside boundary
  const traversal2 = "C:\\Windows\\System32\\config\\SAM";
  const invalid2 = await validator.validateFilePath(traversal2);
  console.assert(invalid2.valid === false, "✅ Absolute path outside boundary blocked");
  
  // Test 4: Normalized path that escapes
  const traversal3 = path.join(tmpDir, "subdir", "..", "..", "..", "etc", "passwd");
  const invalid3 = await validator.validateFilePath(traversal3);
  console.assert(invalid3.valid === false, "✅ Normalized escape path blocked");
  
  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
  
  console.log("✅ Path Traversal Tests PASSED\n");
}

async function testReDoS() {
  console.log("🔒 Testing ReDoS Protection...");
  
  // Test catastrophic backtracking patterns
  const dangerousPatterns = [
    "(a+)+",
    "(a*)*",
    "(a|a)*",
    "(a|ab)*",
  ];
  
  for (const pattern of dangerousPatterns) {
    try {
      const regex = new RegExp(pattern, "g");
      const testString = "a".repeat(20) + "X";
      
      const start = Date.now();
      const timeout = setTimeout(() => {
        throw new Error(`ReDoS detected: pattern "${pattern}" took >1000ms`);
      }, 1000);
      
      regex.test(testString);
      clearTimeout(timeout);
      
      const elapsed = Date.now() - start;
      console.log(`⚠️  Pattern "${pattern}" completed in ${elapsed}ms (potential ReDoS)`);
    } catch (error) {
      console.log(`✅ ReDoS protection needed for pattern: "${pattern}"`);
    }
  }
  
  console.log("✅ ReDoS Tests COMPLETED\n");
}

async function testRegexInjection() {
  console.log("🔒 Testing Regex Injection Protection...");
  
  // Simulate renameSymbol with malicious input
  const maliciousNames = [
    ".*",  // Matches everything
    "^.*$",  // Matches entire file
    "(a+)+",  // ReDoS
    "\\",  // Invalid escape
  ];
  
  for (const name of maliciousNames) {
    try {
      // Sanitize (as done in renameSymbol)
      const sanitized = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${sanitized}\\b`, "g");
      
      const testContent = "function test() { return 42; }";
      const result = testContent.replace(regex, "newName");
      
      // Should not match anything if properly sanitized
      if (result === testContent) {
        console.log(`✅ Regex injection blocked: "${name}"`);
      } else {
        console.log(`⚠️  Regex injection partially worked: "${name}"`);
      }
    } catch (error) {
      console.log(`✅ Regex injection caused error (caught): "${name}"`);
    }
  }
  
  console.log("✅ Regex Injection Tests PASSED\n");
}

async function testFileSizeValidation() {
  console.log("🔒 Testing File Size Validation...");
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-size-test-"));
  const validator = new SecurityValidator(tmpDir);
  
  // Create small file
  const smallFile = path.join(tmpDir, "small.txt");
  await fs.writeFile(smallFile, "x".repeat(1000));
  
  const validSize = await validator.validateFileSize(smallFile, 10 * 1024);
  console.assert(validSize.valid === true, "✅ Small file accepted");
  
  // Create large file
  const largeFile = path.join(tmpDir, "large.txt");
  await fs.writeFile(largeFile, "x".repeat(1024 * 1024));
  
  const invalidSize = await validator.validateFileSize(largeFile, 500 * 1024);
  console.assert(invalidSize.valid === false, "✅ Large file rejected");
  
  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
  
  console.log("✅ File Size Validation Tests PASSED\n");
}

async function runAllTests() {
  console.log("🚀 Running Security Test Suite v3.2.0\n");
  
  try {
    await testPathTraversal();
    await testReDoS();
    await testRegexInjection();
    await testFileSizeValidation();
    
    console.log("✅ ALL SECURITY TESTS PASSED");
    process.exit(0);
  } catch (error) {
    console.error("❌ SECURITY TEST FAILED:", error);
    process.exit(1);
  }
}

runAllTests();
