# TPMCluely

TPMCluely is a macOS Tauri desktop app for live meeting assistance. It captures transcript signal during a meeting, answers transcript-grounded questions, runs meeting-specific assistant actions, and turns completed sessions into review-first Linear ticket drafts.

The current product focus is the in-meeting workflow:

- preflight and permissions
- live transcript capture
- Ask TPMCluely
- dynamic meeting actions
- session review and export
- local ticket draft generation
- explicit approval before any Linear push

Some internal package names still use the older `Cluely` label. In product and documentation terms, this repo should be treated as `TPMCluely`.

## What Is In This Repo

This repository contains two related apps:

1. The TPMCluely desktop app at the repo root
   - React frontend
   - Tauri desktop shell
   - Rust backend
   - local persistence for sessions, transcript history, assistant output, and ticket drafts
2. [`ticket-generator/`](./ticket-generator)
   - a standalone Next.js reference app for an older ticket-generation workflow
   - useful for comparison, but not required for the current desktop workflow

For the main product flow, use the desktop app at the repo root.

## Current Product Behavior

The current desktop app supports:

- `Overview` tab for desktop readiness and runtime health
- `Onboarding` tab for permissions and provider setup
- `Session` tab for meeting start, capture mode selection, preflight, overlay control, and live assistance
- `Dashboard` tab for transcript review, assistant trace review, export, and ticket approval
- `Settings` tab for capture defaults, ticket behavior, prompt management, and knowledge file management

Key workflow rules:

- session history, assistant output, and ticket drafts are stored locally
- provider secrets are stored through the backend, not in the frontend
- ticket drafts are generated locally first
- nothing is pushed to Linear automatically
- a ticket must be approved before it can be pushed

## Feature Summary

### Live Meeting Assistance

- transcript-grounded `Ask TPMCluely`
- dynamic actions:
  - `Summarize so far`
  - `What was decided?`
  - `Next steps`
  - `Follow-up questions`
- pause and resume meeting sessions
- overlay mode with a configurable global shortcut

### Capture Options

- `Microphone + Deepgram`
- `System audio (advanced)`
- `Manual only`

The app runs preflight checks for the selected capture path and may either:

- allow the mode
- warn that the mode still needs verification
- block the mode until permissions or setup issues are fixed

### Screen Context

If `Screen Context` is enabled in Settings, Ask TPMCluely and dynamic actions can use shared screen context when available.

You can also enable `Persist Screen Artifacts` if you want the exact screenshots sent to Gemini to be stored for debugging and review.

### Ticket Workflow

- completed sessions can produce local draft tickets
- drafts can be edited before push
- drafts can be approved, rejected, or moved back to draft
- only approved drafts can be pushed to Linear
- previously pushed issues are not overwritten
- the Linear integration uses idempotency and dedupe markers so repeat pushes can link existing issues instead of creating duplicates

## Requirements

For local desktop development and real usage on macOS, install:

- macOS
- Node.js 20+
- npm
- Rust toolchain
- Xcode Command Line Tools

If `npm run tauri:dev` fails because of missing native dependencies, install Rust and the macOS developer tools first.

## Installation

From the repo root:

```bash
npm install
```

## Provider Setup

The desktop app stores secrets through the Tauri backend and OS keychain-backed storage.

Do not configure the desktop app by editing `ticket-generator/.env.local`.

Open the app and go to `Onboarding`, then store:

- `Gemini API Key`
- `Deepgram API Key`
- `Linear API Key` if you want Linear push
- `Linear Team ID` if you want Linear push

Expected readiness states:

- `Gemini: Ready`
- `Deepgram: Ready`
- `Linear: Ready` when both the API key and team ID are configured

Notes:

- Gemini is used for assistant responses and ticket generation
- Deepgram is used for live transcription
- Linear is optional if you only want local draft tickets and local review

## Running The App

### Desktop Runtime

Run the real desktop app:

```bash
npm run tauri:dev
```

Use this for real feature validation, native permissions, overlay behavior, and live meeting testing.

### Production Build

Build the desktop app:

```bash
npm run tauri:build
```

### Browser Mock Runtime

Run the frontend in browser-mock mode:

```bash
VITE_ENABLE_BROWSER_MOCK=true npm run dev
```

Use this for UI development and browser-safe experimentation only.

Without `VITE_ENABLE_BROWSER_MOCK=true`, the app expects the native Tauri runtime and will fail in a plain browser tab.

## Verification Commands

From the repo root:

### Frontend build

```bash
npm run build
```

### Web tests

```bash
npm run test:web
```

### End-to-end smoke test

```bash
npm run test:e2e
```

### Rust tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

### Full desktop verification

