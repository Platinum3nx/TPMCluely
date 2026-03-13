import type { SystemAudioSource } from "../lib/types";

interface SystemAudioSourcePickerProps {
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onSelect: (source: SystemAudioSource) => void;
  open: boolean;
  sources: SystemAudioSource[];
}

export function SystemAudioSourcePicker({
  error,
  loading,
  onClose,
  onSelect,
  open,
  sources,
}: SystemAudioSourcePickerProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="source-picker-backdrop" role="presentation">
      <div className="source-picker-card" role="dialog" aria-modal="true" aria-labelledby="system-audio-picker-title">
        <div className="section-header">
          <div>
            <p className="card-title" id="system-audio-picker-title">
              Choose Meeting Audio
            </p>
            <p className="card-detail">
              Pick the meeting window or display TPMCluely should listen to for live transcription.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
        </div>

        {loading ? <p className="card-detail">Loading shareable system audio sources…</p> : null}
        {error ? (
          <div className="inline-alert inline-alert-soft">
            <strong>System audio is blocked</strong>
            <p>{error}</p>
          </div>
        ) : null}

        {!loading && sources.length === 0 && !error ? (
          <div className="empty-block">
            <strong>No meeting audio sources available</strong>
            <p>Share a meeting window or display, then try again.</p>
          </div>
        ) : null}

        {sources.length > 0 ? (
          <div className="source-picker-list">
            {sources.map((source) => (
              <button
                type="button"
                key={`${source.kind}-${source.id}`}
                className="source-picker-option"
                onClick={() => onSelect(source)}
              >
                <strong>{source.sourceLabel}</strong>
                <span>{source.kind === "window" ? "Window audio" : "Display audio"}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
