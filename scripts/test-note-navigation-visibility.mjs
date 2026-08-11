import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const constantsSource = readFileSync(
  new URL("../src/constants.ts", import.meta.url),
  "utf8",
);
const managerSource = readFileSync(
  new URL("../src/menu/persistent-menu-manager.ts", import.meta.url),
  "utf8",
);
const eventsSource = readFileSync(
  new URL("../src/events/register-events.ts", import.meta.url),
  "utf8",
);
const settingsTabSource = readFileSync(
  new URL("../src/settings-tab.ts", import.meta.url),
  "utf8",
);
const typesSource = readFileSync(
  new URL("../src/types.ts", import.meta.url),
  "utf8",
);

const visibilityKeys = [
  "showCalendarNavButton",
  "showTasksNavButton",
  "showMentionsNavButton",
];

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function matchingBrace(source, openBrace) {
  assert.equal(
    source[openBrace],
    "{",
    `expected opening brace at ${openBrace}`,
  );
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  assert.fail(`unclosed block beginning at ${openBrace}`);
}

function guardedSymbolBlock(source, settingKey, symbol) {
  const symbolIndex = source.indexOf(`const ${symbol}`);
  assert.ok(symbolIndex >= 0, `missing ${symbol}`);
  const settingIndex = source.lastIndexOf(
    `settings.${settingKey}`,
    symbolIndex,
  );
  assert.ok(settingIndex >= 0, `${symbol} must be preceded by ${settingKey}`);
  const guardIndex = source.lastIndexOf("if (", settingIndex);
  assert.ok(
    guardIndex >= 0 && guardIndex < settingIndex,
    `${symbol} must be constructed inside a ${settingKey} guard`,
  );
  const openBrace = source.indexOf("{", guardIndex);
  assert.ok(
    openBrace > guardIndex && openBrace < symbolIndex,
    `${symbol} guard must open before construction`,
  );
  const closeBrace = matchingBrace(source, openBrace);
  assert.ok(
    closeBrace > symbolIndex,
    `${symbol} must remain inside its visibility guard`,
  );
  return {
    start: guardIndex,
    end: closeBrace + 1,
    source: source.slice(guardIndex, closeBrace + 1),
  };
}

test("note-navigation visibility settings are typed and default on for legacy payloads", () => {
  for (const key of visibilityKeys) {
    assert.match(typesSource, new RegExp(`\\b${key}: boolean;`));
    assert.match(constantsSource, new RegExp(`\\b${key}: true,`));
  }
});

test("all note-navigation controls live uniquely in Menus & surfaces and refresh immediately", () => {
  const menusSource = sourceBetween(
    settingsTabSource,
    "if (this.activeSettingsPage === 'menus-surfaces') {",
    "// --- Appearance Settings ---",
  );

  for (const key of [
    "enableTopParentNav",
    "topParentNavPlacement",
    ...visibilityKeys,
  ]) {
    const occurrences = [
      ...settingsTabSource.matchAll(
        new RegExp(`plugin\\.settings\\.${key}\\b`, "g"),
      ),
    ];
    assert.ok(
      occurrences.length >= 2,
      `${key} needs a value binding and a change handler`,
    );
    for (const occurrence of occurrences) {
      assert.ok(
        occurrence.index >= settingsTabSource.indexOf(menusSource) &&
          occurrence.index <
            settingsTabSource.indexOf(menusSource) + menusSource.length,
        `${key} must not be rendered outside Menus & surfaces`,
      );
    }
    assert.match(
      menusSource,
      new RegExp(
        `${key}[\\s\\S]{0,700}${key}\\s*=[\\s\\S]{0,220}saveSettings\\(\\)[\\s\\S]{0,220}persistentMenuManager\\.ensureMenus\\(\\)`,
      ),
      `${key} changes must save and rebuild the visible navigation`,
    );
  }
});

test("top navigation cache identity includes every independent visibility choice", () => {
  const ensureTopSource = sourceBetween(
    managerSource,
    "public ensureTopParentNav",
    "private getTopParentNavPlacement",
  );
  const signatureSource = sourceBetween(
    ensureTopSource,
    "const signature = [",
    "].join('|')",
  );

  for (const key of visibilityKeys) {
    assert.match(
      signatureSource,
      new RegExp(`\\b${key}\\b`),
      `${key} must invalidate the cached top navigation`,
    );
  }
  assert.match(
    signatureSource,
    /externalActionSignature/,
    "external action registration changes must invalidate the cached top navigation",
  );
  assert.match(
    ensureTopSource,
    /const showTopNavigation = this\.plugin\.settings\.enableTopParentNav === true/,
  );
});

