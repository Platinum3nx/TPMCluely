import { describe, expect, it } from "vitest";

import {
  captureModeLabel,
  getBlockingChecksForMode,
  getPreflightModeCanStart,
  getPreflightModeLabel,
  getPreflightModeState,
  getPreflightModeSummary,
  mergeRendererPreflightReport,
} from "../lib/preflight";
import type { PreflightReport } from "../lib/types";

const report: PreflightReport = {
  checkedAt: "2026-03-13T09:00:00Z",
  checks: [
    {
      key: "database_ready",
      title: "Database",
      status: "ready",
      message: "Database is ready.",
    },
    {
      key: "deepgram_connectivity",
      title: "Deepgram connectivity",
      status: "ready",
      message: "Deepgram connectivity check succeeded.",
    },
    {
      key: "microphone_permission",
      title: "Microphone permission",
      status: "ready",
      message: "Microphone access is granted.",
    },
    {
      key: "preferred_microphone",
      title: "Preferred microphone",
      status: "ready",
      message: "A preferred microphone is saved.",
      detail: "built-in-mic",
    },
    {
      key: "microphone_device_available",
      title: "Selected microphone",
      status: "ready",
      message: "Built-in microphone is available.",
      detail: "built-in-mic",
    },
    {
      key: "microphone_stream_probe",
      title: "Microphone stream probe",
      status: "warning",
      message: "Run preflight or start listening to verify the selected microphone stream.",
      detail: "built-in-mic",
    },
    {
      key: "screen_recording_permission",
      title: "Screen Recording permission",
      status: "ready",
      message: "Screen Recording access is granted.",
    },
    {
      key: "system_audio_capability",
      title: "System audio capture",
      status: "ready",
      message: "Native system audio capture is available.",
    },
    {
      key: "system_audio_source_list",
      title: "Shareable system audio sources",
      status: "warning",
      message: "Run preflight or start listening to relist shareable system-audio sources before the meeting starts.",
    },
  ],
  modes: [
    { mode: "manual", canStart: true, state: "ready", summary: "Manual mode is ready." },
    {
      mode: "microphone",
      canStart: true,
      state: "verification_required",
      summary: "Verify the selected microphone before TPMCluely starts live capture.",
    },
    {
      mode: "system_audio",
      canStart: true,
      state: "verification_required",
      summary: "Verify that shareable system-audio sources are available before TPMCluely starts live capture.",
    },
  ],
};

describe("preflight helpers", () => {
  it("returns the selected mode summary and readiness", () => {
    expect(getPreflightModeSummary(report, "manual")).toBe("Manual mode is ready.");
    expect(getPreflightModeCanStart(report, "manual")).toBe(true);
    expect(getPreflightModeCanStart(report, "microphone")).toBe(true);
    expect(getPreflightModeState(report, "microphone")).toBe("verification_required");
    expect(getPreflightModeLabel("verification_required")).toBe("Verify");
  });

  it("filters blocking checks for a capture mode", () => {
    const blockingChecks = getBlockingChecksForMode(
      mergeRendererPreflightReport(report, [
        {
          key: "deepgram_connectivity",
          title: "Deepgram connectivity",
          status: "blocked",
          message: "Deepgram connectivity check failed.",
        },
      ]),
      "microphone"
    );
    expect(blockingChecks).toHaveLength(1);
    expect(blockingChecks[0]?.title).toBe("Deepgram connectivity");
  });

  it("formats capture mode labels for the UI", () => {
    expect(captureModeLabel("manual")).toBe("Manual");
    expect(captureModeLabel("microphone")).toBe("Microphone");
    expect(captureModeLabel("system_audio")).toBe("System audio");
  });

  it("promotes microphone readiness only after the renderer probe succeeds", () => {
    const merged = mergeRendererPreflightReport(report, [
      {
        key: "microphone_stream_probe",
        title: "Microphone stream probe",
        status: "ready",
        message: "The selected microphone opened successfully and can stream audio.",
        detail: "built-in-mic",
      },
    ]);

    expect(getPreflightModeState(merged, "microphone")).toBe("ready");
    expect(getPreflightModeSummary(merged, "microphone")).toContain("verified for this machine");
  });

  it("blocks microphone mode when the saved device is missing", () => {
    const merged = mergeRendererPreflightReport(report, [
      {
        key: "microphone_device_available",
        title: "Selected microphone",
        status: "blocked",
        message: "The saved preferred microphone is unavailable on this machine. Choose another input before the meeting starts.",
        detail: "stale-device-id",
      },
    ]);

    expect(getPreflightModeCanStart(merged, "microphone")).toBe(false);
    expect(getPreflightModeState(merged, "microphone")).toBe("blocked");
  });
});
