"use client";

import { useState } from "react";

export interface Ticket {
  title: string;
  description: string;
  acceptance_criteria: string[];
  assignee_name: string;
}

interface TicketCardProps {
  ticket: Ticket;
  index: number;
}

export default function TicketCard({ ticket, index }: TicketCardProps) {
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(false);

  const handlePushToLinear = async () => {
    setPushing(true);
    // Simulate API call to Linear
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setPushed(true);
    setPushing(false);
  };

  const priorityColors = [
    "border-l-[#ff4444]",
    "border-l-[#ffaa00]",
    "border-l-[#00ff88]",
    "border-l-[#00d4ff]",
    "border-l-[#aa66ff]",
  ];

  const priorityLabels = ["Urgent", "High", "Medium", "Low", "Backlog"];
  const priorityDots = ["bg-[#ff4444]", "bg-[#ffaa00]", "bg-[#00ff88]", "bg-[#00d4ff]", "bg-[#aa66ff]"];
  const pIdx = index % priorityColors.length;

  return (
    <div
      className={`ticket-card group relative bg-[#0d0d0d] border border-[#1a1a1a] ${priorityColors[pIdx]} border-l-2 rounded-lg p-5 hover:border-[#2a2a2a] hover:bg-[#111] transition-all duration-300`}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#555] font-mono text-xs tracking-wider">
              TICK-{String(index + 1).padStart(3, "0")}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide bg-[#1a1a1a]`}>
              <span className={`w-1.5 h-1.5 rounded-full ${priorityDots[pIdx]}`} />
              <span className="text-[#888]">{priorityLabels[pIdx]}</span>
            </span>
          </div>
          <h3 className="text-[#e0e0e0] font-semibold text-sm leading-tight group-hover:text-[#00ff88] transition-colors">
            {ticket.title}
          </h3>
        </div>
      </div>

      {/* Description */}
      <p className="text-[#888] text-xs leading-relaxed mb-4 line-clamp-3">
        {ticket.description}
      </p>

      {/* Acceptance Criteria */}
      <div className="mb-4">
        <p className="text-[#555] text-[10px] font-mono tracking-widest uppercase mb-2">
          Acceptance Criteria
        </p>
        <ul className="space-y-1.5">
          {ticket.acceptance_criteria.map((criteria, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-xs text-[#888]"
            >
              <span className="text-[#00ff88] mt-0.5 text-[10px]">▸</span>
              <span className="leading-relaxed">{criteria}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#1a1a1a]">
        {/* Assignee */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00ff88] to-[#00d4ff] flex items-center justify-center">
            <span className="text-[#050505] text-[10px] font-bold">
              {ticket.assignee_name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2)}
            </span>
          </div>
          <span className="text-[#888] text-xs">{ticket.assignee_name}</span>
        </div>

        {/* Push to Linear Button */}
        <button
          onClick={handlePushToLinear}
          disabled={pushing || pushed}
          className={`relative px-3 py-1.5 rounded text-xs font-mono tracking-wide transition-all duration-300 cursor-pointer ${
            pushed
              ? "bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30"
              : pushing
              ? "bg-[#1a1a1a] text-[#555] border border-[#1a1a1a]"
              : "bg-[#1a1a1a] text-[#888] border border-[#2a2a2a] hover:border-[#00ff88]/50 hover:text-[#00ff88] hover:bg-[#00ff88]/5 hover:shadow-[0_0_12px_rgba(0,255,136,0.1)]"
          }`}
        >
          {pushed ? (
            <span className="flex items-center gap-1.5">
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Pushed
            </span>
          ) : pushing ? (
            <span className="flex items-center gap-1.5">
              <svg
                className="w-3 h-3 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Pushing...
            </span>
          ) : (
            "Push to Linear →"
          )}
        </button>
      </div>
    </div>
  );
}
