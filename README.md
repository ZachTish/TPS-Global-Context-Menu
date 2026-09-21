# TPS Global Context Menu

Shared properties, entity and task contracts, context menus, note interactions, and TPS Table/List Base views.

Current release: [3.1.1](https://github.com/ZachTish/TPS-Global-Context-Menu/releases/tag/3.1.1) · Obsidian 1.10.0+ · Desktop and mobile.

## Install with BRAT

Add `ZachTish/TPS-Global-Context-Menu` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Configure fields and workflows

The settings hub opens on **Rules & fields**. Other destinations are **Menus & surfaces**, **Workflows**, **Appearance**, and **Advanced**.

- **Custom fields** defines keys, labels, types, value sources, and visibility. Search by name/key or filter by type; only one property editor stays expanded. Search and disclosure state are transient.
- TPS Notebook Navigator 6.1.0+ imports defined keys through `api.propertyCatalog` version 1. Existing Navigator ordering and visibility win; removing a GCM definition does not delete note data or Navigator configuration.
- Use **Atomic note** for a full note as the record, and **Atomic line** for an inline record. GCM owns the shared identity, configured field mappings, status choices, and checkbox mappings consumed by other TPS plugins.
- Navigator presentation rules provide virtual sorting/icon/color values. User-authored icon, color, sort, and hidden properties are preserved during recurrence cleanup.
- Linked menus, recurrence, timers, and Daily Note workflows use their configured fields. Source mode shows source rather than replacing the note with a rendered TPS surface.

## Two-level Daily Note identity — 2.4.0

Daily Notes may use `kind: note` together with `noteKind: daily`. Both values are required for this new identity route; keys and values are case-insensitive and surrounding whitespace is ignored. Existing Daily kind/type/tag aliases remain supported. This is an additive identity feature, not a general subtype hierarchy or a note migration.

The pair supplies Daily identity while the configured filename or existing scheduled/title date supplies the date. Templates can use the pair without being mistaken for a dated Daily Note while their date is unresolved. Creation preserves both authored properties. Navigator's Core Daily Notes mode, date lookup, legacy reconciliation, navigation, and task-date inheritance consume the shared classifier. Calendar 0.14.0 adds matching task-placement support for explicitly selected Daily Notes.

`kind: note` alone, `noteKind: daily` alone, other note subtypes, and task/workout/calendar identities do not gain Daily identity through the pair. A date-only note with no kind still follows the existing path-based behavior. Mixed/conflicting kinds, conflicting dates, malformed YAML, and current-source checks retain their protections. No defaults, saved settings, or public API versions change; put the pair in a note or the configured Daily Notes template to use it.

Regression coverage includes canonical/named files, case and single-value list compatibility, template date absence, reconciliation with unchanged metadata, incomplete pairs, conflicting record/date identity, and stale-cache rejection. Tests, final build/deployment, test-vault reload and installed creation/reopening QA are recorded in [2.4.0 release notes](release-notes/2.4.0.md). Validation on 2026-09-20 passed 1,158 full-suite checks, 125 additional checks, and 97 focused checks; TypeScript and the separate final build deployed to the test vault. After `plugin:reload`, Navigator created and reopened the paired-template note with both fields intact; provider lookup recognized canonical and named paired notes and excluded the ordinary-note control. Temporary defaults were restored and QA fixtures archived. Minimum Obsidian remains 1.10.0; production installation is a separate BRAT update.

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

## 2.5.0 — Shared note creation opening (2026-09-20)

GCM owns **Menus & surfaces → Note opening**: **After creating a note** chooses Editable preview, Open note, or Stay in current view; **Open destination** chooses current/new tab for Open note and the preview's Open button. Fresh installations default to preview/current tab. Existing installations import Calendar's `postCreateBehavior` (or legacy false `openTaskDestinationAfterCreate`) and Navigator's `createNewNotesInNewTab` once, only for missing GCM keys. Migration reads those plugins' preferences without rewriting them. GCM's persisted keys are `notePostCreateBehavior` and `noteOpenDestination`; subsequent changes are authoritative regardless of plugin startup order.

Native embedded/standalone Bases, TPS Table/List note creation, Calendar 0.15.0+, Navigator 6.3.0+, GCM attachment-note creation, Create task native records, and newly created task-associated notes share this policy. Existing-note navigation, explicit destination overrides, legacy inline task/line creation, background imports, core New note, and independent third-party creation commands retain their own semantics. This is a post-creation policy; it does not change folder, template, filter precedence, identity, or record payloads.

The native Bases adapter checks the native menu's create/frontmatter/open ordering and wraps that menu only. A per-operation app/file-manager facade delegates native folder/file/frontmatter work, then a private completion signal stops native presentation before the iPhone tab branch. It neither patches the real FileManager nor observes unrelated vault creates. Duplicate activation while one menu creation is pending is ignored. Missing/changed native contracts preserve native behavior and log a warning; unloading restores the original handler. The installed 1.14.1 runtime and 1.14.2 source contract were checked. Native template behavior is preserved (including its choice of template metadata rather than inferred filters).

The editable preview retains the originating surface, offers note-name editing for newly named files, body autosave, properties, Open note and Dismiss. Rename errors keep it open; Escape in the name field restores the current filename; Enter saves the name and enters body editing. Body and title changes flush before dismiss/open. Mobile uses the existing keyboard-aware overlay, a 16px name input and 44px Open/Dismiss targets. iOS may require a tap to raise its software keyboard after asynchronous creation. Preview failure retains the note/current view and offers an explicit Open action. Opening failure is reported without recreating or retrying the note.

Additive `api.ui` v1 capabilities: `presentCreatedNote({filePath, sourcePluginId, anchorEl?, sourceLeaf?, renameTitle?, explicitDestination?})`, `handlesNativeBaseCreation(controller)`, `getNoteOpeningSettings()`, and `openNoteOpeningSettings()`. Presentation returns false only for an invalid/missing file; true acknowledges handling, including stay or a reported presentation failure. Consumers should feature-detect. Explicit destinations are `tab`, `split`, or `window`. Existing preview/navigation APIs are unchanged.

Validation uses `scripts/test-note-opening.mjs` (routing, desktop/mobile preview, migration, native defaults/callback preservation, failure/cancel, repeated activation, unload), the existing preview/write-ownership/task suites, `npm run prepretest`, `npm test`, and a separate `npm run build`. Test deployment uses the shared helper and only shipped artifacts; reload uses the test-vault plugin reload command. Desktop QA in Obsidian Plugin Test Vault verified the embedded native Table New button, keyboard creation, preview rename/body persistence without extra tabs, stay, open/new-tab, and native template metadata versus active-view/Base defaults. Physical iPhone acceptance remains for the user's BRAT test. Minimum Obsidian stays 1.10.0; unsupported native contracts use Obsidian's own behavior. This is a backward-compatible minor feature release, not a production installation.

Final validation: 1,166 full-suite checks plus 126 additional checks passed; the separate production build deployed only shipped test artifacts. The final 2.5.0 reload passed rename-conflict protection and automatic-rename path tracking. Calendar and Navigator settings handoffs were exercised in the test vault. Existing runtime state was retained by the shared deploy helper; QA opening preferences and the temporary native-record root were restored. Synthetic notes were archived after verification. Physical iPhone validation remains pending.


## 2.5.1 — Preserve title capitalization in filenames (2026-09-20)

With Auto-rename enabled, title changes that only change case now rename the file too: `TishOS V0.2.md` becomes `TishOS v0.2.md` when the authored title uses a lowercase `v`. Both explicit title editing and the existing metadata-driven filename sync use exact-case equality for the no-change guard. Obsidian's FileManager performs the rename and link updates; no temporary note or direct filesystem rename is introduced.

Exact and case-insensitive sibling collisions still prevent overwriting another file. An existing lookup that refers to the same file permits a case-only rename. Daily/workflow filename ownership, creation grace, automatic-write exclusions, malformed-source checks, and the Auto-rename preference are preserved. No setting migration or bulk rename is performed. Navigator 6.4.0 independently recognizes folder notes by their authored titles.

The filename regression exercises the actual FileNamingService against case-sensitive and insensitive lookups, explicit and metadata title routes, idempotence, collision protection, content preservation, and exclusions. Required validation is the focused Daily Note/filename suite, `npm test`, `npm run prepretest`, and a separate production build, followed by deployment/reload and title-edit QA in Obsidian Plugin Test Vault. Minimum Obsidian remains 1.10.0. This is a patch release and a BRAT handoff; physical iPhone acceptance remains pending.

Test-vault UI validation on 2026-09-20 used the Edit Title dialog and Save action to change `TishOS V0.2` to `TishOS v0.2`. The actual FileManager rename succeeded on macOS's case-insensitive filesystem, the old path disappeared, the title matched, and the body remained intact. Auto-rename and Navigator QA preferences were restored and synthetic notes archived. Full validation passed 1,167 declared test checks plus 126 additional checks before the separate final build/deployment and plugin reload.


## 2.6.0 — Confirmed property migrations (2026-09-20)

Changing a custom field's **Frontmatter Key**, an integration property name, or a timestamp, view-mode, time-tracking, task-reveal, or child-parent property key now edits a draft. **Apply** scans Markdown frontmatter and shows the old/new key, affected note paths, count, and conflicts. **Confirm update** changes existing notes before saving the configuration. Cancel does neither. The scan includes archived notes and templates because this is an explicit migration, not background automation. Scanning shows persistent progress with a Cancel scan action and uses at most eight concurrent reads. Unloading GCM cancels a pending scan. No new persistent preference or settings navigation destination is introduced.

Custom property options/suggestions also use Apply. Replacing exactly one option with one new option proposes a stored-value migration. Additions/removals/reordering are explicitly confirmed as suggestion-only changes; multiple simultaneous replacements require individual **Rename stored value** actions so GCM never guesses the pairing. Rename stored value also works for vault-derived values. Values match exact strings or top-level list items under the selected case-insensitive property key; numeric/boolean values, nested objects and link targets are not coerced. New numeric-looking strings remain quoted strings.

The YAML range planner preserves unrelated properties, comments, line endings, BOM and the complete note body. Existing destination keys (even equal-valued), duplicate keys, relevant malformed YAML, merge keys, and unsafe alias/anchor/tag cases block the whole migration. Multiline value replacements require manual editing; renaming a key whose value is multiline is supported. Unrelated malformed notes do not block a migration. GCM rechecks settings and rescans notes after confirmation, then compares exact source before each write. A stale preview must be reviewed again. A failed partial migration restores unchanged migrated notes and settings; concurrent edits are never overwritten.

A temporary private `property-migration-recovery.json` inside this plugin's runtime folder stores original/replacement note snapshots and only changed configuration groups. It is verified before note writes and removed after success or complete rollback. An interrupted migration blocks further migrations until **Advanced → Restore interrupted property migration** succeeds. Conflicting subsequent edits keep recovery available for manual resolution. This file can contain note content and must not be committed or attached to support reports. GCM metadata/modify filename automation is suppressed during the transaction; external plugins and other devices are not locked. Avoid editing the same properties from another device during migration.

Known GCM references follow renames: matching custom fields, scoped/hidden property conditions, declared property-key settings, ignored backlink keys, virtual Base embed keys, exact view-mode/Navigator conditions and sort-value inputs, status option/classification/checkbox mappings, and Kind acceptance constraints. Changing a filter or rule criterion directly still changes selection only. Template identification is a discovery rule and retains its existing behavior. Inline fields, note prose, `.base` formulas, external plugin configurations, core property-type metadata, and hard-coded TPS record contracts are outside this frontmatter migration; review those references separately. Integration read aliases remain available. Other TPS plugins' mappings must be updated separately.

The existing five settings destinations and defaults remain unchanged. The preview is a single modal with a scrollable path/conflict list, native Cancel/Confirm buttons, visible keyboard focus, and wrapping 44px actions on narrow screens. Validation is `scripts/test-property-migration.mjs` plus existing property-identity/managed-field suites, the full declared tests, `npm run prepretest`, and a separate production build. The shared deployment helper publishes only shipped artifacts to Obsidian Plugin Test Vault; reload uses the targeted plugin reload command. Minimum Obsidian remains 1.10.0. This is an additive minor feature release for the user's BRAT pull; physical iPhone acceptance remains pending.

Final test-vault validation: 1,193 declared checks and 126 additional checks passed. The final versioned production build deployed to the test runtime and was reloaded. UI QA reviewed the two-note preview, cancelled without writes, confirmed a property-key rename, then confirmed an exact string-value rename in both scalar and list storage. Comments, unrelated properties and bodies were preserved; manual options followed the value rename and the recovery file was removed. Original property definitions were verified unchanged and restored by removing the synthetic field; fixtures were moved directly to `_archive`. The preview was visually inspected in the test-vault settings window. Physical iPhone testing remains pending.


## 3.0.0 — Confirmed current mappings

Advanced exposes Record kind key as a single current mapping. Apply previews all matching Markdown frontmatter, including archives and templates, confirms, migrates notes, and saves configuration last. Integration fields stop reading earlier names; historical configured names are migration input only. Native identities use only the current profile in ordinary reads; legacy identity evidence still guards duplicate IDs and protected fields. Consolidate records requires confirmation and retires aliases after success.

Major: removes implicit reads of historical record and integration mappings. Existing navigation destinations, default routes, disclosures, commands, and persisted UI-state contract are unchanged. Mapping controls are plain inputs with an explicit Apply action and wrapping layouts; no alias editor is added. Cancel preserves the current mapping and notes.

Shared migrations change Markdown frontmatter only, preserve note bodies, reject occupied destinations and stale previews, and keep a local recovery copy until success. Inline fields, Base formulas, per-view configuration, and disabled plugins are not automatically rewritten; enable participating TPS plugins before a shared rename. Review historical records before relying on totals after upgrading. Health timing migration uses its existing guarded rollback flow; a process crash cannot provide a vault-wide atomic transaction. No migration or outbound service runs merely because the plugin is upgraded.

Validation covers current-only reads, migration-only historical inputs, cancellation, archived notes, conflicts, stale previews, save/write rollback, cross-plugin setting changes and identity protection. Required final validation: full declared suite, separate production build to the test vault, named plugin reload and settings confirmation checks. UI and final test results are recorded in the release notes. Minimum Obsidian compatibility is unchanged. Update GCM before applying Controller or Calendar mapping changes. The release is a BRAT handoff; production installation remains user-controlled.

Full declared suite: 1,199 checks passed, 0 optional/existing checks skipped, zero failed. Plus 127 additional checks passed. TypeScript and separate final production builds pass and deploy only shipped artifacts to the test vault; targeted plugin reloads verify the installed versions. Test-vault validation (2026-09-20): Controller’s real Apply dialog previewed one synthetic Markdown note and two plugin mappings. Cancel preserved both mappings and the original file; confirming renamed the property and updated Controller and Calendar together, preserved the body, restored input focus, and removed temporary recovery. Original settings were restored and the fixture archived. GCM’s current kind key and migration controls were inspected. Calendar’s five rendered key inputs and Apply actions were verified. Health’s timing inputs were checked; an existing archived QA note with potentially relevant malformed frontmatter correctly blocked migration with a path-specific error and no changes. Successful Health confirmation, timing conversion, cancellation and rollback are covered by regression tests. No outbound automation was enabled. Existing mobile CSS/layout is retained; physical iOS testing remains user acceptance.


## 3.1.0 — Independent Health entry keys

Health → Note library now offers an editable **Entry and session frontmatter key** beside the entry/session values. Food definitions and reusable workout/exercise templates keep their existing separate key controls. All groups may use the same key (for example `kind`) or different keys (for example `entityKind` for templates and `entryKind` for logged records). Entry-key Apply previews and confirms only Health native food/activity entries, workout sessions and legacy workout exercise records, including archives. Templates and other TPS records are not renamed by this scoped action. Matching values must remain distinct when records share a key.

GCM 3.1.0 stores the current physical key per record kind in `nativeRecordKindPropertyKeys`; the empty default preserves existing storage. The mapping survives Health being disabled. Native creation, reads, updates, identity changes and consolidation use the selected key; old keys are never fallback readers. Its nativeRecords API v6 adds the optional `kindPropertyKeys` capability, kind-aware `getStorageProfile(kind)`, and guarded key-map access/configuration. Health kind-value migrations carry the key binding to the new value and restore it on save failure. The global GCM key rename remains a broader explicitly reviewed operation.

This is a backward-compatible minor feature. Existing settings routes, default Rules & fields route, disclosures and mobile wrapping layout remain. The new field is a labeled plain input with Apply/Enter, migration preview and focus restoration; no navigation state is persisted. GCM owns the stored record binding while Health owns the settings surface. Update GCM before configuring this feature. Conflicts, stale previews and active workouts block writes; the existing recovery/rollback limits remain. Inline fields, Base formulas and per-view mappings are not rewritten. Unrelated malformed templates are ignored by the Health-scoped scan; possibly matching malformed records must be repaired.

Validation: focused coverage exercises shared/separate keys, strict reads, creation/edit/reidentification, template/task isolation, cancel/confirm, stale maps, value-change binding retention and rollback. Full suite, separate final build, test-vault reload/UI results and artifact hashes are recorded in this release's notes. Production remains a user-controlled BRAT pull; physical iOS acceptance is pending.

Installed test-vault QA (2026-09-20): used the actual Health Note library Apply control to preview two synthetic logged records. Cancel left their keys and the saved map unchanged. Confirm moved only the food entry and workout session; the reusable template and task stayed on their original key. A newly created record used only the separate physical key, and an edit retained it. A second UI confirmation moved all three logs back to the shared key. All four original bodies were preserved, focus returned to the labeled input, and recovery was cleared. Original settings were restored and all five fixtures archived. At a 388 px settings container width, the control row measured 283 px with 283 px scroll width and no overflow. Physical iOS acceptance remains user testing. No outbound automation was enabled.

Full suite: 1202 passed, 0 optional skips, zero failed. Additional suite: 131 passed. TypeScript and separate final builds deployed only shipped files to the test vault; targeted reloads verified version 3.1.0.

## 3.1.1 — Smoother note opening

The active-view watcher refreshes completed-task widgets without reconfiguring every Markdown editor. Previously each file/mode change called Obsidian's global `updateOptions()` twice; Obsidian already configures the opened editor. Settings changes still explicitly reconfigure editors. GCM also avoids its second focus request when Obsidian has already activated the destination. Reusing an existing note, background opens, pinned-tab routing, and fallback activation retain their behavior.

No settings, defaults, records, or public API contract change. This is a backward-compatible performance patch. Focused behavioral tests exercise widget refresh versus settings refresh and foreground/background/existing-note activation. Full tests, a separate final build, test-vault deployment/reload and navigation QA are recorded in the release notes. Minimum Obsidian stays 1.10.0; production remains the user's BRAT pull.

Installed QA: the same four-note-open sequence dropped from eight global editor reconfigurations to zero, with four native focus calls instead of five. Reading, Source and Live Preview transitions retained the exact note body; a settled manual scroll retained its position and cursor. Full suite: 1,207 passed plus 131 additional checks; TypeScript and final build passed. Test deployment and explicit reload used only Obsidian Plugin Test Vault. QA fixtures were archived, temporary runtime probes removed, and original navigation restored. No settings were saved or outbound automation enabled. See release notes for final artifact hashes.
