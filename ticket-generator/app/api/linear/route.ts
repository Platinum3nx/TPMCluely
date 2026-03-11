import { NextRequest, NextResponse } from "next/server";
import { AppError, toErrorMessage } from "@/lib/server/errors";
import { runIdempotent } from "@/lib/server/idempotency";
import { createLinearIssue } from "@/lib/server/linear";
import { parseLinearRequestBody } from "@/lib/server/request-validation";
import { runRouteSecurity } from "@/lib/server/security";

const LINEAR_RATE_LIMIT = {
  routeKey: "linear",
  limit: 24,
  windowMs: 10 * 60 * 1000,
};

export async function POST(request: NextRequest) {
  const securityResponse = runRouteSecurity(request, LINEAR_RATE_LIMIT);
  if (securityResponse) {
    return securityResponse;
  }

  try {
    const body = await request.json().catch(() => {
      throw new AppError("Request body must be valid JSON.", 400, "INVALID_JSON");
    });
    const parsed = parseLinearRequestBody(body);

    const apiKey = process.env.LINEAR_API_KEY;
    const teamId = process.env.LINEAR_TEAM_ID;

    if (!apiKey || !teamId) {
      throw new AppError(
        "LINEAR_API_KEY and LINEAR_TEAM_ID must be set in .env.local.",
        500,
        "MISSING_LINEAR_CONFIG"
      );
    }

    const result = await runIdempotent(parsed.idempotencyKey, () =>
      createLinearIssue({
        apiKey,
        teamId,
        title: parsed.title,
        description: parsed.description,
        acceptanceCriteria: parsed.acceptanceCriteria,
        idempotencyKey: parsed.idempotencyKey,
      })
    );

    return NextResponse.json({
      success: true,
      issue: result.value,
      deduped: result.deduped,
    });
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("Error creating Linear issue:", error);
    }

    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: toErrorMessage(error) }, { status });
  }
}
