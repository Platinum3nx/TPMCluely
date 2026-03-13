use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use http::Request;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::app::commands::{
    derive_session_update, map_session, map_transcript, SessionRecordPayload,
    TranscriptSegmentPayload,
};
use crate::db::AppDatabase;
use crate::providers::stt::deepgram_listen_endpoint;
use crate::secrets::AppSecretStore;

use super::buffering::{
    dedupe_key, AudioChunk, AudioNormalizer, FinalizedUtterance, FinalizedUtteranceBuilder,
};

pub const EVENT_CAPTURE_STATE: &str = "capture:state";
pub const EVENT_CAPTURE_PARTIAL: &str = "capture:partial";
pub const EVENT_CAPTURE_SEGMENT: &str = "capture:segment";
pub const EVENT_CAPTURE_HEALTH: &str = "capture:health";

const AUDIO_QUEUE_CAPACITY: usize = 64;
const KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SystemAudioSourceKind {
    Window,
    Display,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudioSource {
    pub id: String,
    pub kind: SystemAudioSourceKind,
    pub title: String,
    pub app_name: Option<String>,
    pub bundle_id: Option<String>,
    pub source_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudioSourceListPayload {
    pub sources: Vec<SystemAudioSource>,
    pub permission_status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureRuntimeState {
    Idle,
    PermissionBlocked,
    Starting,
    Connecting,
    Listening,
    Degraded,
    Stopping,
    Error,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatePayload {
    pub session_id: Option<String>,
    pub runtime_state: CaptureRuntimeState,
    pub capture_mode: String,
    pub source_label: Option<String>,
    pub message: Option<String>,
    pub permission_status: Option<String>,
    pub target_kind: Option<SystemAudioSourceKind>,
    pub reconnect_attempt: u32,
}

impl CaptureStatePayload {
    pub fn idle() -> Self {
        Self {
            session_id: None,
            runtime_state: CaptureRuntimeState::Idle,
            capture_mode: "manual".to_string(),
            source_label: None,
            message: None,
            permission_status: None,
            target_kind: None,
            reconnect_attempt: 0,
        }
    }
}

impl Default for CaptureStatePayload {
    fn default() -> Self {
        Self::idle()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureHealthPayload {
    pub session_id: Option<String>,
    pub severity: String,
    pub dropped_frames: u64,
    pub queue_depth: usize,
    pub reconnect_attempt: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureCapabilities {
    pub native_system_audio: bool,
    pub screen_recording_required: bool,
    pub microphone_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSystemAudioCaptureInput {
    pub session_id: String,
    pub source_id: String,
    pub source_kind: SystemAudioSourceKind,
    pub source_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePartialEventPayload {
    pub session_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSegmentEventPayload {
    pub session_id: String,
    pub session: SessionRecordPayload,
    pub segment: TranscriptSegmentPayload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PermissionStatus {
    Unknown,
    Granted,
    Denied,
    Restricted,
}

impl PermissionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Restricted => "restricted",
        }
    }
}

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("system audio capture is unavailable in this runtime")]
    Unsupported,
    #[error("{0}")]
    PermissionBlocked(String),
    #[error("{0}")]
    Native(String),
    #[error("{0}")]
    Provider(String),
    #[error("{0}")]
    Database(String),
    #[error("{0}")]
    Secret(String),
    #[error("{0}")]
    InvalidInput(String),
}

#[derive(Clone, Default)]
pub struct CaptureService {
    inner: Arc<Mutex<CaptureServiceInner>>,
}

#[derive(Default)]
struct CaptureServiceInner {
    state: CaptureStatePayload,
    active: Option<ActiveCapture>,
}

struct ActiveCapture {
    session_id: String,
    _callback_context: Arc<NativeCallbackContext>,
    control_tx: mpsc::UnboundedSender<ControlMessage>,
    task_handle: JoinHandle<()>,
    native_handle: NativeCaptureHandle,
}

struct NativeCallbackContext {
    session_id: String,
    app: AppHandle,
    service: CaptureService,
    queue_depth: AtomicUsize,
    dropped_frames: AtomicU64,
    reconnect_attempt: AtomicU64,
    normalizer: Mutex<AudioNormalizer>,
    overflow: Mutex<OverflowState>,
    audio_tx: mpsc::Sender<AudioChunk>,
    control_tx: mpsc::UnboundedSender<ControlMessage>,
}

#[derive(Default)]
struct OverflowState {
    started_at: Option<Instant>,
    restarted: bool,
    failed: bool,
}

enum ControlMessage {
    Stop,
    RestartDeepgram,
    NativeStopped(String),
    NativeError(String),
}

impl CaptureService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn capabilities(&self) -> CaptureCapabilities {
        CaptureCapabilities {
            native_system_audio: cfg!(target_os = "macos"),
            screen_recording_required: true,
            microphone_fallback: true,
        }
    }

    pub fn current_state(&self) -> CaptureStatePayload {
        self.inner
            .lock()
            .expect("capture service mutex poisoned")
            .state
            .clone()
    }

    pub fn list_system_audio_sources(&self) -> Result<SystemAudioSourceListPayload, AudioError> {
        if !self.capabilities().native_system_audio {
            return Ok(SystemAudioSourceListPayload {
                sources: Vec::new(),
                permission_status: "restricted".to_string(),
                message: Some(
                    "Native system-audio capture is only available in the macOS desktop runtime."
                        .to_string(),
                ),
            });
        }

        let permission = screen_recording_status();
        if permission != PermissionStatus::Granted {
            return Ok(SystemAudioSourceListPayload {
                sources: Vec::new(),
                permission_status: permission.as_str().to_string(),
                message: Some(
                    "Screen Recording permission is required before TPMCluely can capture meeting audio."
                        .to_string(),
                ),
            });
        }

        let mut sources = native_list_sources("com.cluely.desktop")?;
        sources.sort_by(|left, right| match (left.kind, right.kind) {
            (SystemAudioSourceKind::Window, SystemAudioSourceKind::Display) => {
                std::cmp::Ordering::Less
            }
            (SystemAudioSourceKind::Display, SystemAudioSourceKind::Window) => {
                std::cmp::Ordering::Greater
            }
            _ => left.source_label.cmp(&right.source_label),
        });

        Ok(SystemAudioSourceListPayload {
            sources,
            permission_status: permission.as_str().to_string(),
            message: None,
        })
    }

    pub async fn start_system_audio_capture(
        &self,
        app: AppHandle,
        database: Arc<AppDatabase>,
        secret_store: Arc<dyn AppSecretStore>,
        input: StartSystemAudioCaptureInput,
        audio_language: String,
    ) -> Result<CaptureStatePayload, AudioError> {
        self.stop_system_audio_capture(&app, None).await?;

        if !self.capabilities().native_system_audio {
            let payload = self.update_state(
                &app,
                CaptureStatePayload {
                    runtime_state: CaptureRuntimeState::Unsupported,
                    message: Some(
                        "Native system audio capture is unavailable in this runtime.".to_string(),
                    ),
                    ..CaptureStatePayload::idle()
                },
            );
            return Ok(payload);
        }

        let permission = match ensure_screen_recording_access() {
            PermissionStatus::Granted => PermissionStatus::Granted,
            status => {
                database
                    .update_session_status(&input.session_id, "permission_blocked", None)
                    .map_err(|error| AudioError::Database(error.to_string()))?;
                let payload = self.update_state(
                    &app,
                    CaptureStatePayload {
                        session_id: Some(input.session_id),
                        runtime_state: CaptureRuntimeState::PermissionBlocked,
                        capture_mode: "system_audio".to_string(),
                        source_label: Some(input.source_label),
                        message: Some(
                            "Screen Recording permission is blocked. Open System Settings -> Privacy & Security -> Screen Recording and enable TPMCluely."
                                .to_string(),
                        ),
                        permission_status: Some(status.as_str().to_string()),
                        target_kind: Some(input.source_kind),
                        reconnect_attempt: 0,
                    },
                );
                return Ok(payload);
            }
        };

        let deepgram_api_key = secret_store
            .read_secret("deepgram_api_key")
            .map_err(|error| AudioError::Secret(error.to_string()))?
            .ok_or_else(|| AudioError::Secret("Deepgram API key is missing.".to_string()))?;

        database
            .update_session_status(&input.session_id, "preparing", None)
            .map_err(|error| AudioError::Database(error.to_string()))?;
        database
            .update_session_capture_metadata(
                &input.session_id,
                "system_audio",
                Some(match input.source_kind {
                    SystemAudioSourceKind::Window => "window",
                    SystemAudioSourceKind::Display => "display",
                }),
                Some(&input.source_label),
            )
            .map_err(|error| AudioError::Database(error.to_string()))?;

        self.update_state(
            &app,
            CaptureStatePayload {
                session_id: Some(input.session_id.clone()),
                runtime_state: CaptureRuntimeState::Starting,
                capture_mode: "system_audio".to_string(),
                source_label: Some(input.source_label.clone()),
                message: Some("Starting native system-audio capture.".to_string()),
                permission_status: Some(permission.as_str().to_string()),
                target_kind: Some(input.source_kind),
                reconnect_attempt: 0,
            },
        );

        let (audio_tx, audio_rx) = mpsc::channel(AUDIO_QUEUE_CAPACITY);
        let (control_tx, control_rx) = mpsc::unbounded_channel();
        let callback_context = Arc::new(NativeCallbackContext {
            session_id: input.session_id.clone(),
            app: app.clone(),
            service: self.clone(),
            queue_depth: AtomicUsize::new(0),
            dropped_frames: AtomicU64::new(0),
            reconnect_attempt: AtomicU64::new(0),
            normalizer: Mutex::new(AudioNormalizer::default()),
            overflow: Mutex::new(OverflowState::default()),
            audio_tx,
            control_tx: control_tx.clone(),
        });

        let task_handle = tokio::spawn(run_capture_pipeline(
            app.clone(),
            self.clone(),
            Arc::clone(&database),
            input.session_id.clone(),
            input.source_label.clone(),
            audio_language,
            deepgram_api_key,
            callback_context.clone(),
            audio_rx,
            control_rx,
        ));

        let native_handle = match native_start_capture(
            &input.source_id,
            input.source_kind,
            callback_context.as_ref(),
        ) {
            Ok(handle) => handle,
            Err(error) => {
                task_handle.abort();
                let _ = database.update_session_status(&input.session_id, "capture_error", None);
                let payload = self.update_state(
                    &app,
                    CaptureStatePayload {
                        session_id: Some(input.session_id),
                        runtime_state: CaptureRuntimeState::Error,
                        capture_mode: "system_audio".to_string(),
                        source_label: Some(input.source_label),
                        message: Some(error.to_string()),
                        permission_status: Some(permission.as_str().to_string()),
                        target_kind: Some(input.source_kind),
                        reconnect_attempt: 0,
                    },
                );
                return Ok(payload);
            }
        };

        let payload = self.current_state();
        self.inner
            .lock()
            .expect("capture service mutex poisoned")
            .active = Some(ActiveCapture {
            session_id: input.session_id,
            _callback_context: callback_context,
            control_tx,
            task_handle,
            native_handle,
        });

        Ok(payload)
    }

    pub async fn stop_system_audio_capture(
        &self,
        app: &AppHandle,
        session_id: Option<&str>,
    ) -> Result<CaptureStatePayload, AudioError> {
        let active = {
            let mut inner = self.inner.lock().expect("capture service mutex poisoned");
            if session_id
                .map(|candidate| {
                    inner
                        .active
                        .as_ref()
                        .map(|active| active.session_id.as_str())
                        != Some(candidate)
                })
                .unwrap_or(false)
            {
                return Ok(inner.state.clone());
            }
            if inner.active.is_none() {
                inner.state = CaptureStatePayload::idle();
                return Ok(inner.state.clone());
            }
            let state = CaptureStatePayload {
                runtime_state: CaptureRuntimeState::Stopping,
                message: Some("Stopping live system-audio capture.".to_string()),
                ..inner.state.clone()
            };
            inner.state = state.clone();
            let _ = app.emit(EVENT_CAPTURE_STATE, &state);
            inner.active.take()
        };

        if let Some(active) = active {
            let _ = active.control_tx.send(ControlMessage::Stop);
            active.native_handle.stop();
            let _ = active.task_handle.await;
        }

        Ok(self.update_state(app, CaptureStatePayload::idle()))
    }

    fn update_state(&self, app: &AppHandle, payload: CaptureStatePayload) -> CaptureStatePayload {
        {
            let mut inner = self.inner.lock().expect("capture service mutex poisoned");
            inner.state = payload.clone();
        }
        let _ = app.emit(EVENT_CAPTURE_STATE, &payload);
        payload
    }

    fn emit_partial(&self, app: &AppHandle, session_id: &str, text: String) {
        let _ = app.emit(
            EVENT_CAPTURE_PARTIAL,
            CapturePartialEventPayload {
                session_id: session_id.to_string(),
                text,
            },
        );
    }

    fn emit_health(&self, app: &AppHandle, payload: CaptureHealthPayload) {
        let _ = app.emit(EVENT_CAPTURE_HEALTH, &payload);
    }
}

async fn run_capture_pipeline(
    app: AppHandle,
    service: CaptureService,
    database: Arc<AppDatabase>,
    session_id: String,
    source_label: String,
    audio_language: String,
    deepgram_api_key: String,
    callback_context: Arc<NativeCallbackContext>,
    mut audio_rx: mpsc::Receiver<AudioChunk>,
    mut control_rx: mpsc::UnboundedReceiver<ControlMessage>,
) {
    let mut reconnect_attempt = 0_u32;

    loop {
        let connect_payload = CaptureStatePayload {
            session_id: Some(session_id.clone()),
            runtime_state: if reconnect_attempt == 0 {
                CaptureRuntimeState::Connecting
            } else {
                CaptureRuntimeState::Degraded
            },
            capture_mode: "system_audio".to_string(),
            source_label: Some(source_label.clone()),
            message: Some(if reconnect_attempt == 0 {
                "Connecting TPMCluely to Deepgram.".to_string()
            } else {
                "Reconnecting TPMCluely to Deepgram.".to_string()
            }),
            permission_status: Some(screen_recording_status().as_str().to_string()),
            target_kind: None,
            reconnect_attempt,
        };
        service.update_state(&app, connect_payload);

        let connection = match connect_to_deepgram(&deepgram_api_key, &audio_language).await {
            Ok(socket) => socket,
            Err(error) => {
                if reconnect_attempt == 0 {
                    reconnect_attempt += 1;
                    service.emit_health(
                        &app,
                        CaptureHealthPayload {
                            session_id: Some(session_id.clone()),
                            severity: "warning".to_string(),
                            dropped_frames: callback_context.dropped_frames.load(Ordering::SeqCst),
                            queue_depth: callback_context.queue_depth.load(Ordering::SeqCst),
                            reconnect_attempt,
                            message: format!("Deepgram connection failed once: {error}"),
                        },
                    );
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }

                let _ = database.update_session_status(&session_id, "capture_error", None);
                service.update_state(
                    &app,
                    CaptureStatePayload {
                        session_id: Some(session_id.clone()),
                        runtime_state: CaptureRuntimeState::Error,
                        capture_mode: "system_audio".to_string(),
                        source_label: Some(source_label.clone()),
                        message: Some(format!("Deepgram live transcription failed: {error}")),
                        permission_status: Some(screen_recording_status().as_str().to_string()),
                        target_kind: None,
                        reconnect_attempt,
                    },
                );
                service.emit_partial(&app, &session_id, String::new());
                return;
            }
        };

        let _ = database.update_session_status(&session_id, "active", None);
        service.update_state(
            &app,
            CaptureStatePayload {
                session_id: Some(session_id.clone()),
                runtime_state: CaptureRuntimeState::Listening,
                capture_mode: "system_audio".to_string(),
                source_label: Some(source_label.clone()),
                message: Some("Listening to shared meeting audio.".to_string()),
                permission_status: Some(screen_recording_status().as_str().to_string()),
                target_kind: None,
                reconnect_attempt,
            },
        );

        let (mut writer, mut reader) = connection.split();
        let mut keep_alive = tokio::time::interval(KEEP_ALIVE_INTERVAL);
        let mut utterance = FinalizedUtteranceBuilder::default();

        let should_restart = loop {
            tokio::select! {
                control = control_rx.recv() => {
                    match control {
                        Some(ControlMessage::Stop) => {
                            let _ = writer.send(Message::Text("{\"type\":\"Finalize\"}".to_string())).await;
                            let _ = writer.send(Message::Text("{\"type\":\"CloseStream\"}".to_string())).await;
                            let finalized = utterance.flush();
                            if !finalized.is_empty() {
                                let _ = persist_finalized_utterances(&database, &app, &session_id, finalized);
                            }
                            service.emit_partial(&app, &session_id, String::new());
                            return;
                        }
                        Some(ControlMessage::RestartDeepgram) => {
                            let _ = writer.send(Message::Text("{\"type\":\"Finalize\"}".to_string())).await;
                            let _ = writer.send(Message::Text("{\"type\":\"CloseStream\"}".to_string())).await;
                            let finalized = utterance.flush();
                            if !finalized.is_empty() {
                                let _ = persist_finalized_utterances(&database, &app, &session_id, finalized);
                            }
                            break true;
                        }
                        Some(ControlMessage::NativeStopped(message)) => {
                            let _ = database.update_session_status(&session_id, "capture_error", None);
                            service.update_state(
                                &app,
                                CaptureStatePayload {
                                    session_id: Some(session_id.clone()),
                                    runtime_state: CaptureRuntimeState::Error,
                                    capture_mode: "system_audio".to_string(),
                                    source_label: Some(source_label.clone()),
                                    message: Some(message),
                                    permission_status: Some(screen_recording_status().as_str().to_string()),
                                    target_kind: None,
                                    reconnect_attempt,
                                },
                            );
                            service.emit_partial(&app, &session_id, String::new());
                            return;
                        }
                        Some(ControlMessage::NativeError(message)) => {
                            let _ = database.update_session_status(&session_id, "capture_error", None);
                            service.update_state(
                                &app,
                                CaptureStatePayload {
                                    session_id: Some(session_id.clone()),
                                    runtime_state: CaptureRuntimeState::Error,
                                    capture_mode: "system_audio".to_string(),
                                    source_label: Some(source_label.clone()),
                                    message: Some(message),
                                    permission_status: Some(screen_recording_status().as_str().to_string()),
                                    target_kind: None,
                                    reconnect_attempt,
                                },
                            );
                            service.emit_partial(&app, &session_id, String::new());
                            return;
                        }
                        None => return,
                    }
                }
                maybe_chunk = audio_rx.recv() => {
                    if let Some(chunk) = maybe_chunk {
                        saturating_decrement(&callback_context.queue_depth);
                        if let Err(error) = writer.send(Message::Binary(chunk.bytes)).await {
                            if reconnect_attempt == 0 {
                                service.emit_health(
                                    &app,
                                    CaptureHealthPayload {
                                        session_id: Some(session_id.clone()),
                                        severity: "warning".to_string(),
                                        dropped_frames: callback_context.dropped_frames.load(Ordering::SeqCst),
                                        queue_depth: callback_context.queue_depth.load(Ordering::SeqCst),
                                        reconnect_attempt: reconnect_attempt + 1,
                                        message: format!("Deepgram websocket write failed: {error}"),
                                    },
                                );
                                break true;
                            }
                            let _ = database.update_session_status(&session_id, "capture_error", None);
                            service.update_state(
                                &app,
                                CaptureStatePayload {
                                    session_id: Some(session_id.clone()),
                                    runtime_state: CaptureRuntimeState::Error,
                                    capture_mode: "system_audio".to_string(),
                                    source_label: Some(source_label.clone()),
                                    message: Some(format!("Deepgram websocket write failed: {error}")),
                                    permission_status: Some(screen_recording_status().as_str().to_string()),
                                    target_kind: None,
                                    reconnect_attempt,
                                },
                            );
                            service.emit_partial(&app, &session_id, String::new());
                            return;
                        }
                    }
                }
                _ = keep_alive.tick() => {
                    let _ = writer.send(Message::Text("{\"type\":\"KeepAlive\"}".to_string())).await;
                }
                message = reader.next() => {
                    match message {
                        Some(Ok(Message::Text(text))) => {
                            if let Err(error) = handle_deepgram_text(&service, &app, &database, &session_id, &mut utterance, text).await {
                                let _ = database.update_session_status(&session_id, "capture_error", None);
                                service.update_state(
                                    &app,
                                    CaptureStatePayload {
                                        session_id: Some(session_id.clone()),
                                        runtime_state: CaptureRuntimeState::Error,
                                        capture_mode: "system_audio".to_string(),
                                        source_label: Some(source_label.clone()),
                                        message: Some(error.to_string()),
                                        permission_status: Some(screen_recording_status().as_str().to_string()),
                                        target_kind: None,
                                        reconnect_attempt,
                                    },
                                );
                                service.emit_partial(&app, &session_id, String::new());
                                return;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            break reconnect_attempt == 0;
                        }
                        Some(Err(error)) => {
                            if reconnect_attempt == 0 {
                                service.emit_health(
                                    &app,
                                    CaptureHealthPayload {
                                        session_id: Some(session_id.clone()),
                                        severity: "warning".to_string(),
                                        dropped_frames: callback_context.dropped_frames.load(Ordering::SeqCst),
                                        queue_depth: callback_context.queue_depth.load(Ordering::SeqCst),
                                        reconnect_attempt: reconnect_attempt + 1,
                                        message: format!("Deepgram websocket disconnected: {error}"),
                                    },
                                );
                                break true;
                            }
                            let _ = database.update_session_status(&session_id, "capture_error", None);
                            service.update_state(
                                &app,
                                CaptureStatePayload {
                                    session_id: Some(session_id.clone()),
                                    runtime_state: CaptureRuntimeState::Error,
                                    capture_mode: "system_audio".to_string(),
                                    source_label: Some(source_label.clone()),
                                    message: Some(format!("Deepgram websocket disconnected: {error}")),
                                    permission_status: Some(screen_recording_status().as_str().to_string()),
                                    target_kind: None,
                                    reconnect_attempt,
                                },
                            );
                            service.emit_partial(&app, &session_id, String::new());
                            return;
                        }
                        Some(Ok(_)) => {}
                    }
                }
            }
        };

        let finalized = utterance.flush();
        if !finalized.is_empty() {
            let _ = persist_finalized_utterances(&database, &app, &session_id, finalized);
        }
        service.emit_partial(&app, &session_id, String::new());

        if should_restart && reconnect_attempt == 0 {
            reconnect_attempt += 1;
            callback_context
                .reconnect_attempt
                .store(reconnect_attempt as u64, Ordering::SeqCst);
            let _ = database.update_session_status(&session_id, "provider_degraded", None);
            continue;
        }

        let _ = database.update_session_status(&session_id, "capture_error", None);
        service.update_state(
            &app,
            CaptureStatePayload {
                session_id: Some(session_id.clone()),
                runtime_state: CaptureRuntimeState::Error,
                capture_mode: "system_audio".to_string(),
                source_label: Some(source_label.clone()),
                message: Some("Live transcription disconnected. Switch to microphone capture if this keeps happening.".to_string()),
                permission_status: Some(screen_recording_status().as_str().to_string()),
                target_kind: None,
                reconnect_attempt,
            },
        );
        return;
    }
}

async fn handle_deepgram_text(
    service: &CaptureService,
    app: &AppHandle,
    database: &AppDatabase,
    session_id: &str,
    utterance: &mut FinalizedUtteranceBuilder,
    text: String,
) -> Result<(), AudioError> {
    let payload = parse_deepgram_message(&text)?;

    match payload {
        DeepgramMessage::Results {
            transcript,
            is_final,
            speech_final,
            utterances: finalized_turns,
        } => {
            if transcript.is_empty() && finalized_turns.is_empty() {
                if is_final && !utterance.is_empty() && speech_final {
                    let flushed = utterance.flush();
                    if !flushed.is_empty() {
                        persist_finalized_utterances(database, app, session_id, flushed)?;
                    }
                    service.emit_partial(app, session_id, String::new());
                }
                return Ok(());
            }

            if is_final {
                utterance.push_utterances(finalized_turns);
                if speech_final {
                    let flushed = utterance.flush();
                    if !flushed.is_empty() {
                        persist_finalized_utterances(database, app, session_id, flushed)?;
                    }
                    service.emit_partial(app, session_id, String::new());
                }
            } else {
                service.emit_partial(app, session_id, transcript);
            }
        }
        DeepgramMessage::UtteranceEnd => {
            let flushed = utterance.flush();
            if !flushed.is_empty() {
                persist_finalized_utterances(database, app, session_id, flushed)?;
            }
            service.emit_partial(app, session_id, String::new());
        }
        DeepgramMessage::Other => {}
    }

    Ok(())
}

fn persist_finalized_utterances(
    database: &AppDatabase,
    app: &AppHandle,
    session_id: &str,
    utterances: Vec<FinalizedUtterance>,
) -> Result<(), AudioError> {
    let mut persisted_segments = Vec::new();
    for utterance in utterances {
        let dedupe = dedupe_key(
            "capture",
            utterance.speaker_id.as_deref(),
            utterance.start_ms,
            utterance.end_ms,
            &utterance.text,
        );
        let maybe_segment = database
            .append_transcript_segment_with_metadata(
                session_id,
                utterance.speaker_id.as_deref(),
                utterance.speaker_label.as_deref(),
                utterance.speaker_confidence,
                &utterance.text,
                true,
                "capture",
                utterance.start_ms,
                utterance.end_ms,
                Some(&dedupe),
            )
            .map_err(|error| AudioError::Database(error.to_string()))?;

        if let Some(segment) = maybe_segment {
            persisted_segments.push(segment);
        }
    }

    if persisted_segments.is_empty() {
        return Ok(());
    }

    let transcripts = database
        .list_transcript_segments(session_id)
        .map_err(|error| AudioError::Database(error.to_string()))?;
    let derived = derive_session_update(&transcripts);
    database
        .update_session_derived(session_id, &derived)
        .map_err(|error| AudioError::Database(error.to_string()))?;

    let session = database
        .get_session(session_id)
        .map_err(|error| AudioError::Database(error.to_string()))?
        .ok_or_else(|| {
            AudioError::Database("Session disappeared while persisting capture output.".to_string())
        })?;

    let session_payload = map_session(session);
    for segment in persisted_segments {
        let _ = app.emit(
            EVENT_CAPTURE_SEGMENT,
            CaptureSegmentEventPayload {
                session_id: session_id.to_string(),
                session: session_payload.clone(),
                segment: map_transcript(segment),
            },
        );
    }

    Ok(())
}

async fn connect_to_deepgram(
    api_key: &str,
    audio_language: &str,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    AudioError,
> {
    let request = Request::builder()
        .uri(deepgram_listen_endpoint(audio_language))
        .header("Authorization", format!("Token {api_key}"))
        .body(())
        .map_err(|error| AudioError::Provider(error.to_string()))?;

    connect_async(request)
        .await
        .map(|(socket, _)| socket)
        .map_err(|error| AudioError::Provider(error.to_string()))
}

fn saturating_decrement(value: &AtomicUsize) {
    let _ = value.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
        Some(current.saturating_sub(1))
    });
}

#[derive(Debug)]
enum DeepgramMessage {
    Results {
        transcript: String,
        is_final: bool,
        speech_final: bool,
        utterances: Vec<FinalizedUtterance>,
    },
    UtteranceEnd,
    Other,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct DeepgramChannel {
    #[serde(default)]
    alternatives: Vec<DeepgramAlternative>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct DeepgramAlternative {
    #[serde(default)]
    transcript: String,
    #[serde(default)]
    words: Vec<DeepgramWord>,
    #[serde(default)]
    utterances: Vec<DeepgramUtterancePayload>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct DeepgramWord {
    #[serde(default)]
    word: String,
    #[serde(default)]
    punctuated_word: Option<String>,
    #[serde(default)]
    start: Option<f64>,
    #[serde(default)]
    end: Option<f64>,
    #[serde(default)]
    speaker: Option<usize>,
    #[serde(default)]
    speaker_confidence: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct DeepgramUtterancePayload {
    #[serde(default)]
    transcript: String,
    #[serde(default)]
    start: Option<f64>,
    #[serde(default)]
    end: Option<f64>,
    #[serde(default)]
    speaker: Option<usize>,
    #[serde(default)]
    words: Vec<DeepgramWord>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawDeepgramMessage {
    Results(RawDeepgramResults),
    Typed(RawDeepgramTypedMessage),
}

#[derive(Debug, Deserialize)]
struct RawDeepgramTypedMessage {
    #[serde(rename = "type")]
    message_type: String,
}

#[derive(Debug, Deserialize)]
struct RawDeepgramResults {
    #[serde(default, rename = "type")]
    message_type: Option<String>,
    #[serde(default)]
    is_final: bool,
    #[serde(default)]
    speech_final: bool,
    #[serde(default)]
    start: Option<f64>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    utterances: Vec<DeepgramUtterancePayload>,
    #[serde(default)]
    results: Option<DeepgramNestedResults>,
    channel: Option<DeepgramChannel>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct DeepgramNestedResults {
    #[serde(default)]
    utterances: Vec<DeepgramUtterancePayload>,
}

fn parse_deepgram_message(text: &str) -> Result<DeepgramMessage, AudioError> {
    let raw = serde_json::from_str::<RawDeepgramMessage>(text).map_err(|error| {
        AudioError::Provider(format!("Failed to parse Deepgram response: {error}"))
    })?;

    match raw {
        RawDeepgramMessage::Typed(RawDeepgramTypedMessage { message_type })
            if message_type == "UtteranceEnd" =>
        {
            Ok(DeepgramMessage::UtteranceEnd)
        }
        RawDeepgramMessage::Typed(_) => Ok(DeepgramMessage::Other),
        RawDeepgramMessage::Results(message)
            if message.message_type.as_deref().unwrap_or("Results") == "Results" =>
        {
            let alternative = message
                .channel
                .as_ref()
                .and_then(|channel| channel.alternatives.first())
                .cloned()
                .unwrap_or_default();
            let transcript = alternative.transcript.trim().to_string();
            let utterances = normalize_deepgram_utterances(
                &message.utterances,
                message
                    .results
                    .as_ref()
                    .map(|results| results.utterances.as_slice())
                    .unwrap_or(&[]),
                &alternative,
                seconds_to_ms(message.start),
                end_ms_from_duration(message.start, message.duration),
            );

            Ok(DeepgramMessage::Results {
                transcript,
                is_final: message.is_final,
                speech_final: message.speech_final,
                utterances,
            })
        }
        RawDeepgramMessage::Results(_) => Ok(DeepgramMessage::Other),
    }
}

fn normalize_deepgram_utterances(
    top_level_utterances: &[DeepgramUtterancePayload],
    nested_utterances: &[DeepgramUtterancePayload],
    alternative: &DeepgramAlternative,
    fallback_start_ms: Option<i64>,
    fallback_end_ms: Option<i64>,
) -> Vec<FinalizedUtterance> {
    let utterances = if !top_level_utterances.is_empty() {
        top_level_utterances
    } else if !nested_utterances.is_empty() {
        nested_utterances
    } else if !alternative.utterances.is_empty() {
        alternative.utterances.as_slice()
    } else {
        &[] as &[DeepgramUtterancePayload]
    };

    if !utterances.is_empty() {
        let mut builder = FinalizedUtteranceBuilder::default();
        for utterance in utterances {
            builder.push_utterances(normalize_deepgram_utterance_payload(utterance));
        }
        return builder.flush();
    }

    if !alternative.words.is_empty() {
        return group_words_by_speaker(&alternative.words);
    }

    let text = alternative.transcript.trim();
    if text.is_empty() {
        return Vec::new();
    }

    vec![FinalizedUtterance {
        speaker_id: None,
        speaker_label: None,
        speaker_confidence: None,
        text: text.to_string(),
        start_ms: fallback_start_ms,
        end_ms: fallback_end_ms,
    }]
}

fn normalize_deepgram_utterance_payload(
    utterance: &DeepgramUtterancePayload,
) -> Vec<FinalizedUtterance> {
    if utterance.speaker.is_some() {
        let speaker_id = deepgram_speaker_id(utterance.speaker);
        let speaker_label = deepgram_speaker_label(utterance.speaker);
        let text = if utterance.transcript.trim().is_empty() {
            join_word_tokens(&utterance.words)
        } else {
            utterance.transcript.trim().to_string()
        };
        let start_ms = seconds_to_ms(utterance.start)
            .or_else(|| utterance.words.first().and_then(|word| seconds_to_ms(word.start)));
        let end_ms = seconds_to_ms(utterance.end)
            .or_else(|| utterance.words.last().and_then(|word| seconds_to_ms(word.end)));

        return vec![FinalizedUtterance {
            speaker_id,
            speaker_label,
            speaker_confidence: average_speaker_confidence(&utterance.words),
            text,
            start_ms,
            end_ms,
        }];
    }

    if utterance.words.iter().any(|word| word.speaker.is_some()) {
        return group_words_by_speaker(&utterance.words);
    }

    let text = if utterance.transcript.trim().is_empty() {
        join_word_tokens(&utterance.words)
    } else {
        utterance.transcript.trim().to_string()
    };
    if text.is_empty() {
        return Vec::new();
    }

    vec![FinalizedUtterance {
        speaker_id: None,
        speaker_label: None,
        speaker_confidence: None,
        text,
        start_ms: seconds_to_ms(utterance.start),
        end_ms: seconds_to_ms(utterance.end),
    }]
}

fn group_words_by_speaker(words: &[DeepgramWord]) -> Vec<FinalizedUtterance> {
    let mut builder = FinalizedUtteranceBuilder::default();
    for word in words {
        let token = word_token(word);
        if token.is_empty() {
            continue;
        }

        let speaker_id = deepgram_speaker_id(word.speaker);
        let speaker_label = deepgram_speaker_label(word.speaker);
        builder.push(
            speaker_id.as_deref(),
            speaker_label.as_deref(),
            word.speaker_confidence,
            &token,
            seconds_to_ms(word.start),
            seconds_to_ms(word.end),
        );
    }
    builder.flush()
}

fn join_word_tokens(words: &[DeepgramWord]) -> String {
    words
        .iter()
        .map(word_token)
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn word_token(word: &DeepgramWord) -> String {
    word.punctuated_word
        .as_deref()
        .unwrap_or(word.word.as_str())
        .trim()
        .to_string()
}

fn deepgram_speaker_id(speaker: Option<usize>) -> Option<String> {
    speaker.map(|value| format!("dg:{value}"))
}

fn deepgram_speaker_label(speaker: Option<usize>) -> Option<String> {
    speaker.map(|value| format!("Speaker {}", value + 1))
}

fn seconds_to_ms(value: Option<f64>) -> Option<i64> {
    let value = value?;
    if value.is_finite() && value >= 0.0 {
        Some((value * 1_000.0).round() as i64)
    } else {
        None
    }
}

fn end_ms_from_duration(start: Option<f64>, duration: Option<f64>) -> Option<i64> {
    match (start, duration) {
        (Some(start), Some(duration)) if start.is_finite() && duration.is_finite() && duration >= 0.0 => {
            Some(((start + duration) * 1_000.0).round() as i64)
        }
        (Some(start), None) => seconds_to_ms(Some(start)),
        _ => None,
    }
}

fn average_speaker_confidence(words: &[DeepgramWord]) -> Option<f64> {
    let (sum, count) = words.iter().fold((0.0_f64, 0_u32), |(sum, count), word| {
        match word.speaker_confidence {
            Some(confidence) if confidence.is_finite() => (sum + confidence, count + 1),
            _ => (sum, count),
        }
    });

    if count == 0 {
        None
    } else {
        Some(sum / count as f64)
    }
}

#[derive(Debug)]
struct NativeCaptureHandle(*mut c_void);

unsafe impl Send for NativeCaptureHandle {}

impl NativeCaptureHandle {
    fn stop(self) {
        native_stop_capture(self.0);
    }
}

#[cfg(target_os = "macos")]
#[allow(improper_ctypes)]
extern "C" {
    fn tpm_get_screen_recording_permission_status() -> c_int;
    fn tpm_request_screen_recording_permission() -> c_int;
    fn tpm_get_microphone_permission_status() -> c_int;
    fn tpm_list_system_audio_sources(
        excluded_bundle_id: *const c_char,
        error_out: *mut *mut c_char,
    ) -> *mut c_char;
    fn tpm_start_system_audio_capture(
        source_kind: *const c_char,
        source_id: u32,
        audio_callback: extern "C" fn(*const f32, usize, u32, u32, f64, *mut c_void),
        event_callback: extern "C" fn(c_int, *const c_char, *mut c_void),
        user_data: *mut c_void,
        error_out: *mut *mut c_char,
    ) -> *mut c_void;
    fn tpm_stop_system_audio_capture(handle: *mut c_void);
    fn tpm_free_string(value: *mut c_char);
}

fn screen_recording_status() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    unsafe {
        decode_permission_status(tpm_get_screen_recording_permission_status())
    }

    #[cfg(not(target_os = "macos"))]
    {
        PermissionStatus::Restricted
    }
}

pub fn microphone_permission_status() -> &'static str {
    #[cfg(target_os = "macos")]
    unsafe {
        return decode_permission_status(tpm_get_microphone_permission_status()).as_str();
    }

    #[cfg(not(target_os = "macos"))]
    {
        "restricted"
    }
}

pub fn screen_recording_permission_status() -> &'static str {
    screen_recording_status().as_str()
}

fn ensure_screen_recording_access() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    unsafe {
        let status = decode_permission_status(tpm_get_screen_recording_permission_status());
        if status == PermissionStatus::Granted {
            return status;
        }
        decode_permission_status(tpm_request_screen_recording_permission())
    }

    #[cfg(not(target_os = "macos"))]
    {
        PermissionStatus::Restricted
    }
}

fn decode_permission_status(value: c_int) -> PermissionStatus {
    match value {
        1 => PermissionStatus::Granted,
        2 => PermissionStatus::Denied,
        3 => PermissionStatus::Restricted,
        _ => PermissionStatus::Unknown,
    }
}

fn native_list_sources(excluded_bundle_id: &str) -> Result<Vec<SystemAudioSource>, AudioError> {
    #[cfg(target_os = "macos")]
    unsafe {
        let mut error_out: *mut c_char = std::ptr::null_mut();
        let excluded_bundle_id = CString::new(excluded_bundle_id)
            .map_err(|error| AudioError::Native(error.to_string()))?;
        let raw = tpm_list_system_audio_sources(excluded_bundle_id.as_ptr(), &mut error_out);
        if !error_out.is_null() {
            let message = c_string_to_string(error_out);
            tpm_free_string(error_out);
            return Err(AudioError::Native(message));
        }
        if raw.is_null() {
            return Ok(Vec::new());
        }
        let json = c_string_to_string(raw);
        tpm_free_string(raw);
        serde_json::from_str(&json).map_err(|error| AudioError::Native(error.to_string()))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = excluded_bundle_id;
        Err(AudioError::Unsupported)
    }
}

fn native_start_capture(
    source_id: &str,
    source_kind: SystemAudioSourceKind,
    callback_context: &NativeCallbackContext,
) -> Result<NativeCaptureHandle, AudioError> {
    #[cfg(target_os = "macos")]
    unsafe {
        let mut error_out: *mut c_char = std::ptr::null_mut();
        let kind = CString::new(match source_kind {
            SystemAudioSourceKind::Window => "window",
            SystemAudioSourceKind::Display => "display",
        })
        .map_err(|error| AudioError::InvalidInput(error.to_string()))?;
        let source_id = source_id
            .parse::<u32>()
            .map_err(|error| AudioError::InvalidInput(error.to_string()))?;
        let raw_handle = tpm_start_system_audio_capture(
            kind.as_ptr(),
            source_id,
            native_audio_callback,
            native_event_callback,
            callback_context as *const NativeCallbackContext as *mut c_void,
            &mut error_out,
        );
        if !error_out.is_null() {
            let message = c_string_to_string(error_out);
            tpm_free_string(error_out);
            return Err(AudioError::Native(message));
        }
        if raw_handle.is_null() {
            return Err(AudioError::Native(
                "Native ScreenCaptureKit stream failed to initialize.".to_string(),
            ));
        }
        Ok(NativeCaptureHandle(raw_handle))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (source_id, source_kind, callback_context);
        Err(AudioError::Unsupported)
    }
}

fn native_stop_capture(handle: *mut c_void) {
    #[cfg(target_os = "macos")]
    unsafe {
        if !handle.is_null() {
            tpm_stop_system_audio_capture(handle);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = handle;
    }
}

fn c_string_to_string(raw: *const c_char) -> String {
    unsafe { CStr::from_ptr(raw).to_string_lossy().into_owned() }
}

extern "C" fn native_audio_callback(
    samples: *const f32,
    frame_count: usize,
    sample_rate: u32,
    channels: u32,
    _pts_ms: f64,
    user_data: *mut c_void,
) {
    if samples.is_null() || frame_count == 0 || channels == 0 || user_data.is_null() {
        return;
    }

    let context = unsafe { &*(user_data as *const NativeCallbackContext) };
    let sample_count = frame_count.saturating_mul(channels as usize);
    let input = unsafe { std::slice::from_raw_parts(samples, sample_count) };
    let chunk = {
        let mut normalizer = context
            .normalizer
            .lock()
            .expect("native audio callback mutex poisoned");
        normalizer.process_interleaved_f32(input, sample_rate, channels)
    };

    let Some(chunk) = chunk else {
        return;
    };

    match context.audio_tx.try_send(chunk) {
        Ok(()) => {
            context.queue_depth.fetch_add(1, Ordering::SeqCst);
            let mut overflow = context.overflow.lock().expect("overflow mutex poisoned");
            overflow.started_at = None;
            overflow.restarted = false;
            overflow.failed = false;
        }
        Err(_) => {
            let dropped = context.dropped_frames.fetch_add(1, Ordering::SeqCst) + 1;
            let queue_depth = context.queue_depth.load(Ordering::SeqCst);
            context.service.emit_health(
                &context.app,
                CaptureHealthPayload {
                    session_id: Some(context.session_id.clone()),
                    severity: "warning".to_string(),
                    dropped_frames: dropped,
                    queue_depth,
                    reconnect_attempt: context.reconnect_attempt.load(Ordering::SeqCst) as u32,
                    message:
                        "Audio capture backlog is full. TPMCluely dropped the newest audio frame."
                            .to_string(),
                },
            );

            let mut overflow = context.overflow.lock().expect("overflow mutex poisoned");
            let now = Instant::now();
            if overflow.started_at.is_none() {
                overflow.started_at = Some(now);
            }
            if let Some(started_at) = overflow.started_at {
                let elapsed = now.saturating_duration_since(started_at);
                if elapsed >= Duration::from_secs(5) && !overflow.restarted {
                    overflow.restarted = true;
                    let _ = context.control_tx.send(ControlMessage::RestartDeepgram);
                } else if elapsed >= Duration::from_secs(10)
                    && overflow.restarted
                    && !overflow.failed
                {
                    overflow.failed = true;
                    let _ = context.control_tx.send(ControlMessage::NativeError(
                        "Audio capture remained overloaded after a reconnect. Switch TPMCluely to microphone capture."
                            .to_string(),
                    ));
                }
            }
        }
    }
}

extern "C" fn native_event_callback(
    event_type: c_int,
    message: *const c_char,
    user_data: *mut c_void,
) {
    if user_data.is_null() {
        return;
    }
    let context = unsafe { &*(user_data as *const NativeCallbackContext) };
    let message = if message.is_null() {
        "System audio capture stopped.".to_string()
    } else {
        c_string_to_string(message)
    };

    match event_type {
        2 => {
            let _ = context
                .control_tx
                .send(ControlMessage::NativeStopped(message));
        }
        3 => {
            let _ = context
                .control_tx
                .send(ControlMessage::NativeError(message));
        }
        4 => {
            let _ = context
                .control_tx
                .send(ControlMessage::NativeError(message));
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::{
        screen_recording_permission_status, CaptureRuntimeState, CaptureStatePayload,
        SystemAudioSourceKind,
    };

    #[test]
    fn idle_capture_state_defaults_to_manual() {
        let state = CaptureStatePayload::idle();
        assert_eq!(state.runtime_state, CaptureRuntimeState::Idle);
        assert_eq!(state.capture_mode, "manual");
    }

    #[test]
    fn permission_snapshot_is_valid_enum_value() {
        let status = screen_recording_permission_status();
        assert!(matches!(
            status,
            "unknown" | "granted" | "denied" | "restricted"
        ));
    }

    #[test]
    fn source_kind_serializes_in_snake_case() {
        let serialized = serde_json::to_string(&SystemAudioSourceKind::Window)
            .expect("source kind should serialize");
        assert_eq!(serialized, "\"window\"");
    }
}
