import { NextRequest, NextResponse } from "next/server";
import { AppError, toErrorMessage } from "@/lib/server/errors";
import { generateTickets } from "@/lib/server/generate-tickets";
import { parseGenerateRequestBody } from "@/lib/server/request-validation";
import { runRouteSecurity } from "@/lib/server/security";

const GENERATE_RATE_LIMIT = {
  routeKey: "generate",
  limit: 10,
  windowMs: 5 * 60 * 1000,
};

export async function POST(request: NextRequest) {
  const securityResponse = runRouteSecurity(request, GENERATE_RATE_LIMIT);
  if (securityResponse) {
    return securityResponse;
  }

  try {
    const body = await request.json().catch(() => {
      throw new AppError("Request body must be valid JSON.", 400, "INVALID_JSON");
    });
    const { transcript } = parseGenerateRequestBody(body);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AppError(
        "GEMINI_API_KEY is not configured. Add it to your .env.local file.",
        500,
        "MISSING_GEMINI_KEY"
      );
    }

    const result = await generateTickets(transcript, apiKey);
    return NextResponse.json(result);
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("Error generating tickets:", error);
    }

    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: toErrorMessage(error) }, { status });
  }
}
