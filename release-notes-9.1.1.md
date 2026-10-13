# TPS Global Context Menu 9.1.1

Fix running record settings remaining stale after Obsidian Sync updates data.json. Uses Obsidian’s external-settings callback to adopt shared nativeRecord configuration, preserve unsaved local changes, invalidate stale reads, refresh record indexing once, and notify Health/API consumers. No new polling, settings writeback, hardcoded identity key, or automatic note remediation. Other settings retain existing reload behavior.

Validation: 1,770 tests passed; separate versioned build deployed to Obsidian Plugin Test Vault and reloaded. Installed probe: workout recognition false → true after tpsId → id adoption; zero settings writes, one refresh across two callbacks. Health’s fresh-identity create API wrote id, not tpsId. An unrelated caller-supplied-ID creation probe was blocked by an existing malformed archived QA note; left unchanged. Physical iPhone Sync delivery remains unverified.

Minimum Obsidian: 1.10.0. Tested in the test vault; ready for BRAT pull, not installed in production. Install on each device and enable community-plugin settings sync. Existing wrongly keyed notes require reviewed migration.

SHA-256:

- `main.js`: `0edbfdef0bf2e43c94f5155b854c4c2c4282b9bbb3c16795311db3adcd494730`

- `manifest.json`: `72c921853678f4d12f654305ab61b56f6f5ecbb26166eceb47e60d83b8ab116c`

- `styles.css`: `1755db82b35e7b5e33152da81187f4b79e4298daddd11989d84f721dae4399e0`
