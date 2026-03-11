# Ticket Generator

Convert meeting transcripts into structured engineering tickets and push them to Linear.

## Core Capabilities

- Transcript -> AI ticket extraction (`Bug`, `Feature`, `Task`)
- Strict JSON parsing and server-side ticket normalization
- Transcript size guardrails with deterministic condensation
- Idempotent Linear issue creation support
- API origin checks + in-memory rate limiting
- Optional HTTP Basic Auth for app/API protection
- Retry + timeout controls for Gemini and Linear API calls

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file:

```bash
cp .env.example .env.local
```

3. Fill required variables in `.env.local`:

- `GEMINI_API_KEY`
- `LINEAR_API_KEY`
- `LINEAR_TEAM_ID`

Optional security settings:

- `ALLOWED_ORIGINS` (comma-separated list of trusted origins)
- `BASIC_AUTH_USERNAME`
- `BASIC_AUTH_PASSWORD`

## Scripts

```bash
npm run dev
npm run lint
npm run test
npm run build
```

## API Routes

- `POST /api/generate`
  - Input: `{ "transcript": "..." }`
  - Output: `{ "tickets": Ticket[], "warnings": string[] }`
- `POST /api/linear`
  - Input: `{ "title": "...", "description": "...", "acceptance_criteria": string[], "idempotency_key"?: "..." }`
  - Output: `{ "success": true, "issue": LinearIssue, "deduped": boolean }`

## Reliability/Safety Notes

- Generation route applies input validation, transcript hard limits, and bounded model context.
- Both API routes enforce origin checks and rate limits.
- Both external providers (Gemini, Linear) run with retry and timeout protections.
- Linear pushes support idempotency keys and client-side persistence to reduce duplicate ticket creation.
