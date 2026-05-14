/**
 * File Streaming - v3.6.3
 * Stream large files in chunks to avoid memory exhaustion
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import { MAX_FILE_SIZE_BYTES } from "./constants.js";

export interface StreamOptions {
  chunkSize?: number;
  maxSize?: number;
  encoding?: BufferEncoding;
}

export interface StreamResult {
  success: boolean;
  chunks?: string[];
  totalSize?: number;
  error?: string;
}

/**
 * Stream file in chunks
 */
export async function streamFile(
  filePath: string,
  options: StreamOptions = {}
): Promise<StreamResult> {
  const {
    chunkSize = 1024 * 1024, // 1MB chunks
    maxSize = MAX_FILE_SIZE_BYTES,
    encoding = "utf-8",
  } = options;

  try {
    // Check file size first
    const stat = await fs.promises.stat(filePath);
    if (stat.size > maxSize) {
      return {
        success: false,
        error: `File too large: ${(stat.size / 1024 / 1024).toFixed(2)}MB (max: ${(maxSize / 1024 / 1024).toFixed(2)}MB)`,
      };
    }

    const chunks: string[] = [];
    let totalSize = 0;

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, {
        encoding,
        highWaterMark: chunkSize,
      });

      stream.on("data", (chunk: string | Buffer) => {
        const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString(encoding);
        totalSize += Buffer.byteLength(chunkStr, encoding);
        
        if (totalSize > maxSize) {
          stream.destroy();
          resolve({
            success: false,
            error: `File size exceeded during streaming: ${(totalSize / 1024 / 1024).toFixed(2)}MB`,
          });
          return;
        }

        chunks.push(chunkStr);
      });

      stream.on("end", () => {
        resolve({
          success: true,
          chunks,
          totalSize,
        });
      });

      stream.on("error", (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stream file line by line (memory efficient)
 */
export async function streamLines(
  filePath: string,
  callback: (line: string, lineNumber: number) => Promise<boolean | void>
): Promise<{ success: boolean; linesProcessed: number; error?: string }> {
  try {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineNumber = 0;
    let shouldContinue = true;

    for await (const line of rl) {
      lineNumber++;
      
      if (!shouldContinue) break;

      const result = await callback(line, lineNumber);
      if (result === false) {
        shouldContinue = false;
      }
    }

    return {
      success: true,
      linesProcessed: lineNumber,
    };
  } catch (error) {
    return {
      success: false,
      linesProcessed: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stream and parse large file with AST (chunked)
 */
export async function streamParseFile(
  filePath: string,
  parser: any,
  options: StreamOptions = {}
): Promise<{ success: boolean; symbols?: any[]; error?: string }> {
  try {
    // For files >10MB, stream in chunks
    const stat = await fs.promises.stat(filePath);
    
    if (stat.size <= 10 * 1024 * 1024) {
      // Small file, read normally
      const content = await fs.promises.readFile(filePath, "utf-8");
      const tree = parser.parse(content);
      const symbols = parser.findSymbols(tree);
      return { success: true, symbols };
    }

    // Large file, stream and parse incrementally
    const streamResult = await streamFile(filePath, options);
    
    if (!streamResult.success) {
      return { success: false, error: streamResult.error };
    }

    // Combine chunks and parse
    const content = streamResult.chunks!.join("");
    const tree = parser.parse(content);
    const symbols = parser.findSymbols(tree);

    return { success: true, symbols };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Write file in chunks (streaming write)
 */
export async function streamWriteFile(
  filePath: string,
  content: string,
  options: StreamOptions = {}
): Promise<{ success: boolean; bytesWritten?: number; error?: string }> {
  const { chunkSize = 1024 * 1024, encoding = "utf-8" } = options;

  try {
    const tmpPath = filePath + ".tmp";
    const writeStream = fs.createWriteStream(tmpPath, { encoding });

    let bytesWritten = 0;
    let offset = 0;

    return new Promise((resolve) => {
      const writeChunk = () => {
        if (offset >= content.length) {
          writeStream.end(() => {
            fs.promises.rename(tmpPath, filePath)
              .then(() => resolve({ success: true, bytesWritten }))
              .catch((error) => resolve({ success: false, error: error.message }));
          });
          return;
        }

        const chunk = content.substring(offset, offset + chunkSize);
        offset += chunkSize;

        const canContinue = writeStream.write(chunk, encoding);
        bytesWritten += Buffer.byteLength(chunk, encoding);

        if (canContinue) {
          writeChunk();
        } else {
          writeStream.once("drain", writeChunk);
        }
      };

      writeStream.on("error", (error) => {
        resolve({ success: false, error: error.message });
      });

      writeChunk();
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
