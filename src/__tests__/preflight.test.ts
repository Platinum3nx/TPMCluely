import { describe, expect, it } from "vitest";

import {
  captureModeLabel,
  getBlockingChecksForMode,
  getPreflightModeCanStart,
  getPreflightModeSummary,
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
      status: "blocked",
      message: "Deepgram connectivity check failed.",
    },
    {
      key: "microphone_permission",
      title: "Microphone permission",
      status: "ready",
      message: "Microphone access is granted.",
    },
  ],
  modes: [
    { mode: "manual", canStart: true, summary: "Manual mode is ready." },
    { mode: "microphone", canStart: false, summary: "Microphone mode is blocked." },
    { mode: "system_audio", canStart: false, summary: "System audio mode is blocked." },
  ],
};

describe("preflight helpers", () => {
  it("returns the selected mode summary and readiness", () => {
    expect(getPreflightModeSummary(report, "manual")).toBe("Manual mode is ready.");
    expect(getPreflightModeCanStart(report, "manual")).toBe(true);
    expect(getPreflightModeCanStart(report, "microphone")).toBe(false);
  });

  it("filters blocking checks for a capture mode", () => {
    const blockingChecks = getBlockingChecksForMode(report, "microphone");
    expect(blockingChecks).toHaveLength(1);
    expect(blockingChecks[0]?.title).toBe("Deepgram connectivity");
  });

  it("formats capture mode labels for the UI", () => {
    expect(captureModeLabel("manual")).toBe("Manual");
    expect(captureModeLabel("microphone")).toBe("Microphone");
    expect(captureModeLabel("system_audio")).toBe("System audio");
  });
});
