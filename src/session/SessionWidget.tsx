import { useState } from "react";
import { AssistantFeed } from "../components/AssistantFeed";
import { captureModeLabel, getPreflightModeLabel } from "../lib/preflight";
import type {
  AudioInputDevice,
  CaptureHealthPayload,
  CaptureMode,
  DynamicActionKey,
  PreflightCheck,
  PreflightModeState,
  ScreenShareState,
  SessionDetail,
  StreamingAssistantDraft,
  SystemAudioSource,
} from "../lib/types";
import { AskBar } from "./AskBar";
import { DynamicActions } from "./DynamicActions";
import { SessionControls } from "./SessionControls";
import { SystemAudioSourcePicker } from "./SystemAudioSourcePicker";
import { TranscriptPanel } from "./TranscriptPanel";

interface SessionWidgetProps {
  activeSession: SessionDetail | null;
  assistantError: string | null;
  assistantInFlightAction: DynamicActionKey | null;
  askInFlight: boolean;
  audioInputDevices: AudioInputDevice[];
  canStartSelectedMode: boolean;
  captureError: string | null;
  captureHealth: CaptureHealthPayload | null;
  captureMode: CaptureMode;
  captureSourceLabel: string | null;
  captureState: string;
  deepgramReady: boolean;
  geminiReady: boolean;
  isCapturing: boolean;
  lastTranscriptFinalizedAt: string | null;
  linearReady: boolean;
  microphoneSelectionWarning: string | null;
  overlayOpen: boolean;
  overlayShortcut: string;
  partialTranscript: string;
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
  streamingAssistantDraft: StreamingAssistantDraft | null;
  stealthMode?: boolean;
  systemAudioPickerError: string | null;
  systemAudioPickerLoading: boolean;
  systemAudioPickerOpen: boolean;
  systemAudioSources: SystemAudioSource[];
  transcriptFreshnessLabel: string;
  onAppendTranscript: (speakerLabel: string, text: string) => Promise<void>;
  onRenameSpeaker: (sessionId: string, speakerId: string, displayLabel: string) => Promise<void>;
  onAsk: (prompt: string) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
  onDynamicAction: (action: DynamicActionKey) => Promise<void>;
  onPauseSession: (sessionId: string) => Promise<void>;
  onRefreshPreflight: () => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onRetryAssistantRequest: () => Promise<void>;
  onSelectMicrophoneDevice: (deviceId: string) => Promise<void>;
  onSelectSystemAudioSource: (source: SystemAudioSource) => Promise<void>;
  onSetCaptureMode: (mode: CaptureMode) => void;
  onStartLiveCapture: () => Promise<void>;
  onStartListening: () => Promise<void>;
  onStartScreenShare: () => Promise<boolean>;
  onStartSession: (title: string) => Promise<void>;
  onStopLiveCapture: () => Promise<void>;
  onStopScreenShare: () => Promise<void>;
  onSystemAudioPickerClose: () => void;
  onToggleOverlay: () => Promise<void>;
}

const overlayModes: Array<{ mode: CaptureMode; label: string; detail: string }> = [
  { mode: "microphone", label: "Mic", detail: "Recommended for real meetings and rehearsal." },
  { mode: "system_audio", label: "System", detail: "Advanced mode when macOS capture and Screen Recording are ready." },
  { mode: "manual", label: "Manual", detail: "Stay transcript-only if audio capture is unavailable." },
];

function formatListeningLabel(captureState: string, isCapturing: boolean): string {
  if (captureState === "connecting") {
    return "Connecting";
  }
  if (captureState === "stopping") {
    return "Stopping";
  }
  if (captureState === "degraded") {
    return "Recovering";
  }
  if (captureState === "error") {
    return "Needs attention";
  }
  return isCapturing ? "Listening" : "Ready";
}

function screenStatusLabel(screenShareState: ScreenShareState): string {
  if (screenShareState === "active") {
    return "Screen shared";
  }
  if (screenShareState === "requesting") {
    return "Requesting";
  }
  if (screenShareState === "error") {
    return "Needs attention";
  }
  return "Screen off";
}

function renderOverlayCapability(label: string, ready: boolean, statusText?: string) {
  return (
    <div className={`overlay-capability ${ready ? "overlay-capability-ready" : "overlay-capability-missing"}`}>
      <strong>{label}</strong>
      <span>{statusText ?? (ready ? "Ready" : "Missing")}</span>
    </div>
  );
}

