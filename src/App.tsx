import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  appendTranscriptSegment,
  askAssistant,
  bootstrapApp,
  completeSession,
  deleteKnowledgeFile,
  deletePrompt,
  exportSessionMarkdown,
  getSecretValue,
  getSessionDetail,
  generateSessionTickets,
  listSessions,
  pauseSession,
  pushGeneratedTicket,
  pushGeneratedTickets,
  resumeSession,
  runDynamicAction,
  runPreflightChecks,
  saveKnowledgeFile,
  savePrompt,
  saveSecret,
  saveSetting,
  searchSessions,
  setGeneratedTicketReviewState,
  setOverlayOpen as persistOverlayOpen,
  startSession,
  updateGeneratedTicketDraft,
} from "./lib/tauri";
import { DashboardApp } from "./dashboard/DashboardApp";
import { OnboardingApp } from "./onboarding/OnboardingApp";
import { Settings } from "./dashboard/Settings";
import { SessionWidget } from "./session/SessionWidget";
import { getBlockingChecksForMode, getPreflightModeCanStart, getPreflightModeSummary } from "./lib/preflight";
import { matchesShortcut, normalizeGlobalShortcut } from "./lib/shortcuts";
import type {
  BootstrapPayload,
  CaptureMode,
  CaptureSegmentEventPayload,
  DynamicActionKey,
  KnowledgeFileRecord,
  PreflightReport,
  PromptRecord,
  SaveKnowledgeFileInput,
  SavePromptInput,
  SecretKey,
  SessionDetail,
  SessionRecord,
  SearchSessionResult,
  ScreenContextInput,
  SettingRecord,
  SystemAudioSource,
  TicketType,
} from "./lib/types";
import { useLiveTranscription } from "./session/useLiveTranscription";

type ViewKey = "overview" | "onboarding" | "session" | "dashboard" | "settings";

