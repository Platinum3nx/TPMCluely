# Cluely Desktop Application - Execution Board

This board turns the implementation plan into an execution sequence with concrete checkpoints, file maps, validation gates, and stop conditions.

Status legend:

- `TODO` - not started
- `IN PROGRESS` - actively being built
- `BLOCKED` - waiting on a decision or failed gate
- `DONE` - shipped with all exit criteria

---

## Build Contract

### Objective

Ship a macOS-only Tauri desktop app that feels as close as possible to the current single-user Cluely experience, while adding transcript-to-Linear ticket generation as a first-class workflow.

### Current repo baseline

- Root currently contains planning docs only
- `ticket-generator/` is the live reference implementation for ticket generation behavior
- There is no Tauri scaffold yet
- We must not weaken or delete `ticket-generator/` before parity tests exist

### Concrete repo layout decision

The desktop app will be created at the repo root:

```text
/
├── src/                     # React frontend for desktop app
├── src-tauri/               # Rust backend
├── docs/                    # release, permission, and parity docs
├── fixtures/                # transcript, provider, and ticket fixtures
├── ticket-generator/        # preserved reference implementation
├── IMPLEMENTATION_PLAN.md
└── EXECUTION_BOARD.md
```

Reason:

- It keeps the new desktop app in the canonical project root
- It preserves `ticket-generator/` as a behavioral reference instead of mixing it into the runtime path
- It lets us add parity fixtures without rewriting the existing reference app

### Non-negotiable delivery rules

1. No checkpoint closes without automated verification and a manual validation path.
2. No ticket-generation porting starts until fixture-based parity coverage exists for the current TypeScript implementation.
3. No release candidate exists until signing, hardened runtime, notarization, and clean-machine permission checks are proven.
4. No feature work bypasses the session data model, transcript store, or Keychain secret layer.

---

## Parity Targets

### Must match before launch

- Session-only live widget
- Live transcript with reliable persistence
- In-session assistant with rolling transcript context
- Dashboard transcript history and searchable session review
- AI-generated session summary, notes, decisions, action items, and follow-up draft
- Screenshot-assisted context capture
- Prompt library, file library, keybinds, output language, audio language
- Best-effort stealth behavior with truthful constraints

### Should match if schedule allows

- Meeting alerts
- Pre-call briefs
- Dynamic insights/actions beyond the core quick actions

### Must exceed baseline

- Transcript-to-ticket generation from both live and completed sessions
- Deterministic ticket normalization, dedupe, repair, and idempotent Linear push

---

## Tooling Contract

