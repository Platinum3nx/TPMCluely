import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Ticket } from "@/lib/shared/tickets";
import { AppError } from "./errors";
import { withRetry, withTimeout } from "./resilience";
import { prepareTranscriptForModel } from "./transcript";
import { extractJsonArrayFromText, normalizeAndValidateTickets } from "./ticket-normalization";

const GENERATION_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 25_000;

const SYSTEM_PROMPT = `You are a principal technical program manager.
Analyze the meeting transcript and produce engineering tickets.

Output requirements:
- Return ONLY a JSON array (no markdown, no prose)
- Each ticket object must contain:
  - "title": concise, implementation-ready title
  - "description": technical context, motivation, and details from discussion
  - "acceptance_criteria": array of measurable, testable criteria
  - "type": exactly one of "Bug", "Feature", or "Task"

Quality rules:
- Generate between 3 and 8 tickets depending on transcript density
- Keep titles specific and action-oriented
- Avoid duplicate tickets
- Ensure every acceptance criterion can be objectively verified
- Treat speaker-attributed commitments as grounded ownership evidence only when the transcript explicitly supports that attribution
- Do not invent owners or certainty when the transcript is unattributed or ambiguous`;

const REPAIR_PROMPT = `Repair the provided content into a strict JSON array of ticket objects.
Rules:
- Output only JSON array
- Required keys: title, description, acceptance_criteria, type
- type must be Bug, Feature, or Task
- acceptance_criteria must be an array of strings
- Remove invalid entries instead of inventing unsupported facts`;

function isRetryableGeminiError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("429") ||
    message.includes("500") ||
    message.includes("503") ||
    message.includes("network")
  );
}

async function requestGeminiJsonText(apiKey: string, payloadText: string, prompt = SYSTEM_PROMPT): Promise<string> {
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: GENERATION_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const response = await withRetry(
    () =>
      withTimeout(
        () =>
          model.generateContent([
            { text: prompt },
            { text: payloadText },
          ]),
        GEMINI_TIMEOUT_MS,
        "Gemini generation"
      ),
    {
      retries: 2,
      shouldRetry: isRetryableGeminiError,
      baseDelayMs: 450,
      maxDelayMs: 4000,
    }
  );

  return response.response.text();
}

function parseAndNormalizeTicketResponse(responseText: string): Ticket[] {
  const rawTickets = extractJsonArrayFromText(responseText);
  return normalizeAndValidateTickets(rawTickets);
}

export interface TicketGenerationResult {
  tickets: Ticket[];
  warnings: string[];
}

export async function generateTickets(transcript: string, apiKey: string): Promise<TicketGenerationResult> {
  const preparedTranscript = prepareTranscriptForModel(transcript);

  const modelInput = `Meeting transcript to analyze:\n\n${preparedTranscript.transcriptForModel}`;
  const rawResponse = await requestGeminiJsonText(apiKey, modelInput);

  try {
    return {
      tickets: parseAndNormalizeTicketResponse(rawResponse),
      warnings: preparedTranscript.warnings,
    };
  } catch (error) {
    const repairInput = `Broken response to repair:\n\n${rawResponse}`;
    const repairedResponse = await requestGeminiJsonText(apiKey, repairInput, REPAIR_PROMPT);

    try {
      return {
        tickets: parseAndNormalizeTicketResponse(repairedResponse),
        warnings: [
          ...preparedTranscript.warnings,
          "Model output required automatic JSON repair before validation.",
        ],
      };
    } catch {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("Failed to parse and validate ticket output from model.", 502, "INVALID_MODEL_OUTPUT");
    }
  }
}
