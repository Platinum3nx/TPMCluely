import { SpeakerRoster } from "../components/SpeakerRoster";
import { useState } from "react";
import type { CaptureMode, SessionSpeaker, TranscriptSegment } from "../lib/types";

const LOW_CONFIDENCE_THRESHOLD = 0.6;

function displaySpeakerLabel(label: string | null): string {
  return label?.trim() || "Unattributed";
}

interface TranscriptPanelProps {
  captureMode: CaptureMode;
  captureState: string;
  overlayOpen: boolean;
  partialTranscript: string;
  sessionId: string | null;
  speakers: SessionSpeaker[];
  showManualComposer?: boolean;
  transcripts: TranscriptSegment[];
  onAppendTranscript: (speakerLabel: string, text: string) => Promise<void>;
  onRenameSpeaker: (sessionId: string, speakerId: string, displayLabel: string) => Promise<void>;
}

export function TranscriptPanel({
  captureMode,
  captureState,
  overlayOpen,
  partialTranscript,
  sessionId,
  speakers,
  showManualComposer = true,
  transcripts,
  onAppendTranscript,
  onRenameSpeaker,
}: TranscriptPanelProps) {
  const [speaker, setSpeaker] = useState("PM");
  const [line, setLine] = useState("");

  return (
    <article className="card transcript-panel">
      <div className="section-header">
        <p className="card-title">Transcript Feed</p>
        <span className="section-meta">
          {transcripts.length} segments · {captureState}
        </span>
      </div>
      {partialTranscript ? (
        <div className="partial-transcript">
          <span>Listening live</span>
          <p>{partialTranscript}</p>
        </div>
      ) : null}
      {sessionId ? (
        <SpeakerRoster
          sessionId={sessionId}
          speakers={speakers}
          onRenameSpeaker={onRenameSpeaker}
          title="Session Speakers"
        />
      ) : null}
      <div className="transcript-feed">
        {transcripts.length === 0 ? (
          <div className="empty-block">
            <strong>No transcript yet</strong>
            <p>
              {captureMode === "microphone" || captureMode === "system_audio"
                ? "Start live transcription to stream Deepgram results here, or add a manual line as a fallback."
                : showManualComposer
                  ? "Add a line manually to capture the key parts of the meeting."
                  : "Open the full session view if you need to add manual transcript lines."}
            </p>
          </div>
        ) : (
          transcripts.map((segment) => (
            <div key={segment.id} className="transcript-line">
              <span>
                {displaySpeakerLabel(segment.speakerLabel)}
                {segment.speakerConfidence != null && segment.speakerConfidence < LOW_CONFIDENCE_THRESHOLD ? (
                  <small className="speaker-confidence-flag">Low confidence</small>
                ) : null}
              </span>
              <p>{segment.text}</p>
            </div>
          ))
        )}
      </div>
      {showManualComposer ? (
        <div className={`field-grid ${overlayOpen ? "field-grid-overlay" : ""}`}>
          <label className="field">
            <span>Speaker</span>
            <input value={speaker} onChange={(event) => setSpeaker(event.target.value)} disabled={!sessionId} />
          </label>
          <label className="field">
            <span>Manual transcript line</span>
            <div className="field-row">
              <input
                value={line}
                onChange={(event) => setLine(event.target.value)}
                placeholder="Engineer: I can own the auth timeout fix."
                disabled={!sessionId}
              />
              <button
                type="button"
                disabled={!sessionId || line.trim().length === 0}
                onClick={async () => {
                  await onAppendTranscript(speaker, line);
                  setLine("");
                }}
              >
                Add
              </button>
            </div>
          </label>
        </div>
      ) : null}
    </article>
  );
}