const viewMeta: Array<{ key: ViewKey; label: string; caption: string }> = [
  { key: "overview", label: "Overview", caption: "Desktop readiness" },
  { key: "onboarding", label: "Onboarding", caption: "Permissions + providers" },
  { key: "session", label: "Session", caption: "Live meeting flow" },
  { key: "dashboard", label: "Dashboard", caption: "Review + exports" },
  { key: "settings", label: "Settings", caption: "Capture defaults" },
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

type AssistantRequest =
  | { action: DynamicActionKey; kind: "action" }
  | { kind: "ask"; prompt: string };

function getSettingValue(settings: SettingRecord[], key: string, fallback: string): string {
  return settings.find((setting) => setting.key === key)?.value ?? fallback;
}

function isSessionLive(status: SessionRecord["status"]): boolean {
  return ["active", "paused", "preparing", "finishing"].includes(status);
}

function describePermissionStatus(status: BootstrapPayload["permissions"]["screenRecording"]): string {
  if (status === "granted") {
    return "Ready";
  }
  if (status === "denied") {
    return "Blocked";
  }
  if (status === "restricted") {
    return "Restricted";
  }
  return "Pending";
}

function createOverlaySessionTitle(): string {
  const stamp = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  return `Live meeting - ${stamp}`;
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
  const [searchResults, setSearchResults] = useState<SearchSessionResult[] | null>(null);
  const [highlightedSequenceNo, setHighlightedSequenceNo] = useState<number | null>(null);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFileRecord[]>([]);
  const [selectedCaptureMode, setSelectedCaptureMode] = useState<CaptureMode>("manual");
  const [secretDrafts, setSecretDrafts] = useState(initialSecrets);
  const [savingSecretKey, setSavingSecretKey] = useState<SecretKey | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantInFlightAction, setAssistantInFlightAction] = useState<DynamicActionKey | null>(null);
  const [askInFlight, setAskInFlight] = useState(false);
  const [lastAssistantRequest, setLastAssistantRequest] = useState<AssistantRequest | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightReport, setPreflightReport] = useState<PreflightReport | null>(null);
  const [systemAudioPickerError, setSystemAudioPickerError] = useState<string | null>(null);
  const [systemAudioPickerLoading, setSystemAudioPickerLoading] = useState(false);
  const [systemAudioPickerOpen, setSystemAudioPickerOpen] = useState(false);
  const [systemAudioPickerSessionId, setSystemAudioPickerSessionId] = useState<string | null>(null);
  const [systemAudioSources, setSystemAudioSources] = useState<SystemAudioSource[]>([]);

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

  function mergeCaptureSegment(detail: SessionDetail | null, payload: CaptureSegmentEventPayload): SessionDetail | null {
    if (!detail || detail.session.id !== payload.session.id) {
      return detail;
    }

    const transcripts = [...detail.transcripts.filter((segment) => segment.id !== payload.segment.id), payload.segment].sort(
      (left, right) => left.sequenceNo - right.sequenceNo
    );

    return {
      ...detail,
      session: payload.session,
      transcripts,
    };
  }

  function applyNativeCaptureSegment(payload: CaptureSegmentEventPayload) {
    setSessions((current) =>
      [payload.session, ...current.filter((session) => session.id !== payload.session.id)].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      )
    );
    setActiveSessionDetail((current) => mergeCaptureSegment(current, payload));
    setSelectedSessionDetail((current) => mergeCaptureSegment(current, payload));
  }

  const {
    audioInputDevices,
    captureError,
    captureHealth,
    captureSourceLabel,
    captureState,
    lastTranscriptFinalizedAt,
    isCapturing,
    listAvailableSystemAudioSources,
    microphoneSelectionWarning,
    partialTranscript,
    screenShareError,
    screenShareOwnedByCapture,
    screenShareState,
    selectedMicrophoneDeviceId,
    setSelectedMicrophoneDeviceId,
    startCapture,
    startScreenShare,
    stopCapture,
    stopScreenShare,
    captureScreenContext,
    transcriptFreshnessLabel,
  } = useLiveTranscription({
    onMicrophoneFinalTranscript: async (segment) => {
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
    onNativeCaptureSegment: applyNativeCaptureSegment,
    preferredMicrophoneDeviceId: bootstrap ? getSettingValue(bootstrap.settings, "preferred_microphone_device_id", "") : "",
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

  async function refreshPreflight(surfaceError = false) {
    try {
      setPreflightLoading(true);
      const report = await runPreflightChecks();
      setPreflightReport(report);
      return report;
    } catch (unknownError) {
      if (surfaceError) {
        const message = unknownError instanceof Error ? unknownError.message : "Failed to run the desktop preflight.";
        setError(message);
      }
      return null;
    } finally {
      setPreflightLoading(false);
    }
  }

  async function hydrateWorkspace(preferredSessionId?: string | null) {
    try {
      setLoading(true);
      setError(null);
      const [payload, sessionList, preflight] = await Promise.all([
        bootstrapApp(),
        listSessions(),
        runPreflightChecks().catch(() => null),
      ]);
      setBootstrap(payload);
      setPreflightReport(preflight);
      setSessions(sessionList);
      setPrompts(payload.prompts);
      setKnowledgeFiles(payload.knowledgeFiles);
      setOverlayOpen(payload.runtime.window.overlayOpen);

      const runtimeActiveSessionId = payload.runtime.session.activeSessionId;
      const activeSession =
        (runtimeActiveSessionId ? sessionList.find((session) => session.id === runtimeActiveSessionId) : null) ??
        sessionList.find((session) => isSessionLive(session.status));
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
    source: "manual" | "capture" = "manual"
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
      const settings = await saveSetting({ key, value });
      setBootstrap((current) => (current ? { ...current, settings } : current));
      if (key === "screen_context_enabled" && value !== "true" && screenShareState === "active") {
        await stopScreenShare();
      }
      await refreshPreflight();
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
  const screenContextEnabled = bootstrap
    ? getSettingValue(bootstrap.settings, "screen_context_enabled", "true") === "true"
    : true;
  const selectedModeCanStart =
    preflightReport != null
      ? getPreflightModeCanStart(preflightReport, selectedCaptureMode)
      : selectedCaptureMode === "manual"
        ? Boolean(bootstrap?.diagnostics.databaseReady)
        : false;
  const selectedModePreflightSummary = getPreflightModeSummary(preflightReport, selectedCaptureMode);
  const selectedModeBlockingChecks = getBlockingChecksForMode(preflightReport, selectedCaptureMode);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    if (bootstrap.secrets.deepgramConfigured && selectedCaptureMode === "manual") {
      setSelectedCaptureMode("microphone");
      return;
    }

    if (
      !bootstrap.secrets.deepgramConfigured &&
      (selectedCaptureMode === "microphone" || selectedCaptureMode === "system_audio")
    ) {
      setSelectedCaptureMode("manual");
    }
  }, [bootstrap, selectedCaptureMode]);

  const updateOverlayWindowLayout = useEffectEvent(async () => {
    if (!("__TAURI_INTERNALS__" in window) || !overlayOpenRef.current) {
      return;
    }

    try {
      const [{ LogicalPosition, LogicalSize }, { currentMonitor, getCurrentWindow }] = await Promise.all([
        import("@tauri-apps/api/dpi"),
        import("@tauri-apps/api/window"),
      ]);

      const appWindow = getCurrentWindow();
      const monitor = await currentMonitor();
      const width = activeSessionRef.current ? 468 : 430;
      const height = activeSessionRef.current ? 780 : 440;

      await appWindow.setSize(new LogicalSize(width, height));
      if (monitor) {
        const x = monitor.workArea.position.x + monitor.workArea.size.width - width - 28;
        const y = monitor.workArea.position.y + 28;
        await appWindow.setPosition(new LogicalPosition(x, y));
      }
    } catch {
      return;
    }
  });

  const syncOverlayWindow = useEffectEvent(async (nextOpen: boolean) => {
    setOverlayOpen(nextOpen);
    setView("session");
    await persistOverlayOpen(nextOpen).catch(() => undefined);

    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    try {
      const [{ LogicalPosition, LogicalSize }, { getCurrentWindow }] = await Promise.all([
        import("@tauri-apps/api/dpi"),
        import("@tauri-apps/api/window"),
      ]);

      const appWindow = getCurrentWindow();
      if (nextOpen) {
        const [outerSize, outerPosition] = await Promise.all([appWindow.outerSize(), appWindow.outerPosition()]);

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
        overlayOpenRef.current = true;
        await updateOverlayWindowLayout();
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
          if (event.state !== "Pressed") {
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

  useEffect(() => {
    if (!overlayOpen) {
      return;
    }

    void updateOverlayWindowLayout();
  }, [activeSessionDetail, overlayOpen, updateOverlayWindowLayout]);

  function closeSystemAudioPicker() {
    setSystemAudioPickerError(null);
    setSystemAudioPickerLoading(false);
    setSystemAudioPickerOpen(false);
    setSystemAudioPickerSessionId(null);
    setSystemAudioSources([]);
  }

  async function openSystemAudioPicker(sessionId: string) {
    setSystemAudioPickerSessionId(sessionId);
    setSystemAudioPickerError(null);
    setSystemAudioPickerLoading(true);
    setSystemAudioPickerOpen(true);
    setSystemAudioSources([]);

    try {
      const payload = await listAvailableSystemAudioSources();
      setSystemAudioSources(payload.sources);

      if (payload.permissionStatus !== "granted") {
        setSystemAudioPickerError(
          payload.message ?? "Screen Recording permission is required before TPMCluely can capture system audio."
        );
      }
    } catch (unknownError) {
      const message =
        unknownError instanceof Error ? unknownError.message : "Shareable system audio sources could not be loaded.";
      setSystemAudioPickerError(message);
      setError(message);
    } finally {
      setSystemAudioPickerLoading(false);
    }
  }

  async function handleSelectSystemAudioSource(source: SystemAudioSource) {
    if (!systemAudioPickerSessionId) {
      setSystemAudioPickerError("Start or resume a meeting before selecting a system audio source.");
      return;
    }

    try {
      setError(null);
      setSystemAudioPickerError(null);
      setSystemAudioPickerLoading(true);
      await startCapture({
        language: audioLanguage,
        mode: "system_audio",
        sessionId: systemAudioPickerSessionId,
        source,
      });
      closeSystemAudioPicker();
    } catch (unknownError) {
      const message =
        unknownError instanceof Error ? unknownError.message : "Native system audio capture could not start.";
      setSystemAudioPickerError(message);
      setError(message);
    } finally {
      setSystemAudioPickerLoading(false);
    }
  }

  async function handleSelectMicrophoneDevice(deviceId: string) {
    setSelectedMicrophoneDeviceId(deviceId);
    try {
      const settings = await saveSetting({ key: "preferred_microphone_device_id", value: deviceId });
      setBootstrap((current) => (current ? { ...current, settings } : current));
      await refreshPreflight();
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to save the preferred microphone.";
      setError(message);
    }
  }

  async function ensureSelectedModeReady(mode: CaptureMode) {
    const report = await refreshPreflight(true);
    if (!report) {
      return false;
    }

    const canStart = getPreflightModeCanStart(report, mode);
    if (canStart) {
      return true;
    }

    const blockingChecks = getBlockingChecksForMode(report, mode);
    const message =
      blockingChecks.length > 0
        ? blockingChecks.map((check) => `${check.title}: ${check.message}`).join(" ")
        : getPreflightModeSummary(report, mode);
    setError(message);
    return false;
  }

  async function startLiveCaptureForSession(sessionId?: string) {
    const targetSessionId = sessionId ?? activeSessionRef.current?.session.id;
    if (!targetSessionId) {
      setError("Start a meeting before enabling live transcription.");
      return;
    }

    if (selectedCaptureMode !== "microphone" && selectedCaptureMode !== "system_audio") {
      setError("Set capture mode to microphone or system audio to start Deepgram live transcription.");
      return;
    }

    const ready = await ensureSelectedModeReady(selectedCaptureMode);
    if (!ready) {
      return;
    }

    if (selectedCaptureMode === "system_audio") {
      if (!bootstrap?.captureCapabilities.nativeSystemAudio) {
        setError("System audio capture is available only in the native macOS desktop runtime.");
        return;
      }

      await openSystemAudioPicker(targetSessionId);
      return;
    }

    closeSystemAudioPicker();

    const apiKey = await getSecretValue("deepgram_api_key");
    if (!apiKey) {
      setError("Add a Deepgram API key from Onboarding to enable live transcription.");
      return;
    }

    setError(null);
    await startCapture({
      apiKey,
      deviceId: selectedMicrophoneDeviceId || undefined,
      language: audioLanguage,
      mode: "microphone",
      speakerLabel: "Meeting",
      sessionId: targetSessionId,
    });
  }

  async function createSessionRecord(title: string) {
    const detail = await startSession({ title });
    applySessionDetail(detail);
    setView("session");
    return detail;
  }

  async function handleStartSession(title: string) {
    try {
      setAssistantError(null);
      const detail = await createSessionRecord(title);
      if (sessionWidgetEnabled) {
        await syncOverlayWindow(true);
      }
      if (
        bootstrap?.secrets.deepgramConfigured &&
        (selectedCaptureMode === "microphone" || selectedCaptureMode === "system_audio")
      ) {
        await startLiveCaptureForSession(detail.session.id);
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to start session.";
      setError(message);
    }
  }

  async function handleStartListening() {
    try {
      setError(null);
      setAssistantError(null);
      if (selectedCaptureMode === "manual") {
        const ready = await ensureSelectedModeReady("manual");
        if (!ready) {
          return;
        }
      }
      let detail = activeSessionRef.current;
      if (!activeSessionRef.current) {
        detail = await createSessionRecord(createOverlaySessionTitle());
      }

      if (!overlayOpenRef.current) {
        await syncOverlayWindow(true);
      }

      if (selectedCaptureMode === "manual") {
        return;
      }

      await startLiveCaptureForSession(detail?.session.id);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to start listening.";
      setError(message);
    }
  }

  async function handlePauseSession(sessionId: string) {
    if (isCapturing) {
      await stopCapture(sessionId);
    }
    closeSystemAudioPicker();
    const detail = await pauseSession(sessionId);
    applySessionDetail(detail);
  }

  async function handleResumeSession(sessionId: string) {
    const detail = await resumeSession(sessionId);
    applySessionDetail(detail);
    if (
      detail &&
      bootstrap?.secrets.deepgramConfigured &&
      (selectedCaptureMode === "microphone" || selectedCaptureMode === "system_audio")
    ) {
      await startLiveCaptureForSession(detail.session.id);
    }
  }

  async function handleCompleteSession(sessionId: string) {
    if (isCapturing) {
      await stopCapture(sessionId);
    }
    closeSystemAudioPicker();
    if (screenShareState === "active" || screenShareState === "error") {
      await stopScreenShare();
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
    if (!activeSessionRef.current || askInFlight || assistantInFlightAction) {
      return;
    }

    try {
      setAssistantError(null);
      setAssistantInFlightAction(action);
      const screenContext =
        action === "follow_up" && screenContextEnabled ? await captureScreenContextSafely() : null;
      const detail = await runDynamicAction({
        sessionId: activeSessionRef.current.session.id,
        action,
        screenContext,
      });
      setLastAssistantRequest({ kind: "action", action });
      applySessionDetail(detail);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Assistant action failed.";
      setAssistantError(message);
      setError(message);
    } finally {
      setAssistantInFlightAction(null);
    }
  }

  async function handleAsk(prompt: string) {
    if (!activeSessionRef.current || askInFlight || assistantInFlightAction) {
      return;
    }

    try {
      setAssistantError(null);
      setAskInFlight(true);
      const detail = await askAssistant({
        sessionId: activeSessionRef.current.session.id,
        prompt,
        screenContext: screenContextEnabled ? await captureScreenContextSafely() : null,
      });
      setLastAssistantRequest({ kind: "ask", prompt });
      applySessionDetail(detail);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Ask TPMCluely failed.";
      setAssistantError(message);
      setError(message);
    } finally {
      setAskInFlight(false);
    }
  }

  async function handleRetryAssistantRequest() {
    if (!lastAssistantRequest) {
      return;
    }

    if (lastAssistantRequest.kind === "ask") {
      await handleAsk(lastAssistantRequest.prompt);
      return;
    }

    await handleDynamicAction(lastAssistantRequest.action);
  }

  async function handleSelectSession(sessionId: string, transcriptSequenceNo?: number | null) {
    setSelectedSessionId(sessionId);
    setHighlightedSequenceNo(transcriptSequenceNo ?? null);
    setSelectedSessionDetail(await getSessionDetail(sessionId));
  }

  async function handleGenerateTickets(sessionId: string) {
    const detail = await generateSessionTickets(sessionId);
    applySessionDetail(detail);
  }

  async function handlePushGeneratedTicket(sessionId: string, idempotencyKey: string) {
    const detail = await pushGeneratedTicket({ sessionId, idempotencyKey });
    applySessionDetail(detail);
  }

  async function handlePushGeneratedTickets(sessionId: string) {
    const detail = await pushGeneratedTickets(sessionId);
    applySessionDetail(detail);
  }

  async function handleUpdateGeneratedTicketDraft(
    sessionId: string,
    idempotencyKey: string,
    draft: { acceptanceCriteria: string[]; description: string; title: string; type: TicketType }
  ) {
    const detail = await updateGeneratedTicketDraft({
      sessionId,
      idempotencyKey,
      title: draft.title,
      description: draft.description,
      acceptanceCriteria: draft.acceptanceCriteria,
      type: draft.type,
    });
    applySessionDetail(detail);
  }

  async function handleSetGeneratedTicketReviewState(
    sessionId: string,
    idempotencyKey: string,
    reviewState: "draft" | "approved" | "rejected",
    rejectionReason?: string | null
  ) {
    const detail = await setGeneratedTicketReviewState({
      sessionId,
      idempotencyKey,
      reviewState,
      rejectionReason,
    });
    applySessionDetail(detail);
  }

  async function handleStartLiveCapture() {
    if (!activeSessionRef.current) {
      return;
    }

    await startLiveCaptureForSession(activeSessionRef.current.session.id);
  }

  async function handleStopLiveCapture() {
    closeSystemAudioPicker();
    await stopCapture(activeSessionRef.current?.session.id);
  }

  async function captureScreenContextSafely(): Promise<ScreenContextInput | null> {
    if (!screenContextEnabled || screenShareState !== "active") {
      return null;
    }

    try {
      return await captureScreenContext();
    } catch {
      return null;
    }
  }

  const handleSearchSessions = useEffectEvent(async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    setSearchResults(await searchSessions(query));
  });

  async function handleSavePrompt(input: SavePromptInput) {
    try {
      setPrompts(await savePrompt(input));
      const payload = await bootstrapApp();
      setBootstrap(payload);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to save prompt.";
      setError(message);
    }
  }

  async function handleDeletePrompt(promptId: string) {
    try {
      setPrompts(await deletePrompt(promptId));
      const payload = await bootstrapApp();
      setBootstrap(payload);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to delete prompt.";
      setError(message);
    }
  }

  async function handleSaveKnowledgeFile(input: SaveKnowledgeFileInput) {
    try {
      setKnowledgeFiles(await saveKnowledgeFile(input));
      const payload = await bootstrapApp();
      setBootstrap(payload);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to save knowledge file.";
      setError(message);
    }
  }

  async function handleDeleteKnowledgeFile(knowledgeFileId: string) {
    try {
      setKnowledgeFiles(await deleteKnowledgeFile(knowledgeFileId));
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Failed to delete knowledge file.";
      setError(message);
    }
  }

  async function handleExportSession(sessionDetail: SessionDetail) {
    const exported = await exportSessionMarkdown(sessionDetail.session.id);
    if (!exported) {
      setError("The session export could not be created.");
      return;
    }

    const blob = new Blob([exported.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exported.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading-state">
          <span className="eyebrow">TPMCluely</span>
          <h1>Preparing the desktop meeting copilot.</h1>
          <p>Loading the local runtime, provider state, and session history.</p>
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
          assistantError={assistantError}
          assistantInFlightAction={assistantInFlightAction}
          askInFlight={askInFlight}
          audioInputDevices={audioInputDevices}
          canStartSelectedMode={selectedModeCanStart}
          captureError={captureError ?? error}
          captureHealth={captureHealth}
          captureMode={selectedCaptureMode}
          captureSourceLabel={captureSourceLabel}
          captureState={captureState}
          deepgramReady={bootstrap.secrets.deepgramConfigured}
          geminiReady={bootstrap.secrets.geminiConfigured}
          isCapturing={isCapturing}
          lastTranscriptFinalizedAt={lastTranscriptFinalizedAt}
          linearReady={bootstrap.secrets.linearConfigured}
          microphoneSelectionWarning={microphoneSelectionWarning}
          overlayOpen={overlayOpen}
          overlayShortcut={overlayShortcut}
          partialTranscript={partialTranscript}
          preflightBlockingChecks={selectedModeBlockingChecks}
          preflightCheckedAt={preflightReport?.checkedAt ?? null}
          preflightLoading={preflightLoading}
          preflightSummary={selectedModePreflightSummary}
          screenContextEnabled={screenContextEnabled}
          screenShareError={screenShareError}
          screenShareOwnedByCapture={screenShareOwnedByCapture}
          screenShareState={screenShareState}
          selectedMicrophoneDeviceId={selectedMicrophoneDeviceId}
          systemAudioPickerError={systemAudioPickerError}
          systemAudioPickerLoading={systemAudioPickerLoading}
          systemAudioPickerOpen={systemAudioPickerOpen}
          systemAudioSources={systemAudioSources}
          transcriptFreshnessLabel={transcriptFreshnessLabel}
          onStartSession={handleStartSession}
          onPauseSession={handlePauseSession}
          onRefreshPreflight={() => refreshPreflight(true).then(() => undefined)}
          onRetryAssistantRequest={handleRetryAssistantRequest}
          onResumeSession={handleResumeSession}
          onCompleteSession={handleCompleteSession}
          onAppendTranscript={handleAppendTranscript}
          onDynamicAction={handleDynamicAction}
          onAsk={handleAsk}
          onSelectMicrophoneDevice={handleSelectMicrophoneDevice}
          onSetCaptureMode={setSelectedCaptureMode}
          onSelectSystemAudioSource={handleSelectSystemAudioSource}
          onStartLiveCapture={handleStartLiveCapture}
          onStartListening={handleStartListening}
          onStartScreenShare={startScreenShare}
          onStopLiveCapture={handleStopLiveCapture}
          onStopScreenShare={stopScreenShare}
          onSystemAudioPickerClose={closeSystemAudioPicker}
          onToggleOverlay={() => syncOverlayWindow(!overlayOpenRef.current)}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero-strip">
        <div>
          <p className="eyebrow">TPMCluely Desktop</p>
          <h1>Meeting intelligence for real engineering sessions, grounded in the transcript and safe to review.</h1>
        </div>
        <div className="hero-meta">
          <span>Version {bootstrap.appVersion}</span>
          <span>{bootstrap.diagnostics.mode === "desktop" ? "Desktop runtime" : "Development runtime"}</span>
          <span>{bootstrap.diagnostics.captureBackend}</span>
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
            <p className="card-title">Desktop Readiness</p>
            <div className="readiness-row">
              <span>Database</span>
              <strong>{bootstrap.diagnostics.databaseReady ? "Ready" : "Pending"}</strong>
            </div>
            <div className="readiness-row">
              <span>Keychain</span>
              <strong>{bootstrap.diagnostics.keychainAvailable ? "Ready" : "Unavailable"}</strong>
            </div>
            <div className="readiness-row">
              <span>State Machine</span>
              <strong>{bootstrap.diagnostics.stateMachineReady ? "Ready" : "Pending"}</strong>
            </div>
            <div className="readiness-row">
              <span>Search / Export</span>
              <strong>
                {bootstrap.diagnostics.searchReady && bootstrap.diagnostics.exportReady ? "Ready" : "Pending"}
              </strong>
            </div>
            <div className="readiness-row">
              <span>Screen Recording</span>
              <strong>{describePermissionStatus(bootstrap.permissions.screenRecording)}</strong>
            </div>
            <div className="readiness-row">
              <span>Native System Audio</span>
              <strong>{bootstrap.captureCapabilities.nativeSystemAudio ? "Available" : "Desktop only"}</strong>
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
                  <p className="card-title">Meeting Flow</p>
                  <h2>Capture, answer, review</h2>
                  <p className="card-detail">
                    Start a meeting, answer live questions from the transcript, then end with review-first draft tickets.
                  </p>
                </article>
                <article className="card feature-card accent-card">
                  <p className="card-title">Trust Model</p>
                  <h2>Transcript first, Linear second</h2>
                  <p className="card-detail">
                    Gemini answers are labeled, transcript fallback is explicit, and nothing is pushed before approval.
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
              assistantError={assistantError}
              assistantInFlightAction={assistantInFlightAction}
              askInFlight={askInFlight}
              audioInputDevices={audioInputDevices}
              canStartSelectedMode={selectedModeCanStart}
              captureError={captureError ?? error}
              captureHealth={captureHealth}
              captureMode={selectedCaptureMode}
              captureSourceLabel={captureSourceLabel}
              captureState={captureState}
              deepgramReady={bootstrap.secrets.deepgramConfigured}
              geminiReady={bootstrap.secrets.geminiConfigured}
              isCapturing={isCapturing}
              lastTranscriptFinalizedAt={lastTranscriptFinalizedAt}
              linearReady={bootstrap.secrets.linearConfigured}
              microphoneSelectionWarning={microphoneSelectionWarning}
              overlayOpen={overlayOpen}
              overlayShortcut={overlayShortcut}
              partialTranscript={partialTranscript}
              preflightBlockingChecks={selectedModeBlockingChecks}
              preflightCheckedAt={preflightReport?.checkedAt ?? null}
              preflightLoading={preflightLoading}
              preflightSummary={selectedModePreflightSummary}
              screenContextEnabled={screenContextEnabled}
              screenShareError={screenShareError}
              screenShareOwnedByCapture={screenShareOwnedByCapture}
              screenShareState={screenShareState}
              selectedMicrophoneDeviceId={selectedMicrophoneDeviceId}
              systemAudioPickerError={systemAudioPickerError}
              systemAudioPickerLoading={systemAudioPickerLoading}
              systemAudioPickerOpen={systemAudioPickerOpen}
              systemAudioSources={systemAudioSources}
              transcriptFreshnessLabel={transcriptFreshnessLabel}
              onStartSession={handleStartSession}
              onPauseSession={handlePauseSession}
              onRefreshPreflight={() => refreshPreflight(true).then(() => undefined)}
              onRetryAssistantRequest={handleRetryAssistantRequest}
              onResumeSession={handleResumeSession}
              onCompleteSession={handleCompleteSession}
              onAppendTranscript={handleAppendTranscript}
              onDynamicAction={handleDynamicAction}
              onAsk={handleAsk}
              onSelectMicrophoneDevice={handleSelectMicrophoneDevice}
              onSetCaptureMode={setSelectedCaptureMode}
              onSelectSystemAudioSource={handleSelectSystemAudioSource}
              onStartLiveCapture={handleStartLiveCapture}
              onStartListening={handleStartListening}
              onStartScreenShare={startScreenShare}
              onStopLiveCapture={handleStopLiveCapture}
              onStopScreenShare={stopScreenShare}
              onSystemAudioPickerClose={closeSystemAudioPicker}
              onToggleOverlay={() => syncOverlayWindow(!overlayOpenRef.current)}
            />
          ) : null}

          {view === "dashboard" ? (
            <DashboardApp
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              sessionDetail={selectedSessionDetail}
              searchResults={searchResults}
              highlightedSequenceNo={highlightedSequenceNo}
              onSearchSessions={handleSearchSessions}
              onSelectSession={handleSelectSession}
              onExportSession={handleExportSession}
              onGenerateTickets={handleGenerateTickets}
              onPushGeneratedTicket={handlePushGeneratedTicket}
              onPushGeneratedTickets={handlePushGeneratedTickets}
              onSetGeneratedTicketReviewState={handleSetGeneratedTicketReviewState}
              onUpdateGeneratedTicketDraft={handleUpdateGeneratedTicketDraft}
              allowTicketPreview={bootstrap.diagnostics.mode === "browser-mock"}
            />
          ) : null}

          {view === "settings" ? (
            <Settings
              bootstrap={bootstrap}
              prompts={prompts}
              knowledgeFiles={knowledgeFiles}
              onUpdateSetting={handleUpdateSetting}
              onSavePrompt={handleSavePrompt}
              onDeletePrompt={handleDeletePrompt}
              onSaveKnowledgeFile={handleSaveKnowledgeFile}
              onDeleteKnowledgeFile={handleDeleteKnowledgeFile}
            />
          ) : null}
        </section>
      </section>
    </main>
  );
}
