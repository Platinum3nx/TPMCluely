import { AppError } from "./errors";

export const MAX_TRANSCRIPT_CHARS = 150_000;
export const TARGET_MODEL_TRANSCRIPT_CHARS = 22_000;

const HEAD_SECTION_CHARS = 7_500;
const TAIL_SECTION_CHARS = 7_500;
const ACTION_SECTION_BUDGET_CHARS = 5_500;
const ACTION_LINE_REGEX =
  /\b(todo|action item|bug|fix|implement|ship|owner|assigned|deadline|decided|decision|follow[- ]?up|ticket|blocker|regression|incident|eta|next step)\b/i;

export interface TranscriptPreparationResult {
  transcriptForModel: string;
  warnings: string[];
  originalChars: number;
  usedChars: number;
  condensed: boolean;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\t/g, "  ").trim();
}

function truncateMiddle(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }

  const headChars = Math.floor(maxChars * 0.55);
  const tailChars = Math.max(0, maxChars - headChars - 40);
  return `${input.slice(0, headChars)}\n\n[... trimmed for length ...]\n\n${input.slice(-tailChars)}`;
}

function collectActionLines(input: string, budgetChars: number): string {
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && ACTION_LINE_REGEX.test(line));

  const seen = new Set<string>();
  const selected: string[] = [];
  let totalChars = 0;

  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    const nextTotal = totalChars + line.length + 1;
    if (nextTotal > budgetChars) {
      break;
    }

    selected.push(line);
    seen.add(normalized);
    totalChars = nextTotal;
  }

  return selected.join("\n");
}

export function prepareTranscriptForModel(rawTranscript: string): TranscriptPreparationResult {
  const normalized = normalizeWhitespace(rawTranscript);
  const originalChars = normalized.length;

  if (originalChars === 0) {
    throw new AppError("Transcript is required and must be a non-empty string.", 400, "INVALID_TRANSCRIPT");
  }

  if (originalChars > MAX_TRANSCRIPT_CHARS) {
    throw new AppError(
      `Transcript is too large (${originalChars.toLocaleString()} chars). Max allowed is ${MAX_TRANSCRIPT_CHARS.toLocaleString()} chars.`,
      413,
      "TRANSCRIPT_TOO_LARGE"
    );
  }

  if (originalChars <= TARGET_MODEL_TRANSCRIPT_CHARS) {
    return {
      transcriptForModel: normalized,
      warnings: [],
      originalChars,
      usedChars: originalChars,
      condensed: false,
    };
  }

  const head = normalized.slice(0, HEAD_SECTION_CHARS).trimEnd();
  const tail = normalized.slice(-TAIL_SECTION_CHARS).trimStart();
  const middle = normalized.slice(HEAD_SECTION_CHARS, -TAIL_SECTION_CHARS);
  const actionLines = collectActionLines(middle, ACTION_SECTION_BUDGET_CHARS);

  const assembled = [
    head,
    "",
    "[... middle section omitted for token safety ...]",
    actionLines
      ? `Key action-oriented lines extracted from omitted middle section:\n${actionLines}`
      : "No high-signal action lines were detected in the omitted middle section.",
    "",
    tail,
  ].join("\n");

  const condensed = truncateMiddle(assembled, TARGET_MODEL_TRANSCRIPT_CHARS);
  const omittedChars = Math.max(0, originalChars - condensed.length);

  return {
    transcriptForModel: condensed,
    warnings: [
      `Transcript was condensed from ${originalChars.toLocaleString()} to ${condensed.length.toLocaleString()} characters to control cost and latency.`,
      omittedChars > 0
        ? `${omittedChars.toLocaleString()} characters were omitted from low-signal sections.`
        : "Low-signal transcript sections were condensed.",
    ],
    originalChars,
    usedChars: condensed.length,
    condensed: true,
  };
}
