import { AppError } from "./errors";
import { HttpStatusError, statusIsRetryable, withRetry, withTimeout } from "./resilience";

const LINEAR_TIMEOUT_MS = 12_000;

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        title
        url
      }
    }
  }
`;

export interface CreateLinearIssueInput {
  apiKey: string;
  teamId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  idempotencyKey?: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildLinearDescription(
  description: string,
  acceptanceCriteria: string[],
  idempotencyKey?: string
): string {
  let fullDescription = normalizeLine(description);

  if (acceptanceCriteria.length > 0) {
    const checklist = acceptanceCriteria.map((criterion) => `- [ ] ${normalizeLine(criterion)}`).join("\n");
    fullDescription += `\n\n**Acceptance Criteria**\n${checklist}`;
  }

  if (idempotencyKey) {
    fullDescription += `\n\n<!-- cluely-idempotency:${idempotencyKey} -->`;
  }

  return fullDescription;
}

function isRetryableLinearError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.retryable;
  }
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

async function postLinearGraphql<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const performRequest = async (): Promise<T> => {
    const controller = new AbortController();
    const request = withTimeout(
      async () =>
        fetch("https://api.linear.app/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        }),
      LINEAR_TIMEOUT_MS,
      "Linear GraphQL request"
    );

    const response = await request.catch((error) => {
      controller.abort();
      throw error;
    });

    if (!response.ok) {
      const retryable = statusIsRetryable(response.status);
      let bodySnippet = "";
      try {
        bodySnippet = await response.text();
      } catch {
        bodySnippet = "";
      }

      throw new HttpStatusError(
        response.status,
        `Linear API returned HTTP ${response.status}${bodySnippet ? `: ${bodySnippet.slice(0, 180)}` : ""}`,
        retryable
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new AppError("Linear API response was not valid JSON.", 502, "LINEAR_INVALID_JSON");
    }
  };

  return withRetry(() => performRequest(), {
    retries: 2,
    shouldRetry: isRetryableLinearError,
    baseDelayMs: 400,
    maxDelayMs: 3500,
  });
}

export async function createLinearIssue(input: CreateLinearIssueInput): Promise<LinearIssue> {
  const fullDescription = buildLinearDescription(
    input.description,
    input.acceptanceCriteria,
    input.idempotencyKey
  );

  const data = await postLinearGraphql<{
    data?: { issueCreate?: { success?: boolean; issue?: LinearIssue } };
    errors?: Array<{ message?: string }>;
  }>(input.apiKey, ISSUE_CREATE_MUTATION, {
    input: {
      teamId: input.teamId,
      title: normalizeLine(input.title),
      description: fullDescription,
    },
  });

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const message = data.errors
      .map((error) => (typeof error.message === "string" ? error.message : "Unknown Linear GraphQL error"))
      .join(", ");
    throw new AppError(message, 400, "LINEAR_GRAPHQL_ERROR");
  }

  if (!data.data?.issueCreate?.success || !data.data.issueCreate.issue) {
    throw new AppError("Linear failed to create the issue.", 502, "LINEAR_CREATE_FAILED");
  }

  return data.data.issueCreate.issue;
}
