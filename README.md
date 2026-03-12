# TPMCluely

TPMCluely is a Tauri desktop app for an in-meeting engineering copilot workflow:

- start a meeting session
- capture transcript signal live
- ask transcript-grounded questions with `Ask TPMCluely`
- generate follow-up questions during the meeting
- end the meeting
- automatically generate engineering tickets
- push those tickets into Linear with idempotent dedupe

The goal of this repo is a fully functional TPMCluely-style product focused on the core meeting loop and ticket generation, not full parity with every legacy Cluely feature.

## Naming Note

The project name is `TPMCluely`.

Some internal package names or UI strings may still contain the legacy `Cluely` label. The current product direction and README naming should be treated as `TPMCluely`.

## What This Repo Contains

This repo has two related apps:

1. `TPMCluely` desktop app
   - Tauri + React frontend
   - Rust backend
   - local session storage
   - macOS keychain-backed secret storage
   - live transcript -> Gemini Q&A -> ticket generation -> Linear push

2. `ticket-generator/`
   - a standalone Next.js reference implementation for the older ticket-generation workflow
   - useful for comparison, but not required for the current desktop app flow

For the main product workflow, use the desktop app at the repo root.

## Core Workflow

The intended workflow is:

1. Start TPMCluely.
2. Join a meeting on your machine.
3. Press the overlay shortcut to open TPMCluely.
4. Choose a transcript source:
   - `System audio + Deepgram`
   - `Microphone + Deepgram`
   - `Manual only`
5. Click `Start Listening` in the overlay.
6. Let the meeting proceed.
7. Click `Ask TPMCluely` when the user needs a transcript-grounded answer to read aloud.
8. Click `Follow-up questions` when you want Gemini to suggest deeper questions based on unresolved discussion.
9. End the session.
10. Review generated notes and tickets in the dashboard.
11. If Linear is configured, tickets are automatically pushed to Linear once per idempotency key.

## How It Works

### High-Level Architecture

- React frontend:
  - meeting UI
  - overlay mode
  - capture controls
  - live transcript display
  - dashboard and ticket review

- Rust backend:
  - SQLite persistence for sessions, transcripts, messages, and generated tickets
  - Gemini calls for meeting answers and ticket generation
  - Linear GraphQL calls for issue creation
  - keychain-backed secret storage

- Deepgram:
  - used for live transcription
  - streamed from the frontend capture layer

### Session Lifecycle

When you open the overlay and click `Start Listening`:

- a session record is created
- the live meeting UI becomes active
- the overlay becomes the primary live control surface
- transcript segments are appended as they arrive
- rolling summary and derived notes are updated as transcript signal grows

When you ask a question:

- the app sends Gemini:
  - rolling summary
  - recent transcript snippets
  - relevant transcript matches
  - recent meeting Q&A history
- Gemini returns a concise answer grounded in the transcript

When you run a dynamic action:

- `Summarize so far` gives a concise spoken summary
- `What was decided?` extracts decisions
- `Next steps` extracts action items
- `Follow-up questions` generates grounded follow-up questions for the meeting

When you end a session:

- transcript capture stops
- final derived notes are saved
- Gemini generates engineering tickets based on the meeting content
- generated tickets are normalized and deduped
- if Linear auto-push is enabled, tickets are pushed into Linear

### Ticket Generation Rules

Ticket count is dynamic.

That means:

- a short meeting discussing one clear work item may produce one ticket
- a broader meeting may produce several tickets
- a vague meeting may produce zero tickets

The app is intentionally not hardcoded to a fixed ticket range.

## Prerequisites

For local desktop development on macOS, you should have:

- Node.js 20+
- npm
- Rust toolchain
- Xcode Command Line Tools

If `npm run tauri:dev` fails because of missing native tooling, install Rust and the macOS developer toolchain first.

## Setup

### 1. Install Dependencies

From the repo root:

```bash
npm install
```

### 2. Configure API Keys

The desktop app uses its own secret store.

Desktop keys are not read from `ticket-generator/.env.local`.

For the TPMCluely desktop app, store these keys through the app's `Onboarding` screen:

- `Gemini API Key`
- `Deepgram API Key`
- `Linear API Key`
- `Linear Team ID`

These are saved through the Tauri backend into the app's keychain-backed secret store.

Important:

- `ticket-generator/.env.local` is only used by the standalone Next.js app in `ticket-generator/`
- the desktop app should be configured through the desktop UI, not by editing `.env.local`

### 3. Optional Settings Review

Open the `Settings` screen and verify:

- `Ticket Generation` is on
- `Auto Generate Tickets` is on
- `Auto Push Linear` is on
- `Always On Top` is set the way you want
- `Overlay Shortcut` matches your preferred trigger

## Running The App

### Desktop App

Run the actual TPMCluely desktop app:

```bash
npm run tauri:dev
```

This is the command you should use for real desktop usage and validation.

### Browser Mock

Run the frontend without the desktop runtime:

```bash
npm run dev
```

Use this only for UI development or browser-safe testing.

It will not give you the full desktop behavior.

