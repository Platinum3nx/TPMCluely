import { useState } from "react";
import type { TranscriptSegment } from "../lib/types";

interface TranscriptPanelProps {
  sessionId: string | null;
  transcripts: TranscriptSegment[];
  onAppendTranscript: (speakerLabel: string, text: string) => Promise<void>;
}

export function TranscriptPanel({ sessionId, transcripts, onAppendTranscript }: TranscriptPanelProps) {
  const [speaker, setSpeaker] = useState("PM");
  const [line, setLine] = useState("");

  return (
    <article className="card transcript-panel">
      <div className="section-header">
        <p className="card-title">Transcript Feed</p>
        <span className="section-meta">{transcripts.length} segments</span>
      </div>
      <div className="transcript-feed">
        {transcripts.length === 0 ? (
          <div className="empty-block">
            <strong>No transcript yet</strong>
            <p>Add a line manually or load the demo transcript to simulate an active meeting.</p>
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
      <div className="field-grid">
        <label className="field">
          <span>Speaker</span>
          <input value={speaker} onChange={(event) => setSpeaker(event.target.value)} disabled={!sessionId} />
        </label>
        <label className="field">
          <span>Transcript line</span>
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
