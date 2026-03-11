import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTicketIdempotencyKey,
  extractJsonArrayFromText,
  normalizeAndValidateTickets,
} from "../lib/server/ticket-normalization";

test("extractJsonArrayFromText parses fenced JSON arrays", () => {
  const response = "```json\n[{\"title\":\"Fix login\",\"description\":\"Fix timeout bug\",\"acceptance_criteria\":[\"Works under load\"],\"type\":\"Bug\"}]\n```";
  const parsed = extractJsonArrayFromText(response);

  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
});

test("normalizeAndValidateTickets removes duplicates and adds idempotency keys", () => {
  const raw = [
    {
      title: "Fix login timeout",
      description: "Investigate and patch timeout handling for auth flow.",
      acceptance_criteria: ["Timeout no longer logs users out unexpectedly"],
      type: "Bug",
    },
    {
      title: "Fix login timeout",
      description: "Investigate and patch timeout handling for auth flow.",
      acceptance_criteria: ["Timeout no longer logs users out unexpectedly"],
      type: "Bug",
    },
  ];

  const normalized = normalizeAndValidateTickets(raw);
  assert.equal(normalized.length, 1);
  assert.equal(typeof normalized[0].idempotency_key, "string");
  assert.equal(normalized[0].idempotency_key.length, 24);
});

test("buildTicketIdempotencyKey is deterministic", () => {
  const ticket = {
    title: "Improve cache invalidation",
    description: "Implement deterministic cache busting after deploy.",
    acceptance_criteria: ["Cache clears on deploy", "No stale assets are served"],
    type: "Task" as const,
  };

  const keyA = buildTicketIdempotencyKey(ticket);
  const keyB = buildTicketIdempotencyKey(ticket);

  assert.equal(keyA, keyB);
});
