# Cluely Desktop Application - Implementation Plan

A Tauri 2 desktop app for macOS that aims to match the current single-user Cluely experience as closely as possible, while adding a first-class transcript-to-Linear ticket generation workflow.

---

## Product Target

### What we are building

The app should feel like a Cluely-style meeting copilot, not a generic floating chatbot:

- A live session widget that is present only when the user is in an active session
- Real-time transcript capture and live AI assistance during the session
- Post-session transcript, notes, next steps, and searchable history in a dashboard
- Screenshot-assisted question answering and contextual help during a meeting
- Custom prompts, custom files/knowledge, custom keybinds, and language controls
- Optional pre-call brief generation for upcoming meetings
- Ticket generation from transcript/history, with one-click and bulk push to Linear

### Functional parity target

The v1 parity target is the current public Cluely single-user workflow:

- Manual or alert-driven session start
- Session-only widget with hide/show and minimal UI footprint
- Live transcript and ask-anything assistant
- Dashboard transcript history and transcript-centric session review
- AI-generated notes, follow-up content, and action extraction
- Screenshot/context capture for "what is on my screen?" style help
- Custom prompts and user-provided reference files
- Custom keybinds, output language controls, and audio language controls
- Pre-call meeting brief generation as a later parity phase
- No raw audio persistence; transcript is the primary durable artifact

### Additional feature beyond Cluely parity

- Transcript-to-ticket pipeline with normalization, deduplication, idempotent Linear pushes, and dashboard/session quick actions

### Explicit non-goals for initial release

- Windows support
- Multi-user org admin features
- Remote/cloud transcript storage by default
- Continuous screen recording or saved video capture
- Guaranteed invisibility on every macOS capture tool and OS version

---

## Product Principles

1. Session-first, dashboard-second
   The live widget should exist only around an active session. The dashboard is where transcripts, notes, tickets, prompts, and settings live.

2. Transcript-first persistence
   The source of truth is transcript segments, derived summaries, session artifacts, and user actions. We do not persist raw meeting audio.

3. Best-effort stealth, truthful UX
   We will optimize for unobtrusive behavior, but the app must never claim it is invisible in cases where macOS does not allow that guarantee.

4. Local-first by default
   Session history, prompts, and files stay local unless the user explicitly exports, shares, or pushes to an external provider.

5. Provider abstraction
   LLM, STT, and downstream integrations must be wrapped behind interfaces so we can change providers without rewiring the app.

6. Reliability before polish
   Permission handling, reconnection, transcript integrity, and post-session correctness matter more than visual polish in early phases.

---

## Decisions (Finalized)

| Area | Decision |
|------|----------|
| Platform | macOS only, 13+ |
| Desktop stack | Tauri 2 + Rust backend + React frontend |
| UI styling | Tailwind CSS 4 |
| Local storage | SQLite + FTS5 |
| Secrets storage | macOS Keychain for API keys and tokens |
| Transcript persistence | Final transcript segments persisted; no raw audio saved |
| Live STT | Provider adapter, initial implementation: Deepgram streaming |
| LLM | Provider adapter, initial implementation: Gemini |
| Ticket generation | Preserve behavioral parity with current `ticket-generator` safeguards before adding new ticket features |
| Window strategy | Session widget + dashboard + settings/onboarding windows |
| Screenshot strategy | Explicit on-demand capture only; no continuous screen recording |
| Release security | Signed, hardened runtime, notarized builds required before external testing |

### Important platform truth

Best-effort stealth is possible, but 100% invisibility is not guaranteed on all macOS versions and screen sharing/recording tools. Acceptance criteria must be phrased as tool-specific observed behavior, not absolute promises.

---

## Foundation Layer

This section is the minimum engineering substrate we need before feature work can safely scale.

### 1. User journeys to anchor the build

#### Journey A - start and run a session

1. User starts a session manually, from tray, or from a meeting alert
2. Session widget appears
3. App verifies permissions and capture health
4. Transcript begins streaming into the widget and the local transcript store
5. User asks questions, requests summaries, or captures a screenshot
6. App maintains rolling context without resending the full transcript every time

#### Journey B - end a session and review it

1. User ends the session
2. App finalizes transcript, summary, decisions, action items, and optional follow-up email draft
3. Dashboard shows the completed session with transcript, notes, and artifacts
4. User can search, export, or generate tickets from the session

#### Journey C - generate and push tickets

