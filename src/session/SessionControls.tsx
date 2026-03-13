import { useState } from "react";
import { captureModeLabel, getPreflightModeLabel } from "../lib/preflight";
import type {
  AudioInputDevice,
  CaptureHealthPayload,
  CaptureMode,
  PreflightCheck,
  PreflightModeState,
  ScreenShareState,
  SessionDetail,
} from "../lib/types";

interface SessionControlsProps {
  activeSession: SessionDetail | null;
  audioInputDevices: AudioInputDevice[];
  canStartSelectedMode: boolean;
  captureError: string | null;
  captureHealth: CaptureHealthPayload | null;
  captureMode: CaptureMode;
  captureSourceLabel: string | null;
  captureState: string;
  lastTranscriptFinalizedAt: string | null;
  microphoneSelectionWarning: string | null;
  overlayOpen: boolean;
  overlayShortcut: string;
  preflightBlockingChecks: PreflightCheck[];
  preflightCheckedAt: string | null;
  preflightLoading: boolean;
  preflightState: PreflightModeState;
  preflightSummary: string;
  preflightWarningChecks: PreflightCheck[];
  screenContextEnabled: boolean;
  screenShareError: string | null;
  screenShareOwnedByCapture: boolean;
  screenShareState: ScreenShareState;
  selectedMicrophoneDeviceId: string;
  transcriptFreshnessLabel: string;
  onCompleteSession: (sessionId: string) => Promise<void>;
  onPauseSession: (sessionId: string) => Promise<void>;
  onRefreshPreflight: () => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onSelectMicrophoneDevice: (deviceId: string) => Promise<void>;
  onSetCaptureMode: (mode: CaptureMode) => void;
  onStartLiveCapture: () => Promise<void>;
  onStartScreenShare: () => Promise<boolean>;
  onStartSession: (title: string) => Promise<void>;
  onStopLiveCapture: () => Promise<void>;
  onStopScreenShare: () => Promise<void>;
  onToggleOverlay: () => Promise<void>;
}

function screenShareLabel(screenShareState: ScreenShareState): string {
  if (screenShareState === "active") {
    return "Shared";
  }
  if (screenShareState === "requesting") {
    return "Requesting";
  }
  if (screenShareState === "error") {
    return "Needs attention";
  }
  return "Off";
}

