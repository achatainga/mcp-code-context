import crypto from "node:crypto";

export interface PendingOperation {
  token: string;
  operation: "write_file_surgical" | "insert_symbol" | "rename_symbol" | "remove_symbol";
  filePath: string;
  payload: any; // Contains specific args needed to re-execute or apply
  expiresAt: number;
}

const CACHE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

class ConfirmationCacheManager {
  private cache = new Map<string, PendingOperation>();

  public add(
    operation: PendingOperation["operation"],
    filePath: string,
    payload: any
  ): string {
    const token = crypto.randomUUID();
    
    this.cache.set(token, {
      token,
      operation,
      filePath,
      payload,
      expiresAt: Date.now() + CACHE_TIMEOUT_MS,
    });

    // Clean up expired items lazily
    this.cleanup();

    return token;
  }

  public get(token: string): PendingOperation | undefined {
    this.cleanup();
    return this.cache.get(token);
  }

  public consume(token: string): PendingOperation | undefined {
    this.cleanup();
    const op = this.cache.get(token);
    if (op) {
      this.cache.delete(token);
    }
    return op;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

export const confirmationCache = new ConfirmationCacheManager();
