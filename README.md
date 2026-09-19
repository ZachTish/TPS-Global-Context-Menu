# TPS Global Context Menu

Shared properties, entity and task contracts, context menus, note interactions, and TPS Table/List Base views.

Current release: [2.3.1](https://github.com/ZachTish/TPS-Global-Context-Menu/releases/tag/2.3.1) · Obsidian 1.10.0+ · Desktop and mobile.

## Install with BRAT

Add `ZachTish/TPS-Global-Context-Menu` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Configure fields and workflows

The settings hub opens on **Rules & fields**. Other destinations are **Menus & surfaces**, **Workflows**, **Appearance**, and **Advanced**.

- **Custom fields** defines keys, labels, types, value sources, and visibility. Search by name/key or filter by type; only one property editor stays expanded. Search and disclosure state are transient.
- TPS Notebook Navigator 6.1.0+ imports defined keys through `api.propertyCatalog` version 1. Existing Navigator ordering and visibility win; removing a GCM definition does not delete note data or Navigator configuration.
- Use **Atomic note** for a full note as the record, and **Atomic line** for an inline record. GCM owns the shared identity, configured field mappings, status choices, and checkbox mappings consumed by other TPS plugins.
- Navigator presentation rules provide virtual sorting/icon/color values. User-authored icon, color, sort, and hidden properties are preserved during recurrence cleanup.
- Linked menus, recurrence, timers, and Daily Note workflows use their configured fields. Source mode shows source rather than replacing the note with a rendered TPS surface.

## Daily Note reliability — 2.3.1

Malformed YAML in an unrelated project or archived note no longer locks all Daily Note creation through GCM, including Navigator's calendar and daily-note command. Invalid files stay untouched and excluded from the identity index. No settings, API versions, or note data migrate.

Potential Daily Notes remain conservative blockers: date-shaped paths, last-known Daily identity, raw Daily markers, and escaped/aliased malformed YAML. Conflicting identities, unreadable or unresolved sources, canonical target occupancy, and malformed selected notes retain their existing guards. A malformed note containing an incidental Daily marker can still require repair before creation; this is intentional duplicate protection.

Focused regressions cover the archived-project mixed YAML mapping/list failure, unrelated malformed files, existing/new days, possible Daily identities, and recovery after repair. Validation on 2026-09-19: all 1,154 `npm test` checks and 125 additional `prepretest` checks passed, plus 93 focused Daily Note checks. The separate production build deployed to the test vault and `plugin:reload` loaded 2.3.1. The previously blocked provider call succeeded; Navigator’s confirmation created and opened one templated note, and reopening made no duplicate. The malformed fixture remained unchanged and temporary defaults were restored. Installed UI QA used Core template tokens (Templater is not installed in the test vault); Templater behavior remains covered by the existing automated suite. See [release notes](release-notes/2.3.1.md). This patch is a BRAT handoff; production installation and acceptance remain separate.

## Integration

Consumers should feature-detect the enabled plugin's API and its versioned capabilities. GCM provides entity discovery, line metadata, Base query/creation helpers, property editing, note opening, template protection, and the property catalog. Domain plugins own their own records and provider operations.

TPS Home was removed in 2.0.0. Older Home descriptions in [the historical reference](REFERENCE.md) are historical and must not be used as current setup instructions. Calendar owns calendar views; Health owns nutrition/workout flows; Controller owns automation and Plaid transport.

The reference retains the detailed APIs, settings contracts, and validation records without placing the release log ahead of setup. Current interfaces live in [src/plugin-api.ts](src/plugin-api.ts); configured behavior lives in [src/settings-tab.ts](src/settings-tab.ts).

## Development and repository policy

`main` is the stable source line. Numeric tags identify immutable released artifacts. `optimization` is an unreleased work-in-progress lane; do not install it through BRAT or merge it into stable without separate validation.

The supported build lives inside `Obsidian Plugin Test Vault/Plugin Development`, with `TPS-Global-Context-Menu (Dev)` as the mapped stable source. These repositories depend on adjacent shared tooling including `deploy-runtime.mjs`; a standalone clone is not currently self-contained.

From the contained workspace, prepare dependencies using the shared helper, then run tests and a separate final build:

```sh
# From Plugin Development:
node ./prepare-dependencies.mjs "TPS-Global-Context-Menu (Dev)"
cd "TPS-Global-Context-Menu (Dev)"
npm test
npm run build
```

Dependencies stay in the vault's `.plugin-dev-cache.nosync` through a relative `node_modules` symlink. Use a clean, current checkout; preserve unrelated changes and never build an old dirty worktree into the test runtime. Stable builds deploy only shipped artifacts to the test vault. Optimization builds are build-only. Runtime `data.json`, secrets, caches, and session state never belong in Git.

Documentation-only maintenance does not create a new plugin version. Published release tags and assets are preserved. Do not rely on legacy version/release scripts without reviewing their current behavior. Production updates remain the user's BRAT handoff.

For prior feature details and release-specific evidence, see [REFERENCE.md](REFERENCE.md) and [GitHub releases](https://github.com/ZachTish/TPS-Global-Context-Menu/releases). The September 16 cleanup changes documentation and repository metadata, not shipped behavior.
