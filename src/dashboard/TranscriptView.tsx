import type { TranscriptSegment } from "../lib/types";

interface TranscriptViewProps {
  transcripts: TranscriptSegment[];
}

export function TranscriptView({ transcripts }: TranscriptViewProps) {
  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Transcript</p>
        <span className="section-meta">{transcripts.length} segments</span>
      </div>
      <div className="transcript-feed">
        {transcripts.map((segment) => (
          <div key={segment.id} className="transcript-line">
            <span>{segment.speakerLabel ?? "Speaker"}</span>
            <p>{segment.text}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
