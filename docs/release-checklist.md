# Release Checklist

## Foundation

- Root frontend builds with `npm run build`
- Rust backend passes `cargo test`
- Session state machine tests pass
- SQLite migrations run on clean launch and repeat launch
- Keychain secret storage works on macOS

## Permissions

- Screen Recording prompt path documented
- Permission denied state visible in UI
- Retry path documented
- System Settings recovery path documented

## Packaging

- Developer ID signing configured
- Hardened runtime enabled
- Notarization path verified
- Clean-machine install tested

## Product smoke test

- Launch app
- Load onboarding
- Save provider secrets
- Update settings
- Verify dashboard/settings shell renders
