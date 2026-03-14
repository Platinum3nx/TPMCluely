import type { ChatMessage, StreamingAssistantDraft } from "../lib/types";

interface AssistantFeedProps {
  draft?: StreamingAssistantDraft | null;
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

function formatRepoCitationLabel(path: string, startLine: number, endLine: number): string {
  if (startLine === endLine) {
    return `${path}:${startLine}`;
  }
  return `${path}:${startLine}-${endLine}`;
}

export function AssistantFeed({
  draft = null,
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
        {visibleMessages.length === 0 && !draft ? (
          <div className="empty-block">
            <strong>{emptyTitle}</strong>
            <p>{emptyDetail}</p>
          </div>
        ) : visibleMessages.length > 0 ? (
          visibleMessages.map((message) => {
            const chips = Array.from(
              new Set(
                [
                  renderResponseMode(message),
                  message.metadata?.usedScreenContext ? "Screen used" : null,
                  message.metadata?.providerName ?? null,
                  formatLatency(message.metadata?.latencyMs),
                  message.metadata?.repoSearch?.used ? `Repo ${message.metadata.repoSearch.mode ?? "search"}` : null,
                  message.metadata?.repoSearch?.attempted && !message.metadata?.repoSearch?.used
                    ? "Repo skipped"
                    : null,
                  message.metadata?.repoSearch?.freshness ? `Freshness ${message.metadata.repoSearch.freshness}` : null,
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
                {message.metadata?.repoCitations?.length ? (
                  <div className="message-chip-row">
                    {message.metadata.repoCitations.map((citation) => (
                      <a
                        key={`${message.id}-${citation.label}-${citation.path}-${citation.startLine}`}
                        className="message-chip"
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        title={citation.snippet}
                      >
                        {citation.label} {formatRepoCitationLabel(citation.path, citation.startLine, citation.endLine)}
                      </a>
                    ))}
                  </div>
                ) : null}
                {message.metadata?.providerError ? (
                  <p className="message-meta-note">Provider note: {message.metadata.providerError}</p>
                ) : null}
                {message.metadata?.repoSearch?.reason ? (
                  <p className="message-meta-note">Repo search: {message.metadata.repoSearch.reason}</p>
                ) : null}
              </div>
            );
          })
        ) : null}
        {draft ? (
          <div className="message-card message-assistant">
            <div className="message-card-header">
              <span>assistant</span>
            </div>
            <div className="message-chip-row">
              <span className="message-chip">Drafting answer</span>
              {draft.requestedScreenContext ? <span className="message-chip">Screen requested</span> : null}
            </div>
            <p>{draft.content || "Drafting answer..."}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}
