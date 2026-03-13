import type { TranscriptSegment } from "../lib/types";

const LOW_CONFIDENCE_THRESHOLD = 0.6;

function displaySpeakerLabel(label: string | null): string {
  return label?.trim() || "Unattributed";
}

interface TranscriptViewProps {
  transcripts: TranscriptSegment[];
  highlightedSequenceNo?: number | null;
}

export function TranscriptView({ transcripts, highlightedSequenceNo = null }: TranscriptViewProps) {
  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Transcript</p>
        <span className="section-meta">{transcripts.length} segments</span>
      </div>
      <div className="transcript-feed">
        {transcripts.map((segment) => (
          <div
            key={segment.id}
            className={`transcript-line ${highlightedSequenceNo === segment.sequenceNo ? "session-list-item-active" : ""}`}
          >
            <span>
              {displaySpeakerLabel(segment.speakerLabel)}
              {segment.speakerConfidence != null && segment.speakerConfidence < LOW_CONFIDENCE_THRESHOLD ? (
                <small className="speaker-confidence-flag">Low confidence</small>
              ) : null}
            </span>
            <p>{segment.text}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
