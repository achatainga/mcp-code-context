import { describe, it, expect, beforeAll } from "vitest";
import { extractApiRouteMatrix } from "../../../src/operations/apiRoutes.js";
import { CodeContextEngine } from "../../../src/core/engine.js";
import { ParserRegistry } from "../../../src/parsers/registry.js";

describe("extract_api_route_matrix (v7.0.0 Zero-Runtime REST/FastAPI Route Extractor)", () => {
  let registry: ParserRegistry;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
  });

  it("extracts Express routes with path parameters in TypeScript", async () => {
    const code = `
app.get("/api/v1/users/:userId", getUserHandler);
router.post("/api/v1/orders", createOrderHandler);
router.delete("/api/v1/items/:itemId", deleteItemHandler);
`;
    const res = await extractApiRouteMatrix({ code, registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalRoutesFound).toBe(3);
    expect(report.routes[0].method).toBe("GET");
    expect(report.routes[0].path).toBe("/api/v1/users/:userId");
    expect(report.routes[0].pathParams).toContain("userId");
    expect(report.routes[1].method).toBe("POST");
    expect(report.routes[2].method).toBe("DELETE");
  });

  it("extracts FastAPI routes from Python (from binance quant bot)", async () => {
    const code = `
@router.get("/v1/ticker/{symbol}")
async def get_ticker(symbol: str):
    return {"symbol": symbol}

@app.post("/v1/order")
async def place_order(order: OrderRequest):
    return {"status": "ok"}
`;
    const res = await extractApiRouteMatrix({ code, filePath: "api.py", registry });
    expect(res.success).toBe(true);
    const report = JSON.parse(res.content!);
    expect(report.totalRoutesFound).toBe(2);
    expect(report.routes[0].method).toBe("GET");
    expect(report.routes[0].path).toBe("/v1/ticker/{symbol}");
    expect(report.routes[0].pathParams).toContain("symbol");
    expect(report.routes[0].handlerName).toBe("get_ticker");
    expect(report.routes[1].method).toBe("POST");
  });
});
