/**
 * Gemfile Parser - v3.9.1
 * Parses Ruby Gemfile to extract gem dependencies and infer implicit behavior.
 * Uses a JSON data file for gem descriptions so they can be updated without recompile.
 */

import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Load gem descriptions from JSON sibling file at module init time (sync, once)
function loadGemDescriptions(): Record<string, string> {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const jsonPath = path.join(dir, "gemDescriptions.json");
    return JSON.parse(fsSync.readFileSync(jsonPath, "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

const GEM_DESCRIPTIONS: Record<string, string> = loadGemDescriptions();

export interface GemEntry {
  name: string;
  version?: string;
  implicitBehavior?: string;
}

export interface GemfileResult {
  gems: GemEntry[];
  knownGems: GemEntry[]; // only gems with known implicit behavior
}

// Cache: gemfilePath → { result, mtime }
const gemfileCache = new Map<string, { result: GemfileResult; mtime: number }>();

export async function parseGemfile(projectRoot: string): Promise<GemfileResult | null> {
  const gemfilePath = path.join(projectRoot, "Gemfile");

  let mtime: number;
  try {
    mtime = (await fs.stat(gemfilePath)).mtimeMs;
  } catch {
    return null; // No Gemfile — not a Ruby project
  }

  const cached = gemfileCache.get(gemfilePath);
  if (cached?.mtime === mtime) return cached.result;

  const content = await fs.readFile(gemfilePath, "utf-8");
  const result = parseGemfileContent(content);
  gemfileCache.set(gemfilePath, { result, mtime });
  return result;
}

export function parseGemfileContent(content: string): GemfileResult {
  const gems: GemEntry[] = [];

  // Match: gem 'name' | gem 'name', '~> 1.0' | gem "name", "version"
  const gemRe = /^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/gm;

  let match: RegExpExecArray | null;
  while ((match = gemRe.exec(content)) !== null) {
    const name = match[1].toLowerCase();
    const version = match[2];
    const implicitBehavior = GEM_DESCRIPTIONS[name];
    gems.push({ name, version, implicitBehavior });
  }

  const knownGems = gems.filter(g => g.implicitBehavior !== undefined);

  return { gems, knownGems };
}

export function formatGemAnnotation(knownGems: GemEntry[]): string {
  if (knownGems.length === 0) return "";
  const lines = knownGems
    .map(g => `  <gem name="${g.name}"${g.version ? ` version="${g.version}"` : ""}>\n    ${g.implicitBehavior}\n  </gem>`)
    .join("\n");
  return `<!-- Gemfile: installed gems with implicit behavior\n${lines}\n-->`;
}
