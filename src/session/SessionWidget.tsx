import { AskBar } from "./AskBar";
import { DynamicActions } from "./DynamicActions";
import { SessionControls } from "./SessionControls";
import { TranscriptPanel } from "./TranscriptPanel";
import type {
  CaptureMode,
  ChatMessage,
  DynamicActionKey,
  ScreenShareState,
  SessionDetail,
} from "../lib/types";

interface SessionWidgetProps {
  activeSession: SessionDetail | null;
  captureError: string | null;
  captureMode: CaptureMode;
  captureState: string;
  deepgramReady: boolean;
  geminiReady: boolean;
  isCapturing: boolean;
  linearReady: boolean;
  overlayOpen: boolean;
  overlayShortcut: string;
  partialTranscript: string;
  screenContextEnabled: boolean;
  screenShareError: string | null;
  screenShareOwnedByCapture: boolean;
  screenShareState: ScreenShareState;
  onStartSession: (title: string) => Promise<void>;
  onPauseSession: (sessionId: string) => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
  onAppendTranscript: (speakerLabel: string, text: string) => Promise<void>;
  onDynamicAction: (action: DynamicActionKey) => Promise<void>;
  onAsk: (prompt: string) => Promise<void>;
  onSetCaptureMode: (mode: CaptureMode) => void;
  onStartLiveCapture: () => Promise<void>;
  onStartListening: () => Promise<void>;
  onStartScreenShare: () => Promise<boolean>;
  onStopLiveCapture: () => Promise<void>;
  onStopScreenShare: () => Promise<void>;
  onToggleOverlay: () => Promise<void>;
}

const overlayModes: Array<{ mode: CaptureMode; label: string; detail: string }> = [
  { mode: "microphone", label: "Mic", detail: "Use the meeting audio in your room." },
  { mode: "system_audio", label: "System", detail: "Capture shared system audio when macOS allows it." },
  { mode: "manual", label: "Manual", detail: "Fallback if audio capture is unavailable." },
];

function formatListeningLabel(captureState: string, isCapturing: boolean): string {
  if (captureState === "connecting") {
    return "Connecting";
  }
  if (captureState === "stopping") {
    return "Stopping";
  }
  if (captureState === "error") {
    return "Needs attention";
  }
  return isCapturing ? "Listening" : "Ready";
}