1. User generates tickets from a session transcript or transcript slice
2. App condenses transcript safely if needed
3. LLM returns normalized candidate tickets
4. App repairs/validates/deduplicates the output
5. User pushes one or many tickets to Linear
6. Idempotency prevents duplicate issue creation

#### Journey D - customize assistant behavior

1. User adds prompts, files, keybinds, language/output preferences
2. Settings update provider configuration and runtime behavior without corrupting session data

### 2. Session state model

Every workflow should conform to an explicit session state machine:

`idle -> preparing -> active -> paused -> finishing -> completed`

Additional failure states:

- `permission_blocked`
- `capture_error`
- `provider_degraded`
- `finalization_failed`

This state machine must drive UI visibility, command availability, telemetry, and recovery behavior.

### 3. Permission and platform prerequisites

The app must include first-run and retryable flows for:

- Screen Recording permission
- Microphone permission if we choose to support mic input later
- Accessibility permission only if needed for keybind/window behavior beyond Tauri defaults
- Secure onboarding copy that explains exactly why each permission is needed
- Detection of denied vs restricted vs missing permission state
- Deep links or instructions to System Settings when permission changes require user action

Release engineering prerequisites:

- Developer ID signing
- Hardened runtime
- Notarization
- Entitlements reviewed against ScreenCaptureKit and Tauri plugins
- A release checklist that includes permission prompts on a clean machine

### 4. Secrets and data handling

Rules:

- API keys and integration tokens live in macOS Keychain, not SQLite
- SQLite stores non-secret application data only
- Raw audio is never persisted
- On-demand screenshots are stored only when explicitly attached or when the user chooses to preserve them
- Ephemeral screenshot captures used for a single request should be deleted after processing
- Exports and share links are explicit user actions
- Session deletion must remove transcripts, artifacts, and ticket generation outputs for that session

### 5. Provider abstraction contracts

Create interfaces before feature code:

- `SpeechToTextProvider`
  - `start_stream(session_id, config)`
  - `push_audio(chunk)`
  - `stop_stream()`
  - emits partial/final transcript events and health events

- `LlmProvider`
  - `stream_chat(request)`
  - `generate_structured(request)`
  - `analyze_image(request)`
  - emits chunk, completion, usage, and failure events

- `TicketProvider`
  - wraps structured generation plus normalization/repair pipeline

- `LinearProvider`
  - `create_issue(input)`
  - `create_issues_bulk(inputs)`
  - supports retry, timeout, and idempotency

All provider adapters must surface:

- timeout category
- retryable vs non-retryable failures
- response latency
- token/usage metadata where available

### 6. Transcript context strategy

We should not prepend the entire live transcript to every user message. Instead:

- Persist transcript in ordered segments
- Maintain a rolling context window for the active session
- Generate background summary snapshots after configurable transcript milestones
- Feed the model:
  - latest transcript slice
  - rolling summary snapshot
  - current user prompt
  - optional screenshot/file context
  - active system prompt

This reduces cost and latency while keeping context grounded.

### 7. Search and indexing strategy

Search is a product requirement, so it must be designed up front:

- Use SQLite FTS5 over transcript segments, session titles, summaries, decisions, and notes
- Maintain an indexed search document per session
- Support transcript hit navigation back to exact segment timestamps/order
- Keep search rebuild scripts available for schema migrations

### 8. Quality gates that block downstream work

No later phase should proceed until these are true:

- Clean project scaffold builds on a fresh machine
- Permissions can be requested, denied, retried, and recovered
- A single transcript segment pipeline exists from capture to persistence to UI
- Transcript search works on seeded data
- Secrets are stored in Keychain and can be rotated
- Automated tests exist for core schema and provider adapters
- Release signing/notarization path is documented and exercised at least once

---

## Revised Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│                      React Frontend                           │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Session      │  │ Dashboard    │  │ Onboarding/Settings │  │
│  │ Widget       │  │              │  │                     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘  │
│         └─────────────────┴─────────────────────┘             │
│                         Tauri IPC                              │
└────────────────────────────┬──────────────────────────────────┘
                             │