### Production Build

```bash
npm run tauri:build
```

## Recommended Setup

For the most reliable setup:

1. Launch the app with:

```bash
npm run tauri:dev
```

2. Go to `Onboarding` and confirm all providers are `Ready`.
3. Go to `Settings` and confirm ticket automation toggles are enabled.
4. Go to `Session`.
5. Join the meeting you want TPMCluely to assist with.
6. Choose `Microphone + Deepgram` unless you have already verified `System audio + Deepgram` on your exact machine and meeting app.
7. Press the overlay shortcut.
8. Click `Start Listening`.
9. Run the meeting.
10. Use `Ask TPMCluely` and `Follow-up questions` during the discussion.
11. End the session.
12. Open `Dashboard` and show the resulting tickets and Linear links.

## Capture Modes

### `Microphone + Deepgram`

Safest option for most single-machine usage.

Use this if:

- the meeting is playing over speakers
- you are okay with microphone pickup
- you want the most predictable capture path

### `System audio + Deepgram`

Best when it works, but more OS- and app-dependent.

Use this only if you have already verified:

- the meeting app exposes system audio to screen/audio capture
- macOS permissions are behaving correctly

### `Manual only`

Fallback mode.

Use this if live capture fails and you still want to keep working:

- Ask TPMCluely
- follow-up generation
- ticket generation

## Main Screens

### Onboarding

Use this screen to:

- check provider readiness
- check the diagnostics snapshot
- store provider keys

### Session

This is the main live meeting experience.

It includes:

- session lifecycle controls
- capture mode selection
- live transcript controls
- overlay toggle
- `Ask TPMCluely`
- dynamic actions
- transcript feed
- assistant feed

### Dashboard

Use this after a session ends.

It shows:

- session notes
- transcript history
- generated tickets
- Linear links if ticket push succeeded

### Settings

Use this to configure:

- theme
- output language
- audio language
- overlay shortcut
- session widget / always-on-top behavior
- ticket automation toggles

## Typical Meeting Flow

Here is a representative TPMCluely workflow:

1. Start TPMCluely.
2. Join a meeting called something like `Q2 engineering planning` or `Auth rollout review`.
3. Press the overlay shortcut and click `Start Listening`.
4. Let the team discuss a couple of features.
5. When someone asks the user a question, click `Ask TPMCluely`.
6. Ask something like:
   - `What should I say about rollout risk?`
   - `What was decided about the metrics dashboard?`
   - `Who owns the backend work?`
7. Read Gemini's response aloud.
8. Click `Follow-up questions` once or twice to show proactive assistance.
9. End the meeting.
10. Open the dashboard.
11. Show the generated tickets.
12. Show the Linear issue links.

## Testing

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
cd src-tauri
cargo test
```

## Troubleshooting

### The transcript does not appear

Check:

- Deepgram key is stored in the desktop app
- microphone or system audio permissions are granted
- you selected the right capture mode
- you clicked `Start Listening`

Fallback:

- switch to `Manual only`
- add transcript lines manually

### `Ask TPMCluely` gives weak answers

Usually this means:

- there is not enough transcript yet
- the audio quality is poor
- too many people are talking over one another

Fix:

- let more transcript accumulate
- ask a more specific question
- use manual transcript lines for important moments

### Tickets did not show up in Linear

Check:

- `Linear API Key` is stored
- `Linear Team ID` is stored
- `Auto Push Linear` is enabled
- the Linear token has permission to create issues in that team

The dashboard may still show locally generated tickets even if the Linear push fails.

### Overlay shortcut does not trigger

Check:

- the shortcut value in `Settings`
- whether another app is already using the same global shortcut
- whether the meeting session is active

You can always open the overlay using the in-app button.

## Data and Secrets

### Secrets

Desktop secrets are stored in the app's keychain-backed secret store.

That includes:

- Gemini key
- Deepgram key
- Linear API key
- Linear team ID

### Local Session Data

Meeting data is stored locally in the desktop app database, including:

- sessions
- transcript segments
- assistant messages
- generated tickets

## `ticket-generator/` Notes

The `ticket-generator/` directory still exists as a reference implementation for the older standalone ticket-generation flow.

Use it only if you explicitly want to run that separate app.

Its `.env.local` is not the runtime config source for the Tauri desktop app.

## Current Product Scope

TPMCluely is currently focused on the main in-meeting workflow:

- live meeting assistance
- transcript-grounded Q&A
- follow-up question generation
- post-meeting ticket generation

It is intentionally not focused on out-of-meeting features like:

- Google Calendar pre-briefs
- pre-call summaries
- extra out-of-scope workflow surfaces

## Recommended Readiness Checklist

Before relying on the app for a live meeting:

1. Confirm all four provider secrets are present.
2. Run a 3-5 minute dry run with the same meeting app.
3. Verify:
   - transcript appears live
   - `Ask TPMCluely` returns usable answers
   - `Follow-up questions` works
   - ending the session generates tickets
   - tickets land in Linear
4. If system audio is inconsistent, switch to `Microphone + Deepgram`.
