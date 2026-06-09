import { CodeContextEngine } from "../core/engine.js";
import { ParserRegistry } from "../parsers/registry.js";
import { globalSessionManager } from "../core/sessionManager.js";

export const SESSION_ID = `pid-${process.pid}`;

let engine: CodeContextEngine;
let registry: ParserRegistry;

export function setServerInstances(e: CodeContextEngine, r: ParserRegistry): void {
  engine = e;
  registry = r;
}

export function getEngine(): CodeContextEngine {
  return engine;
}

export function getRegistry(): ParserRegistry {
  return registry;
}

export function getSession(): ReturnType<typeof globalSessionManager.getOrCreate> {
  return globalSessionManager.getOrCreate(SESSION_ID);
}

export function getCacheManager(projectRoot: string) {
  return globalSessionManager.getCacheManager(SESSION_ID, projectRoot);
}
