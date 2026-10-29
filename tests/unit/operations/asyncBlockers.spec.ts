import { describe, it, expect, beforeAll } from "vitest";
import { detectAsyncEventloopBlockers } from "../../../src/operations/asyncBlockers.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("detect_async_eventloop_blockers (v7.0.0 SRE Event-Loop Blocker Detector)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("detects fs.readFileSync inside async handler in TypeScript", async () => {
    const code = `
async function handleRequest(req: any) {
  const data = fs.readFileSync("/data.json", "utf-8");
  return JSON.parse(data);
}
`;
    const res = await detectAsyncEventloopBlockers({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.asyncFunctionsScanned).toBe(1);
    expect(report.blockingCallsFound).toBe(1);
    expect(report.incidents[0].blockingApi).toBe("fs.readFileSync");
    expect(report.incidents[0].severity).toBe("CRITICAL");
    expect(report.incidents[0].suggestedAlternative).toContain("fs.readFile");
  });

  it("detects time.sleep inside Python async coroutine (from quant bot)", async () => {
    const code = `
async def poll_orderbook(symbol: str):
    while True:
        time.sleep(1)
        print("polling")
`;
    const res = await detectAsyncEventloopBlockers({ code, filePath: "bot.py", registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.asyncFunctionsScanned).toBe(1);
    expect(report.blockingCallsFound).toBe(1);
    expect(report.incidents[0].blockingApi).toBe("time.sleep");
    expect(report.incidents[0].suggestedAlternative).toContain("asyncio.sleep");
  });

  it("passes cleanly when async functions use non-blocking APIs", async () => {
    const code = `
async function cleanHandler() {
  await doWork();
  return 42;
}
`;
    const res = await detectAsyncEventloopBlockers({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.blockingCallsFound).toBe(0);
  });
});
