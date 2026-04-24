/**
 * Backup Manager - v3.5.1
 * Handles rolling backups for file modifications
 */
export declare class BackupManager {
    private static readonly MAX_BACKUPS;
    private static readonly BACKUP_DIR_NAME;
    /**
     * Creates a backup of the specified file before it gets modified
     */
    static createBackup(filePath: string, projectRoot: string): Promise<void>;
    /**
     * Restores a file to its previous state
     * @param steps How many versions to go back (1 = last version)
     */
    static rollback(filePath: string, projectRoot: string, steps?: number): Promise<{
        success: boolean;
        error?: string;
        restoredFrom?: string;
    }>;
    /**
     * Deletes all backups for a project
     */
    static clean(projectRoot: string): Promise<{
        success: boolean;
        error?: string;
        deletedCount?: number;
    }>;
    /**
     * Private helper to delete oldest backups if exceeding limit
     */
    private static enforceBackupLimit;
}