┌────────────────────────────┴──────────────────────────────────┐
│                         Rust Backend                           │
│                                                                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Session     │  │ Permissions  │  │ Window/Tray/Hotkeys  │   │
│  │ Engine      │  │ + Onboarding │  │                      │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                     │               │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────────┴───────────┐   │
│  │ Audio       │  │ Screenshot   │  │ Provider Adapters    │   │
│  │ Capture     │  │ Capture      │  │ STT / LLM / Linear   │   │
│  └──────┬──────┘  └──────────────┘  └──────────┬───────────┘   │
│         │                                      │               │
│  ┌──────┴───────────┐  ┌──────────────────────┴─────────────┐  │
│  │ Transcript +     │  │ Ticket Engine + Post-Session Jobs  │  │
│  │ Context Engine   │  │ summaries, notes, next steps       │  │
│  └──────┬───────────┘  └──────────────────────┬─────────────┘  │
│         │                                      │               │
│  ┌──────┴───────────┐  ┌──────────────────────┴─────────────┐  │
│  │ SQLite + FTS5    │  │ Keychain + File Storage + Exports  │  │
│  └──────────────────┘  └────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## Suggested Project Structure

```text
cluely-app/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── app/
│       │   ├── commands.rs
│       │   ├── state.rs
│       │   └── events.rs
│       ├── session/
│       │   ├── mod.rs
│       │   ├── manager.rs
│       │   ├── state_machine.rs
│       │   └── finalizer.rs
│       ├── permissions/
│       │   ├── mod.rs
│       │   └── macos.rs
│       ├── audio/
│       │   ├── mod.rs
│       │   ├── capture.rs
│       │   └── buffering.rs
│       ├── transcript/
│       │   ├── mod.rs
│       │   ├── store.rs
│       │   ├── summarizer.rs
│       │   └── search.rs
│       ├── screenshot/
│       │   ├── mod.rs
│       │   └── selection.rs
│       ├── providers/
│       │   ├── mod.rs
│       │   ├── llm.rs
│       │   ├── stt.rs
│       │   ├── gemini.rs
│       │   ├── deepgram.rs
│       │   └── linear.rs
│       ├── prompts/
│       │   └── mod.rs
│       ├── knowledge/
│       │   ├── mod.rs
│       │   └── ingest.rs
│       ├── tickets/
│       │   ├── mod.rs
│       │   ├── generate.rs
│       │   ├── normalize.rs
│       │   ├── idempotency.rs
│       │   └── linear_push.rs
│       ├── db/
│       │   ├── mod.rs
│       │   ├── migrations.rs
│       │   ├── sessions.rs
│       │   ├── transcripts.rs
│       │   ├── messages.rs
│       │   ├── prompts.rs
│       │   ├── artifacts.rs
│       │   ├── tickets.rs
│       │   └── search.rs
│       ├── secrets/
│       │   └── mod.rs
│       ├── exports/
│       │   └── mod.rs
│       └── window/
│           └── mod.rs
├── src/
│   ├── App.tsx
│   ├── onboarding/
│   │   ├── OnboardingApp.tsx
│   │   └── PermissionChecklist.tsx
│   ├── session/
│   │   ├── SessionWidget.tsx
│   │   ├── TranscriptPanel.tsx
│   │   ├── AskBar.tsx
│   │   ├── DynamicActions.tsx
│   │   └── SessionControls.tsx
│   ├── dashboard/
│   │   ├── DashboardApp.tsx
│   │   ├── SessionsList.tsx
│   │   ├── SessionDetail.tsx
│   │   ├── TranscriptView.tsx
│   │   ├── NotesView.tsx
│   │   ├── TicketDashboard.tsx
│   │   ├── PromptLibrary.tsx
│   │   ├── FileLibrary.tsx
│   │   ├── PreCallBriefs.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── TicketCard.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── SearchBar.tsx
│   │   └── EmptyState.tsx
│   └── lib/
│       ├── tauri.ts
│       ├── types.ts
│       └── session-state.ts
└── docs/
    ├── release-checklist.md
    ├── permissions-matrix.md
    └── provider-parity.md
```

---

## Data Model

The original schema is not sufficient for a transcript-first, session-driven product. We need an explicit session model and searchable transcript store.

### Core tables

