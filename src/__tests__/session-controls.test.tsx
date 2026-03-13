import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        preflightState="blocked"
        preflightSummary="Microphone capture is blocked until Deepgram is configured."
        preflightWarningChecks={[]}
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

  it("keeps live controls enabled in verify mode and offers fallback actions", async () => {
    const user = userEvent.setup();
    const onSetCaptureMode = vi.fn();
    const onRefreshPreflight = vi.fn(async () => undefined);

    render(
      <SessionControls
        activeSession={null}
        audioInputDevices={[
          {
            deviceId: "built-in-mic",
            isDefault: true,
            label: "Built-in microphone",
          },
        ]}
        canStartSelectedMode
        captureError={null}
        captureHealth={null}
        captureMode="system_audio"
        captureSourceLabel={null}
        captureState="idle"
        lastTranscriptFinalizedAt={null}
        microphoneSelectionWarning={null}
        overlayOpen={false}
        overlayShortcut="CmdOrCtrl+Shift+K"
        preflightBlockingChecks={[]}
        preflightCheckedAt="2026-03-13T09:00:00Z"
        preflightLoading={false}
        preflightState="verification_required"
        preflightSummary="Shareable system-audio sources still need to be revalidated on this machine."
        preflightWarningChecks={[
          {
            key: "system_audio_source_list",
            title: "Shareable system audio sources",
            status: "warning",
            message: "Run preflight or start listening to relist shareable system-audio sources before the meeting starts.",
          },
        ]}
        screenContextEnabled
        screenShareError={null}
        screenShareOwnedByCapture={false}
        screenShareState="inactive"
        selectedMicrophoneDeviceId=""
        transcriptFreshnessLabel="Idle"
        onCompleteSession={vi.fn(async () => undefined)}
        onPauseSession={vi.fn(async () => undefined)}
        onRefreshPreflight={onRefreshPreflight}
        onResumeSession={vi.fn(async () => undefined)}
        onSelectMicrophoneDevice={vi.fn(async () => undefined)}
        onSetCaptureMode={onSetCaptureMode}
        onStartLiveCapture={vi.fn(async () => undefined)}
        onStartScreenShare={vi.fn(async () => false)}
        onStartSession={vi.fn(async () => undefined)}
        onStopLiveCapture={vi.fn(async () => undefined)}
        onStopScreenShare={vi.fn(async () => undefined)}
        onToggleOverlay={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByText("Verify")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Listening" })).toBeEnabled();
    expect(screen.getByText("Verify this capture path before the meeting starts")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry verification" }));
    expect(onRefreshPreflight).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Switch to microphone" }));
    expect(onSetCaptureMode).toHaveBeenCalledWith("microphone");
  });
});
