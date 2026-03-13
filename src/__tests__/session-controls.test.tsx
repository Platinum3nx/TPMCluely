import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionControls } from "../session/SessionControls";

describe("SessionControls", () => {
  it("surfaces preflight blockers and disables listening when the selected mode is not ready", () => {
    render(
      <SessionControls
        activeSession={null}
        audioInputDevices={[]}
        canStartSelectedMode={false}
        captureError={null}
        captureHealth={null}
        captureMode="microphone"
        captureSourceLabel={null}
        captureState="idle"
        lastTranscriptFinalizedAt={null}
        microphoneSelectionWarning="No preferred microphone is saved yet."
        overlayOpen={false}
        overlayShortcut="CmdOrCtrl+Shift+K"
        preflightBlockingChecks={[
          {
            key: "deepgram_connectivity",
            title: "Deepgram connectivity",
            status: "blocked",
            message: "Deepgram connectivity check failed.",
          },
        ]}
        preflightCheckedAt="2026-03-13T09:00:00Z"
        preflightLoading={false}
        preflightSummary="Microphone capture is blocked until Deepgram is configured."
        screenContextEnabled
        screenShareError={null}
        screenShareOwnedByCapture={false}
        screenShareState="inactive"
        selectedMicrophoneDeviceId=""
        transcriptFreshnessLabel="Waiting for first finalized transcript"
        onCompleteSession={vi.fn(async () => undefined)}
        onPauseSession={vi.fn(async () => undefined)}
        onRefreshPreflight={vi.fn(async () => undefined)}
        onResumeSession={vi.fn(async () => undefined)}
        onSelectMicrophoneDevice={vi.fn(async () => undefined)}
        onSetCaptureMode={vi.fn()}
        onStartLiveCapture={vi.fn(async () => undefined)}
        onStartScreenShare={vi.fn(async () => false)}
        onStartSession={vi.fn(async () => undefined)}
        onStopLiveCapture={vi.fn(async () => undefined)}
        onStopScreenShare={vi.fn(async () => undefined)}
        onToggleOverlay={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByText("Fix these before starting microphone capture")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Listening" })).toBeDisabled();
    expect(screen.getByText("Deepgram connectivity check failed.")).toBeInTheDocument();
    expect(screen.getByText("No preferred microphone is saved yet.")).toBeInTheDocument();
  });
});
