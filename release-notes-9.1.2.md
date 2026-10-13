# TPS Global Context Menu 9.1.2 — Daily-note access during startup

Patch release: configuration and canonical daily-note lookup no longer wait for
an unrelated whole-vault native-record inventory. No settings migration.

Record identity operations retain their existing discovery barriers. Indexed
snapshots remain explicitly unready until complete; a failed index still blocks
record mutations. Enabled history recovery retains its original barrier. Base
opening and startup timer recovery still wait for discovery. One API publication
avoids restarting consumers twice. No poller, repair loop or persistent cache.

## Verification

- `npm test`: 1,770 passed.
- Explicit `npm run prepretest`: 327 passed (this separately declared script is not automatically run by npm test).
- Focused native-record suite: 268 passed, including 4,049-record startup and cancellation after early publication.
- Separate final production build deployed only to Obsidian Plugin Test Vault; CLI reload confirmed 9.1.2, API availability and Health readiness.
- Real existing-daily-note lookup/ensure succeeded; synthetic fixture archived.
- Five foreground plugin reloads per version, with Health, Controller and Navigator enabled: median API availability **489 ms → 132 ms**; combined GCM/Health discovery **725 ms → 663 ms**.
- Both versions: two Markdown inventories, zero process/modify attempts, no observed >50 ms long tasks. Raw reads: 1–2 before, 1 after, of a development README.
- Daily lookup succeeded during incomplete discovery in all updated samples.

These are warm test-vault plugin reloads, not production cold launches or phone
Sync catch-up. They demonstrate earlier access, not reduced Sync transfer volume.
Existing test identity-conflict fixtures remain; read-only probes included those
conflicts without bypassing mutation guards. Physical iPhone acceptance remains
unverified. Minimum Obsidian: 1.10.0.

Published for the user's BRAT pull. Not directly deployed to production.

## SHA-256

- `main.js`: `7290415cb4bbe7ab01c3f6d2a1d4c3f64e78297aff1833098ec83260ef3064b7`
- `manifest.json`: `e8ba2b59612776fc64d4536ef79dff806b0d22c2a7d0a05f255f216e4a5fe8bb`
- `styles.css`: `1755db82b35e7b5e33152da81187f4b79e4298daddd11989d84f721dae4399e0`