By the end of Checkpoint C0, the root project must expose these commands:

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run test:web`
- `npm run test:e2e`
- `cargo test`
- `cargo fmt --check`
- `cargo clippy -- -D warnings`

These commands are part of the board contract. If a checkpoint needs a new script, the script becomes part of the checkpoint output.

---

## Board Summary

| ID | Checkpoint | Status | Depends On | Primary Outcome |
|----|------------|--------|------------|-----------------|
| C0 | Repo Bootstrap and Foundation | `TODO` | - | Root Tauri app scaffold, DB, Keychain, state machine, docs |
| C1 | Session Shell and Widget | `TODO` | C0 | Start/pause/resume/stop session with real widget lifecycle |
| C2 | Audio Capture and Transcript Pipeline | `TODO` | C1 | Ordered transcript segments persisted during live sessions |
| C3 | Rolling Context and Live Assistant | `TODO` | C2 | Streaming assistant that uses transcript slices and summaries |
| C4 | Session Finalization and Dashboard Review | `TODO` | C3 | Completed sessions produce reviewable dashboard records |
| C5 | Search, Export, and Dataset Seeding | `TODO` | C4 | Fast session search and export reliability |
| C6 | Screenshot and On-Screen Context | `TODO` | C4 | Manual and auto screenshot analysis with cleanup rules |
| C7 | Personalization, Files, and Keybinds | `TODO` | C4 | Prompt library, file library, languages, shortcuts |
| C8 | Meeting Alerts and Pre-Call Briefs | `TODO` | C7 | Optional closer Cluely parity for upcoming meetings |
| C9 | Ticket Generation Parity Port and Linear Push | `TODO` | C4, C5 | Tauri-native ticket workflow matching `ticket-generator` safeguards |
| C10 | Hardening, Release, and Clean-Machine Validation | `TODO` | C6, C7, C9 | Signed, notarized, resilient release candidate |

Critical path:

`C0 -> C1 -> C2 -> C3 -> C4 -> C5 -> C9 -> C10`

---

## Checkpoint Details

## C0 - Repo Bootstrap and Foundation

Status: `TODO`

### Outcome

Create the root desktop app scaffold and the foundation layers that every later feature must use.

### Scope

- Initialize root `package.json`, frontend app, and `src-tauri/`
- Add Rust workspace structure and app modules
- Add SQLite bootstrap, migration runner, WAL mode, and FTS5 support
- Add Keychain secret storage abstraction
- Add session state machine
- Add onboarding shell and settings shell
- Add diagnostics plumbing and structured logs
- Add `docs/release-checklist.md`, `docs/permissions-matrix.md`, and `docs/provider-parity.md`
- Add `fixtures/` directory with placeholder transcript/provider fixtures

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/package.json`
- `/Users/arjunmalghan/CluelyV/Cluely/tsconfig.json`
- `/Users/arjunmalghan/CluelyV/Cluely/vite.config.ts`
- `/Users/arjunmalghan/CluelyV/Cluely/src/App.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/lib/tauri.ts`
- `/Users/arjunmalghan/CluelyV/Cluely/src/lib/types.ts`
- `/Users/arjunmalghan/CluelyV/Cluely/src/onboarding/OnboardingApp.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/Settings.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/Cargo.toml`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/tauri.conf.json`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/main.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/lib.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/app/commands.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/app/state.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/session/state_machine.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/mod.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/migrations.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/secrets/mod.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/docs/release-checklist.md`
- `/Users/arjunmalghan/CluelyV/Cluely/docs/permissions-matrix.md`
- `/Users/arjunmalghan/CluelyV/Cluely/docs/provider-parity.md`
- `/Users/arjunmalghan/CluelyV/Cluely/fixtures/README.md`

### Verification

- `npm run build`
- `npm run lint`
- `cargo test`
- `cargo fmt --check`
- `cargo clippy -- -D warnings`

Manual validation:

- App launches
- Onboarding renders
- Settings renders
- Permission states and provider state surface in UI

### Exit gate

- Root app scaffold exists and builds
- Keychain reads/writes work
- DB migration runner works on first launch and repeat launch
- Session state machine tests pass
- No feature work starts outside the shared modules created here

### Stop if

- Keychain integration proves unreliable in Tauri on macOS
- SQLite FTS5 or migration strategy is unstable on the chosen setup
- We cannot get a reproducible root app scaffold without disrupting `ticket-generator/`

---

## C1 - Session Shell and Widget

Status: `TODO`

### Outcome

Users can start, pause, resume, and stop a session from tray or shortcut, and the session widget behaves like the product shell.

### Scope

- Tray menu
- Global shortcut registration
- Session widget lifecycle
- Compact vs expanded widget state
- Best-effort content protection hooks
- Session lifecycle commands wired to the state machine

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/src/session/SessionWidget.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/session/SessionControls.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/lib/session-state.ts`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/window/mod.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/session/manager.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/app/events.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/app/commands.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/docs/permissions-matrix.md`

### Verification

- `cargo test session`
- `npm run test:web -- session-widget`

Manual validation:

- `Start Session` opens widget
- `Pause` and `Resume` change state without recreating the session
- `Stop Session` moves to finishing/completed path
- Shortcut toggles the widget without losing state

### Exit gate

- Widget only exists in valid session states
- Session lifecycle emits consistent state events to frontend
- Capture visibility matrix is documented by tool and macOS version

### Stop if

- Widget behavior depends on ad hoc frontend state instead of the backend state machine
- Shortcut behavior is flaky across app focus changes

---

## C2 - Audio Capture and Transcript Pipeline

Status: `TODO`

### Outcome

System audio becomes ordered, persisted transcript segments in a live session.

### Scope

