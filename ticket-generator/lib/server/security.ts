import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { consumeRateLimit, getClientIdentifier } from "./rate-limit";

export interface RouteSecurityOptions {
  routeKey: string;
  limit: number;
  windowMs: number;
}

function parseAllowedOrigins(rawValue: string | undefined): Set<string> {
  const origins = new Set<string>();
  if (!rawValue) {
    return origins;
  }

  for (const value of rawValue.split(",")) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      origins.add(trimmed);
    }
  }

  return origins;
}

function validateOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  const requestOrigin = request.nextUrl.origin;
  const configuredOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  configuredOrigins.add(requestOrigin);

  if (!origin) {
    if (process.env.NODE_ENV === "production") {
      return "Missing Origin header.";
    }
    return null;
  }

  if (!configuredOrigins.has(origin)) {
    return "Request origin is not allowed.";
  }

  return null;
}

export function runRouteSecurity(
  request: NextRequest,
  options: RouteSecurityOptions
): NextResponse | null {
  const originError = validateOrigin(request);
  if (originError) {
    return NextResponse.json({ error: originError }, { status: 403 });
  }

  const clientId = getClientIdentifier(request);
  const rateLimitKey = `${options.routeKey}:${clientId}`;
  const rateLimit = consumeRateLimit(rateLimitKey, options.limit, options.windowMs);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before retrying." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
        },
      }
    );
  }

  return null;
}
