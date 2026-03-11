import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT = `You are a ruthless technical project manager. Analyze this raw meeting transcript, extract actionable engineering tasks, and return the data as a strict JSON array of objects.

Each object in the array must have exactly these keys:
- "title": string — a concise, actionable ticket title
- "description": string — include context from the meeting (who raised it, why it matters, technical details discussed)
- "acceptance_criteria": array of strings — specific, testable acceptance criteria
- "type": string — exactly one of "Bug", "Feature", or "Task"

Rules:
- Extract 3-8 tickets depending on the transcript length
- Be specific and actionable — no vague titles
- Each acceptance criterion must be testable and measurable
- Include relevant technical context from the discussion
- Return ONLY the JSON array. No markdown, no code fences, no extra text.`;

export async function POST(request: NextRequest) {
  try {
    const { transcript } = await request.json();

    if (!transcript || typeof transcript !== "string" || transcript.trim().length === 0) {
      return NextResponse.json(
        { error: "Transcript is required and must be a non-empty string." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured. Add it to your .env.local file." },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    });

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: `Here is the meeting transcript to analyze:\n\n${transcript}` },
    ]);

    const responseText = result.response.text();

    let tickets;
    try {
      tickets = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        tickets = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    if (!Array.isArray(tickets)) {
      throw new Error("AI response is not an array");
    }

    // Validate and normalize each ticket
    const validatedTickets = tickets.map((t: Record<string, unknown>) => ({
      title: String(t.title || "Untitled Ticket"),
      description: String(t.description || "No description provided."),
      acceptance_criteria: Array.isArray(t.acceptance_criteria)
        ? t.acceptance_criteria.map(String)
        : [String(t.acceptance_criteria || "TBD")],
      type: ["Bug", "Feature", "Task"].includes(String(t.type))
        ? String(t.type)
        : "Task",
    }));

    return NextResponse.json({ tickets: validatedTickets });
  } catch (error) {
    console.error("Error generating tickets:", error);
    let message = "An unexpected error occurred";
    if (error instanceof Error) {
      // Extract clean message from verbose Gemini SDK errors
      if (error.message.includes("429")) {
        message = "Gemini API rate limit exceeded. Please wait a minute and try again.";
      } else if (error.message.includes("401") || error.message.includes("403")) {
        message = "Invalid Gemini API key. Check your .env.local file.";
      } else {
        // Take just the first sentence
        message = error.message.split(". ")[0] + ".";
      }
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
