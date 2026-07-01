# Release Checklist

Use this checklist whenever creating a new release tag.

1. Pick a version newer than every published updater feed version.
2. Update all app version fields before tagging:
   - `package.json`
   - `package-lock.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`
   - `src-tauri/tauri.conf.json`
3. Run:
   - `npm run tauri:renderer:build`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
4. Commit the version bump and release changes.
5. Create and push an annotated tag from that commit:
   - `git tag -a vX.Y.Z -m "Chikku Parser vX.Y.Z"`
   - `git push origin <branch>`
   - `git push origin vX.Y.Z`
6. Wait for `.github/workflows/release.yml` to complete successfully.
7. Verify the published updater feed:
   - `curl -L https://github.com/aj4abinjacob/chikku_parser/releases/latest/download/latest.json`
   - Confirm `version` equals the tag version.
   - Confirm macOS x64, macOS arm64, Linux, and Windows platforms are present.

## Signing Key

Back up the Tauri updater private key and its password in a password manager or secrets manager. Do not commit it to the repository.

The app embeds the matching public key in `src-tauri/tauri.conf.json`. If the private key is lost, existing users cannot verify future auto-updates signed by a new key. Recovery would require distributing a manually installed build that contains the replacement public key.
