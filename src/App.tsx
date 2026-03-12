import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  appendTranscriptSegment,
  askAssistant,
  bootstrapApp,
  completeSession,
  getSecretValue,
  getSessionDetail,
  listSessions,
  pauseSession,
  resumeSession,
  runDynamicAction,
  saveSecret,
  saveSetting,
  startSession,
} from "./lib/tauri";
import { DashboardApp } from "./dashboard/DashboardApp";
import { OnboardingApp } from "./onboarding/OnboardingApp";
import { Settings } from "./dashboard/Settings";
import { SessionWidget } from "./session/SessionWidget";
import { buildSessionMarkdown } from "./lib/export";
import { matchesShortcut, normalizeGlobalShortcut } from "./lib/shortcuts";
import type {
  BootstrapPayload,
  CaptureMode,
  DynamicActionKey,
  SecretKey,
  SessionDetail,
  SessionRecord,
  SettingRecord,
} from "./lib/types";
import { useLiveTranscription } from "./session/useLiveTranscription";

type ViewKey = "overview" | "onboarding" | "session" | "dashboard" | "settings";

const viewMeta: Array<{ key: ViewKey; label: string; caption: string }> = [
  { key: "overview", label: "Mission", caption: "Foundation snapshot" },
  { key: "onboarding", label: "Onboarding", caption: "Permissions + providers" },
  { key: "session", label: "Session", caption: "Live widget shell" },
  { key: "dashboard", label: "Dashboard", caption: "Review + exports" },
  { key: "settings", label: "Settings", caption: "Local-first controls" },
];

const initialSecrets: Record<SecretKey, string> = {
  gemini_api_key: "",
  deepgram_api_key: "",
  linear_api_key: "",
  linear_team_id: "",
};

interface WindowFrame {
  height: number;
  width: number;
  x: number;
  y: number;
}

function getSettingValue(settings: SettingRecord[], key: string, fallback: string): string {
  return settings.find((setting) => setting.key === key)?.value ?? fallback;
}

function isSessionLive(status: SessionRecord["status"]): boolean {
  return ["active", "paused", "preparing", "finishing"].includes(status);
}