function renderAssistantFeed(messages: ChatMessage[], overlayOpen: boolean) {
  return (
    <article className="card message-panel">
      <div className="section-header">
        <p className="card-title">Assistant Feed</p>
        <span className="section-meta">{messages.length} messages</span>
      </div>
      <div className="message-feed">
        {messages.length === 0 ? (
          <div className="empty-block">
            <strong>No assistant output yet</strong>
            <p>Run an action or ask a question to create the first response.</p>
          </div>
        ) : (
          messages
            .slice(overlayOpen ? -5 : 0)
            .map((message) => (
              <div key={message.id} className={`message-card message-${message.role}`}>
                <div className="message-card-header">
                  <span>{message.role}</span>
                  {message.attachments.some((attachment) => attachment.kind === "screenshot") ? (
                    <span className="message-attachment-badge">
                      Screen used ·{" "}
                      {new Date(message.attachments[0].capturedAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  ) : null}
                </div>
                <p>{message.content}</p>
              </div>
            ))
        )}
      </div>
    </article>
  );
}

function renderOverlayCapability(label: string, ready: boolean, statusText?: string) {
  return (
    <div className={`overlay-capability ${ready ? "overlay-capability-ready" : "overlay-capability-missing"}`}>
      <strong>{label}</strong>
      <span>{statusText ?? (ready ? "Ready" : "Missing")}</span>
    </div>
  );
}

function screenStatusLabel(screenShareState: ScreenShareState): string {
  if (screenShareState === "active") {
    return "Sharing";
  }
  if (screenShareState === "error") {
    return "Needs attention";
  }
  return "Screen off";
}

export function SessionWidget({
  activeSession,
  captureError,
  captureMode,
  captureState,
  deepgramReady,
  geminiReady,
  isCapturing,
  linearReady,
  overlayOpen,
  overlayShortcut,
  partialTranscript,
  screenContextEnabled,
  screenShareError,
  screenShareOwnedByCapture,
  screenShareState,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onCompleteSession,
  onAppendTranscript,
  onDynamicAction,
  onAsk,
  onSetCaptureMode,
  onStartLiveCapture,
  onStartListening,
  onStartScreenShare,
  onStopLiveCapture,
  onStopScreenShare,
  onToggleOverlay,
}: SessionWidgetProps) {
  const status = activeSession?.session.status ?? "idle";
  const overlayPrimaryLabel = captureMode === "manual" ? "Start Session" : "Start Listening";
  const overlayMessages = activeSession?.messages ?? [];
  const overlayTranscripts = activeSession?.transcripts ?? [];
  const listeningLabel = formatListeningLabel(captureState, isCapturing);

  if (overlayOpen) {
    return (
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
              <button type="button" className="overlay-ghost-button" onClick={() => void onToggleOverlay()}>
                Hide
              </button>
            </div>
          </header>

          {!activeSession ? (
            <section className="cluely-launch-surface">
              <div className="cluely-launch-copy">
                <p className="eyebrow">Shortcut First</p>
                <h3>Open TPMCluely, then start listening when the meeting begins.</h3>
                <p className="card-detail">
                  TPMCluely will collect the transcript, answer live questions, suggest follow-ups, and generate Linear
                  tickets when the meeting ends.
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

              <div className="overlay-capability-grid">
                {renderOverlayCapability("Deepgram", deepgramReady)}
                {renderOverlayCapability("Gemini", geminiReady)}
                {renderOverlayCapability("Linear", linearReady)}
                {renderOverlayCapability("Screen", screenShareState === "active", screenStatusLabel(screenShareState))}
              </div>

              <div className="overlay-launch-actions">
                <button type="button" className="overlay-primary-button" onClick={() => void onStartListening()}>
                  {overlayPrimaryLabel}
                </button>
                <span className="overlay-shortcut-badge">Shortcut: {overlayShortcut}</span>
              </div>

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
                      {status === "paused" ? "Meeting paused" : "Meeting in progress"} · {captureMode.replace("_", " ")}
                    </p>
                  </div>
                  <div className="cluely-live-meta">
                    <span className={`overlay-pill ${isCapturing ? "overlay-pill-live" : ""}`}>{listeningLabel}</span>
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

                <div className="toolbar-row cluely-live-toolbar">
                  {status === "paused" ? (
                    <button type="button" onClick={() => void onResumeSession(activeSession.session.id)}>
                      Resume Meeting
                    </button>
                  ) : captureState === "listening" || captureState === "connecting" || captureState === "stopping" ? (
                    <button type="button" onClick={() => void onStopLiveCapture()}>
                      Stop Listening
                    </button>
                  ) : (
                    <button type="button" onClick={() => void onStartLiveCapture()}>
                      Start Listening
                    </button>
                  )}
                  {status === "active" ? (
                    <button type="button" className="secondary-button" onClick={() => void onPauseSession(activeSession.session.id)}>
                      Pause
                    </button>
                  ) : null}
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
                disabled={false}
                screenContextEnabled={screenContextEnabled}
                screenShareState={screenShareState}
                onAsk={onAsk}
              />
              <DynamicActions disabled={false} onRunAction={onDynamicAction} />

              <div className="overlay-feed-grid">
                <TranscriptPanel
                  captureMode={captureMode}
                  captureState={captureState}
                  overlayOpen
                  partialTranscript={partialTranscript}
                  sessionId={activeSession.session.id}
                  showManualComposer={false}
                  transcripts={overlayTranscripts.slice(-8)}
                  onAppendTranscript={onAppendTranscript}
                />
                {renderAssistantFeed(overlayMessages, true)}
              </div>
            </section>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="panel session-grid">
      <div className="panel-hero">
        <p className="eyebrow">Live Session Widget</p>
        <h2>Live transcript, overlay controls, grounded answers, and auto-generated tickets.</h2>
        <p className="muted">
          Start a meeting, stream transcript signal into the assistant, answer live questions with Ask TPMCluely, then
          end the session to generate deduped Linear tickets automatically.
        </p>
      </div>

      <div className="session-grid-body">
        <div className="card-stack">
          <SessionControls
            activeSession={activeSession}
            captureError={captureError}
            captureMode={captureMode}
            captureState={captureState}
            overlayOpen={overlayOpen}
            overlayShortcut={overlayShortcut}
            screenContextEnabled={screenContextEnabled}
            screenShareError={screenShareError}
            screenShareOwnedByCapture={screenShareOwnedByCapture}
            screenShareState={screenShareState}
            onStartSession={onStartSession}
            onPauseSession={onPauseSession}
            onResumeSession={onResumeSession}
            onCompleteSession={onCompleteSession}
            onSetCaptureMode={onSetCaptureMode}
            onStartLiveCapture={onStartLiveCapture}
            onStartScreenShare={onStartScreenShare}
            onStopLiveCapture={onStopLiveCapture}
            onStopScreenShare={onStopScreenShare}
            onToggleOverlay={onToggleOverlay}
          />
          <DynamicActions disabled={!activeSession} onRunAction={onDynamicAction} />
          <AskBar
            disabled={!activeSession}
            screenContextEnabled={screenContextEnabled}
            screenShareState={screenShareState}
            onAsk={onAsk}
          />
        </div>

        <div className="card-stack">
          <TranscriptPanel
            captureMode={captureMode}
            captureState={captureState}
            overlayOpen={overlayOpen}
            partialTranscript={partialTranscript}
            sessionId={activeSession?.session.id ?? null}
            transcripts={activeSession?.transcripts ?? []}
            onAppendTranscript={onAppendTranscript}
          />

          {renderAssistantFeed(activeSession?.messages ?? [], false)}
        </div>
      </div>
    </section>
  );
}
