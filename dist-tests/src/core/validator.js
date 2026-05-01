/**
 * Security Validator - v3.5.3
 * CRITICAL FIX: Path traversal check AFTER normalization
 */
import * as path from "node:path";
import * as fs from "node:fs/promises";
export class SecurityValidator {
    projectRoot;
    constructor(projectRoot) {
        this.projectRoot = path.resolve(projectRoot);
    }
    async validateFilePath(filePath) {
        // Resolve FIRST, then check
        const resolved = path.resolve(filePath);
        // CRITICAL: Check boundary AFTER normalization (with path separator)
        if (resolved !== this.projectRoot && !resolved.startsWith(this.projectRoot + path.sep)) {
            return { valid: false, error: "Path outside project boundary" };
        }
        // NOTE: Path traversal already caught by startsWith check above.
        // Removed dead code that duplicated the boundary check (unreachable condition).
        // Existence check
        try {
            await fs.access(resolved);
        }
        catch {
            return { valid: false, error: "File does not exist" };
        }
        return { valid: true, resolvedPath: resolved };
    }
    async validateFileSize(filePath, maxSize = 10 * 1024 * 1024) {
        try {
            const stat = await fs.stat(filePath);
            if (stat.size > maxSize) {
                return { valid: false, error: `File too large: ${(stat.size / 1024 / 1024).toFixed(2)}MB` };
            }
            return { valid: true };
        }
        catch (error) {
            return { valid: false, error: `Failed to check file size: ${error}` };
        }
    }
}
//# sourceMappingURL=validator.js.map