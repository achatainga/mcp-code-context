/**
 * Tests v3.6.2 - Telemetry, Streaming, Audit Logger
 */

import { TelemetryCollector, trackOperation, globalTelemetry } from "../src/utils/telemetry.js";
import { streamFile, streamLines, streamWriteFile } from "../src/utils/streaming.js";
import { AuditLogger } from "../src/utils/auditLogger.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
  }
}

// ─── TELEMETRY ───────────────────────────────────────────────────────────────

async function testTelemetry(): Promise<void> {
  console.log("\n🧪 Testing TelemetryCollector...");
  const t = new TelemetryCollector();

  t.recordOperation({ toolName: "read_file", duration: 10, success: true });
  t.recordOperation({ toolName: "read_file", duration: 20, success: true });
  t.recordOperation({ toolName: "write_file", duration: 50, success: false, error: "Permission denied" });

  const summary = t.getSummary();
  assert(summary.totalOperations === 3, "totalOperations = 3");
  assert(Math.round(summary.successRate) === 67, "successRate ~67%");
  assert(summary.recentErrors.length === 1, "recentErrors has 1 entry");
  assert(summary.recentErrors[0].error === "Permission denied", "error message correct");
  assert(summary.operationsByTool["read_file"] === 2, "read_file count = 2");

  const toolMetrics = t.getToolMetrics("read_file");
  assert(toolMetrics.count === 2, "getToolMetrics count = 2");
  assert(toolMetrics.successRate === 100, "getToolMetrics successRate = 100");
  assert(toolMetrics.averageDuration === 15, "getToolMetrics avgDuration = 15");

  const emptyMetrics = t.getToolMetrics("nonexistent");
  assert(emptyMetrics.count === 0, "getToolMetrics returns zeros for unknown tool");

  t.recordMetric("cache.hit", 1);
  t.recordMetric("cache.hit", 1);
  t.recordMetric("cache.miss", 1);
  const cache = t.getCacheMetrics();
  assert(cache.hits === 2, "cache hits = 2");
  assert(cache.misses === 1, "cache misses = 1");
  assert(Math.round(cache.hitRate) === 67, "cache hitRate ~67%");

  const prometheus = t.toPrometheus();
  assert(prometheus.includes("mcp_operations_total 3"), "Prometheus output correct");

  const exported = t.exportMetrics();
  assert(exported.operations.length === 3, "exportMetrics has 3 operations");

  t.clear();
  assert(t.getSummary().totalOperations === 0, "clear() resets operations");

  console.log("\n🧪 Testing trackOperation helper...");
  const result = await trackOperation("test_tool", async () => 42);
  assert(result === 42, "trackOperation returns value");

  let threw = false;
  try {
    await trackOperation("failing_tool", async () => { throw new Error("boom"); });
  } catch {
    threw = true;
  }
  assert(threw, "trackOperation re-throws errors");

  const gs = globalTelemetry.getSummary();
  assert(gs.totalOperations >= 2, "globalTelemetry records trackOperation calls");
}

// ─── STREAMING ───────────────────────────────────────────────────────────────

async function testStreaming(): Promise<void> {
  console.log("\n🧪 Testing streamFile...");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-"));
  const testFile = path.join(tmpDir, "test.txt");
  const content = "Hello World\nLine 2\nLine 3";
  await fs.writeFile(testFile, content, "utf-8");

  const result = await streamFile(testFile);
  assert(result.success === true, "streamFile succeeds on valid file");
  assert(result.chunks!.join("") === content, "streamFile content matches");
  assert(result.totalSize! > 0, "streamFile reports totalSize");

  const tooSmallLimit = await streamFile(testFile, { maxSize: 5 });
  assert(tooSmallLimit.success === false, "streamFile rejects file exceeding maxSize");

  const missing = await streamFile(path.join(tmpDir, "nonexistent.txt"));
  assert(missing.success === false, "streamFile handles missing file");

  console.log("\n🧪 Testing streamLines...");
  const lines: string[] = [];
  const lineResult = await streamLines(testFile, async (line) => { lines.push(line); });
  assert(lineResult.success === true, "streamLines succeeds");
  assert(lineResult.linesProcessed === 3, "streamLines processes 3 lines");
  assert(lines[0] === "Hello World", "streamLines first line correct");

  // Early stop
  const earlyLines: string[] = [];
  await streamLines(testFile, async (line) => {
    earlyLines.push(line);
    return false; // stop after first
  });
  assert(earlyLines.length === 1, "streamLines stops on false return");

  console.log("\n🧪 Testing streamWriteFile...");
  const outFile = path.join(tmpDir, "out.txt");
  const writeResult = await streamWriteFile(outFile, "Written content");
  assert(writeResult.success === true, "streamWriteFile succeeds");
  const written = await fs.readFile(outFile, "utf-8");
  assert(written === "Written content", "streamWriteFile content correct");

  await fs.rm(tmpDir, { recursive: true });
}

// ─── AUDIT LOGGER ────────────────────────────────────────────────────────────

async function testAuditLogger(): Promise<void> {
  console.log("\n🧪 Testing AuditLogger...");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-audit-"));

  const logger = new AuditLogger({
    logDir: tmpDir,
    enableConsole: false,
    enableFile: true,
  });

  await logger.log({ level: "info", operation: "read_file", details: {}, result: "success" });
  await logger.log({ level: "error", operation: "write_file", details: {}, result: "failure", error: "Permission denied" });
  await logger.logSecurity("path_traversal", { path: "../etc/passwd" }, "failure", "Blocked");
  await logger.logWrite("replace_symbol", "/src/index.ts", "client-1", "success", { symbol: "myFunc" });
  await logger.logRead("read_file_surgical", "/src/index.ts", "client-1", 12, "success");

  await logger.flush();

  const files = await fs.readdir(tmpDir);
  assert(files.length > 0, "AuditLogger creates log file");

  const logContent = await fs.readFile(path.join(tmpDir, files[0]), "utf-8");
  const entries = logContent.trim().split("\n").map(l => JSON.parse(l));
  assert(entries.length === 5, "AuditLogger wrote 5 entries");
  assert(entries[2].level === "security", "security entry level correct");
  assert(entries[2].operation === "path_traversal", "security entry operation correct");

  const queried = await logger.query({ level: "security" });
  assert(queried.length === 1, "query filters by level");

  const failureQuery = await logger.query({ result: "failure" });
  assert(failureQuery.length === 2, "query filters by result=failure");

  const stats = await logger.getStats();
  assert(stats.totalEntries === 5, "getStats totalEntries = 5");
  assert(stats.securityEvents === 1, "getStats securityEvents = 1");
  assert(stats.byResult["success"] === 3, "getStats byResult success = 3");

  await logger.stop();
  await fs.rm(tmpDir, { recursive: true });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🚀 Running v3.6.2 Test Suite\n");
  console.log("=".repeat(60));

  await testTelemetry();
  await testStreaming();
  await testAuditLogger();

  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 TEST SUMMARY`);
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${(passed / (passed + failed) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log("\n🎉 ALL v3.6.2 TESTS PASSED!");
    process.exit(0);
  } else {
    console.error(`\n💥 ${failed} TESTS FAILED`);
    process.exit(1);
  }
}

main().catch(console.error);