- ScreenCaptureKit audio capture
- Buffering and backpressure control
- Deepgram streaming provider adapter
- Partial and final transcript events
- Transcript segment persistence with strict ordering
- Capture health and degraded mode

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/src/session/TranscriptPanel.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/audio/mod.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/audio/capture.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/audio/buffering.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/providers/stt.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/providers/deepgram.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/transcript/store.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/transcripts.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/fixtures/transcripts/live-session-basic.txt`
- `/Users/arjunmalghan/CluelyV/Cluely/fixtures/providers/deepgram_partial_final.json`

### Verification

- `cargo test transcript`
- `cargo test deepgram`

Manual validation:

- Start session
- Play meeting audio
- Observe partial and final transcript updates
- Hide/show widget and verify transcript continuity
- Simulate disconnect and verify degraded state plus reconnect

### Exit gate

- Transcript segments are persisted while the session is active
- Segment ordering survives reconnects
- Final segments are durable across app restart if session was active

### Stop if

- Partial/final events overwrite each other incorrectly
- Reconnect logic causes duplicate or out-of-order segment writes

---

## C3 - Rolling Context and Live Assistant

Status: `TODO`

### Outcome

The session widget supports live questions, streaming answers, and dynamic actions without stuffing the entire transcript into every request.

### Scope

- Gemini LLM adapter behind `LlmProvider`
- Rolling context builder
- Summary snapshots at transcript milestones
- Live ask bar
- Dynamic actions:
  - summarize so far
  - what was decided
  - next steps
  - follow-up draft

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/src/session/AskBar.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/session/DynamicActions.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/components/MessageBubble.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/providers/llm.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/providers/gemini.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/transcript/summarizer.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/messages.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/session/finalizer.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/fixtures/transcripts/long-session-condensed.txt`

### Verification

- `cargo test context`
- `cargo test summarizer`
- `npm run test:web -- ask-bar`

Manual validation:

- Ask a question during a session
- Observe streaming response
- Trigger at least two dynamic actions
- Verify conversation history persists against the current session

### Exit gate

- Requests use transcript slices plus summary snapshots
- Message history persists
- Summary snapshots are reusable and do not corrupt the transcript store

### Stop if

- The assistant still depends on full transcript prepend
- Latency or token usage is unbounded for long sessions

---

## C4 - Session Finalization and Dashboard Review

Status: `TODO`

### Outcome

Ending a session produces the durable dashboard experience: transcript, summary, notes, actions, follow-up draft, and session detail.

### Scope

- Finalization pipeline
- Dashboard session list
- Session detail page
- Transcript view
- Notes and actions view
- Completed-session artifact persistence

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/DashboardApp.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/SessionsList.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/SessionDetail.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/TranscriptView.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/NotesView.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/sessions.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/artifacts.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/exports/mod.rs`

### Verification

- `cargo test finalizer`
- `npm run test:web -- dashboard`

Manual validation:

- Start and stop a session
- Open dashboard
- Review transcript, summary, decisions, actions, and follow-up draft
- Export the session as Markdown

### Exit gate

- Completed sessions remain readable after restart
- Finalization failure state is visible and recoverable
- Export includes transcript and derived artifacts

### Stop if

- Finalization is not idempotent
- Dashboard depends on ephemeral in-memory state

---

## C5 - Search, Export, and Dataset Seeding

Status: `TODO`

### Outcome

Search works over sessions at product scale and export remains stable on seeded datasets.

### Scope

- FTS5-backed session search index
- Search result navigation back to transcript segments
- Seed dataset generation for performance checks
- Search rebuild tooling for migrations

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/src/components/SearchBar.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/transcript/search.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/search.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/fixtures/transcripts/search-seed-001.txt`
- `/Users/arjunmalghan/CluelyV/Cluely/fixtures/transcripts/search-seed-002.txt`
- `/Users/arjunmalghan/CluelyV/Cluely/docs/provider-parity.md`

### Verification

- `cargo test search`
- Seed 500 to 1,000 sessions and measure query latency

Manual validation:

- Search by decision text
- Search by transcript phrase
- Jump from result to transcript location

### Exit gate

- Warm search on seeded data is within target
- Search rebuild can recover index after migration or corruption

### Stop if

- Search schema is tightly coupled to transient UI formatting
- Query times scale poorly by transcript size

---

## C6 - Screenshot and On-Screen Context

Status: `TODO`

### Outcome

Users can capture on-screen context for one-off help or attach it to a session deliberately.

### Scope

