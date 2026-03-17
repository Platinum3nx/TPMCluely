import { useCallback, useRef, useState } from "react";
import { streamAskCrossSession } from "../lib/tauri";

interface CrossSessionAskBarProps {
  currentSessionId?: string | null;
  onNavigateToSession?: (sessionId: string, seqStart?: number | null, seqEnd?: number | null) => void;
}

export function CrossSessionAskBar({ currentSessionId, onNavigateToSession }: CrossSessionAskBarProps) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed || streaming) return;

      setStreaming(true);
      setAnswer(null);
      setError(null);

      let accumulated = "";

      try {
        await streamAskCrossSession(
          {
            prompt: trimmed,
            currentSessionId: currentSessionId ?? undefined,
          },
          {
            onChunk: (event) => {
              accumulated = event.content;
              setAnswer(accumulated);
            },
            onCompleted: (event) => {
              setAnswer(event.answer);
              setStreaming(false);
            },
            onFailed: (event) => {
              setError(event.error);
              setStreaming(false);
            },
          }
        );
      } catch (err) {
        setError(String(err));
        setStreaming(false);
      }
    },
    [query, streaming, currentSessionId]
  );

  const handleClear = useCallback(() => {
    setAnswer(null);
    setError(null);
    setQuery("");
    inputRef.current?.focus();
  }, []);

  return (
    <div className="cross-session-ask-bar">
      <form onSubmit={handleSubmit} className="cross-session-ask-form">
        <input
          ref={inputRef}
          type="text"
          className="cross-session-ask-input"
          placeholder="Ask across all sessions… e.g. What did we decide about auth?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={streaming}
        />
        <button
          type="submit"
          className="cross-session-ask-btn"
          disabled={!query.trim() || streaming}
        >
          {streaming ? "…" : "Ask"}
        </button>
      </form>

      {(answer || error) && (
        <div className="cross-session-answer">
          {error ? (
            <p className="cross-session-error">{error}</p>
          ) : (
            <p className="cross-session-answer-text">{answer}</p>
          )}
          <button onClick={handleClear} className="cross-session-clear-btn">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
