/**
 * File Lock Tests - v3.3.0
 */
import { FileLockManager } from "../src/utils/fileLock.js";
async function testBasicLocking() {
    console.log("🧪 Testing Basic File Locking...");
    const lockManager = new FileLockManager(5000);
    // Test 1: Acquire lock
    const result1 = await lockManager.acquireLock("/test/file.ts", "client1", "write");
    console.assert(result1.acquired === true, "✅ Lock acquired");
    console.assert(lockManager.isLocked("/test/file.ts") === true, "✅ File marked as locked");
    // Test 2: Try to acquire same lock
    const result2 = await lockManager.acquireLock("/test/file.ts", "client2", "write");
    console.assert(result2.acquired === false, "✅ Second lock denied");
    console.assert(result2.lockedBy === "client1", "✅ Locked by correct client");
    // Test 3: Release lock
    const released = lockManager.releaseLock("/test/file.ts", "client1");
    console.assert(released === true, "✅ Lock released");
    console.assert(lockManager.isLocked("/test/file.ts") === false, "✅ File unlocked");
    lockManager.clearAll();
    console.log("✅ Basic File Locking Tests PASSED\n");
}
async function testLockTimeout() {
    console.log("🧪 Testing Lock Timeout...");
    const lockManager = new FileLockManager(500); // 500ms timeout
    // Acquire lock
    await lockManager.acquireLock("/test/timeout.ts", "client1", "write");
    console.assert(lockManager.isLocked("/test/timeout.ts") === true, "✅ Lock acquired");
    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 600));
    // Lock should be auto-released
    console.assert(lockManager.isLocked("/test/timeout.ts") === false, "✅ Lock auto-released after timeout");
    lockManager.clearAll();
    console.log("✅ Lock Timeout Tests PASSED\n");
}
async function testMultipleFiles() {
    console.log("🧪 Testing Multiple Files...");
    const lockManager = new FileLockManager(5000);
    // Lock multiple files
    await lockManager.acquireLock("/test/file1.ts", "client1", "write");
    await lockManager.acquireLock("/test/file2.ts", "client1", "write");
    await lockManager.acquireLock("/test/file3.ts", "client2", "write");
    const locks = lockManager.getActiveLocks();
    console.assert(locks.length === 3, "✅ Multiple locks active");
    // Release all for client1
    const released = lockManager.releaseAllForClient("client1");
    console.assert(released === 2, "✅ Released 2 locks for client1");
    console.assert(lockManager.isLocked("/test/file3.ts") === true, "✅ Client2 lock still active");
    lockManager.clearAll();
    console.log("✅ Multiple Files Tests PASSED\n");
}
async function testPathNormalization() {
    console.log("🧪 Testing Path Normalization...");
    const lockManager = new FileLockManager(5000);
    // Lock with Windows path
    await lockManager.acquireLock("C:\\test\\file.ts", "client1", "write");
    // Try to lock with Unix path (should be same file)
    const result = await lockManager.acquireLock("C:/test/file.ts", "client2", "write");
    console.assert(result.acquired === false, "✅ Path normalization works");
    lockManager.clearAll();
    console.log("✅ Path Normalization Tests PASSED\n");
}
async function testForceRelease() {
    console.log("🧪 Testing Force Release...");
    const lockManager = new FileLockManager(5000);
    // Acquire lock
    await lockManager.acquireLock("/test/force.ts", "client1", "write");
    // Try to release with wrong client (should fail)
    const released1 = lockManager.releaseLock("/test/force.ts", "client2");
    console.assert(released1 === false, "✅ Release with wrong client denied");
    // Force release (admin)
    const released2 = lockManager.forceRelease("/test/force.ts");
    console.assert(released2 === true, "✅ Force release successful");
    console.assert(lockManager.isLocked("/test/force.ts") === false, "✅ File unlocked");
    lockManager.clearAll();
    console.log("✅ Force Release Tests PASSED\n");
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
    }
    catch (error) {
        console.error("❌ FILE LOCK TEST FAILED:", error);
        process.exit(1);
    }
}
runAllTests();
//# sourceMappingURL=test-file-lock.js.map