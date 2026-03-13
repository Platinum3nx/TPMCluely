import { useState } from "react";

import type { SessionSpeaker } from "../lib/types";

interface SpeakerRosterProps {
  sessionId: string;
  speakers: SessionSpeaker[];
  onRenameSpeaker: (sessionId: string, speakerId: string, displayLabel: string) => Promise<void>;
  title?: string;
}

export function SpeakerRoster({
  sessionId,
  speakers,
  onRenameSpeaker,
  title = "Speakers",
}: SpeakerRosterProps) {
  const [editingSpeakerId, setEditingSpeakerId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  if (speakers.length === 0) {
    return null;
  }

  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">{title}</p>
        <span className="section-meta">{speakers.length} detected</span>
      </div>
      <div className="speaker-roster">
        {speakers.map((speaker) => {
          const editing = speaker.speakerId === editingSpeakerId;
          return (
            <div key={speaker.speakerId} className="speaker-roster-row">
              <div>
                <strong>{speaker.displayLabel}</strong>
                <p className="card-detail">
                  {speaker.source === "manual" ? "Added manually" : "Detected from live capture"}
                </p>
              </div>
              {editing ? (
                <div className="speaker-roster-actions">
                  <input
                    value={draftLabel}
                    onChange={(event) => setDraftLabel(event.target.value)}
                    placeholder="Rename speaker"
                  />
                  <button
                    type="button"
                    disabled={!draftLabel.trim()}
                    onClick={async () => {
                      await onRenameSpeaker(sessionId, speaker.speakerId, draftLabel.trim());
                      setEditingSpeakerId(null);
                      setDraftLabel("");
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setEditingSpeakerId(null);
                      setDraftLabel("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setEditingSpeakerId(speaker.speakerId);
                    setDraftLabel(speaker.displayLabel);
                  }}
                >
                  Rename
                </button>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}
