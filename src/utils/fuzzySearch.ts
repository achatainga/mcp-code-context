/**
 * Fuzzy Search - v3.6.0
 * Typo-tolerant search with fuse.js
 */

import Fuse from 'fuse.js';

export interface FuzzySearchOptions {
  threshold?: number; // 0.0 = perfect match, 1.0 = match anything (default: 0.4)
  keys?: string[]; // Fields to search in
  includeScore?: boolean;
}

export interface FuzzySearchResult<T> {
  item: T;
  score?: number;
  matches?: readonly any[];
}

/**
 * Perform fuzzy search on array of items
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  options: FuzzySearchOptions = {}
): FuzzySearchResult<T>[] {
  const fuse = new Fuse(items, {
    threshold: options.threshold ?? 0.4,
    keys: options.keys,
    includeScore: options.includeScore ?? true,
    includeMatches: true,
    minMatchCharLength: 2,
    ignoreLocation: true,
  });

  const results = fuse.search(query);
  
  return results.map(result => ({
    item: result.item,
    score: result.score,
    matches: result.matches,
  }));
}

/**
 * Fuzzy match a single string against a query
 */
export function fuzzyMatch(text: string, query: string, threshold: number = 0.4): boolean {
  const fuse = new Fuse([text], {
    threshold,
    includeScore: true,
  });

  const results = fuse.search(query);
  return results.length > 0;
}
