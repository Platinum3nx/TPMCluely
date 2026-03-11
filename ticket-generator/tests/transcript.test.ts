import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TRANSCRIPT_CHARS,
  TARGET_MODEL_TRANSCRIPT_CHARS,
  prepareTranscriptForModel,
} from "../lib/server/transcript";

test("prepareTranscriptForModel keeps small transcripts unchanged", () => {
  const transcript = "PM: We need to fix login timeout.\nEng: I will ship a fix tomorrow.";
  const result = prepareTranscriptForModel(transcript);

  assert.equal(result.condensed, false);
  assert.equal(result.transcriptForModel, transcript);
  assert.equal(result.warnings.length, 0);
});

test("prepareTranscriptForModel condenses oversized transcripts within model target", () => {
  const baseLine = "Speaker: action item fix auth bug and create ticket for regression.\n";
  const transcript = baseLine.repeat(1200);
  const result = prepareTranscriptForModel(transcript);

  assert.equal(result.condensed, true);
  assert.ok(result.transcriptForModel.length <= TARGET_MODEL_TRANSCRIPT_CHARS);
  assert.ok(result.warnings.length >= 1);
});

test("prepareTranscriptForModel rejects transcripts over hard limit", () => {
  const transcript = "x".repeat(MAX_TRANSCRIPT_CHARS + 1);

  assert.throws(() => prepareTranscriptForModel(transcript), /Transcript is too large/i);
});
