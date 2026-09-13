# 2.2.4

Rename the user-facing storage distinction to Atomic note / Atomic line, including related record configuration and commands. Internal setting keys, stored architecture values, command IDs, APIs and data behavior remain unchanged. No migration or architecture switch is performed.

Validation: 1,149 tests passed. Reloaded Advanced settings display Atomic line and Atomic note while their stored values remain legacy and native-records. Existing navigation, conditional controls and native keyboard semantics are preserved. Separate final production-mode builds deployed to the isolated test vault; affected plugins were reloaded. No live bank data or credentials were used.

Minimum Obsidian: 1.10.0. Tested in the test vault and ready for BRAT; publication alone does not install it in production.

## SHA-256

- `main.js`: `a5a9b99ab4d0bc9129e2b095ed7386cd9e4e4979682688f05960ab1fd85c4a59`
- `manifest.json`: `0202e70ec4a8f9884d9653a157c20d06f4de4f5b86b484612f547971f712b011`
- `styles.css`: `2cf3c1c5127f0bf34ba03c47416302408be318669e3ff1230e4b7a932b922f08`
