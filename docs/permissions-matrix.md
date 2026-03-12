# Permissions Matrix

| Permission | Why it exists | Current C0 behavior | Future checkpoint |
|------------|---------------|---------------------|-------------------|
| Screen Recording | Required for system audio capture and screenshots | surfaced as `unknown` until native detection is wired | C2 / C6 |
| Microphone | Optional future voice capture path | surfaced as `unknown` | later |
| Accessibility | Needed only if advanced hotkeys/window behavior requires it | surfaced as `unknown` | C1+ if required |

## Notes

- We must never claim guaranteed invisibility on macOS capture tools.
- Permission UX must distinguish `unknown`, `granted`, `denied`, and `restricted`.
- Clean-machine validation must include denied-permission recovery.