```sql
CREATE TABLE sessions (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (
    status IN (
      'idle',
      'preparing',
      'active',
      'paused',
      'finishing',
      'completed',
      'permission_blocked',
      'capture_error',
      'provider_degraded',
      'finalization_failed'
    )
  ),
  started_at            TEXT,
  ended_at              TEXT,
  source                TEXT NOT NULL DEFAULT 'manual',
  output_language       TEXT NOT NULL DEFAULT 'en',
  audio_language        TEXT NOT NULL DEFAULT 'auto',
  active_prompt_id      TEXT,
  rolling_summary       TEXT,
  final_summary         TEXT,
  decisions_md          TEXT,
  action_items_md       TEXT,
  follow_up_email_md    TEXT,
  notes_md              TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transcript_segments (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence_no           INTEGER NOT NULL,
  speaker_label         TEXT,
  speaker_confidence    REAL,
  start_ms              INTEGER,
  end_ms                INTEGER,
  text                  TEXT NOT NULL,
  is_final              INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_transcript_session_sequence
  ON transcript_segments(session_id, sequence_no);

CREATE TABLE chat_messages (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role                  TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content               TEXT NOT NULL,
  context_snapshot      TEXT,
  attachments_json      TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE session_artifacts (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (
    kind IN ('screenshot', 'attachment', 'export', 'brief', 'note', 'ticket_batch')
  ),
  storage_path          TEXT,
  mime_type             TEXT,
  sha256                TEXT,
  metadata_json         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE system_prompts (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  content               TEXT NOT NULL,
  is_default            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE knowledge_files (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  storage_path          TEXT NOT NULL,
  mime_type             TEXT NOT NULL,
  sha256                TEXT NOT NULL,
  extracted_text_path   TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE generated_tickets (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  acceptance_criteria   TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('Bug', 'Feature', 'Task')),
  idempotency_key       TEXT NOT NULL,
  linear_issue_id       TEXT,
  linear_issue_key      TEXT,
  linear_issue_url      TEXT,
  pushed_at             TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_generated_tickets_idempotency
  ON generated_tickets(idempotency_key);

CREATE TABLE settings (
  key                   TEXT PRIMARY KEY,
  value                 TEXT NOT NULL
);

CREATE VIRTUAL TABLE session_search USING fts5(
  session_id UNINDEXED,
  title,
  rolling_summary,
  final_summary,
  decisions_md,
  action_items_md,
  notes_md,
  transcript_text
);
```

### Default settings

```sql
INSERT INTO settings (key, value) VALUES
  ('theme', 'system'),
  ('session_widget_enabled', 'true'),
  ('always_on_top', 'true'),
  ('dock_icon', 'true'),
  ('launch_at_login', 'false'),
  ('output_language', 'en'),
  ('audio_language', 'auto'),
  ('live_summary_enabled', 'true'),
  ('screenshot_mode', 'selection'),
  ('screenshot_processing', 'manual'),
  ('ticket_generation_enabled', 'true');
```

### Why this model is stronger

- Sessions are first-class, so live and post-session behavior share the same data model
- Transcript segments are durable and searchable
- Chat is attached to a session instead of standing alone
- Notes, summaries, screenshots, and ticket batches are explicit artifacts
- Ticket generation is modeled as a normal product capability, not an afterthought

---

## Ticket Generation Parity Requirements

The existing `ticket-generator` folder is the behavioral spec for ticket generation. Phase 8 is not complete until we preserve these safeguards:

- input validation for transcript and Linear payloads
- transcript hard limits and deterministic condensation
- strict JSON extraction and repair
- ticket normalization, truncation, and deduplication
- deterministic ticket idempotency keys
- retry and timeout behavior for Gemini and Linear calls
- idempotent issue creation
- tests that prove parity with the current implementation

The route files alone are not enough. We must port the underlying safety logic, or define fixture-based parity tests before rewriting it.

---

## Delivery Strategy

### Build order philosophy

We will build in this order:

1. Foundation and platform risk burn-down
2. Session shell and transcript pipeline
3. Live assistant and derived notes
4. Dashboard/history/search
5. Screenshot/context features
6. Customization and pre-call parity
7. Ticket generation
8. Hardening, release, and polish

### Why the order changed

- Persistence and search are foundational, not late-phase polish
- Permissions/signing are product blockers, not release-week chores
- Ticket generation depends on transcript quality and session finalization quality
- Provider abstraction must exist before feature code multiplies integration debt

---

## Phase 0: Foundation and Risk Burn-Down

**Goal**: Prove the app can safely exist on macOS before feature velocity begins.

### Backend work

- Initialize Tauri 2 project structure with session, provider, permission, and storage modules
- Implement SQLite bootstrap, migration runner, WAL mode, and FTS5 enablement
- Implement Keychain-based secret storage
- Add typed provider interfaces for STT, LLM, Linear
- Add session state machine
- Add permission inspection APIs and onboarding state
- Add structured logging and health event bus

### Frontend work

- Onboarding window for permissions, provider setup, and diagnostics
- Settings shell with provider status and secret management
- Session/dashboard routing scaffold

### Exit criteria

