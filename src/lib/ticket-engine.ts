import type { GeneratedTicket, SessionDetail, TicketType } from "./types";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function classifyTicketType(line: string): TicketType {
  const lowercase = line.toLowerCase();
  if (/(bug|fix|timeout|regression|incident|error)/i.test(lowercase)) {
    return "Bug";
  }
  if (/(build|add|implement|create|launch|ship|feature|rollout)/i.test(lowercase)) {
    return "Feature";
  }
  return "Task";
}

function ticketTitle(type: TicketType, line: string): string {
  const cleaned = normalizeWhitespace(line)
    .replace(/^[A-Za-z0-9 _-]+:\s*/, "")
    .replace(/[.]+$/, "");

  if (type === "Bug") {
    return cleaned.toLowerCase().startsWith("fix ") ? cleaned : `Fix ${cleaned}`;
  }
  if (type === "Feature") {
    return cleaned.toLowerCase().startsWith("implement ") ? cleaned : `Implement ${cleaned}`;
  }
  return cleaned;
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return `tg_${Math.abs(hash).toString(16)}`;
}

export function generateTicketsFromSession(detail: SessionDetail): GeneratedTicket[] {
  const lines = detail.transcripts.map((segment) => normalizeWhitespace(segment.text)).filter(Boolean);
  const candidateLines = lines.filter((line) => /(will|owner|task|todo|fix|build|implement|follow-up|rollout)/i.test(line));
  const sourceLines = (candidateLines.length > 0 ? candidateLines : lines.slice(0, 4)).slice(0, 5);
  const summary = detail.session.finalSummary ?? "Capture and review the transcript for additional detail.";
  const seen = new Set<string>();

  return sourceLines
    .map((line) => {
      const type = classifyTicketType(line);
      const title = ticketTitle(type, line);
      const acceptanceCriteria = [
        "The requested change is implemented without introducing regressions.",
        "The resulting behavior is validated against the transcript intent.",
      ];

      return {
        id: simpleHash(`id:${type}:${title.toLowerCase()}`),
        sessionId: detail.session.id,
        idempotencyKey: simpleHash(`${type}:${title.toLowerCase()}`),
        title,
        description: `${summary}\n\nTranscript source: ${line}`,
        acceptanceCriteria,
        type,
        sourceLine: line,
        linearIssueId: null,
        linearIssueKey: null,
        linearIssueUrl: null,
        pushedAt: null,
        linearPushState: "pending",
        linearLastError: null,
        linearLastAttemptAt: null,
        linearDeduped: false,
        reviewState: "draft",
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        reviewedAt: null,
        createdAt: detail.session.updatedAt,
      } satisfies GeneratedTicket;
    })
    .filter((ticket) => {
      const key = `${ticket.type}:${ticket.title.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}