test("Calendar visibility guards only the Calendar popover button", () => {
  const scheduledSource = sourceBetween(
    managerSource,
    "private createScheduledNavButtons(",
    "private createRelationshipNavButtons(",
  );
  const calendarGuard = guardedSymbolBlock(
    scheduledSource,
    "showCalendarNavButton",
    "calendarButton",
  );
  const dailyNoteIndex = scheduledSource.indexOf("const dailyNoteButton");

  assert.match(calendarGuard.source, /buttons\.push\(calendarButton\)/);
  assert.doesNotMatch(calendarGuard.source, /dailyNoteButton/);
  assert.ok(
    dailyNoteIndex > calendarGuard.end,
    "the scheduled Daily Note shortcut must remain outside the Calendar guard",
  );

  const ensureTopSource = sourceBetween(
    managerSource,
    "public ensureTopParentNav",
    "private getTopParentNavPlacement",
  );
  const scheduledDeclaration = sourceBetween(
    ensureTopSource,
    "const showScheduledButton",
    ";",
  );
  assert.doesNotMatch(
    scheduledDeclaration,
    /showCalendarNavButton/,
    "hiding Calendar must not suppress the helper that also creates the scheduled Daily Note shortcut",
  );
});

test("Tasks and Mentions are constructed under independent guards", () => {
  const relationshipSource = sourceBetween(
    managerSource,
    "private createRelationshipNavButtons(",
    "private createExternalActionButtons(",
  );
  const tasksGuard = guardedSymbolBlock(
    relationshipSource,
    "showTasksNavButton",
    "tasksButton",
  );
  const mentionsGuard = guardedSymbolBlock(
    relationshipSource,
    "showMentionsNavButton",
    "linksButton",
  );

  assert.match(tasksGuard.source, /buttons\.push\(tasksButton\)/);
  assert.doesNotMatch(tasksGuard.source, /linksButton/);
  assert.match(mentionsGuard.source, /buttons\.push\(linksButton\)/);
  assert.doesNotMatch(mentionsGuard.source, /tasksButton/);
  assert.ok(
    tasksGuard.end <= mentionsGuard.start ||
      mentionsGuard.end <= tasksGuard.start,
    "visibility guards must not be nested",
  );
});

