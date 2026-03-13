import type { SessionDetail } from "./types";

export function buildSessionMarkdown(detail: SessionDetail): string {
  const transcript = detail.transcripts
    .map((segment) => `- ${(segment.speakerLabel ?? "Unattributed").trim() || "Unattributed"}: ${segment.text}`)
    .join("\n");

  return [
    `# ${detail.session.title}`,
    "",
    `Status: ${detail.session.status}`,
    `Started: ${detail.session.startedAt ?? "n/a"}`,
    `Ended: ${detail.session.endedAt ?? "n/a"}`,
    "",
    "## Summary",
    detail.session.finalSummary ?? "No summary available yet.",
    "",
    "## Decisions",
    detail.session.decisionsMd ?? "- None yet.",
    "",
    "## Action Items",
    detail.session.actionItemsMd ?? "- None yet.",
    "",
    "## Transcript",
    transcript || "- No transcript available yet.",
  ].join("\n");
}
