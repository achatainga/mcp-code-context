/**
 * Rate Limiter - v3.5.1
 * Token bucket algorithm for DoS protection
 */
interface RateLimitConfig {
    maxTokens: number;
    refillRate: number;
    refillInterval: number;
}
export declare class RateLimiter {
    private buckets;
    private config;
    private refillTimer;
    constructor(config?: Partial<RateLimitConfig>);
    /**
     * Check if request is allowed
     */
    checkLimit(clientId: string, cost?: number): Promise<{
        allowed: boolean;
        retryAfter?: number;
    }>;
    /**
     * Get current token count for client
     */
    getTokens(clientId: string): number;
    /**
     * Reset tokens for client
     */
    reset(clientId: string): void;
    /**
     * Clear all buckets
     */
    clearAll(): void;
    /**
     * Start automatic refill timer
     */
    private startRefillTimer;
    /**
     * Stop refill timer
     */
    stop(): void;
}
/**
 * Operation costs (in tokens)
 */
export declare const OPERATION_COSTS: {
    readonly get_semantic_repo_map: 50;
    readonly read_file_surgical: 5;
    readonly analyze_impact: 20;
    readonly read_file_lines: 2;
    readonly search_code_pattern: 30;
    readonly parse_file: 5;
    readonly write_file_surgical: 10;
    readonly insert_symbol: 10;
    readonly remove_symbol: 10;
    readonly rename_symbol: 40;
    readonly rollback_file: 2;
    readonly clean_backups: 2;
    readonly get_server_stats: 1;
};
export {};
