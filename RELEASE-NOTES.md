# TPS Global Context Menu 2.2.5

Fixes calendar events retaining generated identity filenames even with Auto-rename enabled. Atomic calendar-event notes now follow the existing sanitized scheduled-date/title naming rule on open and metadata reconciliation, including edits from a calendar while another note is active. Their stable IDs and note content are preserved.

The exception is limited to title-to-filename updates for verified calendar-event records. Reverse title synchronization cannot overwrite the title with an ID filename. Other record kinds, workflow filenames, Daily Note ownership, companion notes, exclusions, malformed-source guards, and collision protection remain in place. No settings keys, defaults, commands, layout, or migration changes. Minimum Obsidian: 1.10.0.

Validation: 1150 full-suite tests and 76 additional native-record tests passed. Mandatory separate production-mode build deployed to Obsidian Plugin Test Vault. Reload preserved settings and verified 2.2.5. Actual automatic creation/open reconciliation renamed a synthetic calendar record; a subsequent title edit renamed it again. Identity/body were unchanged, reverse title synchronization made no content changes, and a workout record kept its filename. Synthetic notes were archived. The stale native-profile reload-copy assertion now matches the previously shipped UI text.

Tested in the test vault and ready for the user's BRAT pull. The production plugin was not deployed or reloaded. The specifically requested event was separately repaired through Obsidian's rename API, preserving its contents and identity. Unrelated existing development changes are excluded.

SHA-256 hashes of the tested release artifacts:

- `main.js`: `4b7ff1fadf69ae2a45e66d70ddd062b7d72ec23d423fee60a61de06edbc23470`
- `manifest.json`: `bd62ee6169b5bff83d2942839a15ea701820c9b72adae56e844068540f09bc73`
- `styles.css`: `2cf3c1c5127f0bf34ba03c47416302408be318669e3ff1230e4b7a932b922f08`