```bash
npm run verify:desktop
```

## Daily Workflow

### 1. First-Time Setup

1. Start the app with `npm run tauri:dev`.
2. Open `Onboarding`.
3. Confirm permissions are in a usable state:
   - `Screen Recording`
   - `Microphone`
   - `Accessibility`
4. Store provider keys.
5. Confirm the provider readiness cards are ready for the integrations you plan to use.
6. Open `Settings` and review capture and ticket defaults before your first real meeting.

### 2. Start A Meeting

Open `Session` and do the following:

1. Run preflight.
2. Choose the capture mode:
   - `Microphone + Deepgram` for the safest live path
   - `System audio (advanced)` when you have already verified macOS capture behavior
   - `Manual only` when you do not want live audio capture
3. If using microphone mode, choose the preferred microphone input.
4. Start the meeting session.
5. Press the overlay shortcut if you want to work from the live overlay.

Default overlay shortcut:

```text
CmdOrCtrl+Shift+K
```

### 3. During The Meeting

From the `Session` tab or overlay, you can:

- ask a live question with `Ask TPMCluely`
- run `Summarize so far`
- run `What was decided?`
- run `Next steps`
- run `Follow-up questions`
- pause the meeting
- stop or restart listening
- share your screen for additional context when screen context is enabled
- hide the overlay without ending the meeting

TPMCluely is designed to stay grounded in the current transcript. Results are best when:

- audio is clear
- speakers are not talking over one another constantly
- enough transcript has accumulated before you ask a question
- you share screen context when the answer depends on what is visible on-screen

### 4. End The Meeting

When you click `End Meeting`, TPMCluely:

- finalizes the session
- stores the resulting notes locally
- may generate draft tickets automatically if both of these settings are enabled:
  - `Ticket Generation`
  - `Auto Generate Drafts`

If automatic generation is disabled, you can generate drafts manually from the dashboard after the session ends.

### 5. Review The Session

Open `Dashboard`, select the session, and review:

- session notes:
  - summary
  - decisions
  - action items
  - follow-up draft
- transcript
- assistant trace
- generated ticket drafts
- Linear issue links when push has succeeded

You can also click `Export Markdown` to export the session as a Markdown summary that includes:

- status
- start and end times
- summary
- decisions
- action items
- transcript

## Main Screens

### Overview

The `Overview` tab is a quick readiness view for:

- database readiness
- keychain availability
- state-machine readiness
- search and export readiness
- permission status
- native system-audio availability

### Onboarding

Use `Onboarding` to:

- review permission state
- inspect the desktop snapshot
- store Gemini, Deepgram, and Linear credentials
- confirm provider readiness

### Session

Use `Session` for the live meeting workflow:

- start a meeting
- choose the capture mode
- choose a microphone device
- run preflight
- start and stop listening
- pause and resume the meeting
- share screen context
- ask transcript-grounded questions
- run dynamic assistant actions
- watch the transcript and assistant feed update live

### Dashboard

Use `Dashboard` after or during a session to:

- search sessions
- inspect transcript evidence
- rename speaker labels
- review assistant output
- export Markdown
- generate ticket drafts
- edit ticket drafts
- approve or reject ticket drafts
- push approved drafts to Linear

### Settings

Use `Settings` to control:

- theme
- output language
- audio language
- overlay shortcut
- ticket push mode
- preferred microphone behavior
- capture and review toggles

Current Settings features include:

- `Stealth Mode`
- `Session Widget`
- `Always On Top`
- `Rolling Summary`
- `Screen Context`
- `Persist Screen Artifacts`
- `Ticket Generation`
- `Auto Generate Drafts`

The `Settings` screen also includes:

- `Prompt Library` for custom prompt templates
- `Knowledge Library` for local reference files

## Prompt And Knowledge Libraries

### Prompt Library

Prompt Library lets you:

- create and edit custom prompt templates
- mark one as active
- mark one as the default

New sessions snapshot the active prompt so the meeting keeps a stable prompt context even if the library changes later.

### Knowledge Library

Knowledge Library stores local text-based reference files inside the desktop app.

The current file picker accepts:

- `.txt`
- `.md`
- `.json`
- `.csv`
- `.log`

This is useful for keeping local notes, runbooks, or specs available in the app's settings area.

## Capture Modes

### `Microphone + Deepgram`

Recommended for most real meetings.

Use this when:

- you want the most predictable setup
- microphone permissions are available
- you have a working input device selected

### `System audio (advanced)`

Use this only after verifying it on your exact machine and meeting stack.

This mode depends more heavily on:

- macOS Screen Recording permission
- native system-audio support
- the behavior of the meeting app you are using

### `Manual only`

