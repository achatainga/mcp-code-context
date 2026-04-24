/**
 * Security Validator - v3.0.0
 * Mandatory project boundary enforcement
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
