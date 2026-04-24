import { LRUCache } from "../src/cache/astCache.js";

console.log("🧪 Cache Memory Limits Test\n");

const cache = new LRUCache<string, string>(3, 100); // 3 entries, 100 bytes max

cache.set("a", "x".repeat(30), undefined, 30);
cache.set("b", "y".repeat(30), undefined, 30);
cache.set("c", "z".repeat(30), undefined, 30);

let stats = cache.getStats();
console.log(stats.bytes === 90 && stats.entries === 3 ? "✅ PASS: 3 entries, 90 bytes" : "❌ FAIL");

cache.set("d", "w".repeat(50), undefined, 50); // Should evict a,b to fit

stats = cache.getStats();
console.log(stats.bytes <= 100 && stats.entries <= 3 ? "✅ PASS: Evicted old entries" : "❌ FAIL");
console.log(cache.has("a") === false ? "✅ PASS: 'a' evicted" : "❌ FAIL");

console.log("\n✨ Done");