- Region and full-screen capture
- Manual attach flow
- Auto-analyze mode
- Ephemeral cleanup path
- Preserved artifact path for attached screenshots

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/screenshot/mod.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/screenshot/selection.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/artifacts.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src/session/AskBar.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/SessionDetail.tsx`

### Verification

- `cargo test screenshot`

Manual validation:

- Capture region
- Ask a question about the capture
- Verify one-off captures are cleaned up
- Verify explicitly attached captures remain visible in session detail

### Exit gate

- No continuous screen recording exists
- Screenshot lifecycle matches explicit user intent

---

## C7 - Personalization, Files, and Keybinds

Status: `TODO`

### Outcome

Users can customize the assistant and session behavior safely.

### Scope

- Prompt CRUD
- Knowledge file ingest and extracted-text storage
- Output language and audio language controls
- Custom keybinds
- Response style controls
- Per-session prompt snapshot behavior

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/PromptLibrary.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/FileLibrary.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/Settings.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/prompts/mod.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/knowledge/ingest.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/prompts.rs`

### Verification

- `cargo test prompts`
- `cargo test knowledge`
- `npm run test:web -- settings`

Manual validation:

- Add prompt
- Add file
- Rebind shortcut
- Change output language
- Start a new session and verify settings take effect without mutating old sessions

### Exit gate

- Historical sessions retain the prompt context they were created under
- Shortcut validation prevents collisions or unusable bindings

---

## C8 - Meeting Alerts and Pre-Call Briefs

Status: `TODO`

### Outcome

Add the Cluely-style prep flow without delaying the core session product.

### Scope

- Calendar integration abstraction
- Upcoming meeting detection
- Alert surfacing
- Pre-call brief generation and persistence

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/PreCallBriefs.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/session/manager.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/artifacts.rs`

### Verification

- `cargo test briefs`

Manual validation:

- Surface an upcoming meeting
- Generate brief
- Launch session from brief

### Exit gate

- Feature can be disabled behind a flag without affecting the core app

---

## C9 - Ticket Generation Parity Port and Linear Push

Status: `TODO`

### Outcome

Ship ticket generation as a native workflow while preserving all meaningful safeguards from `ticket-generator/`.

### Scope

Part A - freeze the behavioral spec

- Preserve `ticket-generator/` as reference
- Create transcript and expected-result fixtures from the current implementation
- Document behavior that must remain invariant

Part B - port the safety logic

- Transcript condensation logic
- Request validation
- JSON extraction and repair
- Ticket normalization and dedupe
- Deterministic idempotency keys
- Retry and timeout behavior
- Linear idempotent push behavior

Part C - ship the product workflow

- Generate tickets from active session
- Generate tickets from completed session
- Edit before push
- Push one or many tickets to Linear
- Persist generated tickets in the session record

### Port map from reference implementation

- `/Users/arjunmalghan/CluelyV/Cluely/ticket-generator/lib/server/transcript.ts`
  -> `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/generate.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/ticket-generator/lib/server/request-validation.ts`
  -> `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/validation.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/ticket-generator/lib/server/ticket-normalization.ts`
  -> `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/normalize.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/ticket-generator/lib/server/idempotency.ts`
  -> `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/idempotency.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/ticket-generator/lib/server/generate-tickets.ts`
  -> `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/generate.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/ticket-generator/lib/server/linear.ts`
  -> `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/providers/linear.rs`

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/TicketDashboard.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src/components/TicketCard.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/mod.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/generate.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/normalize.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/validation.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/idempotency.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/tickets/linear_push.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/src/db/tickets.rs`
- `/Users/arjunmalghan/CluelyV/Cluely/fixtures/tickets/`

### Required fixtures before the Rust port begins

- short transcript with 3 to 5 expected tickets
- oversized transcript that triggers condensation warnings
- malformed JSON model response that requires repair
- duplicate tickets that must dedupe
- duplicate push attempts that must idempotently collapse

### Verification

- Reference tests in `ticket-generator/tests/` still pass
- New Rust parity tests pass against shared fixtures
- `cargo test tickets`
- `cargo test linear`

Manual validation:

- Generate tickets from a completed session
- Generate tickets from an active session
- Push one ticket twice and confirm dedupe
- Push all tickets and confirm persistence of issue URLs

