/**
 * File Streaming - v3.5.3
 * Stream large files in chunks to avoid memory exhaustion
 */
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
export declare function streamFile(filePath: string, options?: StreamOptions): Promise<StreamResult>;
/**
 * Stream file line by line (memory efficient)
 */
export declare function streamLines(filePath: string, callback: (line: string, lineNumber: number) => Promise<boolean | void>): Promise<{
    success: boolean;
    linesProcessed: number;
    error?: string;
}>;
/**
 * Stream and parse large file with AST (chunked)
 */
export declare function streamParseFile(filePath: string, parser: any, options?: StreamOptions): Promise<{
    success: boolean;
    symbols?: any[];
    error?: string;
}>;
/**
 * Write file in chunks (streaming write)
 */
export declare function streamWriteFile(filePath: string, content: string, options?: StreamOptions): Promise<{
    success: boolean;
    bytesWritten?: number;
    error?: string;
}>;
