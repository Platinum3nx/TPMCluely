import type { CaptureMode, PreflightCheck, PreflightReport } from "./types";

const MODE_CHECK_KEYS: Record<CaptureMode, string[]> = {
  manual: ["database_ready"],
  microphone: ["database_ready", "deepgram_key", "deepgram_connectivity", "microphone_permission"],
  system_audio: [
    "database_ready",
    "deepgram_key",
    "deepgram_connectivity",
    "screen_recording_permission",
    "system_audio_capability",
  ],
};

export function captureModeLabel(mode: CaptureMode): string {
  if (mode === "system_audio") {
    return "System audio";
  }
  if (mode === "microphone") {
    return "Microphone";
  }
  return "Manual";
}

export function getPreflightModeSummary(report: PreflightReport | null, mode: CaptureMode): string {
  return (
    report?.modes.find((entry) => entry.mode === mode)?.summary ??
    (mode === "manual"
      ? "Manual mode is ready once the desktop app finishes booting."
      : `${captureModeLabel(mode)} readiness is still loading.`)
  );
}

export function getPreflightModeCanStart(report: PreflightReport | null, mode: CaptureMode): boolean {
  return report?.modes.find((entry) => entry.mode === mode)?.canStart ?? false;
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
