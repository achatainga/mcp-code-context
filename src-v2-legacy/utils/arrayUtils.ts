/**
 * Array utility functions for async processing
 */

/**
 * Splits an array into chunks of specified size
 * Used for batching async operations to prevent overwhelming the event loop
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Process array items in parallel batches with concurrency limit
 */
export async function processBatched<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 50
): Promise<R[]> {
  const chunks = chunkArray(items, batchSize);
  const results: R[] = [];

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(chunk.map(processor));
    results.push(...chunkResults);
  }

  return results;
}
