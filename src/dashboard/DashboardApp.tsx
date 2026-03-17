import { useEffect, useRef, useState } from "react";
import type {
  SearchMode,
  SearchSessionResult,
  SessionDetail as SessionDetailModel,
  SessionRecord,
  TicketType,
} from "../lib/types";
import { SearchBar } from "../components/SearchBar";
import { SessionDetail } from "./SessionDetail";
import { SessionsList } from "./SessionsList";
import { TicketDashboard } from "./TicketDashboard";
import { CrossSessionAskBar } from "./CrossSessionAskBar";
import { InsightsDashboard } from "./InsightsDashboard";

interface DashboardAppProps {
  sessions: SessionRecord[];
  selectedSessionId: string | null;
  sessionDetail: SessionDetailModel | null;
  searchResults: SearchSessionResult[] | null;
  highlightedSequenceStart: number | null;
  highlightedSequenceEnd: number | null;
  semanticSearchReady: boolean;
  onSearchSessions: (query: string, mode: SearchMode, requestId: string) => Promise<void>;
  onSelectSession: (
    sessionId: string,
    transcriptSequenceStart?: number | null,
    transcriptSequenceEnd?: number | null
  ) => Promise<void>;
  onExportSession: (sessionDetail: SessionDetailModel) => void;
  onRenameSpeaker: (sessionId: string, speakerId: string, displayLabel: string) => Promise<void>;
  onGenerateTickets: (sessionId: string) => Promise<void>;
  onPushGeneratedTicket: (sessionId: string, idempotencyKey: string) => Promise<void>;
  onPushGeneratedTickets: (sessionId: string) => Promise<void>;
  onSetGeneratedTicketReviewState: (
    sessionId: string,
    idempotencyKey: string,
    reviewState: "draft" | "approved" | "rejected",
    rejectionReason?: string | null
  ) => Promise<void>;
  onUpdateGeneratedTicketDraft: (
    sessionId: string,
    idempotencyKey: string,
    draft: { acceptanceCriteria: string[]; description: string; title: string; type: TicketType }
  ) => Promise<void>;
  allowTicketPreview: boolean;
}

export function DashboardApp({
  sessions,
  selectedSessionId,
  sessionDetail,
  searchResults,
  highlightedSequenceStart,
  highlightedSequenceEnd,
  semanticSearchReady,
  onSearchSessions,
  onSelectSession,
  onExportSession,
  onRenameSpeaker,
  onGenerateTickets,
  onPushGeneratedTicket,
  onPushGeneratedTickets,
  onSetGeneratedTicketReviewState,
  onUpdateGeneratedTicketDraft,
  allowTicketPreview,
}: DashboardAppProps) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"sessions" | "insights">("sessions");
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    requestSequenceRef.current += 1;
    const searchKey = `search-${requestSequenceRef.current}`;
    void onSearchSessions(query, "lexical", `${searchKey}:lexical`);

    if (!semanticSearchReady || !query.trim()) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void onSearchSessions(query, "hybrid", `${searchKey}:hybrid`);
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [onSearchSessions, query, semanticSearchReady]);

  const sessionItems = query.trim()
    ? (searchResults ?? []).map((result) => ({
        sessionId: result.sessionId,
        title: result.title,
        status: result.status,
        updatedAt: result.updatedAt,
        snippet: result.snippet,
        matchedField: result.matchedField,
        matchLabel: result.matchLabel,
        retrievalMode: result.retrievalMode,
        transcriptSequenceStart: result.transcriptSequenceStart,
        transcriptSequenceEnd: result.transcriptSequenceEnd,
      }))
    : sessions.map((session) => ({
        sessionId: session.id,
        title: session.title,
        status: session.status,
        updatedAt: session.updatedAt,
        snippet: session.finalSummary ?? session.notesMd ?? null,
        matchedField: null,
        matchLabel: null,
        retrievalMode: null,
        transcriptSequenceStart: null,
        transcriptSequenceEnd: null,
      }));

  return (
    <section className="panel dashboard-grid">
      <div className="panel-hero">
        <p className="eyebrow">Review Queue</p>
        <h2>Transcript-centric session history, grounded assistant output, and review-first Linear drafts.</h2>
        <p className="muted">Search sessions, inspect the evidence, then approve only the ticket drafts that should leave the desktop app.</p>
      </div>

      <CrossSessionAskBar
        currentSessionId={selectedSessionId}
        onNavigateToSession={(sessionId) => void onSelectSession(sessionId)}
      />

      <div className="dashboard-tab-bar">
        <button
          className={`dashboard-tab ${activeTab === "sessions" ? "active" : ""}`}
          onClick={() => setActiveTab("sessions")}
        >
          Sessions
        </button>
        <button
          className={`dashboard-tab ${activeTab === "insights" ? "active" : ""}`}
          onClick={() => setActiveTab("insights")}
        >
          Insights
        </button>
      </div>

      {activeTab === "sessions" ? (
        <>
          <SearchBar value={query} onChange={setQuery} />
          <div className="dashboard-grid-body">
            <SessionsList
              sessions={sessionItems}
              selectedSessionId={selectedSessionId}
              onSelectSession={(sessionId, transcriptSequenceStart, transcriptSequenceEnd) =>
                void onSelectSession(sessionId, transcriptSequenceStart, transcriptSequenceEnd)
              }
            />
            <div className="card-stack">
              <SessionDetail
                sessionDetail={sessionDetail}
                highlightedSequenceStart={highlightedSequenceStart}
                highlightedSequenceEnd={highlightedSequenceEnd}
                onExportSession={onExportSession}
                onRenameSpeaker={onRenameSpeaker}
              />
              <TicketDashboard
                sessionDetail={sessionDetail}
                allowPreview={allowTicketPreview}
                onGenerateTickets={onGenerateTickets}
                onPushGeneratedTicket={onPushGeneratedTicket}
                onPushGeneratedTickets={onPushGeneratedTickets}
                onSetGeneratedTicketReviewState={onSetGeneratedTicketReviewState}
                onUpdateGeneratedTicketDraft={onUpdateGeneratedTicketDraft}
              />
            </div>
          </div>
        </>
      ) : (
        <InsightsDashboard
          onSelectSession={(sessionId) => {
            setActiveTab("sessions");
            void onSelectSession(sessionId);
          }}
        />
      )}
    </section>
  );
}
