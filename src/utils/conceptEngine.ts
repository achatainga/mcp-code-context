/**
 * Concept Engine - Offline Semantic Concept Vectors for Code Intelligence
 * 
 * Provides local, offline, high-speed conceptual and semantic matching over AST symbols
 * without requiring external cloud API keys, heavy neural dependencies, or leaking private code.
 */

export interface ConceptMatch {
  name: string;
  type: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  className?: string;
  signature?: string;
  docstring?: string;
  score: number; // 0.00 to 1.00
  matchedConcepts: string[];
  rationale: string;
}

/**
 * Domain Ontologies for Software Engineering Concepts
 */
export const CONCEPT_TAXONOMY: Record<string, string[]> = {
  DISCOUNT_PRICING: [
    "discount", "rebate", "deduction", "promo", "promotion", "promotional", "coupon",
    "voucher", "rate", "tier", "vip", "loyalty", "pricing", "price", "sale", "markdown",
    "concession", "fee", "subtotal", "reduction", "deduct", "calc", "calculate", "compute"
  ],
  AUTH_SECURITY: [
    "auth", "authentication", "login", "signin", "logout", "signout", "token", "jwt",
    "bearer", "session", "credential", "password", "oauth", "oauth2", "expire", "expiration",
    "refresh", "cycle", "stale", "cookie", "identity", "principal", "sso", "authorize",
    "authorization", "rbac", "role", "permission", "access", "guard", "firewall", "secret"
  ],
  PAYMENT_BILLING: [
    "payment", "pay", "charge", "checkout", "invoice", "bill", "billing", "transaction",
    "settle", "settlement", "capture", "refund", "gateway", "stripe", "paypal", "card",
    "credit", "debit", "wallet", "payout", "subscription", "order"
  ],
  STORAGE_DB: [
    "db", "database", "repository", "repo", "entity", "model", "table", "query",
    "persist", "store", "save", "commit", "transaction", "rollback", "migration",
    "schema", "orm", "record", "sqlite", "postgres", "mysql", "mongodb", "dao", "insert"
  ],
  DATA_VALIDATION: [
    "sanitize", "validation", "validate", "verify", "verification", "check", "assert",
    "assertion", "clean", "filter", "whitelist", "allowlist", "blacklist", "escape",
    "taint", "format", "schema", "parse", "mime", "type", "magic", "boundary", "regex"
  ],
  MESSAGING_EVENTS: [
    "event", "emit", "emitter", "dispatch", "dispatcher", "publish", "subscribe",
    "subscriber", "listener", "listen", "queue", "job", "worker", "task", "kafka",
    "rabbit", "rabbitmq", "webhook", "broadcast", "bus", "producer", "consumer"
  ],
  NETWORK_HTTP: [
    "request", "response", "req", "res", "endpoint", "route", "router", "controller",
    "handler", "fetch", "client", "api", "payload", "rest", "graphql", "grpc",
    "middleware", "header", "url", "uri", "http", "https", "status", "proxy"
  ],
  FILE_STORAGE: [
    "upload", "download", "file", "stream", "buffer", "blob", "storage", "bucket",
    "s3", "path", "disk", "fs", "filesystem", "attachment", "directory", "folder",
    "read", "write", "pipe", "chunk", "mimetype"
  ],
  ERROR_RESILIENCE: [
    "error", "exception", "fail", "failure", "catch", "retry", "backoff", "circuit",
    "breaker", "fallback", "recover", "recovery", "timeout", "abort", "handler",
    "panic", "fatal", "fault", "deadlock"
  ],
  LIFECYCLE_STATE: [
    "init", "initialize", "bootstrap", "start", "setup", "teardown", "dispose",
    "destroy", "cleanup", "close", "terminate", "shutdown", "reset", "lifecycle",
    "state", "hook", "mount", "unmount", "active", "idle"
  ],
  CACHE_PERFORMANCE: [
    "cache", "memoize", "memoization", "redis", "ttl", "evict", "eviction", "stale",
    "hit", "miss", "warm", "invalidate", "invalidation", "lru", "storage", "fast"
  ],
  SEARCH_INDEX: [
    "search", "find", "query", "lookup", "filter", "index", "indexer", "match",
    "matching", "fuzzy", "scan", "vector", "score", "rank", "ranking"
  ],
};

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "from",
  "by", "for", "with", "about", "against", "between", "into", "through", "during",
  "before", "after", "above", "below", "to", "of", "up", "down", "in", "out", "on",
  "off", "over", "under", "again", "further", "then", "once", "here", "there", "where",
  "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "can", "will", "just", "don", "should", "now", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "get", "got", "set"
]);

/**
 * Splits camelCase, PascalCase, snake_case, kebab-case identifiers into words
 */
