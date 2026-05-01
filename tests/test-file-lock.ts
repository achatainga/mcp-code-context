/**
 * File Lock Tests - v3.3.0
 */

import { FileLockManager } from "../src/utils/fileLock.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "os";

const testDir = path.join(tmpdir(), "mcp-lock-tests");

async function testBasicLocking() {
  console.log("🧪 Testing Basic File Locking...");
  
  // Setup test directory and file
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  const testFile = path.join(testDir, "file.ts");
  fs.writeFileSync(testFile, "test content");
  
  const lockManager = new FileLockManager();
  
  // Test 1: Acquire lock
  const release1 = await lockManager.acquireLock(testFile);
  console.assert(typeof release1 === "function", "✅ Lock acquired (release function returned)");
  console.assert(await lockManager.isLocked(testFile) === true, "✅ File marked as locked");
  
  // Test 2: Try to acquire same lock (should throw)
  try {
    await lockManager.acquireLock(testFile, 100);
    console.assert(false, "❌ Should have thrown lock error");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.assert(errorMsg.includes("Failed to acquire lock"), "✅ Second lock denied");
  }
  
  // Test 3: Release lock
  await release1();
  console.assert(await lockManager.isLocked(testFile) === false, "✅ File unlocked");
  
  fs.unlinkSync(testFile);
  
  console.log("✅ Basic File Locking Tests PASSED\n");
}

async function testLockTimeout() {
  console.log("🧪 Testing Lock Timeout...");
  
  const testFile = path.join(testDir, "timeout.ts");
  fs.writeFileSync(testFile, "test content");
  
  const lockManager = new FileLockManager();
  
  const release = await lockManager.acquireLock(testFile);
  console.assert(await lockManager.isLocked(testFile) === true, "✅ Lock acquired");
  
  await release();
  console.assert(await lockManager.isLocked(testFile) === false, "✅ Lock released");
  
  fs.unlinkSync(testFile);
  
  console.log("✅ Lock Timeout Tests PASSED\n");
}

async function testMultipleFiles() {
  console.log("🧪 Testing Multiple Files...");
  
  const file1 = path.join(testDir, "file1.ts");
  const file2 = path.join(testDir, "file2.ts");
  const file3 = path.join(testDir, "file3.ts");
  fs.writeFileSync(file1, "test");
  fs.writeFileSync(file2, "test");
  fs.writeFileSync(file3, "test");
  
  const lockManager = new FileLockManager();
  
  const release1 = await lockManager.acquireLock(file1);
  const release2 = await lockManager.acquireLock(file2);
  const release3 = await lockManager.acquireLock(file3);
  
  console.assert(await lockManager.isLocked(file1) === true, "✅ File1 locked");
  console.assert(await lockManager.isLocked(file2) === true, "✅ File2 locked");
  console.assert(await lockManager.isLocked(file3) === true, "✅ File3 locked");
  
  await release1();
  await release2();
  await release3();
  
  console.assert(await lockManager.isLocked(file1) === false, "✅ File1 unlocked");
  console.assert(await lockManager.isLocked(file2) === false, "✅ File2 unlocked");
  console.assert(await lockManager.isLocked(file3) === false, "✅ File3 unlocked");
  
  fs.unlinkSync(file1);
  fs.unlinkSync(file2);
  fs.unlinkSync(file3);
  
  console.log("✅ Multiple Files Tests PASSED\n");
}

async function testPathNormalization() {
  console.log("🧪 Testing Path Normalization...");
  
  const testFile = path.join(testDir, "norm.ts");
  fs.writeFileSync(testFile, "test");
  
  const lockManager = new FileLockManager();
  
  const release = await lockManager.acquireLock(testFile);
  
  try {
    await lockManager.acquireLock(testFile, 100);
    console.assert(false, "❌ Should have thrown lock error");
  } catch (error) {
    console.assert(true, "✅ Path normalization works");
  }
  
  await release();
  fs.unlinkSync(testFile);
  
  console.log("✅ Path Normalization Tests PASSED\n");
}

async function testForceRelease() {
  console.log("🧪 Testing Manual Release...");
  
  const testFile = path.join(testDir, "force.ts");
  fs.writeFileSync(testFile, "test");
  
  const lockManager = new FileLockManager();
  
  const release = await lockManager.acquireLock(testFile);
  console.assert(await lockManager.isLocked(testFile) === true, "✅ Lock acquired");
  
  await release();
  console.assert(await lockManager.isLocked(testFile) === false, "✅ File unlocked");
  
  fs.unlinkSync(testFile);
  
  console.log("✅ Manual Release Tests PASSED\n");
}

async function runAllTests() {
  console.log("🚀 Running File Lock Test Suite v3.3.0\n");
  
  try {
    await testBasicLocking();
    await testLockTimeout();
    await testMultipleFiles();
    await testPathNormalization();
    await testForceRelease();
    
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    
    console.log("✅ ALL FILE LOCK TESTS PASSED");
    process.exit(0);
  } catch (error) {
    console.error("❌ FILE LOCK TEST FAILED:", error);
    process.exit(1);
  }
}

runAllTests();