function renderBlockingChecks(checks: PreflightCheck[]) {
  if (checks.length === 0) {
    return null;
  }

  return (
    <div className="inline-alert">
      <strong>Selected mode is blocked</strong>
      <div className="check-list">
        {checks.map((check) => (
          <div key={check.key} className="check-list-item">
            <span>{check.title}</span>
            <strong>{check.message}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderVerificationChecks(checks: PreflightCheck[]) {
  if (checks.length === 0) {
    return null;
  }

  return (
    <div className="inline-alert inline-alert-soft">
      <strong>Selected mode still needs verification</strong>
      <div className="check-list">
        {checks.map((check) => (
          <div key={check.key} className="check-list-item">
            <span>{check.title}</span>
            <strong>{check.message}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SessionWidget({
  activeSession,
  assistantError,
  assistantInFlightAction,
  askInFlight,
  audioInputDevices,
  canStartSelectedMode,
  captureError,
  captureHealth,
  captureMode,
  captureSourceLabel,
  captureState,
  deepgramReady,
  geminiReady,
  isCapturing,
  lastTranscriptFinalizedAt,
  linearReady,
  microphoneSelectionWarning,
  overlayOpen,
  overlayShortcut,
  partialTranscript,
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
  streamingAssistantDraft,
  stealthMode = false,
  systemAudioPickerError,
  systemAudioPickerLoading,
  systemAudioPickerOpen,
  systemAudioSources,
  transcriptFreshnessLabel,
  onAppendTranscript,
  onRenameSpeaker,
  onAsk,
  onCompleteSession,
  onDynamicAction,
  onPauseSession,
  onRefreshPreflight,
  onResumeSession,
  onRetryAssistantRequest,
  onSelectMicrophoneDevice,
  onSelectSystemAudioSource,
  onSetCaptureMode,
  onStartLiveCapture,
  onStartListening,
  onStartScreenShare,
  onStartSession,
  onStopLiveCapture,
  onStopScreenShare,
  onSystemAudioPickerClose,
  onToggleOverlay,
}: SessionWidgetProps) {
  const status = activeSession?.session.status ?? "idle";
  const overlayPrimaryLabel = captureMode === "manual" ? "Start Meeting" : "Start Listening";
  const listeningLabel = formatListeningLabel(captureState, isCapturing);
  const showRecoveryActions = captureMode !== "manual" && (preflightState !== "ready" || Boolean(captureError));

  function renderRecoveryActions() {
    if (!showRecoveryActions) {
      return null;
    }

    return (
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
    );
  }

  if (overlayOpen && stealthMode) {
    return <StealthOverlay
      activeSession={activeSession}
      askInFlight={askInFlight}
      assistantError={assistantError}
      assistantInFlightAction={assistantInFlightAction}
      captureMode={captureMode}
      captureState={captureState}
      canStartSelectedMode={canStartSelectedMode}
      isCapturing={isCapturing}
      listeningLabel={listeningLabel}
      partialTranscript={partialTranscript}
      status={status}
      streamingAssistantDraft={streamingAssistantDraft}
      onAsk={onAsk}
      onCompleteSession={onCompleteSession}
      onDynamicAction={onDynamicAction}
      onPauseSession={onPauseSession}
      onResumeSession={onResumeSession}
      onRetryAssistantRequest={onRetryAssistantRequest}
      onStartListening={onStartListening}
      onStartLiveCapture={onStartLiveCapture}
      onStopLiveCapture={onStopLiveCapture}
      onToggleOverlay={onToggleOverlay}
    />;
  }

  if (overlayOpen) {
    return (
      <>
        <SystemAudioSourcePicker
          error={systemAudioPickerError}
          loading={systemAudioPickerLoading}
          onClose={onSystemAudioPickerClose}
          onSelect={(source) => void onSelectSystemAudioSource(source)}
          open={systemAudioPickerOpen}
          sources={systemAudioSources}
        />
        <section className="cluely-overlay-shell">
          <div className="cluely-overlay-frame">
            <header className="cluely-overlay-header">
              <div className="cluely-brand-lockup">
                <span className={`cluely-brand-dot ${isCapturing ? "cluely-brand-dot-live" : ""}`} aria-hidden="true" />
                <div>
                  <p className="eyebrow">TPMCluely</p>
                  <h2>{activeSession?.session.title ?? "Meeting Copilot"}</h2>
                </div>
              </div>
              <div className="cluely-overlay-header-actions">
                <span className={`overlay-pill ${isCapturing ? "overlay-pill-live" : ""}`}>{listeningLabel}</span>
                {captureSourceLabel ? <span className="overlay-shortcut-badge">{captureSourceLabel}</span> : null}
                <button type="button" className="overlay-ghost-button" onClick={() => void onToggleOverlay()}>
                  Hide
                </button>
              </div>
            </header>

            {!activeSession ? (
              <section className="cluely-launch-surface">
                <div className="cluely-launch-copy">
                  <p className="eyebrow">Pre-Meeting</p>
                  <h3>Check readiness, pick the right input, then start listening when the meeting begins.</h3>
                  <p className="card-detail">
                    TPMCluely will stay grounded in the live transcript, answer questions during the meeting, and end
                    in review-first Linear ticket drafts.
                  </p>
                </div>

                <div className="overlay-mode-picker">
                  {overlayModes.map((option) => (
                    <button
                      type="button"
                      key={option.mode}
                      className={`overlay-mode-button ${captureMode === option.mode ? "overlay-mode-button-active" : ""}`}
                      onClick={() => onSetCaptureMode(option.mode)}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.detail}</span>
                    </button>
                  ))}
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

                <div className="overlay-capability-grid overlay-capability-grid-wide">
                  {renderOverlayCapability("Deepgram", deepgramReady)}
                  {renderOverlayCapability("Gemini", geminiReady)}
                  {renderOverlayCapability("Linear", linearReady)}
                  {renderOverlayCapability("Screen", screenShareState === "active", screenStatusLabel(screenShareState))}
                </div>

                <div className="preflight-summary preflight-summary-overlay">
                  <div>
                    <p className="muted-label">{captureModeLabel(captureMode)} readiness</p>
                    <strong>{getPreflightModeLabel(preflightState)}</strong>
                    <p className="card-detail">{preflightSummary}</p>
                  </div>
                  <button type="button" className="secondary-button" disabled={preflightLoading} onClick={() => void onRefreshPreflight()}>
                    {preflightLoading ? "Checking..." : "Run again"}
                  </button>
                </div>

                {preflightState === "verification_required" ? renderVerificationChecks(preflightWarningChecks) : null}
                {renderBlockingChecks(preflightBlockingChecks)}
                {renderRecoveryActions()}

                <div className="overlay-launch-actions">
                  <button
                    type="button"
                    className="overlay-primary-button"
                    disabled={!canStartSelectedMode && captureMode !== "manual"}
                    onClick={() => void onStartListening()}
                  >
                    {overlayPrimaryLabel}
                  </button>
                  <span className="overlay-shortcut-badge">Shortcut: {overlayShortcut}</span>
                </div>

                {microphoneSelectionWarning && captureMode === "microphone" ? (
                  <div className="inline-alert inline-alert-soft">
                    <strong>Microphone selection</strong>
                    <p>{microphoneSelectionWarning}</p>
                  </div>
                ) : null}
                {captureError ? (
                  <div className="inline-alert inline-alert-soft">
                    <strong>Listening needs attention</strong>
                    <p>{captureError}</p>
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="cluely-live-surface">
                <article className="card cluely-live-hero">
                  <div className="section-header">
                    <div>
                      <p className="card-title">{activeSession.session.title}</p>
                      <p className="card-detail">
                        {status === "paused" ? "Meeting paused" : "Meeting in progress"} · {captureModeLabel(captureMode)}
                      </p>
                    </div>
                    <div className="cluely-live-meta">
                      <span className={`overlay-pill ${isCapturing ? "overlay-pill-live" : ""}`}>{listeningLabel}</span>
                      {captureSourceLabel ? <span className="overlay-shortcut-badge">{captureSourceLabel}</span> : null}
                      <span className={`overlay-pill ${screenShareState === "active" ? "overlay-pill-live" : ""}`}>
                        {screenStatusLabel(screenShareState)}
                      </span>
                      <span className="overlay-shortcut-badge">{overlayShortcut}</span>
                    </div>
                  </div>

                  <div className="overlay-mode-picker overlay-mode-picker-compact">
                    {overlayModes.map((option) => (
                      <button
                        type="button"
                        key={option.mode}
                        className={`overlay-mode-button ${captureMode === option.mode ? "overlay-mode-button-active" : ""}`}
                        onClick={() => onSetCaptureMode(option.mode)}
                      >
                        <strong>{option.label}</strong>
                      </button>
                    ))}
                  </div>

                  <div className="health-strip">
                    <div className="health-pill">
                      <span>Transcript freshness</span>
                      <strong>{transcriptFreshnessLabel}</strong>
                    </div>
                    <div className="health-pill">
                      <span>Last finalized line</span>
                      <strong>{lastTranscriptFinalizedAt ? new Date(lastTranscriptFinalizedAt).toLocaleTimeString() : "Waiting"}</strong>
                    </div>
                    <div className="health-pill">
                      <span>Preflight</span>
                      <strong>{getPreflightModeLabel(preflightState)}</strong>
                    </div>
                  </div>

                  <div className="toolbar-row cluely-live-toolbar">
                    {status === "paused" ? (
                      <button type="button" onClick={() => void onResumeSession(activeSession.session.id)}>
                        Resume Meeting
                      </button>
                    ) : captureState === "listening" || captureState === "connecting" || captureState === "stopping" || captureState === "degraded" ? (
                      <button type="button" onClick={() => void onStopLiveCapture()}>
                        Stop Listening
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!canStartSelectedMode && captureMode !== "manual"}
                        onClick={() => void onStartLiveCapture()}
                      >
                        Start Listening
                      </button>
                    )}
                    {status === "active" ? (
                      <button type="button" className="secondary-button" onClick={() => void onPauseSession(activeSession.session.id)}>
                        Pause
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button" disabled={preflightLoading} onClick={() => void onRefreshPreflight()}>
                      {preflightLoading ? "Checking..." : "Run preflight"}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void onCompleteSession(activeSession.session.id)}>
                      End Meeting
                    </button>
                  </div>
                  {screenContextEnabled && !screenShareOwnedByCapture ? (
                    <div className="toolbar-row cluely-live-toolbar">
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
                  {preflightState === "verification_required" ? renderVerificationChecks(preflightWarningChecks) : null}
                  {renderBlockingChecks(preflightBlockingChecks)}
                  {renderRecoveryActions()}
                  {captureError ? (
                    <div className="inline-alert inline-alert-soft">
                      <strong>Listening needs attention</strong>
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

                <AskBar
                  disabled={!activeSession}
                  isLoading={askInFlight || assistantInFlightAction !== null}
                  lastError={assistantError}
                  onAsk={onAsk}
                  onRetry={assistantError ? onRetryAssistantRequest : undefined}
                  screenContextEnabled={screenContextEnabled}
                  screenShareState={screenShareState}
                />
                <DynamicActions
                  disabled={!activeSession}
                  inFlightAction={assistantInFlightAction}
                  lastError={assistantError}
                  onRetry={assistantError ? onRetryAssistantRequest : undefined}
                  onRunAction={onDynamicAction}
                />

                <div className="overlay-feed-grid">
                  <TranscriptPanel
                    captureMode={captureMode}
                    captureState={captureState}
                    overlayOpen
                    partialTranscript={partialTranscript}
                    sessionId={activeSession.session.id}
                    speakers={activeSession.speakers}
                    showManualComposer={false}
                    transcripts={activeSession.transcripts.slice(-8)}
                    onAppendTranscript={onAppendTranscript}
                    onRenameSpeaker={onRenameSpeaker}
                  />
                  <AssistantFeed
                    draft={streamingAssistantDraft?.sessionId === activeSession.session.id ? streamingAssistantDraft : null}
                    messages={activeSession.messages}
                    maxItems={5}
                  />
                </div>
              </section>
            )}
          </div>
        </section>
      </>
    );
  }

  return (
    <section className="panel session-grid">
      <SystemAudioSourcePicker
        error={systemAudioPickerError}
        loading={systemAudioPickerLoading}
        onClose={onSystemAudioPickerClose}
        onSelect={(source) => void onSelectSystemAudioSource(source)}
        open={systemAudioPickerOpen}
        sources={systemAudioSources}
      />
      <div className="panel-hero">
        <p className="eyebrow">Live Meeting</p>
        <h2>Run a real meeting with preflight checks, grounded answers, and review-first ticket drafts.</h2>
        <p className="muted">
          TPMCluely keeps the session grounded in the transcript, uses screen context only when available, and never
          pushes tickets to Linear before the user reviews them.
        </p>
      </div>

      <div className="session-grid-body">
        <div className="card-stack">
          <SessionControls
            activeSession={activeSession}
            audioInputDevices={audioInputDevices}
            canStartSelectedMode={canStartSelectedMode}
            captureError={captureError}
            captureHealth={captureHealth}
            captureMode={captureMode}
            captureSourceLabel={captureSourceLabel}
            captureState={captureState}
            lastTranscriptFinalizedAt={lastTranscriptFinalizedAt}
            microphoneSelectionWarning={microphoneSelectionWarning}
            overlayOpen={overlayOpen}
            overlayShortcut={overlayShortcut}
            preflightBlockingChecks={preflightBlockingChecks}
            preflightCheckedAt={preflightCheckedAt}
            preflightLoading={preflightLoading}
            preflightState={preflightState}
            preflightSummary={preflightSummary}
            preflightWarningChecks={preflightWarningChecks}
            screenContextEnabled={screenContextEnabled}
            screenShareError={screenShareError}
            screenShareOwnedByCapture={screenShareOwnedByCapture}
            screenShareState={screenShareState}
            selectedMicrophoneDeviceId={selectedMicrophoneDeviceId}
            transcriptFreshnessLabel={transcriptFreshnessLabel}
            onCompleteSession={onCompleteSession}
            onPauseSession={onPauseSession}
            onRefreshPreflight={onRefreshPreflight}
            onResumeSession={onResumeSession}
            onSelectMicrophoneDevice={onSelectMicrophoneDevice}
            onSetCaptureMode={onSetCaptureMode}
            onStartLiveCapture={onStartLiveCapture}
            onStartScreenShare={onStartScreenShare}
            onStartSession={onStartSession}
            onStopLiveCapture={onStopLiveCapture}
            onStopScreenShare={onStopScreenShare}
            onToggleOverlay={onToggleOverlay}
          />
          <DynamicActions
            disabled={!activeSession}
            inFlightAction={assistantInFlightAction}
            lastError={assistantError}
            onRetry={assistantError ? onRetryAssistantRequest : undefined}
            onRunAction={onDynamicAction}
          />
          <AskBar
            disabled={!activeSession}
            isLoading={askInFlight || assistantInFlightAction !== null}
            lastError={assistantError}
            onAsk={onAsk}
            onRetry={assistantError ? onRetryAssistantRequest : undefined}
            screenContextEnabled={screenContextEnabled}
            screenShareState={screenShareState}
          />
        </div>

        <div className="card-stack">
          <TranscriptPanel
            captureMode={captureMode}
            captureState={captureState}
            overlayOpen={overlayOpen}
            partialTranscript={partialTranscript}
            sessionId={activeSession?.session.id ?? null}
            speakers={activeSession?.speakers ?? []}
            transcripts={activeSession?.transcripts ?? []}
            onAppendTranscript={onAppendTranscript}
            onRenameSpeaker={onRenameSpeaker}
          />

          <AssistantFeed
            draft={
              activeSession && streamingAssistantDraft?.sessionId === activeSession.session.id
                ? streamingAssistantDraft
                : null
            }
            messages={activeSession?.messages ?? []}
          />
        </div>
      </div>
    </section>
  );
}

interface StealthOverlayProps {
  activeSession: SessionDetail | null;
  askInFlight: boolean;
  assistantError: string | null;
  assistantInFlightAction: DynamicActionKey | null;
  captureMode: CaptureMode;
  captureState: string;
  canStartSelectedMode: boolean;
  isCapturing: boolean;
  listeningLabel: string;
  partialTranscript: string;
  status: string;
  streamingAssistantDraft: StreamingAssistantDraft | null;
  onAsk: (prompt: string) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
  onDynamicAction: (action: DynamicActionKey) => Promise<void>;
  onPauseSession: (sessionId: string) => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onRetryAssistantRequest: () => Promise<void>;
  onStartListening: () => Promise<void>;
  onStartLiveCapture: () => Promise<void>;
  onStopLiveCapture: () => Promise<void>;
  onToggleOverlay: () => Promise<void>;
}

function StealthOverlay({
  activeSession,
  askInFlight,
  assistantError,
  assistantInFlightAction,
  captureMode,
  captureState,
  canStartSelectedMode,
  isCapturing,
  listeningLabel,
  partialTranscript,
  status,
  streamingAssistantDraft,
  onAsk,
  onCompleteSession,
  onDynamicAction,
  onPauseSession,
  onResumeSession,
  onRetryAssistantRequest,
  onStartListening,
  onStartLiveCapture,
  onStopLiveCapture,
  onToggleOverlay,
}: StealthOverlayProps) {
  const [prompt, setPrompt] = useState("");
  const [expanded, setExpanded] = useState(false);
  const isLoading = askInFlight || assistantInFlightAction !== null;
  const lastMessage = activeSession?.messages.filter((m) => m.role === "assistant").slice(-1)[0];
  const liveDraft = streamingAssistantDraft?.sessionId === activeSession?.session.id ? streamingAssistantDraft : null;

  if (!activeSession) {
    return (
      <section className="stealth-shell">
        <div className="stealth-bar">
          <span className="stealth-dot" />
          <span className="stealth-title">Ready</span>
          <div className="stealth-input-wrap">
            <input placeholder="Start a meeting to begin..." disabled />
          </div>
          <div className="stealth-actions">
            <button
              type="button"
              className="stealth-btn stealth-btn-primary"
              disabled={!canStartSelectedMode && captureMode !== "manual"}
              onClick={() => void onStartListening()}
            >
              Start
            </button>
            <button type="button" className="stealth-btn" onClick={() => void onToggleOverlay()}>
              Hide
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="stealth-shell">
      <div className="stealth-bar">
        <span className={`stealth-dot ${isCapturing ? "stealth-dot-live" : ""}`} />
        <button
          type="button"
          className="stealth-title"
          onClick={() => setExpanded((v) => !v)}
          title="Toggle details"
          style={{ cursor: "pointer", background: "none", border: "none", padding: 0, textAlign: "left" }}
        >
          {listeningLabel}
        </button>
        <div className="stealth-input-wrap">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isLoading ? "Thinking..." : "Ask anything..."}
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && prompt.trim()) {
                void onAsk(prompt).then(() => setPrompt(""));
              }
            }}
          />
        </div>
        <div className="stealth-actions">
          {captureState === "listening" || captureState === "connecting" ? (
            <button type="button" className="stealth-btn" onClick={() => void onStopLiveCapture()}>Stop</button>
          ) : captureMode !== "manual" ? (
            <button type="button" className="stealth-btn" onClick={() => void onStartLiveCapture()}>Listen</button>
          ) : null}
          <button type="button" className="stealth-btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Less" : "More"}
          </button>
          <button type="button" className="stealth-btn" onClick={() => void onToggleOverlay()}>
            Hide
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="stealth-expandable">
          <div className="stealth-status-row">
            <span>Session:</span>
            <strong>{activeSession.session.title}</strong>
            <span>{status === "paused" ? "Paused" : captureModeLabel(captureMode)}</span>
          </div>

          {partialTranscript ? (
            <div className="partial-transcript" style={{ marginBottom: 8 }}>
              <span>Listening live</span>
              <p>{partialTranscript}</p>
            </div>
          ) : null}

          {liveDraft ? (
            <div className="message-card message-assistant" style={{ marginBottom: 8, fontSize: "0.85rem" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Drafting answer</span>
              <p>{liveDraft.content || "Drafting answer..."}</p>
            </div>
          ) : lastMessage ? (
            <div className="message-card message-assistant" style={{ marginBottom: 8, fontSize: "0.85rem" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Last response</span>
              <p>{lastMessage.content}</p>
            </div>
          ) : null}

          <DynamicActions
            disabled={!activeSession}
            inFlightAction={assistantInFlightAction}
            lastError={assistantError}
            onRetry={assistantError ? onRetryAssistantRequest : undefined}
            onRunAction={onDynamicAction}
          />

          <div className="stealth-toolbar">
            {status === "paused" ? (
              <button type="button" onClick={() => void onResumeSession(activeSession.session.id)}>Resume</button>
            ) : status === "active" ? (
              <button type="button" onClick={() => void onPauseSession(activeSession.session.id)}>Pause</button>
            ) : null}
            <button type="button" onClick={() => void onCompleteSession(activeSession.session.id)}>End</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
