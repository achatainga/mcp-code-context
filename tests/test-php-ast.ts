/**
 * Quick test to understand php-parser AST node structure.
 * Run: npx ts-node src/test-php-ast.ts
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Engine = require("php-parser");

const parser = new Engine({
  parser: { extractDoc: true, php7: true, php8: true },
  ast: { withPositions: true, withSource: true },
});

const code = `<?php
namespace App\\Services;

use App\\Models\\User;
use App\\Contracts\\Cacheable;

interface Loggable {
    public function getLogName(): string;
}

trait HasTimestamps {
    /** Get current timestamp */
    private function now(): int {
        return time();
    }
}

abstract class BaseService {
    abstract public function execute(): void;
    
    protected function log(string $msg): void {
        echo $msg;
    }
}

class UserService extends BaseService implements Loggable, Cacheable {
    use HasTimestamps;
    
    private string $name;
    public const VERSION = '1.0';
    
    /**
     * Create a new UserService instance.
     * @param string $name The user name
     */
    public function __construct(string $name) {
        $this->name = $name;
    }
    
    public function execute(): void {
        $this->log($this->name);
    }
    
    public function getLogName(): string {
        return $this->name;
    }
    
    public static function create(string $n): self {
        return new self($n);
    }
}

function helper(int $x, string $y = 'default'): bool {
    return $x > 0;
}

$lambda = function(int $a): int {
    return $a * 2;
};

enum Color: string {
    case Red = 'red';
    case Blue = 'blue';
}
`;

const ast = parser.parseCode(code, "test.php");

function printNode(node: any, depth = 0) {
  if (!node || typeof node !== "object") return;
  const indent = "  ".repeat(depth);
  
  if (node.kind) {
    const info: string[] = [`${indent}[${node.kind}]`];
    
    if (node.name) {
      const name = typeof node.name === "string" ? node.name : node.name?.name || "";
      info.push(`name="${name}"`);
    }
    if (node.visibility) info.push(`visibility="${node.visibility}"`);
    if (node.isStatic) info.push("static");
    if (node.isAbstract) info.push("abstract");
    if (node.isFinal) info.push("final");
    if (node.nullable) info.push("nullable");
    if (node.type) {
      const t = typeof node.type === "string" ? node.type : node.type?.name || JSON.stringify(node.type?.kind);
      info.push(`type=${t}`);
    }
    if (node.extends) {
      const ext = typeof node.extends === "string" ? node.extends : node.extends?.name || "";
      info.push(`extends=${ext}`);
    }
    if (node.implements && node.implements.length > 0) {
      info.push(`implements=[${node.implements.map((i: any) => i.name || i).join(", ")}]`);
    }
    if (node.value && typeof node.value === "string") {
      info.push(`value="${node.value.substring(0, 40)}"`);
    }
    if (node.leadingComments) {
      info.push(`docComment=YES`);
    }
    
    console.log(info.join(" "));
    
    // Print arguments/parameters
    if (node.arguments && Array.isArray(node.arguments)) {
      for (const arg of node.arguments) {
        printNode(arg, depth + 1);
      }
    }
    
    // Print children/body
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        printNode(child, depth + 1);
      }
    }
    if (node.body && Array.isArray(node.body)) {
      for (const child of node.body) {
        printNode(child, depth + 1);
      }
    }
    if (node.items && Array.isArray(node.items)) {
      for (const item of node.items) {
        printNode(item, depth + 1);
      }
    }
    if (node.cases && Array.isArray(node.cases)) {
      for (const c of node.cases) {
        printNode(c, depth + 1);
      }
    }
    if (node.traits && Array.isArray(node.traits)) {
      for (const t of node.traits) {
        printNode(t, depth + 1);
      }
    }
  }
}

console.log("=== PHP AST Node Structure ===\n");
printNode(ast);