Use this when:

- audio capture is unavailable
- you want to keep a session without live listening
- you want to add transcript signal manually and still use the review workflow

## Ticket Review Workflow

The current ticket flow is intentionally review-first.

What happens today:

1. TPMCluely generates local draft tickets.
2. You review the drafts in `Dashboard`.
3. You edit the title, description, type, or acceptance criteria if needed.
4. You approve the drafts that should leave the desktop app.
5. You push approved drafts to Linear explicitly.

Important:

- TPMCluely does not auto-push drafts to Linear
- unapproved drafts cannot be pushed
- rejected drafts stay local
- pushed drafts keep their linked Linear issue information
- a retry may link an existing issue instead of creating a duplicate when the dedupe markers match

Settings that affect this flow:

- `Ticket Generation`
- `Auto Generate Drafts`
- `Ticket push mode`

`Ticket push mode` currently supports:

- `Review before push`
- `Manual only`

## Screen Context And Stealth Mode

### Screen Context

When `Screen Context` is enabled:

- Ask TPMCluely can use the shared screen when available
- dynamic actions can use the shared screen when available
- the assistant feed records whether screen context was used

### Persist Screen Artifacts

When `Persist Screen Artifacts` is enabled, the app stores the screenshots that were sent with assistant requests. This is useful for debugging and auditability.

### Stealth Mode

`Stealth Mode` is available from Settings for users who want the overlay hidden from screen capture, screen sharing, and recording tools while keeping it visible locally.

## Data And Secrets

### Secrets

Desktop secrets are stored through the backend using the local OS keychain-backed secret store.

That includes:

- Gemini API key
- Deepgram API key
- Linear API key
- Linear team ID

### Local Data

The desktop app stores meeting data locally, including:

- sessions
- transcript segments
- assistant messages
- generated tickets
- settings
- prompt records
- knowledge file metadata

## Architecture At A Glance

- React renders the desktop UI
- Tauri provides the desktop shell and command bridge
- Rust handles persistence, providers, export, and session orchestration
- SQLite stores local session and ticket data
- Gemini powers assistant responses and ticket generation
- Deepgram powers live speech-to-text
- Linear is used only when you explicitly push approved tickets

## Troubleshooting

### `npm run dev` does not work in a normal browser

Use:

```bash
VITE_ENABLE_BROWSER_MOCK=true npm run dev
```

The app requires the native Tauri runtime unless browser mock mode is explicitly enabled.

### No transcript appears

Check:

- your Deepgram key is stored
- microphone or Screen Recording permissions are available
- the selected capture mode passed preflight
- you actually started listening
- the selected microphone or system source is the one you expect

Fallback:

- switch to `Microphone + Deepgram`
- switch to `Manual only`

### Assistant answers are weak

Usually this means:

- the transcript is still too thin
- the audio quality is poor
- multiple people are talking at once
- the question depends on screen context that has not been shared

Try:

- waiting for more transcript
- asking a more specific question
- sharing the screen when relevant
- using a custom prompt for future sessions

### System audio mode is blocked or unreliable

Check:

- `Screen Recording` permission
- whether native system audio is available on your machine
- whether the meeting app exposes the needed audio path

If it is still unreliable, use `Microphone + Deepgram`.

### Tickets did not reach Linear

Check:

- the draft was approved first
- `Linear API Key` is stored
- `Linear Team ID` is stored
- the Linear token can create issues in that team
- you explicitly pushed the approved draft from the dashboard

Remember: drafts remain local until you approve and push them.

### Overlay shortcut does not trigger

Check:

- the configured shortcut in `Settings`
- whether another app already uses the same global shortcut

You can still use the `Session` tab directly even if the global shortcut is unavailable.

## `ticket-generator/` Notes

The standalone app in [`ticket-generator/`](./ticket-generator) is still part of the repository, but it is not the runtime configuration source for the desktop app.

In particular:

- `ticket-generator/.env.local` is for the standalone Next.js app only
- the desktop app should be configured through `Onboarding`
- if you want the older standalone workflow, read [`ticket-generator/README.md`](./ticket-generator/README.md)

## Recommended Dry Run Checklist

Before relying on TPMCluely in a real meeting:

1. Confirm Gemini and Deepgram are ready.
2. Confirm Linear is ready if you plan to push tickets.
3. Run preflight in the `Session` tab.
4. Test the exact capture mode you plan to use.
5. Verify the overlay shortcut works.
6. Run a short rehearsal meeting and confirm:
   - transcript appears
   - Ask TPMCluely responds
   - dynamic actions work
   - ending the session preserves notes
   - ticket drafts appear
   - approved drafts can be pushed to Linear when desired
