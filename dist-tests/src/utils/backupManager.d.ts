/**
 * Backup Manager - v3.6.0
 * Handles rolling backups in OS temp directory
 */
/**
 * Manages file backups with automatic rotation.
 * Backups are stored in OS temp directory to prevent hot-reload loops.
 */
export declare class BackupManager {
    private static readonly MAX_BACKUPS;
    private static backupRootCache;
    private static getBackupRoot;
    /**
     * Creates a backup of a file before modification.
     * Automatically enforces backup limit per file.
     *
     * @param filePath - Absolute path to file to backup
     * @param projectRoot - Project root directory
     */
    static createBackup(filePath: string, projectRoot: string): Promise<void>;
    /**
     * Restores a file from backup.
     *
     * @param filePath - Absolute path to file to restore
     * @param projectRoot - Project root directory
     * @param steps - Number of versions to roll back (default: 1)
     * @returns Result with success status and restored backup name
     */
    static rollback(filePath: string, projectRoot: string, steps?: number): Promise<{
        success: boolean;
        error?: string;
        restoredFrom?: string;
    }>;
    /**
     * Removes all backups for a project.
     *
     * @param projectRoot - Project root directory
     * @returns Result with success status and count of deleted files
     */
    static clean(projectRoot: string): Promise<{
        success: boolean;
        error?: string;
        deletedCount?: number;
    }>;
    private static enforceBackupLimit;
    /**
     * Lists all available backups for a file.
     *
     * @param filePath - Absolute path to file
     * @param projectRoot - Project root directory
     * @returns Array of backup file paths, sorted newest first
     */
    static listBackups(filePath: string, projectRoot: string): Promise<string[]>;
}
