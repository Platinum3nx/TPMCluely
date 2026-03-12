import { useState } from "react";
import type { CaptureMode, TranscriptSegment } from "../lib/types";

interface TranscriptPanelProps {
  captureMode: CaptureMode;
  captureState: string;
  overlayOpen: boolean;
  partialTranscript: string;
  sessionId: string | null;
  transcripts: TranscriptSegment[];
  onAppendTranscript: (speakerLabel: string, text: string) => Promise<void>;
}

export function TranscriptPanel({
  captureMode,
  captureState,
  overlayOpen,
  partialTranscript,
  sessionId,
  transcripts,
  onAppendTranscript,
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
      <div className="transcript-feed">
        {transcripts.length === 0 ? (
          <div className="empty-block">
            <strong>No transcript yet</strong>
            <p>
              {captureMode === "microphone"
                ? "Start live transcription to stream Deepgram results here, or add a manual line as a fallback."
                : "Add a line manually or load the demo transcript to simulate an active meeting."}
            </p>
          </div>
        ) : (
          transcripts.map((segment) => (
            <div key={segment.id} className="transcript-line">
              <span>{segment.speakerLabel ?? "Speaker"}</span>
              <p>{segment.text}</p>
            </div>
          ))
        )}
      </div>
      <div className={`field-grid ${overlayOpen ? "field-grid-overlay" : ""}`}>
        <label className="field">
          <span>Speaker</span>
          <input value={speaker} onChange={(event) => setSpeaker(event.target.value)} disabled={!sessionId} />
        </label>
        <label className="field">
          <span>Manual correction / demo line</span>
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
    </article>
  );
}