- App launches on a clean machine
- DB migrations run automatically
- Secrets can be saved/read/rotated from Keychain
- Permission states are visible in UI
- Signed development build path is documented
- Unit tests exist for migrations, settings, and session state machine

---

## Phase 1: Session Shell and Widget

**Goal**: Establish the Cluely-style live session entry point and control surface.

### Backend work

- System tray with `Start Session`, `Open Dashboard`, `Open Settings`, `Quit`
- Global shortcuts for session toggle and screenshot capture
- Window manager for session widget behavior, docking, hide/show, focus rules, and best-effort content protection
- Session lifecycle commands: create, start, pause, resume, stop, finalize

### Frontend work

- Session widget with compact and expanded modes
- Transcript placeholder area, ask bar, dynamic action area, session controls
- Empty/error states for missing permissions and degraded providers

### Exit criteria

- User can start, pause, resume, and end a session
- Widget only appears for active/preparing/paused sessions
- Shortcut behavior works reliably
- Tool-specific capture visibility matrix is documented instead of claiming universal invisibility

---

## Phase 2: Audio Capture and Streaming Transcription

**Goal**: Turn system audio into reliable live transcript segments.

### Backend work

- ScreenCaptureKit audio capture with explicit buffering and backpressure management
- STT provider adapter with initial Deepgram implementation
- Partial/final transcript events mapped into ordered transcript segments
- Reconnection and degraded-state handling
- Session transcript persistence in near real time

### Frontend work

- Transcript panel with partial vs final styling
- Capture health indicator and reconnect/degraded messaging
- Toggle for active capture

### Exit criteria

- Transcript segments persist while session is active
- Provider reconnect path works without corrupting transcript ordering
- Transcript survives app window hide/show
- Transcript-only history is visible in dashboard seed view
- Integration tests cover transcript ordering and reconnect behavior

---

## Phase 3: Context Engine, Live Assistant, and Dynamic Actions

**Goal**: Deliver real in-session value without naive full-transcript prompt stuffing.

### Backend work

- Rolling context builder based on transcript slices plus summary snapshots
- LLM provider adapter with initial Gemini implementation
- Streaming assistant responses
- Background summary snapshot job every transcript milestone
- Derived actions pipeline: summarize so far, decisions, follow-ups, risks, next steps

### Frontend work

- Ask bar with streaming responses
- Quick/dynamic actions surfaced from current session state
- Message history attached to the active session

### Exit criteria

- Chat uses rolling context, not full transcript prepend
- Session messages persist against the session record
- Summaries and decision extracts can be generated repeatedly without data loss
- Automated tests cover context window assembly and fallback behavior

---

## Phase 4: Session Finalization and Dashboard Review

**Goal**: Make ending a session produce the durable dashboard experience users expect.

### Backend work

- Finalization pipeline for final summary, notes, decisions, action items, follow-up email draft
- Search document generation per session
- Export pipeline for Markdown

### Frontend work

- Dashboard sessions list
- Session detail page with transcript, notes, actions, and exports
- Search UI over session history

### Exit criteria

- Ending a session creates a complete reviewable record
- Search returns results from transcripts and summaries
- Exported Markdown includes transcript and derived notes
- Dashboard remains usable with hundreds of seeded sessions

---

## Phase 5: Screenshot and On-Screen Context

**Goal**: Support contextual help from what the user explicitly captures on screen.

### Backend work

- Full-screen and region capture
- Ephemeral screenshot path for one-off analysis
- Preserved screenshot artifact path when the user attaches it to a session
- LLM image analysis request path

### Frontend work

- Screenshot shortcut handling
- Attachment chip flow
- Auto-analyze and manual-analyze modes

### Exit criteria

- User can capture region/full screen on demand
- Ephemeral captures are deleted after one-off processing
- Preserved captures appear in the session detail view
- No continuous screen recording code path exists

---

## Phase 6: Personalization, Prompt Library, Files, and Keybinds

**Goal**: Match Cluely-like customization that affects live sessions safely.

### Backend work

- Prompt CRUD
- Knowledge file ingest and extracted-text storage
- Settings for output language, audio language, widget behavior, response length, shortcut rebinding
- Per-session prompt snapshotting so later edits do not mutate historical context

### Frontend work

- Prompt library UI
- File library UI
- Shortcut editor
- Language and output controls

### Exit criteria

- Prompt changes affect new requests only
- User files can be attached to sessions and referenced in prompts
- Shortcut rebinding is validated and persisted
- Settings changes do not corrupt active sessions

---

## Phase 7: Meeting Alerts and Pre-Call Briefs

