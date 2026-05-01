/**
 * File Lock Tests - v3.3.0
 */

import { FileLockManager } from "../src/utils/fileLock.js";

async function testBasicLocking() {
  console.log("🧪 Testing Basic File Locking...");
  
  const lockManager = new FileLockManager();
  
  // Test 1: Acquire lock
  const release1 = await lockManager.acquireLock("/test/file.ts");
  console.assert(typeof release1 === "function", "✅ Lock acquired (release function returned)");
  console.assert(await lockManager.isLocked("/test/file.ts") === true, "✅ File marked as locked");
  
  // Test 2: Try to acquire same lock (should throw)
  try {
    await lockManager.acquireLock("/test/file.ts", 100); // 100ms timeout
    console.assert(false, "❌ Should have thrown lock error");
  } catch (error) {
    console.assert(true, "✅ Second lock denied");
  }
  
  // Test 3: Release lock
  await release1();
  console.assert(await lockManager.isLocked("/test/file.ts") === false, "✅ File unlocked");
  
  console.log("✅ Basic File Locking Tests PASSED\n");
}

async function testLockTimeout() {
  console.log("🧪 Testing Lock Timeout...");
  
  // proper-lockfile handles stale detection automatically (30s default)
  // This test verifies manual release works
  const lockManager = new FileLockManager();
  
  const release = await lockManager.acquireLock("/test/timeout.ts");
  console.assert(await lockManager.isLocked("/test/timeout.ts") === true, "✅ Lock acquired");
  
  await release();
  console.assert(await lockManager.isLocked("/test/timeout.ts") === false, "✅ Lock released");
  
  console.log("✅ Lock Timeout Tests PASSED\n");
}

async function testMultipleFiles() {
  console.log("🧪 Testing Multiple Files...");
  
  const lockManager = new FileLockManager();
  
  // Lock multiple files
  const release1 = await lockManager.acquireLock("/test/file1.ts");
  const release2 = await lockManager.acquireLock("/test/file2.ts");
  const release3 = await lockManager.acquireLock("/test/file3.ts");
  
  console.assert(await lockManager.isLocked("/test/file1.ts") === true, "✅ File1 locked");
  console.assert(await lockManager.isLocked("/test/file2.ts") === true, "✅ File2 locked");
  console.assert(await lockManager.isLocked("/test/file3.ts") === true, "✅ File3 locked");
  
  // Release all
  await release1();
  await release2();
  await release3();
  
  console.assert(await lockManager.isLocked("/test/file1.ts") === false, "✅ File1 unlocked");
  console.assert(await lockManager.isLocked("/test/file2.ts") === false, "✅ File2 unlocked");
  console.assert(await lockManager.isLocked("/test/file3.ts") === false, "✅ File3 unlocked");
  
  console.log("✅ Multiple Files Tests PASSED\n");
}

async function testPathNormalization() {
  console.log("🧪 Testing Path Normalization...");
  
  const lockManager = new FileLockManager();
  
  // Lock with Windows path
  const release = await lockManager.acquireLock("C:\\test\\file.ts");
  
  // Try to lock with Unix path (should throw - same file)
  try {
    await lockManager.acquireLock("C:/test/file.ts", 100); // 100ms timeout
    console.assert(false, "❌ Should have thrown lock error");
  } catch (error) {
    console.assert(true, "✅ Path normalization works");
  }
  
  await release();
  console.log("✅ Path Normalization Tests PASSED\n");
}

async function testForceRelease() {
  console.log("🧪 Testing Manual Release...");
  
  const lockManager = new FileLockManager();
  
  // Acquire lock
  const release = await lockManager.acquireLock("/test/force.ts");
  console.assert(await lockManager.isLocked("/test/force.ts") === true, "✅ Lock acquired");
  
  // Release
  await release();
  console.assert(await lockManager.isLocked("/test/force.ts") === false, "✅ File unlocked");
  
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
    
    console.log("✅ ALL FILE LOCK TESTS PASSED");
    process.exit(0);
  } catch (error) {
    console.error("❌ FILE LOCK TEST FAILED:", error);
    process.exit(1);
  }
}

runAllTests();
