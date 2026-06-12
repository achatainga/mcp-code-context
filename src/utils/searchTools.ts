/**
 * Search Tools - Native tool detection (ripgrep > ugrep > ag > findstr/grep)
 * Uses spawn + readline to avoid buffer overflow on large outputs
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { logger } from './logger.js';

export interface SearchToolResult {
  tool: string;
  matches: Array<{ file: string; line: number; content: string }>;
  timedOut: boolean;
}

const SEARCH_TOOLS = [
  { name: 'rg', args: (pattern: string, dir: string) => ['--json', '--', pattern, dir] },
  { name: 'ugrep', args: (pattern: string, dir: string) => ['--json', '--', pattern, dir] },
  { name: 'ag', args: (pattern: string, dir: string) => ['--json', '--', pattern, dir] },
  { name: 'findstr', args: (pattern: string, dir: string) => ['/S', '/N', pattern, `${dir}\\*`] },
  { name: 'grep', args: (pattern: string, dir: string) => ['-rn', '--', pattern, dir] },
];

async function detectTool(): Promise<string | null> {
  for (const tool of SEARCH_TOOLS) {
    try {
      const proc = spawn(tool.name, ['--version'], { stdio: 'ignore' });
      const exitCode = await new Promise<number>((resolve) => {
        proc.on('close', (code) => resolve(code ?? 1));
        proc.on('error', () => resolve(1));
      });
      if (exitCode === 0) {
        logger.debug({ tool: tool.name }, 'Detected search tool');
        return tool.name;
      }
    } catch {
      continue; // Binary not installed — try next search tool
    }
  }
  return null;
}

export async function searchWithNativeTool(
  pattern: string,
  dir: string,
  maxResults: number = 10,
  timeoutMs: number = 30000
): Promise<SearchToolResult | null> {
  const tool = await detectTool();
  if (!tool) return null;

  const toolConfig = SEARCH_TOOLS.find((t) => t.name === tool);
  if (!toolConfig) return null;

  // Pass -m flag to ripgrep/ugrep for OS-level limit
  let args = toolConfig.args(pattern, dir);
  if (tool === 'rg' || tool === 'ugrep') {
    args = ['--max-count', String(maxResults), ...args];
  }

  const proc = spawn(tool, args);
  const matches: Array<{ file: string; line: number; content: string }> = [];
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  const rl = createInterface({ input: proc.stdout });

  for await (const line of rl) {
    if (timedOut) break;
    
    // CRITICAL: Stop collecting once maxResults is reached to prevent OOM
    if (matches.length >= maxResults) {
      proc.kill();
      break;
    }
    
    // Parse JSON output (rg/ugrep/ag) or plain text (findstr/grep)
    if (tool === 'rg' || tool === 'ugrep' || tool === 'ag') {
      try {
        const json = JSON.parse(line);
        if (json.type === 'match') {
          matches.push({
            file: json.data.path.text,
            line: json.data.line_number,
            content: json.data.lines.text.trim(),
          });
        }
      } catch {
        continue; // Non-match JSON line from search tool output (summary, begin/end markers)
      }
    } else {
      // findstr/grep: "file:line:content"
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (match) {
        matches.push({
          file: match[1],
          line: parseInt(match[2], 10),
          content: match[3].trim(),
        });
      }
    }
  }

  clearTimeout(timeout);
  await new Promise<void>((resolve) => proc.on('close', () => resolve()));

  return { tool, matches, timedOut };
}
