/**
 * Rate Limiter Tests - v3.3.0
 */
import { RateLimiter, OPERATION_COSTS } from "../src/utils/rateLimiter.js";
async function testBasicRateLimiting() {
    console.log("🧪 Testing Basic Rate Limiting...");
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 2, refillInterval: 100 });
    // Test 1: Initial request should succeed
    const result1 = await limiter.checkLimit("client1", 5);
    console.assert(result1.allowed === true, "✅ Initial request allowed");
    console.assert(limiter.getTokens("client1") === 5, "✅ Tokens deducted correctly");
    // Test 2: Second request within limit
    const result2 = await limiter.checkLimit("client1", 3);
    console.assert(result2.allowed === true, "✅ Second request allowed");
    console.assert(limiter.getTokens("client1") === 2, "✅ Tokens deducted correctly");
    // Test 3: Request exceeding limit
    const result3 = await limiter.checkLimit("client1", 5);
    console.assert(result3.allowed === false, "✅ Request exceeding limit denied");
    console.assert(result3.retryAfter !== undefined, "✅ Retry-after provided");
    limiter.stop();
    console.log("✅ Basic Rate Limiting Tests PASSED\n");
}
async function testTokenRefill() {
    console.log("🧪 Testing Token Refill...");
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10, refillInterval: 100 });
    // Consume all tokens
    await limiter.checkLimit("client1", 10);
    console.assert(limiter.getTokens("client1") === 0, "✅ All tokens consumed");
    // Wait for refill
    await new Promise(resolve => setTimeout(resolve, 1100));
    // Check refill
    const tokens = limiter.getTokens("client1");
    console.assert(tokens >= 9, `✅ Tokens refilled (${tokens}/10)`);
    limiter.stop();
    console.log("✅ Token Refill Tests PASSED\n");
}
async function testMultipleClients() {
    console.log("🧪 Testing Multiple Clients...");
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 5, refillInterval: 100 });
    // Client 1
    const result1 = await limiter.checkLimit("client1", 8);
    console.assert(result1.allowed === true, "✅ Client 1 request allowed");
    // Client 2 (independent bucket)
    const result2 = await limiter.checkLimit("client2", 8);
    console.assert(result2.allowed === true, "✅ Client 2 request allowed (independent)");
    // Client 1 should still have 2 tokens
    console.assert(limiter.getTokens("client1") === 2, "✅ Client 1 tokens independent");
    console.assert(limiter.getTokens("client2") === 2, "✅ Client 2 tokens independent");
    limiter.stop();
    console.log("✅ Multiple Clients Tests PASSED\n");
}
async function testOperationCosts() {
    console.log("🧪 Testing Operation Costs...");
    const limiter = new RateLimiter({ maxTokens: 100, refillRate: 10, refillInterval: 1000 });
    // Expensive operation
    const result1 = await limiter.checkLimit("client1", OPERATION_COSTS.get_semantic_repo_map);
    console.assert(result1.allowed === true, "✅ Expensive operation allowed");
    console.assert(limiter.getTokens("client1") === 50, "✅ Correct cost deducted (50 tokens)");
    // Cheap operation
    const result2 = await limiter.checkLimit("client1", OPERATION_COSTS.read_file_lines);
    console.assert(result2.allowed === true, "✅ Cheap operation allowed");
    console.assert(limiter.getTokens("client1") === 48, "✅ Correct cost deducted (2 tokens)");
    limiter.stop();
    console.log("✅ Operation Costs Tests PASSED\n");
}
async function testReset() {
    console.log("🧪 Testing Reset...");
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 1, refillInterval: 1000 });
    // Consume tokens
    await limiter.checkLimit("client1", 8);
    console.assert(limiter.getTokens("client1") === 2, "✅ Tokens consumed");
    // Reset
    limiter.reset("client1");
    console.assert(limiter.getTokens("client1") === 10, "✅ Tokens reset to max");
    limiter.stop();
    console.log("✅ Reset Tests PASSED\n");
}
async function runAllTests() {
    console.log("🚀 Running Rate Limiter Test Suite v3.3.0\n");
    try {
        await testBasicRateLimiting();
        await testTokenRefill();
        await testMultipleClients();
        await testOperationCosts();
        await testReset();
        console.log("✅ ALL RATE LIMITER TESTS PASSED");
        process.exit(0);
    }
    catch (error) {
        console.error("❌ RATE LIMITER TEST FAILED:", error);
        process.exit(1);
    }
}
runAllTests();
//# sourceMappingURL=test-rate-limiter.js.map