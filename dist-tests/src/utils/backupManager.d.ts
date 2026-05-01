/**
 * Backup Manager - v3.6.0
 * Handles rolling backups in OS temp directory
 */
export declare class BackupManager {
    private static readonly MAX_BACKUPS;
    private static backupRootCache;
    private static getBackupRoot;
    static createBackup(filePath: string, projectRoot: string): Promise<void>;
    static rollback(filePath: string, projectRoot: string, steps?: number): Promise<{
        success: boolean;
        error?: string;
        restoredFrom?: string;
    }>;
    static clean(projectRoot: string): Promise<{
        success: boolean;
        error?: string;
        deletedCount?: number;
    }>;
    private static enforceBackupLimit;
    static listBackups(filePath: string, projectRoot: string): Promise<string[]>;
}
