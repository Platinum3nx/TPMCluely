"use client";

import { useState, useRef } from "react";
import TicketCard, { Ticket } from "./components/TicketCard";

export default function Home() {
  const [transcript, setTranscript] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState("Initializing...");
  const ticketsRef = useRef<HTMLDivElement>(null);

  const loadingMessages = [
    "Parsing transcript...",
    "Identifying engineering tasks...",
    "Extracting acceptance criteria...",
    "Assigning team members...",
    "Generating tickets...",
    "Formatting output...",
  ];

  const handleGenerate = async () => {
    if (!transcript.trim()) return;

    setLoading(true);
    setError(null);
    setTickets([]);

    // Cycle through loading messages
    let msgIdx = 0;
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % loadingMessages.length;
      setLoadingText(loadingMessages[msgIdx]);
    }, 2000);

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

      // Scroll to tickets on mobile
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
    <div className="relative z-10 min-h-screen">
      {/* Header */}
      <header className="border-b border-[#1a1a1a] bg-[#050505]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
            <h1 className="font-mono text-sm font-semibold tracking-wider text-[#e0e0e0]">
              TICKET<span className="text-[#00ff88]">::</span>GEN
            </h1>
            <span className="text-[10px] font-mono text-[#555] border border-[#1a1a1a] rounded px-1.5 py-0.5">
              v1.0
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-mono text-[#555]">
              powered by <span className="text-[#00d4ff]">gemini</span>
            </span>
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff4444]/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#ffaa00]/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#00ff88]/60" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[calc(100vh-5rem)]">
          {/* LEFT PANEL — Transcript Input */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[#00ff88] font-mono text-xs">▸</span>
                <h2 className="text-xs font-mono tracking-widest text-[#555] uppercase">
                  Transcript Input
                </h2>
              </div>
              <span className="text-[10px] font-mono text-[#555]">
                {transcript.length > 0
                  ? `${transcript.split(/\s+/).filter(Boolean).length} words`
                  : "empty"}
              </span>
            </div>

            <div className="flex-1 relative group">
              <textarea
                id="transcript-input"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={`Paste your meeting transcript here...\n\nExample:\n\nPM: Alright team, let's discuss the auth issues.\nSarah: The login endpoint is getting rate-limited...\nAlex: I can handle the rate limiter implementation.\nPM: Great. We also need to fix the session timeout bug...`}
                className="w-full h-full min-h-[400px] lg:min-h-0 bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg p-4 text-sm text-[#e0e0e0] placeholder-[#333] resize-none focus:outline-none focus:border-[#00ff88]/30 focus:shadow-[0_0_20px_rgba(0,255,136,0.05)] transition-all duration-300 leading-relaxed"
              />
              {/* Scan line effect on focus */}
              <div className="absolute inset-0 pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity">
                <div className="absolute left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#00ff88]/20 to-transparent" style={{ animation: 'scan-line 3s linear infinite' }} />
              </div>
            </div>

            {/* Generate Button */}
            <button
              id="generate-button"
              onClick={handleGenerate}
              disabled={loading || !transcript.trim()}
              className={`mt-4 w-full py-3 rounded-lg font-mono text-sm tracking-wider transition-all duration-300 cursor-pointer ${
                loading
                  ? "bg-[#0d0d0d] border border-[#00ff88]/20 text-[#00ff88]/60"
                  : !transcript.trim()
                  ? "bg-[#0d0d0d] border border-[#1a1a1a] text-[#333] cursor-not-allowed"
                  : "bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] hover:bg-[#00ff88]/15 hover:border-[#00ff88]/50 hover:shadow-[0_0_30px_rgba(0,255,136,0.1)] active:scale-[0.99]"
              }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="w-4 h-4 animate-spin"
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
                  {loadingText}
                </span>
              ) : (
                "[ GENERATE TICKETS ]"
              )}
            </button>

            {/* Error display */}
            {error && (
              <div className="mt-3 p-3 rounded-lg bg-[#ff4444]/5 border border-[#ff4444]/20 text-[#ff4444] text-xs font-mono">
                <span className="text-[#ff4444]/60">error: </span>
                {error}
              </div>
            )}
          </div>

          {/* RIGHT PANEL — Generated Tickets */}
          <div ref={ticketsRef} className="flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[#00d4ff] font-mono text-xs">▸</span>
                <h2 className="text-xs font-mono tracking-widest text-[#555] uppercase">
                  Generated Tickets
                </h2>
              </div>
              {tickets.length > 0 && (
                <span className="text-[10px] font-mono text-[#00ff88] bg-[#00ff88]/10 px-2 py-0.5 rounded-full">
                  {tickets.length} tickets
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {tickets.length > 0 ? (
                tickets.map((ticket, i) => (
                  <TicketCard key={i} ticket={ticket} index={i} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full min-h-[400px] lg:min-h-0 border border-[#1a1a1a] border-dashed rounded-lg">
                  <div className="text-center">
                    <div className="text-[#1a1a1a] text-6xl mb-4 font-mono">
                      { }
                    </div>
                    <p className="text-[#333] text-sm font-mono mb-1">
                      No tickets generated yet
                    </p>
                    <p className="text-[#222] text-xs font-mono">
                      Paste a transcript and hit generate
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