test("top and bottom placements share the same gated button factories", () => {
  const ensureTopSource = sourceBetween(
    managerSource,
    "public ensureTopParentNav",
    "private getTopParentNavPlacement",
  );
  const ensureBottomSource = sourceBetween(
    managerSource,
    "private ensureBottomParentNav",
    "private createScheduledNavButtonsForFile",
  );

  assert.match(ensureTopSource, /createScheduledNavButtons\(/);
  assert.match(ensureTopSource, /createRelationshipNavButtons\(/);
  assert.match(ensureBottomSource, /createScheduledNavButtonsForFile\(/);
  assert.match(ensureBottomSource, /createRelationshipNavButtons\(/);
  assert.match(ensureBottomSource, /enableTopParentNav !== true/);
});

test("an all-hidden top navigation is not committed and preserves a nonempty shared host", () => {
  const ensureTopSource = sourceBetween(
    managerSource,
    "public ensureTopParentNav",
    "private getTopParentNavPlacement",
  );
  const prependIndex = ensureTopSource.indexOf(
    "topSurfaceHost.prepend(container)",
  );
  assert.ok(
    prependIndex >= 0,
    "top navigation must still use the shared title host",
  );

  const prefix = ensureTopSource.slice(0, prependIndex);
  const emptyGuardMatch = [
    ...prefix.matchAll(
      /if\s*\(\s*(?:container\.childElementCount\s*===\s*0|!container\.children\.length|!container\.hasChildNodes\(\))\s*\)\s*\{/g,
    ),
  ].at(-1);
  assert.ok(
    emptyGuardMatch,
    "an empty top navigation needs an explicit pre-commit guard",
  );
  const openBrace = prefix.indexOf("{", emptyGuardMatch.index);
  const closeBrace = matchingBrace(prefix, openBrace);
  const emptyGuardSource = prefix.slice(emptyGuardMatch.index, closeBrace + 1);
  assert.match(emptyGuardSource, /removeEmptyTopSurfaceHost\(view\)/);
  assert.match(emptyGuardSource, /return;/);
  assert.match(
    ensureTopSource,
    /removeTopParentNav\(view, \{ reserveFootprint: false, preserveTopHost: true \}\)/,
  );
});

test("asynchronously hidden external actions cannot leave an empty navigation container", () => {
  const refreshSource = sourceBetween(
    managerSource,
    "private async refreshExternalActionButton",
    "private async resolveExternalActionValue",
  );

  assert.match(
    refreshSource,
    /if \(!visible\)[\s\S]*removeExternalActionButton\(button\)/,
  );
  assert.match(
    refreshSource,
    /catch \(error\)[\s\S]*removeExternalActionButton\(button\)/,
  );
  assert.match(
    refreshSource,
    /removeNavigationContainerIfEmpty\(navigationContainer\)/,
  );
  assert.match(refreshSource, /topParentNavs\.delete\(view\)/);
  assert.match(refreshSource, /removeEmptyTopSurfaceHost\(view\)/);
  assert.match(refreshSource, /bottomParentNavs\.delete\(view\)/);
});

test("bottom navigation reconciliation reuses mounted and intentionally empty states", () => {
  const ensureTopSource = sourceBetween(
    managerSource,
    "public ensureTopParentNav",
    "private getTopParentNavPlacement",
  );
  assert.doesNotMatch(
    ensureTopSource,
    /!showTopNavigation \|\| relationshipPlacement !== 'bottom'/,
    "top placement must not tear down a stable mobile external-action group before reconciliation",
  );
  assert.match(
    ensureTopSource,
    /ensureBottomParentNav\(view, undefined, \{ force: options\.force === true \}\)/,
  );

  const ensureBottomSource = sourceBetween(
    managerSource,
    "private ensureBottomParentNav",
    "private createScheduledNavButtonsForFile",
  );
  const cacheGuardIndex = ensureBottomSource.indexOf(
    "if (!options.force && cachedSignature === signature",
  );
  const buttonFactoryIndex = ensureBottomSource.indexOf("const buttons =");

  assert.ok(cacheGuardIndex >= 0, "bottom navigation needs a non-forced cache guard");
  assert.ok(
    cacheGuardIndex < buttonFactoryIndex,
    "a cache hit must return before relationship and external button factories run",
  );
  assert.match(ensureBottomSource, /dataset\.tpsGcmBottomNavSignature/);
  assert.match(ensureBottomSource, /cachedState === 'mounted'/);
  assert.match(ensureBottomSource, /cachedState === 'empty'/);
  assert.match(ensureBottomSource, /group\.dataset\.signature = signature/);
  for (const key of visibilityKeys) {
    assert.match(
      ensureBottomSource,
      new RegExp(`\\b${key}\\b`),
      `${key} must invalidate the cached bottom navigation`,
    );
  }

  const emptyCleanupSource = sourceBetween(
    managerSource,
    "private removeNavigationContainerIfEmpty",
    "private async resolveExternalActionValue",
  );
  assert.match(
    emptyCleanupSource,
    /tpsGcmBottomNavSignature === container\.dataset\.signature[\s\S]*tpsGcmBottomNavState = 'empty'/,
    "async removal of the last hidden external action must cache the empty result",
  );

  const removeBottomSource = sourceBetween(
    managerSource,
    "private removeBottomParentNav",
    "private getParentChildRelationshipPaths",
  );
  assert.match(removeBottomSource, /delete menu\.dataset\.tpsGcmBottomNavSignature/);
  assert.match(removeBottomSource, /delete menu\.dataset\.tpsGcmBottomNavState/);
});

test("note-open refresh attaches late hosts without forcing stable navigation rebuilds", () => {
  const helperSource = sourceBetween(
    eventsSource,
    "const scheduleResponsiveMenuRefresh",
    "plugin.registerEvent(plugin.app.workspace.on('layout-change'",
  );
  assert.match(helperSource, /ensureMenus\?: boolean/);
  assert.match(helperSource, /force: opts\.force !== false/);
  assert.match(helperSource, /ensureMenus: opts\.ensureMenus === true/);

  const fileOpenSource = sourceBetween(
    eventsSource,
    "plugin.app.workspace.on('file-open'",
    "// ── Reactive completedDate sync",
  );
  assert.match(
    fileOpenSource,
    /scheduleResponsiveMenuRefresh\(file, \{[\s\S]*?ensureMenus: true,[\s\S]*?force: false,[\s\S]*?delayMs: 300/,
  );

  const refreshMenusSource = sourceBetween(
    managerSource,
    "  refreshMenusForFile(\n",
    "private shouldDeferStructuralRefreshForTyping",
  );
  assert.match(refreshMenusSource, /ensureTopParentNav\(view, \{ force \}\)/);
  assert.doesNotMatch(refreshMenusSource, /ensureTopParentNav\(view, \{ force: true \}\)/);
});

test("one relationship-nav construction enumerates reverse children only once", () => {
  const relationshipSource = sourceBetween(
    managerSource,
    "private createRelationshipNavButtons(",
    "private createExternalActionButtons(",
  );
  assert.equal(
    [...relationshipSource.matchAll(/this\.resolveChildFiles\(file\)/g)].length,
    1,
  );
  assert.match(
    relationshipSource,
    /refreshTopChildrenButtonLabel\(file, childFiles, childrenLabel, childrenButton\)/,
  );

  const labelRefreshSource = sourceBetween(
    managerSource,
    "private async refreshTopChildrenButtonLabel",
    "private getScheduledDateForFile",
  );
  assert.match(
    labelRefreshSource,
    /resolveChildFilesForTopButton\(file, knownChildren\)/,
  );

  const childResolverSource = sourceBetween(
    managerSource,
    "private async resolveChildFilesForTopButton",
    "private getEmbeddedMarkdownTargetPaths",
  );
  assert.match(
    childResolverSource,
    /knownChildren \?\? this\.resolveChildFiles\(file\)/,
  );
});
