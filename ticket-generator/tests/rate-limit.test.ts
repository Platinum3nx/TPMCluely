import test from "node:test";
import assert from "node:assert/strict";
import { consumeRateLimit } from "../lib/server/rate-limit";

test("consumeRateLimit blocks once limit is exceeded", () => {
  const key = "generate:1.2.3.4";
  const limit = 2;
  const windowMs = 1_000;
  const now = Date.now();

  const first = consumeRateLimit(key, limit, windowMs, now);
  const second = consumeRateLimit(key, limit, windowMs, now + 10);
  const third = consumeRateLimit(key, limit, windowMs, now + 20);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterMs > 0);
});
