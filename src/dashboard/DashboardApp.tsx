import { useEffect, useState } from "react";
import type { SearchSessionResult, SessionDetail as SessionDetailModel, SessionRecord, TicketType } from "../lib/types";
import { SearchBar } from "../components/SearchBar";
import { SessionDetail } from "./SessionDetail";
import { SessionsList } from "./SessionsList";
import { TicketDashboard } from "./TicketDashboard";

interface DashboardAppProps {
  sessions: SessionRecord[];
  selectedSessionId: string | null;
  sessionDetail: SessionDetailModel | null;
  searchResults: SearchSessionResult[] | null;
  highlightedSequenceNo: number | null;
  onSearchSessions: (query: string) => Promise<void>;
  onSelectSession: (sessionId: string, transcriptSequenceNo?: number | null) => Promise<void>;
  onExportSession: (sessionDetail: SessionDetailModel) => void;
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
  highlightedSequenceNo,
  onSearchSessions,
  onSelectSession,
  onExportSession,
  onGenerateTickets,
  onPushGeneratedTicket,
  onPushGeneratedTickets,
  onSetGeneratedTicketReviewState,
  onUpdateGeneratedTicketDraft,
  allowTicketPreview,
}: DashboardAppProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    void onSearchSessions(query);
  }, [onSearchSessions, query]);

  const sessionItems = query.trim()
    ? (searchResults ?? []).map((result) => ({
        sessionId: result.sessionId,
        title: result.title,
        status: result.status,
        updatedAt: result.updatedAt,
        snippet: result.snippet,
        matchedField: result.matchedField,
        transcriptSequenceNo: result.transcriptSequenceNo,
      }))
    : sessions.map((session) => ({
        sessionId: session.id,
        title: session.title,
        status: session.status,
        updatedAt: session.updatedAt,
        snippet: session.finalSummary ?? session.notesMd ?? null,
        matchedField: null,
        transcriptSequenceNo: null,
      }));

  return (
    <section className="panel dashboard-grid">
      <div className="panel-hero">
        <p className="eyebrow">Review Queue</p>
        <h2>Transcript-centric session history, grounded assistant output, and review-first Linear drafts.</h2>
        <p className="muted">Search sessions, inspect the evidence, then approve only the ticket drafts that should leave the desktop app.</p>
      </div>

      <SearchBar value={query} onChange={setQuery} />

      <div className="dashboard-grid-body">
        <SessionsList
          sessions={sessionItems}
          selectedSessionId={selectedSessionId}
          onSelectSession={(sessionId, transcriptSequenceNo) => void onSelectSession(sessionId, transcriptSequenceNo)}
        />
        <div className="card-stack">
          <SessionDetail
            sessionDetail={sessionDetail}
            highlightedSequenceNo={highlightedSequenceNo}
            onExportSession={onExportSession}
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
    </section>
  );
}
