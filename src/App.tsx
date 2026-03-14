import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  appendTranscriptSegment,
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
  renameSessionSpeaker,
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
  setStealthMode as persistStealthMode,
  startSession,
  streamAskAssistant,
  updateBrowserCaptureSession,
  updateGeneratedTicketDraft,
} from "./lib/tauri";
import { DashboardApp } from "./dashboard/DashboardApp";
import { OnboardingApp } from "./onboarding/OnboardingApp";
import { Settings } from "./dashboard/Settings";
import { SessionWidget } from "./session/SessionWidget";
import {
  getBlockingChecksForMode,
  getPreflightModeCanStart,
  getPreflightModeState,
  getPreflightModeSummary,
  getWarningChecksForMode,
  mergeRendererPreflightReport,
} from "./lib/preflight";
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
  SearchMode,
  SecretKey,
  SessionDetail,
  SessionRecord,
  SearchSessionResult,
  ScreenContextInput,
  SettingRecord,
  StreamingAssistantDraft,
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
  github_pat: "",
};

interface WindowFrame {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface SystemAudioPickerRequest {
  sessionId: string | null;
  title: string | null;
}

type AssistantRequest =
  | { action: DynamicActionKey; kind: "action" }
  | { kind: "ask"; prompt: string };

const ASK_SCREEN_CONTEXT_BUDGET_MS = 250;
const ASK_SCREEN_CONTEXT_FRESH_MS = 2_500;

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
  const [highlightedSequenceStart, setHighlightedSequenceStart] = useState<number | null>(null);
  const [highlightedSequenceEnd, setHighlightedSequenceEnd] = useState<number | null>(null);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFileRecord[]>([]);
  const [selectedCaptureMode, setSelectedCaptureMode] = useState<CaptureMode>("manual");
  const [secretDrafts, setSecretDrafts] = useState(initialSecrets);
  const [savingSecretKey, setSavingSecretKey] = useState<SecretKey | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantInFlightAction, setAssistantInFlightAction] = useState<DynamicActionKey | null>(null);
  const [askInFlight, setAskInFlight] = useState(false);
  const [streamingAssistantDraft, setStreamingAssistantDraft] = useState<StreamingAssistantDraft | null>(null);
  const [lastAssistantRequest, setLastAssistantRequest] = useState<AssistantRequest | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [basePreflightReport, setBasePreflightReport] = useState<PreflightReport | null>(null);
  const [systemAudioPickerError, setSystemAudioPickerError] = useState<string | null>(null);
  const [systemAudioPickerLoading, setSystemAudioPickerLoading] = useState(false);
  const [systemAudioPickerOpen, setSystemAudioPickerOpen] = useState(false);
  const [systemAudioPickerRequest, setSystemAudioPickerRequest] = useState<SystemAudioPickerRequest | null>(null);
  const [systemAudioSources, setSystemAudioSources] = useState<SystemAudioSource[]>([]);
  const [stealthMode, setStealthMode] = useState(false);

  const previousWindowFrameRef = useRef<WindowFrame | null>(null);
  const overlayOpenRef = useRef(false);
  const activeSessionRef = useRef<SessionDetail | null>(null);
  const latestSearchRequestIdRef = useRef<string | null>(null);
  const stealthModeRef = useRef(false);

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
    void refreshSessionDetail(payload.session.id);
  }

  function updateStreamingAssistantDraft(
    requestId: string,
    update: (current: StreamingAssistantDraft) => StreamingAssistantDraft
  ) {
    setStreamingAssistantDraft((current) => {
      if (!current || current.requestId !== requestId) {
        return current;
      }

      return update(current);
    });
  }

  async function refreshSessionDetail(sessionId: string) {
    const detail = await getSessionDetail(sessionId);
    applySessionDetail(detail);
    return detail;
  }

  const {
    audioInputDevices,
    captureError,
    captureHealth,
    captureSourceLabel,
    captureState,
    collectMicrophonePreflightChecks,
    collectSystemAudioPreflightCheck,
    lastTranscriptFinalizedAt,
    isCapturing,
    listAvailableSystemAudioSources,
    microphonePreflightChecks,
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
    systemAudioPreflightCheck,
    transcriptFreshnessLabel,
  } = useLiveTranscription({
    onCaptureSessionStateChanged: async (sessionId) => {
      const detail = await getSessionDetail(sessionId);
      applySessionDetail(detail);
    },
    onMicrophoneFinalTranscript: async (segment) => {
      if (!activeSessionRef.current) {
        return;
      }

      const detail = await appendTranscriptSegment({
        sessionId: activeSessionRef.current.session.id,
        speakerId: segment.speakerId ?? null,
        speakerLabel: segment.speakerLabel,
        speakerConfidence: segment.speakerConfidence ?? null,
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

  useEffect(() => {
    stealthModeRef.current = stealthMode;
  }, [stealthMode]);

  function buildRendererPreflightChecks(
    microphoneChecks = microphonePreflightChecks,
    systemAudioCheck = systemAudioPreflightCheck
  ) {
    return [...microphoneChecks, systemAudioCheck];
  }

  async function refreshPreflight({
    interactive = false,
    mode = selectedCaptureMode,
    surfaceError = false,
  }: {
    interactive?: boolean;
    mode?: CaptureMode;
    surfaceError?: boolean;
  } = {}) {
    try {
      setPreflightLoading(true);
      const report = await runPreflightChecks();
      setBasePreflightReport(report);

      const microphoneChecks =
        interactive && mode === "microphone" ? await collectMicrophonePreflightChecks(true) : microphonePreflightChecks;
      const systemAudioCheck =
        interactive && mode === "system_audio"
          ? await collectSystemAudioPreflightCheck(true)
          : systemAudioPreflightCheck;

      return mergeRendererPreflightReport(report, buildRendererPreflightChecks(microphoneChecks, systemAudioCheck));
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
      setBasePreflightReport(preflight);
      setSessions(sessionList);
      setPrompts(payload.prompts);
      setKnowledgeFiles(payload.knowledgeFiles);
      setOverlayOpen(payload.runtime.window.overlayOpen);

      const stealthEnabled = getSettingValue(payload.settings, "stealth_mode", "true") === "true";
      setStealthMode(stealthEnabled);
      if (stealthEnabled) {
        void persistStealthMode(true).catch(() => undefined);
      }

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
    source: "manual" | "capture" = "manual",
    speakerId: string | null = null,
    speakerConfidence: number | null = null
  ) {
    const detail = await appendTranscriptSegment({
      sessionId,
      speakerId,
      speakerLabel,
      speakerConfidence,
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
  const preflightReport = mergeRendererPreflightReport(basePreflightReport, buildRendererPreflightChecks());
  const selectedModeCanStart =
    preflightReport != null
      ? getPreflightModeCanStart(preflightReport, selectedCaptureMode)
      : selectedCaptureMode === "manual"
        ? Boolean(bootstrap?.diagnostics.databaseReady)
        : false;
  const selectedModeState = getPreflightModeState(preflightReport, selectedCaptureMode);
  const selectedModePreflightSummary = getPreflightModeSummary(preflightReport, selectedCaptureMode);
  const selectedModeBlockingChecks = getBlockingChecksForMode(preflightReport, selectedCaptureMode);
  const selectedModeWarningChecks = getWarningChecksForMode(preflightReport, selectedCaptureMode);

  async function handleRefreshSelectedModePreflight() {
    await refreshPreflight({
      interactive: true,
      mode: selectedCaptureMode,
      surfaceError: true,
    });
  }

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

      if (stealthModeRef.current) {
        const width = 440;
        const height = activeSessionRef.current ? 520 : 52;
        await appWindow.setSize(new LogicalSize(width, height));
        if (monitor) {
          const x = monitor.workArea.position.x + Math.round((monitor.workArea.size.width - width) / 2);
          const y = monitor.workArea.position.y;
          await appWindow.setPosition(new LogicalPosition(x, y));
        }
      } else {
        const width = activeSessionRef.current ? 468 : 430;
        const height = activeSessionRef.current ? 780 : 440;
        await appWindow.setSize(new LogicalSize(width, height));
        if (monitor) {
          const x = monitor.workArea.position.x + monitor.workArea.size.width - width - 28;
          const y = monitor.workArea.position.y + 28;
          await appWindow.setPosition(new LogicalPosition(x, y));
        }
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
        await appWindow.setShadow(!stealthModeRef.current).catch(() => undefined);
        overlayOpenRef.current = true;
        if (stealthModeRef.current) {
          await persistStealthMode(true).catch(() => undefined);
        }
        await updateOverlayWindowLayout();
        await appWindow.show();
        await appWindow.setFocus().catch(() => undefined);
        return;
      }

      if (stealthModeRef.current) {
        await persistStealthMode(false).catch(() => undefined);
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
    setSystemAudioPickerRequest(null);
    setSystemAudioSources([]);
  }

  async function openSystemAudioPicker(request: SystemAudioPickerRequest) {
    setSystemAudioPickerRequest(request);
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
    if (!systemAudioPickerRequest?.sessionId && !systemAudioPickerRequest?.title) {
      setSystemAudioPickerError("Start or resume a meeting before selecting a system audio source.");
      return;
    }

    try {
      setError(null);
      setSystemAudioPickerError(null);
      setSystemAudioPickerLoading(true);
      let targetSessionId = systemAudioPickerRequest?.sessionId ?? null;
      if (!targetSessionId && systemAudioPickerRequest?.title) {
        const detail = await createSessionRecord(systemAudioPickerRequest.title, {
          initialStatus: "preparing",
          captureMode: "system_audio",
          captureTargetKind: source.kind,
          captureTargetLabel: source.sourceLabel,
        });
        targetSessionId = detail.session.id;
        if (sessionWidgetEnabled && !overlayOpenRef.current) {
          await syncOverlayWindow(true);
        }
      }

      if (!targetSessionId) {
        throw new Error("Start or resume a meeting before selecting a system audio source.");
      }

      await startCapture({
        language: audioLanguage,
        mode: "system_audio",
        sessionId: targetSessionId,
        source,
      });
      await refreshSessionDetail(targetSessionId);
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

  async function ensureSelectedModeReady(mode: CaptureMode, interactive = true) {
    const report = await refreshPreflight({ interactive, mode, surfaceError: true });
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

  async function startPreparedMicrophoneCapture(sessionId: string) {
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
      sessionId,
    });
    await refreshSessionDetail(sessionId);
  }

  async function createSessionRecord(title: string, overrides: Partial<Parameters<typeof startSession>[0]> = {}) {
    const detail = await startSession({ title, ...overrides });
    applySessionDetail(detail);
    setView("session");
    return detail;
  }

  async function transitionBrowserCaptureSession(
    sessionId: string,
    status: "preparing" | "active" | "permission_blocked" | "capture_error" | "provider_degraded",
    captureMode: "microphone" = "microphone"
  ) {
    const detail = await updateBrowserCaptureSession({
      sessionId,
      status,
      captureMode,
    });
    applySessionDetail(detail);
    return detail;
  }

  async function startLiveCaptureForExistingSession(sessionId: string) {
    if (selectedCaptureMode !== "microphone" && selectedCaptureMode !== "system_audio") {
      setError("Set capture mode to microphone or system audio to start Deepgram live transcription.");
      return;
    }

    const ready = await ensureSelectedModeReady(selectedCaptureMode, true);
    if (!ready) {
      return;
    }

    if (selectedCaptureMode === "system_audio") {
      if (!bootstrap?.captureCapabilities.nativeSystemAudio) {
        setError("System audio capture is available only in the native macOS desktop runtime.");
        return;
      }

      await openSystemAudioPicker({ sessionId, title: null });
      return;
    }

    closeSystemAudioPicker();
    await transitionBrowserCaptureSession(sessionId, "preparing");
    await startPreparedMicrophoneCapture(sessionId);
  }

  async function handleStartSession(title: string) {
    try {
      setError(null);
      setAssistantError(null);
      if (selectedCaptureMode === "manual") {
        await createSessionRecord(title);
        if (sessionWidgetEnabled) {
          await syncOverlayWindow(true);
        }
        return;
      }

      const ready = await ensureSelectedModeReady(selectedCaptureMode, true);
      if (!ready) {
        return;
      }

      if (selectedCaptureMode === "microphone") {
        const detail = await createSessionRecord(title, {
          initialStatus: "preparing",
          captureMode: "microphone",
        });
        if (sessionWidgetEnabled) {
          await syncOverlayWindow(true);
        }
        await startPreparedMicrophoneCapture(detail.session.id);
        return;
      }

      await openSystemAudioPicker({ sessionId: null, title });
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
        const ready = await ensureSelectedModeReady("manual", false);
        if (!ready) {
          return;
        }

        let detail = activeSessionRef.current;
        if (!detail) {
          detail = await createSessionRecord(createOverlaySessionTitle());
        }

        if (!overlayOpenRef.current) {
          await syncOverlayWindow(true);
        }
        return;
      }

      if (!overlayOpenRef.current) {
        await syncOverlayWindow(true);
      }

      const detail = activeSessionRef.current;
      if (detail) {
        await startLiveCaptureForExistingSession(detail.session.id);
        return;
      }

      const ready = await ensureSelectedModeReady(selectedCaptureMode, true);
      if (!ready) {
        return;
      }

      if (selectedCaptureMode === "microphone") {
        const preparingDetail = await createSessionRecord(createOverlaySessionTitle(), {
          initialStatus: "preparing",
          captureMode: "microphone",
        });
        await startPreparedMicrophoneCapture(preparingDetail.session.id);
        return;
      }

      await openSystemAudioPicker({ sessionId: null, title: createOverlaySessionTitle() });
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
      await startLiveCaptureForExistingSession(detail.session.id);
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

  async function handleRenameSpeaker(sessionId: string, speakerId: string, displayLabel: string) {
    const detail = await renameSessionSpeaker({ sessionId, speakerId, displayLabel });
    applySessionDetail(detail);
  }

  async function handleDynamicAction(action: DynamicActionKey) {
    if (!activeSessionRef.current || askInFlight || assistantInFlightAction) {
      return;
    }

    try {
      setAssistantError(null);
      setAssistantInFlightAction(action);
      const screenContext =
        action === "follow_up" && screenContextEnabled ? (await captureScreenContextSafely()).screenContext : null;
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
      setStreamingAssistantDraft(null);
      const { screenContext, waitMs } = await captureScreenContextSafely({
        maxStaleMs: ASK_SCREEN_CONTEXT_FRESH_MS,
        refreshBudgetMs: ASK_SCREEN_CONTEXT_BUDGET_MS,
        skipRefreshIfUnhealthy: true,
      });
      await streamAskAssistant(
        {
        sessionId: activeSessionRef.current.session.id,
        prompt,
          screenContext,
          screenCaptureWaitMs: waitMs,
        },
        {
          onStarted: (event) => {
            setStreamingAssistantDraft({
              requestId: event.requestId,
              sessionId: event.sessionId,
              prompt: event.prompt,
              content: "",
              startedAt: event.startedAt,
              requestedScreenContext: event.requestedScreenContext,
            });
          },
          onChunk: (event) => {
            updateStreamingAssistantDraft(event.requestId, (current) => ({
              ...current,
              content: event.content,
            }));
          },
          onCompleted: (event) => {
            setStreamingAssistantDraft((current) =>
              current?.requestId === event.requestId ? null : current
            );
            applySessionDetail(event.detail);
          },
          onFailed: (event) => {
            setStreamingAssistantDraft((current) =>
              current?.requestId === event.requestId ? null : current
            );
          },
        }
      );
      setLastAssistantRequest({ kind: "ask", prompt });
    } catch (unknownError) {
      setStreamingAssistantDraft(null);
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

  async function handleSelectSession(
    sessionId: string,
    transcriptSequenceStart?: number | null,
    transcriptSequenceEnd?: number | null
  ) {
    setSelectedSessionId(sessionId);
    setHighlightedSequenceStart(transcriptSequenceStart ?? null);
    setHighlightedSequenceEnd(transcriptSequenceEnd ?? null);
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

    await startLiveCaptureForExistingSession(activeSessionRef.current.session.id);
  }

  async function handleStopLiveCapture() {
    closeSystemAudioPicker();
    await stopCapture(activeSessionRef.current?.session.id);
  }

  async function captureScreenContextSafely({
    maxStaleMs,
    refreshBudgetMs,
    skipRefreshIfUnhealthy = false,
  }: {
    maxStaleMs?: number;
    refreshBudgetMs?: number;
    skipRefreshIfUnhealthy?: boolean;
  } = {}): Promise<{ screenContext: ScreenContextInput | null; waitMs: number }> {
    if (!screenContextEnabled || screenShareState !== "active") {
      return { screenContext: null, waitMs: 0 };
    }

    const startedAt =
      typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
    try {
      const screenContext = await captureScreenContext({
        maxStaleMs,
        refreshBudgetMs,
        skipRefreshIfUnhealthy,
      });
      const endedAt =
        typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
      return {
        screenContext,
        waitMs: Math.max(0, Math.round(endedAt - startedAt)),
      };
    } catch {
      const endedAt =
        typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
      return {
        screenContext: null,
        waitMs: Math.max(0, Math.round(endedAt - startedAt)),
      };
    }
  }

  const handleSearchSessions = useEffectEvent(async (query: string, mode: SearchMode, requestId: string) => {
    latestSearchRequestIdRef.current = requestId;
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    const results = await searchSessions(query, mode);
    if (latestSearchRequestIdRef.current !== requestId) {
      return;
    }

    setSearchResults(results);
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
        {error && !stealthMode ? (
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
          preflightState={selectedModeState}
          preflightSummary={selectedModePreflightSummary}
          preflightWarningChecks={selectedModeWarningChecks}
          screenContextEnabled={screenContextEnabled}
          screenShareError={screenShareError}
          screenShareOwnedByCapture={screenShareOwnedByCapture}
          screenShareState={screenShareState}
          selectedMicrophoneDeviceId={selectedMicrophoneDeviceId}
          streamingAssistantDraft={streamingAssistantDraft}
          stealthMode={stealthMode}
          systemAudioPickerError={systemAudioPickerError}
          systemAudioPickerLoading={systemAudioPickerLoading}
          systemAudioPickerOpen={systemAudioPickerOpen}
          systemAudioSources={systemAudioSources}
          transcriptFreshnessLabel={transcriptFreshnessLabel}
          onStartSession={handleStartSession}
          onPauseSession={handlePauseSession}
          onRefreshPreflight={handleRefreshSelectedModePreflight}
          onRetryAssistantRequest={handleRetryAssistantRequest}
          onResumeSession={handleResumeSession}
          onCompleteSession={handleCompleteSession}
          onAppendTranscript={handleAppendTranscript}
          onRenameSpeaker={handleRenameSpeaker}
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
              preflightState={selectedModeState}
              preflightSummary={selectedModePreflightSummary}
              preflightWarningChecks={selectedModeWarningChecks}
              screenContextEnabled={screenContextEnabled}
              screenShareError={screenShareError}
              screenShareOwnedByCapture={screenShareOwnedByCapture}
              screenShareState={screenShareState}
              selectedMicrophoneDeviceId={selectedMicrophoneDeviceId}
              streamingAssistantDraft={streamingAssistantDraft}
              systemAudioPickerError={systemAudioPickerError}
              systemAudioPickerLoading={systemAudioPickerLoading}
              systemAudioPickerOpen={systemAudioPickerOpen}
              systemAudioSources={systemAudioSources}
              transcriptFreshnessLabel={transcriptFreshnessLabel}
              onStartSession={handleStartSession}
              onPauseSession={handlePauseSession}
              onRefreshPreflight={handleRefreshSelectedModePreflight}
              onRetryAssistantRequest={handleRetryAssistantRequest}
              onResumeSession={handleResumeSession}
              onCompleteSession={handleCompleteSession}
              onAppendTranscript={handleAppendTranscript}
              onRenameSpeaker={handleRenameSpeaker}
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
              highlightedSequenceStart={highlightedSequenceStart}
              highlightedSequenceEnd={highlightedSequenceEnd}
              semanticSearchReady={bootstrap.diagnostics.semanticSearchReady}
              onSearchSessions={handleSearchSessions}
              onSelectSession={handleSelectSession}
              onExportSession={handleExportSession}
              onRenameSpeaker={handleRenameSpeaker}
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
