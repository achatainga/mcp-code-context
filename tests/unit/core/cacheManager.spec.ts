/**
 * CacheManager Unit Tests
 * Tests for memory leak prevention and core functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CacheManager } from '../../../src/core/cacheManager.js';
import { tmpdir } from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('CacheManager', () => {
  const testProjects: CacheManager[] = [];

  afterEach(async () => {
    // Cleanup all test cache managers
    for (const cache of testProjects) {
      await cache.close();
    }
    testProjects.length = 0;
  });

  it('should not leak process event listeners on multiple instantiations', () => {
    // Capture initial listener count
    const initialExitListeners = process.listenerCount('exit');
    const initialSigintListeners = process.listenerCount('SIGINT');
    const initialSigtermListeners = process.listenerCount('SIGTERM');

    // Create 15 CacheManager instances (more than MAX_CACHE_MANAGERS)
    for (let i = 0; i < 15; i++) {
      const testDir = path.join(tmpdir(), `test-cache-${Date.now()}-${i}`);
      const cache = new CacheManager(testDir);
      testProjects.push(cache);
    }

    // Verify listener count hasn't grown
    expect(process.listenerCount('exit')).toBe(initialExitListeners);
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners);
  });

  it('should have persistOnExit method for global shutdown', () => {
    const testDir = path.join(tmpdir(), `test-cache-${Date.now()}`);
    const cache = new CacheManager(testDir);
    testProjects.push(cache);

    // Verify persistOnExit exists and is callable
    expect(typeof cache.persistOnExit).toBe('function');
    
    // Should not throw when called
    expect(() => cache.persistOnExit()).not.toThrow();
  });

  it('should persist cache data synchronously on exit', async () => {
    const testDir = path.join(tmpdir(), `test-cache-persist-${Date.now()}`);
    const cache = new CacheManager(testDir);
    testProjects.push(cache);

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 100));

    // Add some data
    await cache.set({
      filePath: '/test/file.ts',
      hash: 'abc123',
      symbols: [{ name: 'testSymbol', type: 'function' }],
      lastModified: Date.now(),
      cachedAt: Date.now(),
    });

    // Wait for debounced persist
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Call persistOnExit (simulating shutdown)
    cache.persistOnExit();

    // Verify cache file exists
    const cacheFiles = fs.readdirSync(path.join(tmpdir(), 'mcp-cache'));
    expect(cacheFiles.length).toBeGreaterThan(0);
  });
});
