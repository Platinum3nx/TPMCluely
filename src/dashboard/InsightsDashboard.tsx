import { useEffect, useState } from "react";
import type { InsightsPayload, InsightSessionRef, RecurringBlockerPayload, RecurringTopicPayload } from "../lib/types";
import { getCrossSessionInsights } from "../lib/tauri";

interface InsightsDashboardProps {
  onSelectSession: (sessionId: string) => void;
  refreshTrigger?: number;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function TrendBadge({ count, total }: { count: number; total?: number }) {
  if (count <= 1) return null;
  const label = total ? `${count} of last ${total} sessions` : `${count} sessions`;
  return <span className="trend-badge">{label}</span>;
}

function SessionLinks({
  sessions,
  onSelect,
}: {
  sessions: InsightSessionRef[];
  onSelect: (sessionId: string) => void;
}) {
  return (
    <ul className="insight-session-list">
      {sessions.map((s) => (
        <li key={s.sessionId}>
          <button
            className="insight-session-link"
            onClick={() => onSelect(s.sessionId)}
          >
            {s.sessionTitle}
          </button>
          <span className="insight-session-date">{formatDate(s.sessionDate)}</span>
        </li>
      ))}
    </ul>
  );
}

function TopicCard({
  topic,
  onSelect,
}: {
  topic: RecurringTopicPayload;
  onSelect: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`insight-card ${expanded ? "expanded" : ""}`}>
      <button className="insight-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="insight-card-title">{topic.topic}</span>
        <div className="insight-card-meta">
          <TrendBadge count={topic.occurrenceCount} />
          <span className="insight-chevron">{expanded ? "▾" : "▸"}</span>
        </div>
      </button>
      {expanded && (
        <div className="insight-card-body">
          {topic.representativeSnippet && (
            <blockquote className="insight-snippet">{topic.representativeSnippet}</blockquote>
          )}
          <p className="insight-date-range">
            First seen: {formatDate(topic.firstSeenAt)} · Last seen: {formatDate(topic.lastSeenAt)}
          </p>
          <SessionLinks sessions={topic.sessions} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

function BlockerCard({
  blocker,
  onSelect,
}: {
  blocker: RecurringBlockerPayload;
  onSelect: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`insight-card blocker-card ${blocker.resolved ? "resolved" : "unresolved"} ${expanded ? "expanded" : ""}`}>
      <button className="insight-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="insight-card-title">{blocker.description}</span>
        <div className="insight-card-meta">
          {blocker.resolved ? (
            <span className="resolved-badge">Resolved</span>
          ) : (
            <span className="unresolved-badge">Open</span>
          )}
          <TrendBadge count={blocker.occurrenceCount} />
          <span className="insight-chevron">{expanded ? "▾" : "▸"}</span>
        </div>
      </button>
      {expanded && (
        <div className="insight-card-body">
          <p className="insight-date-range">
            First mentioned: {formatDate(blocker.firstMentionedAt)} · Last: {formatDate(blocker.lastMentionedAt)}
          </p>
          <SessionLinks sessions={blocker.sessions} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

export function InsightsDashboard({ onSelectSession, refreshTrigger }: InsightsDashboardProps) {
  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getCrossSessionInsights()
      .then((data) => {
        setInsights(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="insights-dashboard">
        <p className="muted">Loading insights…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="insights-dashboard">
        <p className="muted">Could not load insights: {error}</p>
      </div>
    );
  }

  const hasTopics = (insights?.topics?.length ?? 0) > 0;
  const hasBlockers = (insights?.blockers?.length ?? 0) > 0;

  if (!hasTopics && !hasBlockers) {
    return (
      <div className="insights-dashboard insights-empty">
        <p className="eyebrow">Insights</p>
        <h3>No recurring patterns yet</h3>
        <p className="muted">Complete a few sessions and TPMCluely will automatically surface recurring topics and blockers.</p>
      </div>
    );
  }

  return (
    <div className="insights-dashboard">
      {hasTopics && (
        <section className="insights-section">
          <h3 className="insights-section-title">Recurring Topics</h3>
          <div className="insight-cards">
            {insights!.topics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} onSelect={onSelectSession} />
            ))}
          </div>
        </section>
      )}

      {hasBlockers && (
        <section className="insights-section">
          <h3 className="insights-section-title">Recurring Blockers</h3>
          <div className="insight-cards">
            {insights!.blockers.map((blocker) => (
              <BlockerCard key={blocker.id} blocker={blocker} onSelect={onSelectSession} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