export default function App() {
  const [view, setView] = useState<ViewKey>("overview");
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<SessionDetail | null>(null);
  const [activeSessionDetail, setActiveSessionDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalShortcutReady, setGlobalShortcutReady] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [selectedCaptureMode, setSelectedCaptureMode] = useState<CaptureMode>("manual");
  const [secretDrafts, setSecretDrafts] = useState(initialSecrets);
  const [savingSecretKey, setSavingSecretKey] = useState<SecretKey | null>(null);

  const previousWindowFrameRef = useRef<WindowFrame | null>(null);
  const overlayOpenRef = useRef(false);
  const activeSessionRef = useRef<SessionDetail | null>(null);

  function applySessionDetail(detail: SessionDetail | null) {
    if (!detail) {
      return;
    }

    setSessions((current) =>
      [detail.session, ...current.filter((session) => session.id !== detail.session.id)].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      )
    );
    setSelectedSessionId(detail.session.id);
    setSelectedSessionDetail(detail);
    setActiveSessionDetail(isSessionLive(detail.session.status) ? detail : null);
  }

  const { captureError, captureState, isCapturing, partialTranscript, startCapture, stopCapture } = useLiveTranscription({
    onFinalTranscript: async (segment) => {
      if (!activeSessionRef.current) {
        return;
      }

      const detail = await appendTranscriptSegment({
        sessionId: activeSessionRef.current.session.id,
        speakerLabel: segment.speakerLabel,
        text: segment.text,
        isFinal: true,
        source: segment.source,
      });
      applySessionDetail(detail);
    },
  });

  useEffect(() => {
    void hydrateWorkspace();
  }, []);

  useEffect(() => {
    activeSessionRef.current = activeSessionDetail;
  }, [activeSessionDetail]);

  useEffect(() => {
    overlayOpenRef.current = overlayOpen;
  }, [overlayOpen]);

  async function hydrateWorkspace(preferredSessionId?: string | null) {
    try {
      setLoading(true);
      setError(null);
      const [payload, sessionList] = await Promise.all([bootstrapApp(), listSessions()]);
      setBootstrap(payload);
      setSessions(sessionList);

      const activeSession = sessionList.find((session) => isSessionLive(session.status));
      const nextSelectedSessionId = preferredSessionId ?? activeSession?.id ?? sessionList[0]?.id ?? null;

      setSelectedSessionId(nextSelectedSessionId);
      setActiveSessionDetail(activeSession ? await getSessionDetail(activeSession.id) : null);
      setSelectedSessionDetail(nextSelectedSessionId ? await getSessionDetail(nextSelectedSessionId) : null);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to bootstrap application shell.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function appendAndApplyTranscript(
    sessionId: string,
    speakerLabel: string,
    text: string,
    source: "manual" | "demo" | "capture" = "manual"
  ) {
    const detail = await appendTranscriptSegment({
      sessionId,
      speakerLabel,
      text,
      isFinal: true,
      source,
    });
    applySessionDetail(detail);
    return detail;
  }

  async function handleSaveSecret(key: SecretKey) {
    try {
      setSavingSecretKey(key);
      await saveSecret({ key, value: secretDrafts[key] });
      await hydrateWorkspace(selectedSessionId);
      setSecretDrafts((current) => ({ ...current, [key]: "" }));
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to save secret.";
      setError(message);
    } finally {
      setSavingSecretKey(null);
    }
  }

  async function handleUpdateSetting(key: string, value: string) {
    try {
      await saveSetting({ key, value });
      await hydrateWorkspace(selectedSessionId);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to update setting.";
      setError(message);
    }
  }

  const audioLanguage = bootstrap ? getSettingValue(bootstrap.settings, "audio_language", "auto") : "auto";
  const overlayShortcut = bootstrap ? getSettingValue(bootstrap.settings, "overlay_shortcut", "CmdOrCtrl+Shift+K") : "CmdOrCtrl+Shift+K";
  const pluginShortcut = normalizeGlobalShortcut(overlayShortcut);
  const overlayAlwaysOnTop = bootstrap ? getSettingValue(bootstrap.settings, "always_on_top", "true") === "true" : true;
  const sessionWidgetEnabled = bootstrap
    ? getSettingValue(bootstrap.settings, "session_widget_enabled", "true") === "true"
    : true;

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    if (bootstrap.secrets.deepgramConfigured && selectedCaptureMode === "manual") {
      setSelectedCaptureMode("microphone");
      return;
    }

    if (!bootstrap.secrets.deepgramConfigured && selectedCaptureMode === "microphone") {
      setSelectedCaptureMode("manual");
    }
  }, [bootstrap, selectedCaptureMode]);

  const syncOverlayWindow = useEffectEvent(async (nextOpen: boolean) => {
    if (nextOpen && !activeSessionRef.current) {
      return;
    }

    setOverlayOpen(nextOpen);
    setView("session");

    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    try {
      const [{ LogicalPosition, LogicalSize }, { currentMonitor, getCurrentWindow }] = await Promise.all([
        import("@tauri-apps/api/dpi"),
        import("@tauri-apps/api/window"),
      ]);

      const appWindow = getCurrentWindow();
      if (nextOpen) {
        const [outerSize, outerPosition, monitor] = await Promise.all([
          appWindow.outerSize(),
          appWindow.outerPosition(),
          currentMonitor(),
        ]);

        previousWindowFrameRef.current = {
          width: outerSize.width,
          height: outerSize.height,
          x: outerPosition.x,
          y: outerPosition.y,
        };

        await appWindow.setDecorations(false).catch(() => undefined);
        await appWindow.setAlwaysOnTop(overlayAlwaysOnTop).catch(() => undefined);
        await appWindow.setVisibleOnAllWorkspaces(true).catch(() => undefined);
        await appWindow.setTitleBarStyle("overlay").catch(() => undefined);
        await appWindow.setShadow(true).catch(() => undefined);
        await appWindow.setSize(new LogicalSize(540, 820));

        if (monitor) {
          const x = monitor.workArea.position.x + monitor.workArea.size.width - 572;
          const y = monitor.workArea.position.y + 28;
          await appWindow.setPosition(new LogicalPosition(x, y));
        }

        await appWindow.show();
        await appWindow.setFocus().catch(() => undefined);
        return;
      }

      await appWindow.setDecorations(true).catch(() => undefined);
      await appWindow.setAlwaysOnTop(false).catch(() => undefined);
      await appWindow.setVisibleOnAllWorkspaces(false).catch(() => undefined);
      await appWindow.setTitleBarStyle("visible").catch(() => undefined);

      if (previousWindowFrameRef.current) {
        await appWindow.setSize(
          new LogicalSize(previousWindowFrameRef.current.width, previousWindowFrameRef.current.height)
        );
        await appWindow.setPosition(
          new LogicalPosition(previousWindowFrameRef.current.x, previousWindowFrameRef.current.y)
        );
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Overlay window mode failed to update.";
      setError(message);
    }
  });

  const handleOverlayShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!activeSessionRef.current) {
      return;
    }

    if (!matchesShortcut(event, overlayShortcut)) {
      return;
    }

    event.preventDefault();
    void syncOverlayWindow(!overlayOpenRef.current);
  });

  useEffect(() => {
    if (globalShortcutReady) {
      return undefined;
    }

    const listener = (event: KeyboardEvent) => {
      handleOverlayShortcut(event);
    };

    window.addEventListener("keydown", listener);
    return () => {
        window.removeEventListener("keydown", listener);
      };
  }, [globalShortcutReady, handleOverlayShortcut]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return undefined;
    }

    let cancelled = false;

    async function registerGlobalShortcut() {
      try {
        const { isRegistered, register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
        if (await isRegistered(pluginShortcut)) {
          await unregister(pluginShortcut);
        }
        await register(pluginShortcut, (event) => {
          if (event.state !== "Pressed" || !activeSessionRef.current) {
            return;
          }
          void syncOverlayWindow(!overlayOpenRef.current);
        });
        if (!cancelled) {
          setGlobalShortcutReady(true);
        }
      } catch {
        if (!cancelled) {
          setGlobalShortcutReady(false);
        }
      }
    }

    void registerGlobalShortcut();

    return () => {
      cancelled = true;
      setGlobalShortcutReady(false);
      void import("@tauri-apps/plugin-global-shortcut")
        .then(({ unregister }) => unregister(pluginShortcut))
        .catch(() => undefined);
    };
  }, [pluginShortcut, syncOverlayWindow]);

  async function handleSeedTranscript(sessionIdOverride?: string) {
    const sessionId = sessionIdOverride ?? activeSessionRef.current?.session.id;
    if (!sessionId) {
      return;
    }

    const demoLines = [
      ["PM", "We should ship the new engineering metrics panel behind a staff-only flag first."],
      ["Backend", "I can own the aggregation endpoint and add caching so the dashboard stays under 400 milliseconds."],
      ["Frontend", "We also need a polished empty state and a loading skeleton for the analytics cards."],
      ["QA", "Please give me seeded accounts and acceptance criteria for chart edge cases before Friday."],
      ["EM", "Let's also fix the flaky auth refresh bug before rollout because support is still seeing timeout complaints."],
    ] as const;

    for (const [speakerLabel, text] of demoLines) {
      await appendAndApplyTranscript(sessionId, speakerLabel, text, "demo");
      await new Promise((resolve) => {
        window.setTimeout(resolve, 250);
      });
    }
  }

  async function startLiveCaptureForSession(sessionDetail: SessionDetail) {
    if (selectedCaptureMode === "demo_stream") {
      await handleSeedTranscript(sessionDetail.session.id);
      return;
    }

    if (selectedCaptureMode !== "microphone") {
      setError("Set capture mode to microphone to start Deepgram live transcription.");
      return;
    }

    const apiKey = await getSecretValue("deepgram_api_key");
    if (!apiKey) {
      setError("Add a Deepgram API key from Onboarding to enable live transcription.");
      return;
    }

    setError(null);
    await startCapture({
      apiKey,
      language: audioLanguage,
      mode: "microphone",
      speakerLabel: "Meeting",
    });
  }

  async function handleStartSession(title: string) {
    try {
      const detail = await startSession({ title });
      applySessionDetail(detail);
      setView("session");
      if (sessionWidgetEnabled) {
        await syncOverlayWindow(true);
      }
      if (bootstrap?.secrets.deepgramConfigured && selectedCaptureMode === "microphone") {
        await startLiveCaptureForSession(detail);
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to start session.";
      setError(message);
    }
  }

  async function handlePauseSession(sessionId: string) {
    if (isCapturing) {
      await stopCapture();
    }
    const detail = await pauseSession(sessionId);
    applySessionDetail(detail);
  }

  async function handleResumeSession(sessionId: string) {
    const detail = await resumeSession(sessionId);
    applySessionDetail(detail);
    if (detail && bootstrap?.secrets.deepgramConfigured && selectedCaptureMode === "microphone") {
      await startLiveCaptureForSession(detail);
    }
  }

  async function handleCompleteSession(sessionId: string) {
    if (isCapturing) {
      await stopCapture();
    }
    if (overlayOpenRef.current) {
      await syncOverlayWindow(false);
    }
    const detail = await completeSession(sessionId);
    applySessionDetail(detail);
    setView("dashboard");
  }

  async function handleAppendTranscript(speakerLabel: string, text: string) {
    if (!activeSessionRef.current) {
      return;
    }

    await appendAndApplyTranscript(activeSessionRef.current.session.id, speakerLabel, text, "manual");
  }

  async function handleDynamicAction(action: DynamicActionKey) {
    if (!activeSessionRef.current) {
      return;
    }

    const detail = await runDynamicAction(activeSessionRef.current.session.id, action);
    applySessionDetail(detail);
  }

  async function handleAsk(prompt: string) {
    if (!activeSessionRef.current) {
      return;
    }

    const detail = await askAssistant({
      sessionId: activeSessionRef.current.session.id,
      prompt,
    });
    applySessionDetail(detail);
  }

  async function handleSelectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setSelectedSessionDetail(await getSessionDetail(sessionId));
  }

  async function handleStartLiveCapture() {
    if (!activeSessionRef.current) {
      return;
    }

    await startLiveCaptureForSession(activeSessionRef.current);
  }

  async function handleStopLiveCapture() {
    await stopCapture();
  }

  function handleExportSession(sessionDetail: SessionDetail) {
    const markdown = buildSessionMarkdown(sessionDetail);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sessionDetail.session.title.toLowerCase().replace(/\s+/g, "-") || "session"}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (activeSessionDetail || !overlayOpen) {
      return;
    }

    void syncOverlayWindow(false);
  }, [activeSessionDetail, overlayOpen, syncOverlayWindow]);

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading-state">
          <span className="eyebrow">Cluely Desktop</span>
          <h1>Bootstrapping the foundation layer.</h1>
          <p>Loading permissions, settings, diagnostics, and provider state.</p>
        </div>
      </main>
    );
  }

  if (!bootstrap) {
    return (
      <main className="app-shell">
        <div className="error-state">
          <h1>Application shell unavailable</h1>
          <p>{error ?? "Unknown bootstrap failure."}</p>
          <button type="button" onClick={() => void hydrateWorkspace()}>
            Retry bootstrap
          </button>
        </div>
      </main>
    );
  }

  if (overlayOpen) {
    return (
      <main className="app-shell app-shell-overlay">
        {error ? (
          <div className="inline-alert">
            <strong>Last error</strong>
            <p>{error}</p>
          </div>
        ) : null}
        <SessionWidget
          activeSession={activeSessionDetail}
          captureError={captureError ?? error}
          captureMode={selectedCaptureMode}
          captureState={captureState}
          isCapturing={isCapturing}
          overlayOpen={overlayOpen}
          overlayShortcut={overlayShortcut}
          partialTranscript={partialTranscript}
          onStartSession={handleStartSession}
          onPauseSession={handlePauseSession}
          onResumeSession={handleResumeSession}
          onCompleteSession={handleCompleteSession}
          onAppendTranscript={handleAppendTranscript}
          onDynamicAction={handleDynamicAction}
          onAsk={handleAsk}
          onSetCaptureMode={setSelectedCaptureMode}
          onStartLiveCapture={handleStartLiveCapture}
          onStopLiveCapture={handleStopLiveCapture}
          onToggleOverlay={() => syncOverlayWindow(!overlayOpenRef.current)}
          onSeedTranscript={() => handleSeedTranscript()}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero-strip">
        <div>
          <p className="eyebrow">Cluely Desktop Foundation</p>
          <h1>Session-first meeting intelligence, grounded in local state and explicit system contracts.</h1>
        </div>
        <div className="hero-meta">
          <span>Version {bootstrap.appVersion}</span>
          <span>{bootstrap.diagnostics.mode === "desktop" ? "Desktop runtime" : "Browser-safe mock runtime"}</span>
        </div>
      </section>

      <section className="workspace-shell">
        <aside className="side-nav">
          <div className="side-nav-header">
            <p className="eyebrow">Control Surface</p>
            <h2>{bootstrap.appName}</h2>
          </div>
          <nav>
            {viewMeta.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`nav-pill ${view === item.key ? "nav-pill-active" : ""}`}
                onClick={() => setView(item.key)}
              >
                <strong>{item.label}</strong>
                <span>{item.caption}</span>
              </button>
            ))}
          </nav>
          <article className="side-status">
            <p className="card-title">Foundation Check</p>
            <div className="readiness-row">
              <span>Database</span>
              <strong>{bootstrap.diagnostics.databaseReady ? "Ready" : "Pending"}</strong>
            </div>
            <div className="readiness-row">
              <span>Keychain</span>
              <strong>{bootstrap.diagnostics.keychainAvailable ? "Ready" : "Mock / Pending"}</strong>
            </div>
            <div className="readiness-row">
              <span>State Machine</span>
              <strong>{bootstrap.diagnostics.stateMachineReady ? "Ready" : "Pending"}</strong>
            </div>
          </article>
        </aside>

        <section className="content-stage">
          {error ? (
            <div className="inline-alert">
              <strong>Last error</strong>
              <p>{error}</p>
            </div>
          ) : null}

          {view === "overview" ? (
            <section className="panel">
              <div className="overview-grid">
                <article className="card feature-card">
                  <p className="card-title">Execution Focus</p>
                  <h2>Live meeting demo path</h2>
                  <p className="card-detail">
                    Start a meeting, capture transcript signal, answer questions with Ask Cluely, and end into
                    automatically generated Linear tickets.
                  </p>
                </article>
                <article className="card feature-card accent-card">
                  <p className="card-title">Demo Critical Path</p>
                  <h2>Transcript to answer to ticket workflow</h2>
                  <p className="card-detail">
                    The shell now focuses on the exact product loop needed for a real engineering-meeting demo instead
                    of extra pre- and post-meeting surfaces.
                  </p>
                </article>
                <article className="card feature-card">
                  <p className="card-title">Session Inventory</p>
                  <h2>{sessions.length}</h2>
                  <p className="card-detail">
                    {activeSessionDetail
                      ? `Active session: ${activeSessionDetail.session.title}`
                      : "No active session yet. Start one from the Session tab."}
                  </p>
                </article>
              </div>
            </section>
          ) : null}

          {view === "onboarding" ? (
            <OnboardingApp
              bootstrap={bootstrap}
              secretDrafts={secretDrafts}
              onSecretDraftChange={(key, value) => {
                setSecretDrafts((current) => ({ ...current, [key]: value }));
              }}
              onSaveSecret={handleSaveSecret}
              savingSecretKey={savingSecretKey}
            />
          ) : null}

          {view === "session" ? (
            <SessionWidget
              activeSession={activeSessionDetail}
              captureError={captureError ?? error}
              captureMode={selectedCaptureMode}
              captureState={captureState}
              isCapturing={isCapturing}
              overlayOpen={overlayOpen}
              overlayShortcut={overlayShortcut}
              partialTranscript={partialTranscript}
              onStartSession={handleStartSession}
              onPauseSession={handlePauseSession}
              onResumeSession={handleResumeSession}
              onCompleteSession={handleCompleteSession}
              onAppendTranscript={handleAppendTranscript}
              onDynamicAction={handleDynamicAction}
              onAsk={handleAsk}
              onSetCaptureMode={setSelectedCaptureMode}
              onStartLiveCapture={handleStartLiveCapture}
              onStopLiveCapture={handleStopLiveCapture}
              onToggleOverlay={() => syncOverlayWindow(!overlayOpenRef.current)}
              onSeedTranscript={() => handleSeedTranscript()}
            />
          ) : null}

          {view === "dashboard" ? (
            <DashboardApp
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              sessionDetail={selectedSessionDetail}
              onSelectSession={handleSelectSession}
              onExportSession={handleExportSession}
            />
          ) : null}

          {view === "settings" ? <Settings bootstrap={bootstrap} onUpdateSetting={handleUpdateSetting} /> : null}
        </section>
      </section>
    </main>
  );
}
