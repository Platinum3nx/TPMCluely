"use client";

import { useState } from "react";

export interface Ticket {
  title: string;
  description: string;
  acceptance_criteria: string[];
  type: "Bug" | "Feature" | "Task";
}

interface TicketCardProps {
  ticket: Ticket;
  index: number;
}

const TYPE_STYLES: Record<string, { border: string; dot: string; badge: string }> = {
  Feature: {
    border: "border-l-violet-500",
    dot: "bg-violet-500",
    badge: "text-violet-400 bg-violet-500/10",
  },
  Bug: {
    border: "border-l-rose-500",
    dot: "bg-rose-500",
    badge: "text-rose-400 bg-rose-500/10",
  },
  Task: {
    border: "border-l-amber-500",
    dot: "bg-amber-500",
    badge: "text-amber-400 bg-amber-500/10",
  },
};

export default function TicketCard({ ticket, index }: TicketCardProps) {
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const handlePushToLinear = async () => {
    setPushing(true);
    setPushError(null);
    try {
      const res = await fetch("/api/linear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ticket.title,
          description: ticket.description,
          acceptance_criteria: ticket.acceptance_criteria,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create issue");
      }
      setPushed(true);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Failed to push");
    } finally {
      setPushing(false);
    }
  };

  const style = TYPE_STYLES[ticket.type] || TYPE_STYLES.Task;

  return (
    <div
      className={`ticket-card group relative bg-zinc-900 border border-zinc-800 ${style.border} border-l-2 rounded-xl p-5 hover:border-zinc-700 hover:bg-zinc-900/80 transition-all duration-300 hover:shadow-lg hover:shadow-black/20`}
      style={{ animationDelay: `${index * 0.12}s` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="text-zinc-600 font-mono text-[11px] tracking-wider">
              TICK-{String(index + 1).padStart(3, "0")}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide ${style.badge}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
              {ticket.type}
            </span>
          </div>
          <h3 className="text-zinc-100 font-semibold text-[15px] leading-snug group-hover:text-white transition-colors">
            {ticket.title}
          </h3>
        </div>
      </div>

      {/* Description */}
      <p className="text-zinc-400 text-[13px] leading-relaxed mb-4 line-clamp-3">
        {ticket.description}
      </p>

      {/* Acceptance Criteria */}
      {ticket.acceptance_criteria.length > 0 && (
        <div className="mb-4">
          <p className="text-zinc-600 text-[10px] font-mono tracking-widest uppercase mb-2">
            Acceptance Criteria
          </p>
          <ul className="space-y-1.5">
            {ticket.acceptance_criteria.map((criterion, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs text-zinc-400"
              >
                <span className="text-emerald-500 mt-0.5 text-[10px] shrink-0">▸</span>
                <span className="leading-relaxed">{criterion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div className="pt-3 border-t border-zinc-800/60">
        <div className="flex items-center justify-end">
          <button
            onClick={handlePushToLinear}
            disabled={pushing || pushed}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium tracking-wide transition-all duration-300 cursor-pointer ${
              pushed
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                : pushing
                ? "bg-zinc-800 text-zinc-500 border border-zinc-700"
                : pushError
                ? "bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/15"
                : "bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-violet-500/50 hover:text-violet-300 hover:bg-violet-500/5 hover:shadow-[0_0_15px_rgba(124,58,237,0.08)]"
            }`}
          >
            {pushed ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Created ✅
              </>
            ) : pushing ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                {pushError ? "Retry Push" : "Push to Linear"}
              </>
            )}
          </button>
        </div>
        {pushError && (
          <p className="text-rose-400/80 text-[11px] font-mono mt-2 text-right">
            {pushError}
          </p>
        )}
      </div>
    </div>
  );
}
