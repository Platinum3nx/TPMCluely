import test from "node:test";
import assert from "node:assert/strict";
import { buildLinearDescription } from "../lib/server/linear";

test("buildLinearDescription appends checklist and idempotency marker", () => {
  const description = buildLinearDescription(
    "Implement retry middleware",
    ["Retries only on 429/5xx", "Timeout at 12 seconds"],
    "abc123"
  );

  assert.match(description, /\*\*Acceptance Criteria\*\*/);
  assert.match(description, /- \[ \] Retries only on 429\/5xx/);
  assert.match(description, /cluely-idempotency:abc123/);
});
