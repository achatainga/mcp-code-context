/**
 * Security Validator - v3.5.0
 * CRITICAL FIX: Path traversal check AFTER normalization
 */
export interface ValidationResult {
    valid: boolean;
    resolvedPath?: string;
    error?: string;
}
export declare class SecurityValidator {
    private projectRoot;
    constructor(projectRoot: string);
    validateFilePath(filePath: string): Promise<ValidationResult>;
    validateFileSize(filePath: string, maxSize?: number): Promise<ValidationResult>;
}