export function splitIdentifier(identifier: string): string[] {
  if (!identifier) return [];
  // Split on dots, underscores, dashes, slashes
  const parts = identifier.split(/[\s._\-\/\\]+/);
  const words: string[] = [];

  for (const part of parts) {
    // Regex splits camelCase and PascalCase into word tokens
    const subWords = part.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/\s+/);
    for (const sw of subWords) {
      const clean = sw.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (clean && clean.length > 1) {
        words.push(clean);
      }
    }
  }

  return words;
}

/**
 * Light heuristic stemmer for software engineering vocabulary
 */
export function lightStem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;

  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 4) return w.slice(0, -3);
  if (w.endsWith("tions") && w.length > 6) return w.slice(0, -4);
  if (w.endsWith("tion") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ment") && w.length > 5) return w.slice(0, -4);
  if (w.endsWith("able") && w.length > 5) return w.slice(0, -4);
  if (w.endsWith("ible") && w.length > 5) return w.slice(0, -4);
  if (w.endsWith("ed") && w.length > 3) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 3) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);

  return w;
}

/**
 * Tokenize a free text or docstring into normalized, stemmed concept tokens
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const rawWords = splitIdentifier(text);
  const result: string[] = [];

  for (const raw of rawWords) {
    if (STOP_WORDS.has(raw)) continue;
    const stemmed = lightStem(raw);
    if (!STOP_WORDS.has(stemmed) && stemmed.length > 1) {
      result.push(stemmed);
    }
  }

  return result;
}

/**
 * Maps a list of tokens to a concept vector in the taxonomy space
 */
export function buildConceptVector(tokens: string[]): {
  categoryWeights: Record<string, number>;
  tokenFrequencies: Record<string, number>;
} {
  const categoryWeights: Record<string, number> = {};
  const tokenFrequencies: Record<string, number> = {};

  // Initialize categories
  for (const cat of Object.keys(CONCEPT_TAXONOMY)) {
    categoryWeights[cat] = 0;
  }

  for (const token of tokens) {
    tokenFrequencies[token] = (tokenFrequencies[token] || 0) + 1;

    // Check category affinity
    for (const [category, keywords] of Object.entries(CONCEPT_TAXONOMY)) {
      for (const kw of keywords) {
        const stemmedKw = lightStem(kw);
        if (token === kw || token === stemmedKw || token.includes(stemmedKw) || stemmedKw.includes(token)) {
          categoryWeights[category] = (categoryWeights[category] || 0) + 1;
        }
      }
    }
  }

  return { categoryWeights, tokenFrequencies };
}

/**
 * Calculate Cosine Similarity between two concept vectors
 */
export function calculateConceptSimilarity(
  queryVec: { categoryWeights: Record<string, number>; tokenFrequencies: Record<string, number> },
  docVec: { categoryWeights: Record<string, number>; tokenFrequencies: Record<string, number> }
): {
  score: number;
  matchedConcepts: string[];
  overlappingTokens: string[];
} {
  // 1. Concept Category Cosine Similarity
  let dotProductCat = 0;
  let normQueryCat = 0;
  let normDocCat = 0;
  const matchedConcepts: string[] = [];

  for (const cat of Object.keys(CONCEPT_TAXONOMY)) {
    const qW = queryVec.categoryWeights[cat] || 0;
    const dW = docVec.categoryWeights[cat] || 0;

    dotProductCat += qW * dW;
    normQueryCat += qW * qW;
    normDocCat += dW * dW;

    if (qW > 0 && dW > 0) {
      matchedConcepts.push(cat);
    }
  }

  const catSimilarity = normQueryCat > 0 && normDocCat > 0
    ? dotProductCat / (Math.sqrt(normQueryCat) * Math.sqrt(normDocCat))
    : 0;

  // 2. Direct Token / Lexical Overlap
  let dotProductToken = 0;
  let normQueryToken = 0;
  let normDocToken = 0;
  const overlappingTokens: string[] = [];

  for (const [token, qCount] of Object.entries(queryVec.tokenFrequencies)) {
    normQueryToken += qCount * qCount;
    const dCount = docVec.tokenFrequencies[token] || 0;
    if (dCount > 0) {
      dotProductToken += qCount * dCount;
      overlappingTokens.push(token);
    }
  }

  for (const dCount of Object.values(docVec.tokenFrequencies)) {
    normDocToken += dCount * dCount;
  }

  const tokenSimilarity = normQueryToken > 0 && normDocToken > 0
    ? dotProductToken / (Math.sqrt(normQueryToken) * Math.sqrt(normDocToken))
    : 0;

  // Blended Score: 55% Concept Vector + 45% Lexical Overlap
  // If concept matches strongly even with 0 lexical overlap (e.g. "discount" vs "rebate"), concept weight dominates
  let blendedScore = 0;
  if (tokenSimilarity > 0) {
    blendedScore = (catSimilarity * 0.45) + (tokenSimilarity * 0.55);
  } else if (catSimilarity > 0) {
    blendedScore = catSimilarity * 0.75; // Concept match without direct keyword
  }

  return {
    score: Math.min(1.0, Math.round(blendedScore * 100) / 100),
    matchedConcepts,
    overlappingTokens,
  };
}