### Exit gate

- Rust implementation matches fixture-defined ticket behavior
- Duplicate Linear pushes do not create duplicate issues
- User-visible warnings surface when transcripts are condensed or output is repaired

### Stop if

- We start rewriting without parity fixtures
- The Rust workflow silently diverges from ticket count, normalization, or idempotency behavior

---

## C10 - Hardening, Release, and Clean-Machine Validation

Status: `TODO`

### Outcome

Produce a release candidate that can survive daily use on clean machines.

### Scope

- Crash-safe finalization recovery
- Permission denial and recovery flows
- Provider failure surfacing
- Signed build
- Hardened runtime
- Notarized build
- Clean-machine validation

### Files to create or touch

- `/Users/arjunmalghan/CluelyV/Cluely/docs/release-checklist.md`
- `/Users/arjunmalghan/CluelyV/Cluely/docs/permissions-matrix.md`
- `/Users/arjunmalghan/CluelyV/Cluely/src/dashboard/Settings.tsx`
- `/Users/arjunmalghan/CluelyV/Cluely/src-tauri/tauri.conf.json`

### Verification

- Full release checklist run
- Clean-machine install test
- Permission deny/recover test
- Active-session crash/restart recovery test

Manual validation:

- Install on a clean machine
- Grant and deny permissions
- Run session, finalize, restart app, verify recovery
- Push tickets after restart

### Exit gate

- Signed and notarized build installs cleanly
- No P0 or P1 defects remain open
- Release checklist is complete and archived in docs

---

## Sequencing Rules

### Work that can run in parallel

- C5 can overlap late C4 work once session finalization format is stable
- C6 and C7 can run in parallel after C4
- C8 can be delayed or feature-flagged
- C9 fixture preparation can begin during C4/C5, but the Rust port cannot start until parity fixtures are stable

### Work that must not run in parallel

- C2 and C3 should not split ownership before transcript ordering is stable
- C9 must not bypass C5 because transcript search/export/seed data usually reveal transcript-shape problems that also affect ticket generation
- C10 should not become a catch-all bug bucket; release validation begins as early as C0 docs and evolves every checkpoint

---

## First Implementation Slice

This is the recommended first build slice before broader feature work:

### Slice Alpha

Goal:

Prove the app can support a real session from creation to persisted transcript review.

Includes:

- C0 fully complete
- C1 fully complete
- C2 fully complete
- C3 partial:
  - one dynamic action only: `Summarize so far`
- C4 partial:
  - dashboard session detail for transcript plus summary only

### Demo for Slice Alpha

1. Launch app on a clean dev machine
2. Complete onboarding
3. Start session from tray
4. Capture live system audio transcript
5. Ask for a summary
6. End session
7. Open dashboard and review transcript plus summary

### Why Alpha is the right first slice

- It validates the session model
- It proves transcript persistence and review UX
- It exposes provider, permission, and state-machine problems early
- It gives us a stable foundation for screenshots, files, briefs, and tickets

---

## Risks to Track From Day 1

### R1 - macOS capture and stealth constraints

Mitigation:

- Keep a tool-by-tool visibility matrix
- Use truthful UX copy
- Test on macOS 13, 14, and 15

### R2 - Transcript ordering corruption under reconnect

Mitigation:

- Persist sequence numbers centrally
- Add reconnect fixtures early
- Block C3 until C2 ordering is stable

### R3 - Context bloat and latency

Mitigation:

- Rolling summary snapshots
- Context budgets enforced in code
- Usage metrics from the first LLM integration

### R4 - Ticket parity regression during Rust port

Mitigation:

- Preserve `ticket-generator/`
- Freeze fixtures before rewriting
- Require side-by-side parity tests

### R5 - Release-only failures from entitlements or notarization

Mitigation:

- Build release docs in C0
- Test signing and hardened runtime before feature-complete status

---

## Definition of Done

A checkpoint is only `DONE` when all of the following are true:

- Code is merged and builds cleanly
- Automated tests pass
- Manual validation path works
- Docs are updated
- Known deviations are written down explicitly
- No unresolved blocker remains for the next checkpoint

---

## Immediate Next Action

Start with C0 and treat it like a real milestone, not setup overhead. If C0 is weak, every later checkpoint inherits hidden instability.
