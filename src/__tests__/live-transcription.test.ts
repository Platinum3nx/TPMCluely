import { describe, expect, it } from "vitest";

import { resolvePendingMicrophoneTranscript } from "../session/useLiveTranscription";

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
