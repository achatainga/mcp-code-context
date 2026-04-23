/**
 * Secure validation helper for write operations
 * Enforces project boundary checks
 */

import { validateFilePath } from "./validation.js";
import { findProjectRoot, enforceProjectBoundary } from "./projectRoot.js";

export interface SecureValidationResult {
  valid: boolean;
  resolvedPath?: string;
  projectRoot?: string;
  error?: string;
}

/**
 * Validate file path with mandatory project boundary enforcement
 * Use this for ALL write operations
 */
export function validateFilePathSecure(filePath: string): SecureValidationResult {
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return {
      valid: false,
      error: validation.error
    };
  }

  const resolvedPath = validation.normalizedPath!;

  // SECURITY: Enforce project boundary for write operations
  const projectRoot = findProjectRoot(resolvedPath);
  if (!projectRoot) {
    return {
      valid: false,
      error: "Cannot determine project root. Ensure file is within a valid project."
    };
  }
  
  const boundaryCheck = enforceProjectBoundary(resolvedPath, projectRoot);
  if (!boundaryCheck.valid) {
    return {
      valid: false,
      error: boundaryCheck.error
    };
  }

  return {
    valid: true,
    resolvedPath,
    projectRoot
  };
}
