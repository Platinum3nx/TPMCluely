import { AppError } from "./errors";

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

export interface GenerateRequestBody {
  transcript: string;
}

export function parseGenerateRequestBody(body: unknown): GenerateRequestBody {
  if (!body || typeof body !== "object") {
    throw new AppError("Request body must be a JSON object.", 400, "INVALID_BODY");
  }

  const transcript = (body as Record<string, unknown>).transcript;
  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    throw new AppError("Transcript is required and must be a non-empty string.", 400, "INVALID_TRANSCRIPT");
  }

  return { transcript };
}

export interface LinearRequestBody {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  idempotencyKey?: string;
}

export function parseLinearRequestBody(body: unknown): LinearRequestBody {
  if (!body || typeof body !== "object") {
    throw new AppError("Request body must be a JSON object.", 400, "INVALID_BODY");
  }

  const record = body as Record<string, unknown>;
  const title = normalizeString(record.title);
  const description = normalizeString(record.description);
  const idempotencyKey = normalizeString(record.idempotency_key);

  if (title.length < 4) {
    throw new AppError("Title is required and must be at least 4 characters.", 400, "INVALID_TITLE");
  }

  if (description.length < 8) {
    throw new AppError("Description is required and must be at least 8 characters.", 400, "INVALID_DESCRIPTION");
  }

  const rawCriteria = Array.isArray(record.acceptance_criteria)
    ? record.acceptance_criteria
    : [];

  const acceptanceCriteria = rawCriteria
    .map((item) => normalizeString(item))
    .filter((item) => item.length >= 3)
    .slice(0, 10);

  return {
    title: title.length > 140 ? `${title.slice(0, 137)}...` : title,
    description: description.length > 2400 ? `${description.slice(0, 2397)}...` : description,
    acceptanceCriteria,
    idempotencyKey: idempotencyKey || undefined,
  };
}
