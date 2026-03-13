import type {
  CaptureMode,
  PreflightCheck,
  PreflightModeReport,
  PreflightModeState,
  PreflightReport,
} from "./types";

const MODE_CHECK_KEYS: Record<CaptureMode, string[]> = {
  manual: ["database_ready"],
  microphone: [
    "database_ready",
    "deepgram_key",
    "deepgram_connectivity",
    "microphone_permission",
    "preferred_microphone",
    "microphone_device_available",
    "microphone_stream_probe",
  ],
  system_audio: [
    "database_ready",
    "deepgram_key",
    "deepgram_connectivity",
    "screen_recording_permission",
    "system_audio_capability",
    "system_audio_source_list",
  ],
};

const MICROPHONE_DEVICE_CHECK_KEY = "microphone_device_available";
const MICROPHONE_PROBE_CHECK_KEY = "microphone_stream_probe";
const SYSTEM_AUDIO_SOURCE_LIST_KEY = "system_audio_source_list";

function upsertCheck(checks: PreflightCheck[], nextCheck: PreflightCheck): PreflightCheck[] {
  const nextChecks = checks.filter((check) => check.key !== nextCheck.key);
  nextChecks.push(nextCheck);
  return nextChecks;
}

function findModeEntry(report: PreflightReport | null, mode: CaptureMode): PreflightModeReport | null {
  return report?.modes.find((entry) => entry.mode === mode) ?? null;
}

function summarizeMode(mode: CaptureMode, state: PreflightModeState, checks: PreflightCheck[]): string {
  const blockingChecks = checks.filter((check) => check.status === "blocked");
  if (blockingChecks.length > 0) {
    return blockingChecks[0]?.message ?? `${captureModeLabel(mode)} capture is blocked.`;
  }

  if (mode === "manual") {
    return "Manual mode is ready. You can start the meeting even if providers are still being configured.";
  }

  if (mode === "microphone") {
    const probeCheck = checks.find((check) => check.key === MICROPHONE_PROBE_CHECK_KEY);
    const deviceCheck = checks.find((check) => check.key === MICROPHONE_DEVICE_CHECK_KEY);
    if (state === "ready") {
      return "Microphone capture is verified for this machine and ready for a live meeting.";
    }
    return (
      probeCheck?.message ??
      deviceCheck?.message ??
      "Verify the selected microphone before TPMCluely starts live capture."
    );
  }

  const sourceListCheck = checks.find((check) => check.key === SYSTEM_AUDIO_SOURCE_LIST_KEY);
  return (
    sourceListCheck?.message ??
    "Verify that shareable system-audio sources are available before TPMCluely starts live capture."
  );
}

function buildModeReport(report: PreflightReport | null, mode: CaptureMode): PreflightModeReport {
  const baseEntry = findModeEntry(report, mode);
  const checks = getPreflightChecksForMode(report, mode);
  const blocked = checks.some((check) => check.status === "blocked");

  if (mode === "manual") {
    const canStart = !blocked && (baseEntry?.canStart ?? false);
    return {
      mode,
      canStart,
      state: canStart ? "ready" : "blocked",
      summary: summarizeMode(mode, canStart ? "ready" : "blocked", checks),
    };
  }

  if (blocked || !(baseEntry?.canStart ?? false)) {
    return {
      mode,
      canStart: false,
      state: "blocked",
      summary: summarizeMode(mode, "blocked", checks),
    };
  }

  if (mode === "microphone") {
    const probeCheck = checks.find((check) => check.key === MICROPHONE_PROBE_CHECK_KEY);
    const state: PreflightModeState = probeCheck?.status === "ready" ? "ready" : "verification_required";
    return {
      mode,
      canStart: true,
      state,
      summary: summarizeMode(mode, state, checks),
    };
  }

  return {
    mode,
    canStart: true,
    state: "verification_required",
    summary: summarizeMode(mode, "verification_required", checks),
  };
}

export function captureModeLabel(mode: CaptureMode): string {
  if (mode === "system_audio") {
    return "System audio";
  }
  if (mode === "microphone") {
    return "Microphone";
  }
  return "Manual";
}

export function mergeRendererPreflightReport(
  report: PreflightReport | null,
  localChecks: PreflightCheck[]
): PreflightReport | null {
  if (!report) {
    return null;
  }

  const mergedChecks = localChecks.reduce((current, nextCheck) => upsertCheck(current, nextCheck), [...report.checks]);
  return {
    ...report,
    checks: mergedChecks,
    modes: (["manual", "microphone", "system_audio"] as CaptureMode[]).map((mode) =>
      buildModeReport({ ...report, checks: mergedChecks, modes: report.modes }, mode)
    ),
  };
}

export function getPreflightModeSummary(report: PreflightReport | null, mode: CaptureMode): string {
  return (
    findModeEntry(report, mode)?.summary ??
    (mode === "manual"
      ? "Manual mode is ready once the desktop app finishes booting."
      : `${captureModeLabel(mode)} readiness is still loading.`)
  );
}

export function getPreflightModeCanStart(report: PreflightReport | null, mode: CaptureMode): boolean {
  return findModeEntry(report, mode)?.canStart ?? false;
}

export function getPreflightModeState(report: PreflightReport | null, mode: CaptureMode): PreflightModeState {
  return findModeEntry(report, mode)?.state ?? "blocked";
}

export function getPreflightModeLabel(state: PreflightModeState): string {
  if (state === "ready") {
    return "Ready";
  }
  if (state === "verification_required") {
    return "Verify";
  }
  return "Blocked";
}

export function getPreflightChecksForMode(report: PreflightReport | null, mode: CaptureMode): PreflightCheck[] {
  if (!report) {
    return [];
  }

  const allowedKeys = new Set(MODE_CHECK_KEYS[mode]);
  return report.checks.filter((check) => allowedKeys.has(check.key));
}

export function getBlockingChecksForMode(report: PreflightReport | null, mode: CaptureMode): PreflightCheck[] {
  return getPreflightChecksForMode(report, mode).filter((check) => check.status === "blocked");
}

export function getWarningChecksForMode(report: PreflightReport | null, mode: CaptureMode): PreflightCheck[] {
  return getPreflightChecksForMode(report, mode).filter((check) => check.status === "warning");
}
