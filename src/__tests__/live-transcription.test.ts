import { describe, expect, it } from "vitest";

import { normalizeDeepgramFinalSegments, resolvePendingMicrophoneTranscript } from "../session/useLiveTranscription";

describe("resolvePendingMicrophoneTranscript", () => {
  it("flushes the last interim transcript when no final transcript arrived yet", () => {
    expect(resolvePendingMicrophoneTranscript("We should ship this sprint", "")).toBe(
      "We should ship this sprint"
    );
  });

  it("does not duplicate the last final transcript", () => {
    expect(resolvePendingMicrophoneTranscript("We should ship this sprint", "We should ship this sprint")).toBeNull();
  });

  it("ignores empty interim transcript fragments", () => {
    expect(resolvePendingMicrophoneTranscript("   ", "")).toBeNull();
  });
});

describe("normalizeDeepgramFinalSegments", () => {
  it("splits finalized Deepgram words into speaker turns", () => {
    const segments = normalizeDeepgramFinalSegments({
      type: "Results",
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: "I can take the backend fix. I will handle QA after that.",
            words: [
              { punctuated_word: "I", speaker: 0 },
              { punctuated_word: "can", speaker: 0 },
              { punctuated_word: "take", speaker: 0 },
              { punctuated_word: "the", speaker: 0 },
              { punctuated_word: "backend", speaker: 0 },
              { punctuated_word: "fix.", speaker: 0 },
              { punctuated_word: "I", speaker: 1 },
              { punctuated_word: "will", speaker: 1 },
              { punctuated_word: "handle", speaker: 1 },
              { punctuated_word: "QA", speaker: 1 },
              { punctuated_word: "after", speaker: 1 },
              { punctuated_word: "that.", speaker: 1 },
            ],
          },
        ],
      },
    });

    expect(segments).toEqual([
      {
        speakerId: "dg:0",
        speakerLabel: "Speaker 1",
        speakerConfidence: null,
        text: "I can take the backend fix.",
        source: "capture",
      },
      {
        speakerId: "dg:1",
        speakerLabel: "Speaker 2",
        speakerConfidence: null,
        text: "I will handle QA after that.",
        source: "capture",
      },
    ]);
  });

  it("falls back to an unattributed finalized segment when no speaker metadata exists", () => {
    const segments = normalizeDeepgramFinalSegments({
      type: "Results",
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: "We should ship the rollback fix today.",
          },
        ],
      },
    });

    expect(segments).toEqual([
      {
        speakerId: null,
        speakerLabel: null,
        speakerConfidence: null,
        text: "We should ship the rollback fix today.",
        source: "capture",
      },
    ]);
  });
});
