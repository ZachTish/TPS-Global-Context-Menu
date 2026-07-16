# TPS-Global-Context-Menu (Dev) — Audit

Scope
- Reviewed files: [`src/main.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-Global-Context-Menu%20(Dev)/src/main.ts), [`src/plugin-api.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-Global-Context-Menu%20(Dev)/src/plugin-api.ts), [`src/tps-contracts.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-Global-Context-Menu%20(Dev)/src/tps-contracts.ts), [`src/core`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-Global-Context-Menu%20(Dev)/src/core).

Where issues are
- High: Command/menu injection is achieved via deep patching and readiness polling, which is brittle under Obsidian UI changes and can cause duplicate or missing actions.
- High: Context-menu state is coupled to view lifecycle with deferred timers, so fast pane navigation can produce stale patches and event handlers.
- High: Public API exposure still depends on runtime shape checks and legacy compatibility shims, creating silent breakage risk across plugin updates.
- Medium: Menu action registration has weak idempotency by context and view identity, so repeated initializations can re-register handlers.
- Medium: Cross-plugin calls are spread across core modules rather than a single adapter layer.
- Low: Limited telemetry for menu failures; action IDs are logged with little context.

User interaction risks
- Context actions can appear or disappear after quick note switches, especially in non-file/embedded views.
- The same item may appear twice across reopen cycles if cleanup is missed.
- Users receive vague messages when a menu action cannot execute due to contract drift.

Improvements
- Replace readiness polling with explicit Obsidian lifecycle hooks where possible and register menu handlers once per view registration event.
- Add dedupe keys for menu injections keyed by `viewType`, `markdownType`, and plugin version.
- Convert API surface to a small versioned contract object with explicit `supportsX` checks instead of property probing.
- Ensure command registration is centralized and returns a single boolean outcome to caller.
- Add structured diagnostics for failed menu injection and dispatch failures.

How to simplify/centralize
- Move all shared menu integration behavior into a lightweight `tps-context-menu` package:
  - registration lifecycle
  - idempotent patching
  - command envelope schema
  - standardized error reporting
- Centralize contract models with Calendar/Controller/Kanban usage so all plugins share one versioned action registry.