export function SessionControls({
  activeSession,
  audioInputDevices,
  canStartSelectedMode,
  captureError,
  captureHealth,
  captureMode,
  captureSourceLabel,
  captureState,
  lastTranscriptFinalizedAt,
  microphoneSelectionWarning,
  overlayOpen,
  overlayShortcut,
  preflightBlockingChecks,
  preflightCheckedAt,
  preflightLoading,
  preflightState,
  preflightSummary,
  preflightWarningChecks,
  screenContextEnabled,
  screenShareError,
  screenShareOwnedByCapture,
  screenShareState,
  selectedMicrophoneDeviceId,
  transcriptFreshnessLabel,
  onCompleteSession,
  onPauseSession,
  onRefreshPreflight,
  onResumeSession,
  onSelectMicrophoneDevice,
  onSetCaptureMode,
  onStartLiveCapture,
  onStartScreenShare,
  onStartSession,
  onStopLiveCapture,
  onStopScreenShare,
  onToggleOverlay,
}: SessionControlsProps) {
  const [title, setTitle] = useState("Sprint planning sync");
  const status = activeSession?.session.status ?? "idle";
  const canStartMeeting = title.trim().length > 0 && (captureMode === "manual" || canStartSelectedMode);
  const selectedMicrophoneLabel =
    audioInputDevices.find((device) => device.deviceId === selectedMicrophoneDeviceId)?.label ?? "Default microphone";
  const showVerificationGuidance = preflightState === "verification_required" && preflightWarningChecks.length > 0;
  const showRecoveryActions = captureMode !== "manual" && (preflightState !== "ready" || Boolean(captureError));

  return (
    <article className="card">
      <div className="section-header">
        <div>
          <p className="card-title">{activeSession ? "Session Controls" : "Start a Meeting"}</p>
          <p className="card-detail">
            TPMCluely runs a preflight before listening, answers in-meeting questions from the transcript, and ends in
            review-first ticket drafts for Linear.
          </p>
        </div>
        <button type="button" className="secondary-button" disabled={preflightLoading} onClick={() => void onRefreshPreflight()}>
          {preflightLoading ? "Checking..." : "Run preflight"}
        </button>
      </div>

      {!activeSession ? (
        <div className="field-row">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Session title" />
          <button type="button" onClick={() => void onStartSession(title)} disabled={!canStartMeeting}>
            Start Meeting
          </button>
        </div>
      ) : null}

      <div className="field">
        <span>Capture mode</span>
        <select value={captureMode} onChange={(event) => onSetCaptureMode(event.target.value as CaptureMode)}>
          <option value="microphone">Microphone + Deepgram</option>
          <option value="system_audio">System audio (advanced)</option>
          <option value="manual">Manual only</option>
        </select>
      </div>

      {captureMode === "microphone" ? (
        <label className="field">
          <span>Microphone input</span>
          <select
            value={selectedMicrophoneDeviceId}
            onChange={(event) => void onSelectMicrophoneDevice(event.target.value)}
            disabled={audioInputDevices.length === 0}
          >
            {audioInputDevices.length === 0 ? <option value="">No microphone detected yet</option> : null}
            {audioInputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
                {device.isDefault ? " (Default)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="health-strip">
        <div className="health-pill">
          <span>Mode</span>
          <strong>{captureModeLabel(captureMode)}</strong>
        </div>
        <div className="health-pill">
          <span>Listening</span>
          <strong>{captureState}</strong>
        </div>
        <div className="health-pill">
          <span>Transcript freshness</span>
          <strong>{transcriptFreshnessLabel}</strong>
        </div>
        <div className="health-pill">
          <span>Screen context</span>
          <strong>{screenShareLabel(screenShareState)}</strong>
        </div>
        <div className="health-pill">
          <span>Input / source</span>
          <strong>{captureSourceLabel ?? (captureMode === "microphone" ? selectedMicrophoneLabel : "Not selected")}</strong>
        </div>
        <div className="health-pill">
          <span>Last finalized line</span>
          <strong>{lastTranscriptFinalizedAt ? new Date(lastTranscriptFinalizedAt).toLocaleTimeString() : "Waiting"}</strong>
        </div>
      </div>

      {activeSession ? (
        <>
          <div className="readiness-row">
            <span>Status</span>
            <strong>{status}</strong>
          </div>
          <div className="readiness-row">
            <span>Started</span>
            <strong>{new Date(activeSession.session.startedAt ?? activeSession.session.updatedAt).toLocaleTimeString()}</strong>
          </div>
        </>
      ) : null}

      <div className="preflight-summary">
        <div>
          <p className="muted-label">Selected mode readiness</p>
          <strong>{getPreflightModeLabel(preflightState)}</strong>
          <p className="card-detail">{preflightSummary}</p>
        </div>
        {preflightCheckedAt ? <span className="section-meta">Checked {new Date(preflightCheckedAt).toLocaleTimeString()}</span> : null}
      </div>

      {showVerificationGuidance ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Verify this capture path before the meeting starts</strong>
          <div className="check-list">
            {preflightWarningChecks.map((check) => (
              <div key={check.key} className="check-list-item">
                <span>{check.title}</span>
                <strong>{check.message}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {preflightBlockingChecks.length > 0 ? (
        <div className="inline-alert">
          <strong>Fix these before starting {captureModeLabel(captureMode).toLowerCase()} capture</strong>
          <div className="check-list">
            {preflightBlockingChecks.map((check) => (
              <div key={check.key} className="check-list-item">
                <span>{check.title}</span>
                <strong>{check.message}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showRecoveryActions ? (
        <div className="toolbar-row">
          <button type="button" className="secondary-button" disabled={preflightLoading} onClick={() => void onRefreshPreflight()}>
            {preflightLoading ? "Checking..." : "Retry verification"}
          </button>
          {captureMode === "system_audio" ? (
            <button type="button" className="secondary-button" onClick={() => onSetCaptureMode("microphone")}>
              Switch to microphone
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => onSetCaptureMode("manual")}>
            Switch to manual
          </button>
        </div>
      ) : null}

      <div className="toolbar-row">
        {captureState === "listening" || captureState === "connecting" || captureState === "stopping" || captureState === "degraded" ? (
          <button type="button" onClick={() => void onStopLiveCapture()}>
            Stop Listening
          </button>
        ) : (
          <button type="button" disabled={!canStartSelectedMode && captureMode !== "manual"} onClick={() => void onStartLiveCapture()}>
            Start Listening
          </button>
        )}
        <button type="button" className="secondary-button" onClick={() => void onToggleOverlay()}>
          {overlayOpen ? "Close Overlay" : "Open Overlay"}
        </button>
        {activeSession && status === "active" ? (
          <button type="button" onClick={() => void onPauseSession(activeSession.session.id)}>
            Pause
          </button>
        ) : null}
        {activeSession && status === "paused" ? (
          <button type="button" onClick={() => void onResumeSession(activeSession.session.id)}>
            Resume
          </button>
        ) : null}
        {activeSession && status !== "completed" ? (
          <button type="button" onClick={() => void onCompleteSession(activeSession.session.id)}>
            End Session
          </button>
        ) : null}
      </div>

      {screenContextEnabled && !screenShareOwnedByCapture && activeSession ? (
        <div className="toolbar-row">
          {screenShareState === "active" ? (
            <button type="button" className="secondary-button" onClick={() => void onStopScreenShare()}>
              Stop Sharing Screen
            </button>
          ) : (
            <button type="button" className="secondary-button" onClick={() => void onStartScreenShare()}>
              Share Screen
            </button>
          )}
        </div>
      ) : null}

      <p className="card-detail">Overlay shortcut: {overlayShortcut}</p>

      {captureHealth ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Capture health</strong>
          <p>{captureHealth.message}</p>
        </div>
      ) : null}
      {microphoneSelectionWarning && captureMode === "microphone" ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Microphone selection</strong>
          <p>{microphoneSelectionWarning}</p>
        </div>
      ) : null}
      {captureError ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Live transcription needs attention</strong>
          <p>{captureError}</p>
        </div>
      ) : null}
      {screenShareError ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Screen context needs attention</strong>
          <p>{screenShareError}</p>
        </div>
      ) : null}
    </article>
  );
}