**Goal**: Close the gap with Cluely's meeting-prep workflow.

### Backend work

- Calendar integration abstraction
- Meeting alert generation for upcoming events
- Pre-call brief artifact pipeline

### Frontend work

- Alerts/brief list in dashboard
- One-click `Start Session` from brief or meeting alert
- Brief detail view attached to a session once started

### Exit criteria

- Upcoming meeting can generate a brief
- User can launch directly into a session from the brief
- Brief becomes part of the eventual session record

### Note

If calendar integration threatens schedule, this phase can ship behind a feature flag without weakening the core session product.

---

## Phase 8: Ticket Generation and Linear Push

**Goal**: Add a first-class Cluely-plus ticket workflow on top of completed session data.

### Backend work

- Port current `ticket-generator` safeguards into the Tauri backend
- Transcript preparation with deterministic condensation and warnings
- Structured ticket generation plus repair pass
- Ticket normalization, dedupe, truncation, and idempotency key generation
- Linear provider adapter with retry, timeout, and idempotent create behavior
- Persist generated ticket batches per session

### Frontend work

- `Generate Tickets` quick action in session widget
- Ticket dashboard attached to a session
- Ticket review/edit/push flow
- `Push All` and per-ticket push

### Exit criteria

- Ticket generation works from active session and completed session views
- Pushing the same ticket twice does not create duplicate Linear issues
- Existing ticket-generator fixture behavior is matched by tests
- Warnings for condensed transcripts are visible to the user

---

## Phase 9: Hardening, Performance, and Release

**Goal**: Make the app trustworthy enough to daily-drive.

### Backend work

- Crash-safe finalization recovery
- DB vacuum/maintenance strategy
- Background job cancellation and cleanup
- Release signing, notarization, and update channel decisions

### Frontend work

- Diagnostics surface
- Health/status page for providers and permissions
- Recovery prompts for failed finalization or degraded capture

### Exit criteria

- Signed and notarized release candidate works on a clean machine
- Session finalization can recover from an interrupted app restart
- Search performance and transcript rendering remain acceptable on seeded data
- No high-severity open issues in the release checklist

---

## Cross-Cutting Engineering Requirements

### Security

- Secrets in Keychain only
- Sanitized logs with no transcript leakage in error paths by default
- Explicit user consent for every external push or export

### Observability

- Structured logs per session
- Provider latency metrics
- Capture health metrics
- Finalization success/failure counters

### Performance targets

- Session widget open/restore under 150 ms on warm path
- Partial transcript visible within 800 ms of speech under normal network conditions
- Finalized transcript segments within 2 seconds of provider final event
- Search results for 1,000 seeded sessions under 100 ms on warm DB

### Test strategy

- Rust unit tests for migrations, state machine, transcript assembly, ticket normalization
- Integration tests for provider adapters using fixtures/mocks
- Frontend tests for widget state and dashboard rendering
- Manual matrix:
  - macOS 13, 14, 15
  - permission first-run
  - denied permission recovery
  - screen recording tools and meeting tools
  - online/offline/degraded provider behavior

---

## Phase Dependencies

```text
Phase 0 Foundation
  └── Phase 1 Session Shell
        └── Phase 2 Audio + Transcript
              └── Phase 3 Context + Live Assistant
                    ├── Phase 4 Finalization + Dashboard
                    │     ├── Phase 5 Screenshot Context
                    │     ├── Phase 6 Personalization
                    │     ├── Phase 7 Alerts + Pre-Call Briefs
                    │     └── Phase 8 Ticket Generation
                    └── Phase 9 Hardening + Release
```

Important rule:

- No phase can claim completion without its automated exit criteria and manual platform checks.

---

## First Milestone Recommendation

Before we implement the entire product, we should complete a narrow milestone that derisks the architecture:

1. Phase 0 completely
2. Session widget from Phase 1
3. Transcript persistence from Phase 2
4. Rolling summary plus one dynamic action from Phase 3
5. Dashboard session detail from Phase 4

If that milestone feels solid, the rest of the roadmap becomes much safer.

---

## Summary of What Changed From the Original Plan

- Sessions are now the center of the product model
- Persistence, search, and permissions moved earlier
- Secrets moved from SQLite to Keychain
- Transcript context is now rolling and summarized, not blindly prepended
- Ticket generation now explicitly preserves the tested safeguards in `ticket-generator`
- Pre-call briefs and meeting alerts were added for closer Cluely parity
- Release engineering and platform truth are now first-class requirements
