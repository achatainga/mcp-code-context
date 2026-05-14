/**
 * File Watcher - v3.6.2
 * Auto-invalidate cache on file changes with chokidar
 */

import chokidar, { FSWatcher } from 'chokidar';
import { logger } from './logger.js';
import { EXCLUDE_DIRS } from './constants.js';

export interface FileWatcherConfig {
  debounceMs: number;
  ignored: string[];
  onFileChange: (filePath: string) => void | Promise<void>;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private config: FileWatcherConfig;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private isWatching = false;

  constructor(config: FileWatcherConfig) {
    this.config = config;
  }

  start(rootDir: string): void {
    if (this.isWatching) {
      logger.warn({ rootDir }, 'File watcher already running');
      return;
    }

    this.watcher = chokidar.watch(rootDir, {
      ignored: [
        /(^|[\/\\])\../, // Hidden files
        ...EXCLUDE_DIRS.map(dir => `**/${dir}/**`),
        ...this.config.ignored,
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('change', (filePath) => this.handleChange(filePath))
      .on('unlink', (filePath) => this.handleChange(filePath))
      .on('error', (error) => logger.error({ error }, 'File watcher error'));

    this.isWatching = true;
    logger.info({ rootDir, debounceMs: this.config.debounceMs }, 'File watcher started');
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.isWatching = false;
    logger.info('File watcher stopped');
  }

  getStatus(): { isWatching: boolean; watchedFiles: number; paths: string[] } {
    if (!this.watcher) return { isWatching: false, watchedFiles: 0, paths: [] };
    const watched = this.watcher.getWatched();
    const paths: string[] = [];
    for (const [dir, files] of Object.entries(watched)) {
      for (const file of files as string[]) {
        paths.push(file ? `${dir}/${file}` : dir);
      }
    }
    return {
      isWatching: this.isWatching,
      watchedFiles: paths.length,
      paths: paths.slice(0, 50), // cap at 50 to avoid token explosion
    };
  }

  private handleChange(filePath: string): void {
    // Clear existing timer for this file
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      
      try {
        this.config.onFileChange(filePath);
        logger.debug({ filePath }, 'File change processed');
      } catch (error) {
        logger.error({ error, filePath }, 'Error processing file change');
      }
    }, this.config.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }
}
