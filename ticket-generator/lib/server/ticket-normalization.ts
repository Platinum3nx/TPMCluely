import { createHash } from "crypto";
import type { Ticket, TicketType } from "@/lib/shared/tickets";
import { AppError } from "./errors";

const VALID_TYPES = new Set<TicketType>(["Bug", "Feature", "Task"]);
const TICKET_LIMIT_MIN = 1;
const TICKET_LIMIT_MAX = 8;

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function normalizeDescription(value: unknown): string {
  const description = normalizeString(value);
  return description.length > 2400 ? `${description.slice(0, 2397)}...` : description;
}

function normalizeAcceptanceCriteria(value: unknown): string[] {
  const rawCriteria = Array.isArray(value) ? value : [value];
  const unique = new Set<string>();
  const normalized: string[] = [];

  for (const criterion of rawCriteria) {
    const text = normalizeString(criterion);
    if (text.length < 3) {
      continue;
    }

    if (text.length > 280) {
      continue;
    }

    const key = text.toLowerCase();
    if (unique.has(key)) {
      continue;
    }

    unique.add(key);
    normalized.push(text);
    if (normalized.length >= 10) {
      break;
    }
  }

  return normalized;
}

function normalizeTicketType(value: unknown): TicketType {
  const text = normalizeString(value).toLowerCase();

  if (text.includes("bug")) {
    return "Bug";
  }
  if (text.includes("feature")) {
    return "Feature";
  }
  if (VALID_TYPES.has(value as TicketType)) {
    return value as TicketType;
  }
  return "Task";
}

function normalizeTitle(value: unknown): string {
  const title = normalizeString(value);
  if (title.length === 0) {
    return "";
  }

  const capped = title.length > 140 ? `${title.slice(0, 137)}...` : title;
  return capped.replace(/^[•\-\d.)\s]+/, "").trim();
}

type TicketWithoutKey = Omit<Ticket, "idempotency_key">;

function buildDeduplicationSignature(ticket: TicketWithoutKey): string {
  const criteria = ticket.acceptance_criteria.map((item) => item.toLowerCase()).sort().join("|");
  return `${ticket.type}|${ticket.title.toLowerCase()}|${criteria}`;
}

export function buildTicketIdempotencyKey(ticket: TicketWithoutKey): string {
  const signature = buildDeduplicationSignature(ticket);
  return createHash("sha256").update(signature).digest("hex").slice(0, 24);
}

export function extractJsonArrayFromText(responseText: string): unknown[] {
  const trimmed = responseText.trim();
  const normalized = trimmed
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  const parseCandidate = (candidate: string): unknown[] | null => {
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const directParse = parseCandidate(normalized);
  if (directParse) {
    return directParse;
  }

  const arrayMatch = normalized.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const fallback = parseCandidate(arrayMatch[0]);
    if (fallback) {
      return fallback;
    }
  }

  throw new AppError("Model response could not be parsed as a JSON array.", 502, "INVALID_MODEL_JSON");
}

function normalizeRawTicket(rawTicket: unknown): TicketWithoutKey | null {
  if (!rawTicket || typeof rawTicket !== "object") {
    return null;
  }

  const ticketObject = rawTicket as Record<string, unknown>;
  const title = normalizeTitle(ticketObject.title);
  const description = normalizeDescription(ticketObject.description);
  const acceptanceCriteria = normalizeAcceptanceCriteria(ticketObject.acceptance_criteria);
  const type = normalizeTicketType(ticketObject.type);

  if (title.length < 5 || description.length < 12 || acceptanceCriteria.length === 0) {
    return null;
  }

  return {
    title,
    description,
    acceptance_criteria: acceptanceCriteria,
    type,
  };
}

export function normalizeAndValidateTickets(rawTickets: unknown[]): Ticket[] {
  if (!Array.isArray(rawTickets)) {
    throw new AppError("Model response is not a ticket array.", 502, "INVALID_MODEL_SHAPE");
  }

  const normalized = rawTickets.map(normalizeRawTicket).filter((ticket): ticket is TicketWithoutKey => ticket !== null);

  const deduped: TicketWithoutKey[] = [];
  const seen = new Set<string>();

  for (const ticket of normalized) {
    const signature = buildDeduplicationSignature(ticket);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push(ticket);
  }

  const bounded = deduped.slice(0, TICKET_LIMIT_MAX);
  if (bounded.length < TICKET_LIMIT_MIN) {
    throw new AppError(
      "Model response did not include valid tickets. Try a more explicit transcript or retry generation.",
      502,
      "NO_VALID_TICKETS"
    );
  }

  return bounded.map((ticket) => ({
    ...ticket,
    idempotency_key: buildTicketIdempotencyKey(ticket),
  }));
}
