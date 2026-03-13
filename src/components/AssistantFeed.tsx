import type { ChatMessage } from "../lib/types";

interface AssistantFeedProps {
  emptyDetail?: string;
  emptyTitle?: string;
  maxItems?: number;
  messages: ChatMessage[];
  title?: string;
}

function renderResponseMode(message: ChatMessage): string | null {
  const mode = message.metadata?.responseMode;
  if (mode === "gemini") {
    return "Gemini";
  }
  if (mode === "transcript_fallback") {
    return "Transcript fallback";
  }
  if (mode === "insufficient_transcript") {
    return "Not enough transcript";
  }
  return null;
}

function formatLatency(latencyMs?: number | null): string | null {
  if (latencyMs == null) {
    return null;
  }
  if (latencyMs < 1_000) {
    return `${latencyMs} ms`;
  }
  return `${(latencyMs / 1_000).toFixed(1)} s`;
}

export function AssistantFeed({
  emptyDetail = "Run an action or ask a question to create the first response.",
  emptyTitle = "No assistant output yet",
  maxItems,
  messages,
  title = "Assistant Feed",
}: AssistantFeedProps) {
  const visibleMessages =
    typeof maxItems === "number" && maxItems > 0 ? messages.slice(-maxItems) : messages;

  return (
    <article className="card message-panel">
      <div className="section-header">
        <p className="card-title">{title}</p>
        <span className="section-meta">{messages.length} messages</span>
      </div>
      <div className="message-feed">
        {visibleMessages.length === 0 ? (
          <div className="empty-block">
            <strong>{emptyTitle}</strong>
            <p>{emptyDetail}</p>
          </div>
        ) : (
          visibleMessages.map((message) => {
            const chips = Array.from(
              new Set(
                [
                  renderResponseMode(message),
                  message.metadata?.usedScreenContext ? "Screen used" : null,
                  message.metadata?.providerName ?? null,
                  formatLatency(message.metadata?.latencyMs),
                  ...(message.metadata?.citations ?? []),
                ].filter((value): value is string => Boolean(value))
              )
            );

            return (
              <div key={message.id} className={`message-card message-${message.role}`}>
                <div className="message-card-header">
                  <span>{message.role}</span>
                  {message.attachments.some((attachment) => attachment.kind === "screenshot") ? (
                    <span className="message-attachment-badge">
                      Screen attached ·{" "}
                      {new Date(message.attachments[0].capturedAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  ) : null}
                </div>
                {chips.length > 0 ? (
                  <div className="message-chip-row">
                    {chips.map((chip) => (
                      <span key={`${message.id}-${chip}`} className="message-chip">
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p>{message.content}</p>
                {message.metadata?.providerError ? (
                  <p className="message-meta-note">Provider note: {message.metadata.providerError}</p>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}
