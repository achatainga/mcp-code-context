/**
 * Rate Limiter - v3.4.0
 * Token bucket algorithm for DoS protection
 */
export class RateLimiter {
    buckets = new Map();
    config;
    refillTimer = null;
    constructor(config = {}) {
        this.config = {
            maxTokens: config.maxTokens || 100,
            refillRate: config.refillRate || 10,
            refillInterval: config.refillInterval || 1000,
        };
        this.startRefillTimer();
    }
    /**
     * Check if request is allowed
     */
    async checkLimit(clientId, cost = 1) {
        let bucket = this.buckets.get(clientId);
        if (!bucket) {
            bucket = {
                tokens: this.config.maxTokens,
                lastRefill: Date.now(),
            };
            this.buckets.set(clientId, bucket);
        }
        // Refill tokens based on time elapsed
        const now = Date.now();
        const elapsed = now - bucket.lastRefill;
        const tokensToAdd = Math.floor((elapsed / 1000) * this.config.refillRate);
        if (tokensToAdd > 0) {
            bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + tokensToAdd);
            bucket.lastRefill = now;
        }
        // Check if enough tokens
        if (bucket.tokens >= cost) {
            bucket.tokens -= cost;
            return { allowed: true };
        }
        // Calculate retry after
        const tokensNeeded = cost - bucket.tokens;
        const retryAfter = Math.ceil((tokensNeeded / this.config.refillRate) * 1000);
        return { allowed: false, retryAfter };
    }
    /**
     * Get current token count for client
     */
    getTokens(clientId) {
        const bucket = this.buckets.get(clientId);
        return bucket ? bucket.tokens : this.config.maxTokens;
    }
    /**
     * Reset tokens for client
     */
    reset(clientId) {
        this.buckets.delete(clientId);
    }
    /**
     * Clear all buckets
     */
    clearAll() {
        this.buckets.clear();
    }
    /**
     * Start automatic refill timer
     */
    startRefillTimer() {
        this.refillTimer = setInterval(() => {
            const now = Date.now();
            for (const [clientId, bucket] of this.buckets.entries()) {
                const elapsed = now - bucket.lastRefill;
                const tokensToAdd = Math.floor((elapsed / 1000) * this.config.refillRate);
                if (tokensToAdd > 0) {
                    bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + tokensToAdd);
                    bucket.lastRefill = now;
                }
                // Cleanup inactive clients (no activity for 5 minutes)
                if (elapsed > 5 * 60 * 1000 && bucket.tokens === this.config.maxTokens) {
                    this.buckets.delete(clientId);
                }
            }
        }, this.config.refillInterval);
    }
    /**
     * Stop refill timer
     */
    stop() {
        if (this.refillTimer) {
            clearInterval(this.refillTimer);
            this.refillTimer = null;
        }
    }
}
/**
 * Operation costs (in tokens)
 */
export const OPERATION_COSTS = {
    get_semantic_repo_map: 50, // Expensive — full repo walk
    read_file_surgical: 5,
    analyze_impact: 20,
    read_file_lines: 2,
    search_code_pattern: 30,
    parse_file: 5,
    write_file_surgical: 10,
    insert_symbol: 10,
    remove_symbol: 10,
    rename_symbol: 40, // Very expensive (cross-file)
    rollback_file: 2,
    clean_backups: 2,
    get_server_stats: 1,
};
//# sourceMappingURL=rateLimiter.js.map