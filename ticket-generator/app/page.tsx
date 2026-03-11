"use client";

import { useState, useRef } from "react";
import TicketCard, { Ticket } from "./components/TicketCard";

export default function Home() {
  const [transcript, setTranscript] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState("Initializing…");
  const ticketsRef = useRef<HTMLDivElement>(null);

  const loadingMessages = [
    "Parsing transcript…",
    "Identifying engineering tasks…",
    "Extracting acceptance criteria…",
    "Classifying ticket types…",
    "Generating tickets…",
    "Formatting output…",
  ];

  const handleGenerate = async () => {
    if (!transcript.trim()) return;

    setLoading(true);
    setError(null);
    setTickets([]);

    let msgIdx = 0;
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % loadingMessages.length;
      setLoadingText(loadingMessages[msgIdx]);
    }, 2200);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate tickets");
      }

      setTickets(data.tickets);

      setTimeout(() => {
        ticketsRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-violet-600/15 border border-violet-500/20">
              <svg className="w-3.5 h-3.5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h1 className="font-semibold text-sm tracking-tight text-zinc-100">
              Ticket Generator
            </h1>
            <span className="text-[10px] font-mono text-zinc-600 border border-zinc-800 rounded-md px-1.5 py-0.5 bg-zinc-900">
              v2.0
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-zinc-500 hidden sm:inline">
              powered by Gemini
            </span>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 min-h-[calc(100vh-7rem)]">

          {/* LEFT PANEL — Transcript Input */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-4 rounded-full bg-violet-500" />
              <label
                htmlFor="transcript-input"
                className="text-sm font-medium text-zinc-300 tracking-tight"
              >
                Raw Meeting Transcript
              </label>
            </div>

            <div className="flex-1 relative">
              <textarea
                id="transcript-input"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={`Paste your meeting transcript here…\n\nExample:\n\nPM: Let's talk about the auth issues from last sprint.\nSarah: The login endpoint is getting rate-limited under load…\nAlex: I can handle the rate limiter. Redis-backed, sliding window.\nPM: Great. We also need to fix the session timeout bug…`}
                className="w-full h-full min-h-[420px] lg:min-h-0 bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-zinc-100 placeholder-zinc-600 resize-none focus-ring transition-all duration-200 leading-relaxed"
              />
            </div>

            {/* Word Count */}
            <div className="flex items-center justify-between mt-3">
              <span className="text-[11px] text-zinc-600 font-mono">
                {transcript.length > 0
                  ? `${transcript.split(/\s+/).filter(Boolean).length} words`
                  : "No content"}
              </span>
            </div>

            {/* Generate Button */}
            <button
              id="generate-button"
              onClick={handleGenerate}
              disabled={loading || !transcript.trim()}
              className={`mt-4 w-full py-3.5 rounded-xl font-medium text-sm tracking-wide transition-all duration-300 cursor-pointer ${
                loading
                  ? "bg-violet-600/60 border border-violet-500/40 text-violet-200"
                  : !transcript.trim()
                  ? "bg-zinc-900 border border-zinc-800 text-zinc-600 cursor-not-allowed"
                  : "bg-violet-600 border border-violet-500 text-white hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/20 active:scale-[0.99]"
              }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2.5">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {loadingText}
                </span>
              ) : (
                "Generate Tickets"
              )}
            </button>

            {/* Error display */}
            {error && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/5 border border-rose-500/20 text-rose-400 text-xs font-mono">
                <span className="text-rose-500/60">error: </span>
                {error}
              </div>
            )}
          </div>

          {/* RIGHT PANEL — Generated Tickets */}
          <div ref={ticketsRef} className="flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-emerald-500" />
                <h2 className="text-sm font-medium text-zinc-300 tracking-tight">
                  Generated Tickets
                </h2>
              </div>
              {tickets.length > 0 && (
                <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                  {tickets.length} tickets
                </span>
              )}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              {tickets.length > 0 ? (
                tickets.map((ticket, i) => (
                  <TicketCard key={i} ticket={ticket} index={i} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full min-h-[420px] lg:min-h-0 border border-zinc-800 border-dashed rounded-xl bg-zinc-900/30">
                  <div className="text-center px-6">
                    <div className="w-12 h-12 rounded-xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>
                    <p className="text-zinc-400 text-sm font-medium mb-1">
                      No tickets yet
                    </p>
                    <p className="text-zinc-600 text-xs leading-relaxed">
                      Paste a meeting transcript and click Generate Tickets
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
