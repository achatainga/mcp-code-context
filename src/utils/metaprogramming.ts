/**
 * Metaprogramming Entry Point Scanner - v3.9.0
 * Identifies where Ruby's "magic" methods are generated in a codebase.
 * Does not resolve what methods are created — it surfaces WHERE to look.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDE_DIRS } from "./constants.js";
import { walkDir } from "./fileWalker.js";

export interface MetaprogrammingMatch {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
  description: string;
}

/** Patterns that generate methods dynamically in Ruby */
const METAPROGRAMMING_PATTERNS: Array<{ regex: RegExp; name: string; description: string }> = [
  {
    regex: /\bmethod_missing\b/,
    name: "method_missing",
    description: "Catch-all for undefined method calls — generates methods on demand",
  },
  {
    regex: /\bdefine_method\b/,
    name: "define_method",
    description: "Programmatically defines a method on a class at runtime",
  },
  {
    regex: /\bclass_eval\b|\bmodule_eval\b/,
    name: "class_eval/module_eval",
    description: "Evaluates code in the context of a class — can define methods dynamically",
  },
  {
    regex: /\binstance_eval\b/,
    name: "instance_eval",
    description: "Evaluates code in the context of an object — can define singleton methods",
  },
  {
    regex: /\bsend\s*\(/,
    name: "send",
    description: "Invokes a method dynamically by name — may call generated methods",
  },
  {
    regex: /\bpublic_send\s*\(/,
    name: "public_send",
    description: "Like send but restricted to public methods — dynamic dispatch",
  },
  {
    regex: /\bincluded\s+do\b/,
    name: "included do",
    description: "ActiveSupport::Concern hook — runs when module is included, may add methods/callbacks",
  },
  {
    regex: /\bprepended\s+do\b/,
    name: "prepended do",
    description: "Module prepend hook — methods are added before the including class in the MRO",
  },
  {
    regex: /ActiveSupport::Concern/,
    name: "ActiveSupport::Concern",
    description: "Rails concern module — adds class methods and instance methods when included",
  },
  {
    regex: /\battr_accessor\b|\battr_reader\b|\battr_writer\b/,
    name: "attr_accessor/reader/writer",
    description: "Generates getter/setter methods for the listed attributes",
  },
  {
    regex: /\bdelegate\b.*:to\s*=>/,
    name: "delegate",
    description: "Rails delegate macro — generates forwarding methods to another object",
  },
  {
    regex: /\bhas_many\b.*through:/,
    name: "has_many :through",
    description: "AR association — generates join-table query methods",
  },
];

export async function findMetaprogrammingEntryPoints(params: {
  target: string; // filePath or rootDir
  projectRoot: string;
  isFile?: boolean;
}): Promise<MetaprogrammingMatch[]> {
  const matches: MetaprogrammingMatch[] = [];

  if (params.isFile) {
    const content = await fs.readFile(params.target, "utf-8").catch(() => null);
    if (content) {
      scanContent(content, params.target, matches);
    }
  } else {
    await walkDir(params.target, {
      extensions: [".rb"],
      excludeDirs: EXCLUDE_DIRS,
      onFile: async (fullPath) => {
        const content = await fs.readFile(fullPath, "utf-8").catch(() => null);
        if (content) {
          scanContent(content, fullPath, matches);
        }
      },
    });
  }

  return matches;
}

function scanContent(content: string, filePath: string, matches: MetaprogrammingMatch[]): void {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const { regex, name, description } of METAPROGRAMMING_PATTERNS) {
      if (regex.test(line)) {
        // Get 1 line of context before and after
        const snippet = lines.slice(Math.max(0, i - 1), i + 2).join("\n");
        matches.push({
          file: filePath,
          line: i + 1,
          pattern: name,
          snippet: snippet.trim(),
          description,
        });
        break; // one match per line
      }
    }
  }
}

export function formatMetaprogrammingResults(matches: MetaprogrammingMatch[]): string {
  if (matches.length === 0) {
    return JSON.stringify({ found: 0, message: "No metaprogramming entry points detected" });
  }

  // Group by file
  const byFile = new Map<string, MetaprogrammingMatch[]>();
  for (const m of matches) {
    const existing = byFile.get(m.file) ?? [];
    existing.push(m);
    byFile.set(m.file, existing);
  }

  const result = {
    found: matches.length,
    files: Array.from(byFile.entries()).map(([file, fileMatches]) => ({
      file,
      matches: fileMatches.map(m => ({
        line: m.line,
        pattern: m.pattern,
        description: m.description,
        snippet: m.snippet,
      })),
    })),
  };

  return JSON.stringify(result, null, 2);
}
