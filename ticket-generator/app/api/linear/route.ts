import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { title, description, acceptance_criteria } = await request.json();

    if (!title || !description) {
      return NextResponse.json(
        { error: "Title and description are required." },
        { status: 400 }
      );
    }

    const apiKey = process.env.LINEAR_API_KEY;
    const teamId = process.env.LINEAR_TEAM_ID;

    if (!apiKey || !teamId) {
      return NextResponse.json(
        { error: "LINEAR_API_KEY and LINEAR_TEAM_ID must be set in .env.local" },
        { status: 500 }
      );
    }

    // Format acceptance criteria as a markdown checklist appended to description
    let fullDescription = description;
    if (Array.isArray(acceptance_criteria) && acceptance_criteria.length > 0) {
      const checklist = acceptance_criteria
        .map((criterion: string) => `- [ ] ${criterion}`)
        .join("\n");
      fullDescription += `\n\n**Acceptance Criteria**\n${checklist}`;
    }

    const mutation = `
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

    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            teamId,
            title,
            description: fullDescription,
          },
        },
      }),
    });

    const data = await response.json();

    if (data.errors) {
      const message = data.errors.map((e: { message: string }) => e.message).join(", ");
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!data.data?.issueCreate?.success) {
      return NextResponse.json(
        { error: "Linear failed to create the issue." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      issue: data.data.issueCreate.issue,
    });
  } catch (error) {
    console.error("Error creating Linear issue:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
