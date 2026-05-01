import { BackupManager } from "../src/utils/backupManager.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
async function runTests() {
    console.log("🚀 Running Backup Manager Test Suite\n");
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-backup-"));
    const projectRoot = path.join(tmpDir, "project");
    await fs.mkdir(projectRoot);
    const testFile = path.join(projectRoot, "test.txt");
    // Calculate backup directory location (OS temp)
    const projectHash = crypto.createHash('md5')
        .update(projectRoot)
        .digest('hex')
        .substring(0, 8);
    const backupDir = path.join(os.tmpdir(), 'mcp-backups', projectHash);
    try {
        // 1. Create file and backup
        console.log("🧪 Testing Basic Backup...");
        await fs.writeFile(testFile, "v1", "utf-8");
        await BackupManager.createBackup(testFile, projectRoot);
        const backups = await fs.readdir(backupDir);
        if (backups.length !== 1)
            throw new Error("Backup not created");
        console.log("✅ Basic Backup Test PASSED");
        // 2. Modify and backup multiple times
        console.log("\n🧪 Testing Rolling Backups (Limit Enforcement)...");
        for (let i = 2; i <= 7; i++) {
            await fs.writeFile(testFile, `v${i}`, "utf-8");
            await new Promise(resolve => setTimeout(resolve, 10)); // Ensure different timestamps
            await BackupManager.createBackup(testFile, projectRoot);
        }
        const backupsAfterLimit = await fs.readdir(backupDir);
        if (backupsAfterLimit.length !== 5)
            throw new Error(`Expected 5 backups, got ${backupsAfterLimit.length}`);
        console.log("✅ Rolling Backups Limit Test PASSED");
        // 3. Rollback
        console.log("\n🧪 Testing Rollback...");
        // Current is v7 (which wasn't backed up before next edit, because loop ends).
        // Wait, the loop writes vX, then backs up vX.
        // So the backups are of v3, v4, v5, v6, v7.
        // Let's modify to v8 so current is v8.
        await fs.writeFile(testFile, "v8", "utf-8");
        // Rollback 1 step (should restore v7)
        const rb1 = await BackupManager.rollback(testFile, projectRoot, 1);
        if (!rb1.success)
            throw new Error("Rollback failed: " + rb1.error);
        const content1 = await fs.readFile(testFile, "utf-8");
        if (content1 !== "v7")
            throw new Error(`Expected v7, got ${content1}`);
        console.log("✅ Rollback 1 Step PASSED");
        // Rollback 2 steps (should restore v6)
        const rb2 = await BackupManager.rollback(testFile, projectRoot, 2);
        const content2 = await fs.readFile(testFile, "utf-8");
        if (content2 !== "v6")
            throw new Error(`Expected v6, got ${content2}`);
        console.log("✅ Rollback 2 Steps PASSED");
        // 4. Clean backups
        console.log("\n🧪 Testing Clean Backups...");
        const cleanResult = await BackupManager.clean(projectRoot);
        if (!cleanResult.success)
            throw new Error("Clean failed: " + cleanResult.error);
        if (cleanResult.deletedCount !== 5)
            throw new Error(`Expected 5 deleted, got ${cleanResult.deletedCount}`);
        try {
            await fs.access(backupDir);
            throw new Error("Backup dir should be deleted");
        }
        catch (e) {
            if (e.code !== "ENOENT")
                throw e;
        }
        console.log("✅ Clean Backups Test PASSED");
        console.log("\n🎉 ALL BACKUP MANAGER TESTS PASSED!");
    }
    catch (error) {
        console.error("\n❌ TEST FAILED:", error);
        process.exit(1);
    }
    finally {
        // Cleanup
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}
runTests();
//# sourceMappingURL=test-backup-manager.js.map