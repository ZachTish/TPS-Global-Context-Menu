# Parent relationship startup — 7.3.16 validation record

This records the validated 7.3.16 artifacts. Base is published GCM
7.3.15, commit `4cf8cc5b49f8f69c76c5b528d93c208070913352`. Scope is one startup
performance fix and regression protection. Production is untouched.

The source retains one inventory and cooperates at the existing elapsed 8 ms
budget. Lifecycle and actual-task controls preserve relationships and cover
accepted changes/unload without writes or navigation-owned inventories. The user launched Obsidian after the initial UI blocker. Installed baseline
foreground measurements pass. The versioned deployment, focused after measurements,
loaded-version and installed navigation gates now pass. The app has not been
restarted. Git publication is recorded separately from validation.

## Source validation

- Inspected candidate before edits: 65 focused checks pass; only the pre-existing
  relationship service and regression script were modified.
- Added failing controls: inventory boundary 20 vs expected 12 logical ms; folder
  checkpoint 160 vs expected 8 logical ms. Corrected in one runtime correction.
- Final relationship script: 70 passed, zero failures/cancellations/skips.
- Final normal `TPS_NO_DEPLOY=1 npm test`: 1,673 passed, zero failures,
  cancellations or skips, including all 70 relationship checks; its TypeScript
  and build pass with target=none.
- Explicit `TPS_NO_DEPLOY=1 npm run prepretest`: 303 passed, zero failures,
  cancellations or skips.
- Separate final `TPS_NO_DEPLOY=1 npm run build`: passes TypeScript and bundling;
  reports `[runtime-deploy] target=none reason=TPS_NO_DEPLOY` (build-only).
- `git diff --check`: passes.

## Operation and component measurements

Each 10,000-note initial scan retains one inventory, 10,000 initial metadata
accesses, 9,900 identical relationships, zero raw/body reads and zero writes.
Both real MessageChannel/setTimeout controls admit the queued host timer after
four notes while readiness is false; a resolved-promise-only loop fails this
check. Repeated menu lookups and 100 extracted actual file-open/tab callbacks
retain zero additional relationship inventories or writes. Other consumers in
that callback test are facades, and optional open automation is disabled.
The scheduler branch is tested through a controlled substitute; actual host-task
proof covers MessageChannel and setTimeout, not native browser scheduler execution.

Three alternating component pairs compare published 7.3.15 with this candidate,
using real clocks and tasks. Longest 1 ms heartbeat gaps: before
119.60/93.77/80.79 ms; after 57.66/18.43/16.48 ms. Medians: 93.77/18.43 ms.
Median completion: 92.44/94.58 ms. Completed task yields: before 0/0/0; after
12/9/10. Complete graph SHA-256 in all six samples:
`646128ac60488edf047673532ff74219032639e07e471d18bdc0326032c4db32`.

These are component measurements, not installed UI, CPU-total, production or
mobile speed evidence. Atomic inventory/individual operations, GC and host task
delays are not preemptible; 8 ms is a cooperation threshold, not a hard bound.
Explicit/settings rebuilds remain synchronous.

## Handoff

Version metadata and verified loaded test runtime are 7.3.16. This backward-compatible
patch retains minimum Obsidian 1.10.0 and existing settings/API/storage contracts.
Full versioned tests, separate builds and foreground installed checks pass. Work
is scoped to `fix/gcm-parent-startup-20261006`; Git publication is a separate gate.
Production and physical iPhone/Windows remain untouched/untested.

## Validated artifacts and runtime preservation

SHA-256 hashes of the validated 7.3.16 artifacts:

```text
main.js       e203e96a308dd758c7f8266a3045f757b985812b7b06c4092239fcf9579e2210
manifest.json f54d66ac5cc5469ca98698eade0d6a7c08e3a95071d4d92f733f03f5416ef82e
styles.css    1a86fadf16e91337c7f88101f1ace99fdfea2ab7f4bc4f4222c3d5b2d3f765ca
styles-ui.css 572256adc422f81f32d853b9c73e92310cc3377ceab1e971b2253ec51f25cc16
```

Installed TEST main.js/manifest changed to the candidate; both CSS files remain
unchanged. All four installed hashes match the values above. All eight saved
consumer data.json files remain byte-identical to the predeployment snapshot.
No note creation/editing operation was performed.

## Resumed versioned validation checkpoint

- Versioned normal/supplemental gates: 1,673/303 passed, zero failures,
  cancellations or skips. Separate build: target=test, main.js/manifest only.
- One earlier versioned supplemental attempt failed an incidental exact-one
  shared scheduler count. Whole onload now has actual Native and Parent owners.
  Three such assertions were corrected to prove unfinished Native ownership and
  exactly one Native continuation plus the incomplete Parent continuation. All
  API, inventory, read/write and unload invariants remain; Native-only exact-one
  assertions remain unchanged. Focused Native: 231 passed. No runtime correction.
- Focused, visible actual 7.3.15 warm reload: 17,089 Markdown paths, one loaded-file
  inventory, two Markdown inventories (one GCM, one Health), 51,670 application-wide
  metadata accesses, 47 cached reads, zero raw reads or note writes. Reload return
  447.5 ms; API/Parent ready 699.3 ms; Health ready 863.4 ms; longest reload heartbeat
  gap 130.4 ms. Four parents/five children and complete graph digest
  afb1ef4054a12885bb8afc0dfc7cc9e0ca041ec38d5a44394ffae4db943674da
  are preserved. All eight consumers enabled; settings, saved data, records and
  original leaf preserved. Warm application; not cold process or input-to-paint.
- Focused baseline installed-constructor probe passes all three synthetic sizes
  with live indexes/data/settings untouched. For 10,000 Markdown files: one
  inventory, 10,000 cache acquisitions, 1,428 exact edges, zero I/O or writes,
  zero yields/ticks during the operation, 29.6 ms elapsed/heartbeat gap. This is a
  distinct fixture from the 9,900-edge source test. Native scheduler.yield is absent
  in this Obsidian host; MessageChannel is available. CPU values are whole-renderer
  process deltas and include other threads/work, not isolated Parent CPU.
- After the user focused TEST, all three foreground after probes pass with loaded
  7.3.16 and all eight consumers enabled. Warm reload preserves the identical
  corpus/graph/records/settings/data/enabled set/original leaf. Same one loaded-file
  and two Markdown inventories, 47 cached reads, zero raw reads or note writes.
  Application-wide metadata accesses: 51,681. Reload return 384.3 ms; API 695.3 ms;
  Parent 695.5 ms; Health 851.9 ms; longest reload heartbeat gap 122.8 ms.
- Installed-constructor synthetic 10,000 Markdown after sample: completion 33.8 ms,
  heartbeat gap 8.5 ms, four task yields and heartbeat ticks during work. Same
  one inventory, 10,000 metadata calls, 1,428 exact edges, zero I/O/writes. All
  selected live index contents, runtime instances, data/settings and leaf preserved.
- Actual Live Preview navigation: two first displays, ten tab switches, six repeated
  opens. Zero inventories, Parent rebuild/scan/clear, note or frontmatter writes;
  34 raw/30 cached reads (28 raw first-use, six repeated-open). Tab switches have
  zero reads. Relationships and note hashes unchanged, saved data/settings/enabled
  set preserved; both temporary tabs detached and original leaf restored.
- The earlier console-access blocker was resolved by focusing TEST. No action was
  run in production. The real warm reload remains subject to a 122.8 ms gap; this
  patch does not claim to resolve other owners' startup costs. No app restart.
