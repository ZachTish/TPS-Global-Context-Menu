import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const commandSource = readFileSync(new URL('../src/commands/register-commands.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/views/home-view.ts', import.meta.url), 'utf8');
const pluginApiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
const logBaseViewSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
const logLineUtilsSource = readFileSync(new URL('../src/views/log-line-utils.ts', import.meta.url), 'utf8');
const homeWorkoutBaseSource = readFileSync(new URL('../src/views/home-workout-base.ts', import.meta.url), 'utf8');
const homeFoodDateSource = readFileSync(new URL('../src/views/home-food-date.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
const settingsTabSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const captureServiceSource = readFileSync(new URL('../src/services/home-capture-service.ts', import.meta.url), 'utf8');
const contextTargetServiceSource = readFileSync(new URL('../src/services/context-target-service.ts', import.meta.url), 'utf8');
const nativeCreateOwnerSource = readFileSync(new URL('../src/views/native-base-create-owner.ts', import.meta.url), 'utf8');
const tpsListBridgeSource = readFileSync(new URL('../src/views/tps-list-bridge-view.ts', import.meta.url), 'utf8');
const tpsListViewSource = readFileSync(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url), 'utf8');
const baseEmbedContextSource = readFileSync(new URL('../src/views/base-embed-context.ts', import.meta.url), 'utf8');
const dailyNoteHomeSource = readFileSync(new URL('../src/services/daily-note-home-service.ts', import.meta.url), 'utf8');
const viewModeManagerSource = readFileSync(new URL('../src/handlers/view-mode-manager.ts', import.meta.url), 'utf8');
const fileSuggestModalSource = readFileSync(new URL('../src/modals/FileSuggestModal.ts', import.meta.url), 'utf8');
const openTasksBaseSource = readFileSync(new URL('./fixtures/Open Unscheduled Tasks.base', import.meta.url), 'utf8');
const foodLogBaseSource = readFileSync(new URL('./fixtures/Food Log.base', import.meta.url), 'utf8');
const tasksBaseSource = readFileSync(new URL('./fixtures/Tasks.base', import.meta.url), 'utf8');

async function loadHomeContextModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/home-context.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadPureModule(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadFileSuggestModal() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/modals/FileSuggestModal.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'file-suggest-modal-test-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'file-suggest-obsidian' }));
        builder.onLoad({ filter: /.*/, namespace: 'file-suggest-obsidian' }, () => ({
          loader: 'js',
          contents: `
            export class FuzzySuggestModal {
              constructor(app) { this.app = app; }
            }
            export class TFile {
              constructor(path, extension) { this.path = path; this.extension = extension; }
            }
            export class TFolder {
              constructor(path = '') {
                this.path = path;
                this.name = String(path).split('/').pop() || '';
                this.children = [];
              }
            }
            export class Notice {}
            export function normalizePath(value) {
              return String(value ?? '').replace(/\\\\/g, '/').replace(/^\\/+|\\/+$/g, '');
            }
            export function parseYaml(value) {
              try { return JSON.parse(String(value || '{}')); } catch { return {}; }
            }
            export function stringifyYaml(value) { return JSON.stringify(value ?? {}); }
            globalThis.__homeFileSuggestTestTFile = TFile;
          `,
        }));
        builder.onResolve({ filter: /^\.\.\/logger$/ }, () => ({ path: 'logger', namespace: 'file-suggest-logger' }));
        builder.onLoad({ filter: /^logger$/, namespace: 'file-suggest-logger' }, () => ({
          loader: 'js',
          contents: 'export function flowError() {}',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function createMomentFactory(nowIso = '2026-07-04') {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (value) => String(value).padStart(2, '0');
  const parseDate = (value) => {
    const source = value == null ? nowIso : value;
    if (source instanceof Date) return new Date(source.getTime());
    const match = String(source || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return parseDate(nowIso);
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0);
  };
  const wrap = (value) => {
    const date = parseDate(value);
    return {
      clone: () => wrap(date),
      startOf: (unit) => {
        if (unit === 'day') date.setHours(0, 0, 0, 0);
        return wrap(date);
      },
      format: (format) => String(format || '')
        .replace('YYYY', String(date.getFullYear()))
        .replace('MMM', months[date.getMonth()])
        .replace('MM', pad(date.getMonth() + 1))
        .replace('DD', pad(date.getDate()))
        .replace('D', String(date.getDate()))
        .replace('ddd', weekdays[date.getDay()]),
      isSame: (other, unit) => {
        const otherDate = parseDate(other?.toDate?.() ?? other);
        if (unit === 'day') {
          return date.getFullYear() === otherDate.getFullYear()
            && date.getMonth() === otherDate.getMonth()
            && date.getDate() === otherDate.getDate();
        }
        return date.getTime() === otherDate.getTime();
      },
      toDate: () => new Date(date.getTime()),
    };
  };
  return (value) => wrap(value);
}

test('TPS Home is registered as a rendered Obsidian view', () => {
  assert.match(viewSource, /export const TPS_HOME_VIEW_TYPE = 'tps-home'/);
  assert.match(viewSource, /extends ItemView/);
  assert.match(mainSource, /registerView\(TPS_HOME_VIEW_TYPE/);
  assert.match(mainSource, /async openHomeView\(\): Promise<void>/);
  assert.match(commandSource, /id: 'open-home'/);
  assert.match(commandSource, /name: 'Open TPS Home'/);
});

test('Daily Note reading mode becomes a date-backed TPS Home view', () => {
  assert.match(mainSource, /new DailyNoteHomeService\(this\)/);
  assert.match(dailyNoteHomeSource, /leaf\.view instanceof MarkdownView/);
  assert.match(dailyNoteHomeSource, /leaf\.view\.getMode\(\) !== 'preview'/);
  assert.match(dailyNoteHomeSource, /parseDailyNoteFileDate\(this\.plugin\.app, this\.plugin\.settings, file\)/);
  assert.match(dailyNoteHomeSource, /type: TPS_HOME_VIEW_TYPE/);
  assert.match(dailyNoteHomeSource, /dailyNotePath: targetPath/);
  assert.match(dailyNoteHomeSource, /reading:render-home/);
  assert.match(viewSource, /getState\(\): Record<string, unknown>/);
  assert.match(viewSource, /async setState\(state: Record<string, unknown>\): Promise<void>/);
  assert.match(viewSource, /private unresolvedDailyNotePath: string \| null = null/);
  assert.match(viewSource, /const statePath = this\.dailyNotePath \?\? this\.unresolvedDailyNotePath/);
  assert.match(viewSource, /this\.unresolvedDailyNotePath = file instanceof TFile \? null : requestedPath \|\| null/);
  assert.match(viewSource, /isDailyNoteBacked\(\): boolean \{\s*return this\.dailyNotePath !== null;/);
  assert.match(viewSource, /\(this\.leaf as any\)\.updateHeader\?\.\(\)/);
  assert.match(viewSource, /private async navigateToDailyNoteHome\(date: any\): Promise<void>/);
  assert.match(viewSource, /homeCaptureService\.getDailyNoteForCapture\(date\)/);
  assert.match(viewSource, /Edit this Daily Note in Live Preview/);
  assert.match(viewSource, /dailyNoteHomeService\.allowLivePreview\(this\.leaf, dailyNote\.path\)/);
  assert.match(viewSource, /mode: 'source',\s*source: false/);
  assert.match(dailyNoteHomeSource, /isLivePreviewOverride\(leaf: WorkspaceLeaf\): boolean/);
  assert.match(viewModeManagerSource, /dailyNoteHomeService\?\.isLivePreviewOverride\(leaf\)/);
  assert.match(mainSource, /leaf\.view instanceof TpsHomeView && !leaf\.view\.isDailyNoteBacked\(\)/);
});

test('TPS Home coalesces initial open and Daily Note state into one render', () => {
  assert.match(viewSource, /private homeInitialRenderTimer: number \| null = null/);
  assert.match(viewSource, /this\.rootEl = this\.contentEl\.createDiv\(\{ cls: 'tps-home-root' \}\);\s*this\.scheduleInitialHomeRender\(\);/);
  assert.match(viewSource, /const coalescedInitialRender = this\.cancelInitialHomeRender\('state'\)/);
  assert.match(viewSource, /if \(!coalescedInitialRender && !stateChanged && this\.rootEl\.hasChildNodes\(\)\)/);
  assert.match(viewSource, /initial-render:coalesced/);
  assert.match(viewSource, /this\.cancelInitialHomeRender\('close'\)/);
  assert.doesNotMatch(viewSource, /this\.rootEl = this\.contentEl\.createDiv\(\{ cls: 'tps-home-root' \}\);\s*await this\.render\(\);/);
  assert.match(mainSource, /let created = false/);
  assert.match(mainSource, /created = true;\s*await homeLeaf\.setViewState/);
  assert.match(mainSource, /if \(!created && homeLeaf\.view instanceof TpsHomeView\) \{\s*await homeLeaf\.view\.render\(\);/);
  assert.match(viewSource, /'render:start'/);
  assert.match(viewSource, /'render:done'/);
});

test('TPS Home separates dashboard UI from daily-note capture storage', () => {
  assert.match(viewSource, /Quick capture/);
  assert.match(viewSource, /HOME_CAPTURE_TRIGGERS/);
  assert.match(viewSource, /\(\^\|\\s\)#food\(\?=\\s\|\$\)/);
  assert.match(viewSource, /HomeCaptureTriggerModal/);
  assert.match(viewSource, /Describe food/);
  assert.match(viewSource, /Keep as capture/);
  assert.match(viewSource, /food-describe-clear/);
  assert.match(viewSource, /HomeCaptureTrigger', 'food-describe:failed/);
  assert.match(viewSource, /homeCaptureEditTarget/);
  assert.match(viewSource, /Save changes/);
  assert.match(viewSource, /quick-capture:edit-cancelled/);
  assert.match(viewSource, /replaceHomeCaptureSessionRange/);
  assert.match(viewSource, /session\.originalEditLine, `edit-\$\{reason\}-rollback`/);
  assert.match(viewSource, /await session\.view\.save\(\)/);
  assert.match(viewSource, /Esc Cancel/);
  assert.match(viewSource, /onLineClick/);
  assert.match(captureServiceSource, /element\.dataset\.taskPath = file\.path/);
  assert.match(captureServiceSource, /element\.dataset\.taskLine = String\(line \+ 1\)/);
  assert.doesNotMatch(captureServiceSource, /element\.setAttr\('title', 'Edit task'\);\s*continue;/);
  assert.match(captureServiceSource, /element\.setAttr\('title', 'Edit this line in Quick Capture'\)/);
  assert.match(viewSource, /new MarkdownView\(this\.leaf\)/);
  assert.match(viewSource, /class: HOME_CAPTURE_HIDDEN_LINE_CLASS/);
  assert.match(viewSource, /StateEffect\.appendConfig\.of/);
  assert.match(viewSource, /file: dailyNote\.path,\s*mode: 'source',\s*source: false/);
  assert.match(viewSource, /homeCaptureService\.formatCaptureValue\(value, task\)/);
  assert.match(viewSource, /homeCaptureService\.formatCaptureValue\(value, task\)/);
  assert.match(viewSource, /prepareHomeCaptureDraft\(current, this\.plugin\.settings\.homeCaptureInsertPosition\)/);
  assert.match(viewSource, /replaceHomeCaptureRangeIfUnchanged/);
  assert.match(viewSource, /this\.app\.vault\.process\(session\.file/);
  assert.match(viewSource, /quick-capture:revision-conflict/);
  assert.match(viewSource, /private async runHomeRenderLoop\(\): Promise<void>/);
  assert.match(viewSource, /private async prepareHomeCaptureForTeardown\(reason: 'render' \| 'close'\)/);
  assert.match(viewSource, /validateCaptureValue\(value, today\.clone\(\), \{ task \}\)/);
  assert.match(viewSource, /quick-capture:editor-mounted/);
  assert.match(viewSource, /quick-capture:editor-mount-failed/);
  assert.match(viewSource, /private async closeHomeCaptureMarkdownView\(view: MarkdownView\)/);
  assert.match(viewSource, /if \(Platform\.isMobile\) \{/);
  assert.match(viewSource, /renderMobileQuickCapture/);
  assert.match(viewSource, /createEl\('textarea'/);
  assert.match(viewSource, /homeCaptureService\.capture\(value, today\.clone\(\), \{[\s\S]*?historyCause:[\s\S]*?surface: 'home-quick-capture-mobile'/u);
  assert.match(viewSource, /'home-quick-capture-desktop'/u);
  assert.match(viewSource, /private async beginHomeTaskHistory\(/u);
  assert.match(viewSource, /private async commitHomeTaskHistory\(/u);
  assert.match(viewSource, /this\.applyHomeTaskHistoryIdentities\(replacement, historyIntents\)/u);
  assert.match(viewSource, /await this\.commitHomeTaskHistory\(historyIntents, processed\)/u);
  assert.match(viewSource, /candidates\.push\(\{ action: 'task\.delete', beforeRawLine/u);
  assert.match(viewSource, /candidates\.push\(\{ action: 'task\.create', beforeRawLine: nextRawLine/u);
  assert.match(captureServiceSource, /classifyHomeCaptureLineHistoryAction\(this\.snapshot\.value, replacement\)/u);
  assert.match(captureServiceSource, /surface: 'home-line-editor'/u);
  assert.match(captureServiceSource, /surface: 'home-capture-form'/u);
  assert.match(captureServiceSource, /surface: 'home-capture-modal'/u);
  assert.match(captureServiceSource, /private async beginCaptureTaskHistory\(/u);
  assert.match(viewSource, /idleDailyNoteWrite: false/);
  assert.match(viewSource, /resolveHomeCaptureLineRange\(content, editTarget\.line\)/);
  assert.match(viewSource, /quick-capture:mobile-edit-saved/);
  assert.match(viewSource, /const nextHeight = textarea\.scrollHeight/);
  assert.match(viewSource, /textarea\.style\.height = '1px'/);
  assert.match(viewSource, /focusMobileCaptureSurface/);
  assert.match(viewSource, /textarea\.focus\(\{ preventScroll: true \}\)/);
  assert.match(viewSource, /editorHost\.addEventListener\('touchstart', focusMobileCaptureSurface, \{ capture: true, passive: false \}\)/);
  assert.match(viewSource, /textarea\.style\.overflowY = 'hidden'/);
  assert.match(viewSource, /textarea\.scrollTop = 0/);
  assert.doesNotMatch(viewSource, /localStorage|readHomeCaptureDraft|writeHomeCaptureDraft/);
  assert.doesNotMatch(captureServiceSource, /HOME_CAPTURE_DRAFT_PATH/);
  assert.match(viewSource, /getDailyNoteForCapture/);
  assert.match(viewSource, /addEventListener\('pointerdown', handleCaptureSurfacePointer, \{ capture: true \}\)/);
  assert.match(viewSource, /addEventListener\('touchstart', handleCaptureSurfacePointer, \{ capture: true, passive: false \}\)/);
  assert.match(viewSource, /if \(!target\?\.closest\('\.cm-content'\)\) event\.preventDefault\(\)/);
  assert.match(stylesSource, /\.tps-home-embedded-markdown-view/);
  assert.match(stylesSource, /\.tps-home-embedded-markdown-view \.metadata-container/);
  assert.match(stylesSource, /\.tps-home-embedded-markdown-view \.cm-sizer,/);
  assert.match(stylesSource, /\.tps-home-embedded-markdown-view \.cm-content \{\s*min-height: 100%;/);
  assert.match(stylesSource, /\.tps-home-embedded-markdown-view \.tps-home-capture-hidden-source-line/);
  assert.match(stylesSource, /\.tps-home-native-capture-textarea/);
  assert.match(captureServiceSource, /insertHomeCaptureBlock/);
  assert.match(captureServiceSource, /formatHomeCaptureBlock/);
  assert.match(captureServiceSource, /validateCaptureValue/);
  assert.match(captureServiceSource, /addHeading: false/);
  assert.match(captureServiceSource, /listHomeCaptureHeadings/);
  assert.match(captureServiceSource, /homeCaptureInsertPosition/);
  assert.match(captureServiceSource, /showOpenDailyNoteButton\?: boolean/);
  assert.match(captureServiceSource, /Add as an unchecked task/);
  assert.match(captureServiceSource, /text: 'Add to day'/);
  assert.match(captureServiceSource, /text: 'Add task'/);
  assert.match(captureServiceSource, /updateSubmitState/);
  assert.match(captureServiceSource, /setIcon\(captureTask, 'list-checks'\)/);
  assert.match(captureServiceSource, /submit\(\{ task: true \}\)/);
  assert.match(captureServiceSource, /options\.preserveMarkdown === true/);
  assert.match(captureServiceSource, /formatCaptureMarkdownForWrite\(value, timestamp\)/);
  assert.match(captureServiceSource, /formatHomeCaptureBlock\(value, timestamp, \{ task: options\.task === true \}\)/);
  assert.match(captureServiceSource, /Open daily note/);
  assert.match(captureServiceSource, /MarkdownRenderer/);
  assert.match(captureServiceSource, /getDailyNotePreview/);
  assert.match(captureServiceSource, /renderDailyNotePreview/);
  assert.match(captureServiceSource, /formatWorkoutLogPreview\(body\)/);
  assert.match(captureServiceSource, /removeMissingWorkoutSummaries\(file, content\)/);
  assert.match(captureServiceSource, /tps-health:workout/);
  assert.match(captureServiceSource, /tps-home-workout-card/);
  assert.match(captureServiceSource, /frontmatter\?\.status/);
  assert.match(captureServiceSource, /=== 'wont-do'/);
  assert.match(captureServiceSource, /card\.addClass\('is-abandoned'\)/);
  assert.match(captureServiceSource, /text: 'Abandoned'/);
  assert.match(stylesSource, /\.tps-home-workout-card\.is-abandoned/);
  assert.match(captureServiceSource, /previewBodyClasses = \['tps-home-capture-preview-body', 'markdown-rendered'\]/);
  assert.match(captureServiceSource, /previewBodyClasses\.push\('tps-home-scroll-host'\)/);
  assert.match(captureServiceSource, /openCaptureModalForContext/);
  assert.match(captureServiceSource, /openAndWait\(\): Promise<boolean>/);
  assert.match(viewSource, /homeCaptureService\.renderDailyNotePreview\(panel/);
  assert.match(viewSource, /date: today\.clone\(\)/);
  assert.match(viewSource, /renderWorkoutBase/);
  assert.match(viewSource, /getHomeWorkoutBaseFile/);
  assert.match(viewSource, /ensureDefaultWorkoutLogBaseFile/);
  assert.match(viewSource, /ensureActivityLogBase \|\| healthApi\?\.ensureWorkoutLogBase/);
  assert.doesNotMatch(viewSource, /Show workout logs/);
  assert.doesNotMatch(viewSource, /HomeWorkoutLogsModal/);
  assert.doesNotMatch(viewSource, /getHomeWorkoutLogEntries/);
  assert.match(viewSource, /className: 'tps-home-capture-preview tps-home-capture-preview--home'/);
  assert.doesNotMatch(viewSource, /const next = this\.insertUnderHeading\(existing, 'Capture', block\)/);
  assert.doesNotMatch(captureServiceSource, /const next = this\.insertUnderHeading\(existing, 'Capture', block\)/);
  assert.doesNotMatch(captureServiceSource, /## Capture\\n\\n/);
  assert.match(captureServiceSource, /noteOperationService\.ensureDailyNote/);
  assert.doesNotMatch(captureServiceSource, /getDailyNotePath/);
  assert.doesNotMatch(viewSource, /private async appendCapture/);
  assert.doesNotMatch(viewSource, /private insertCaptureBlock/);
  assert.doesNotMatch(viewSource, /private async ensureDailyNote/);
  assert.doesNotMatch(viewSource, /private getDailyNotePath/);
  assert.match(commandSource, /id: 'home-quick-capture'/);
  assert.match(commandSource, /name: "Capture: Today's Daily Note"/);
  assert.match(commandSource, /id: 'capture-to-current-note'/);
  assert.match(commandSource, /homeCaptureService\.openCaptureModal/);
  assert.match(captureServiceSource, /targetPath: context\.dailyNotePath|context\.dailyNotePath/);
  assert.match(captureServiceSource, /tps-home-context-capture-input/);
  assert.match(stylesSource, /\.tps-home-view/);
  assert.match(stylesSource, /\.workspace-leaf-content\[data-type="tps-home"\] > \.view-header \{\s*display: none;/);
  assert.match(stylesSource, /\.workspace-leaf-content\[data-type="tps-home"\] > \.view-content \{[\s\S]*padding: 0;/);
  assert.match(stylesSource, /\.tps-home-grid/);
  assert.match(stylesSource, /\.tps-home-header \{\s*position: sticky;\s*top: 0;\s*z-index: 20;/);
  assert.match(stylesSource, /\.tps-home-header \{[\s\S]*backdrop-filter: blur\(12px\);/);
  assert.match(stylesSource, /\.tps-home-capture-editor/);
  assert.match(stylesSource, /\.tps-home-capture-tag-suggest/);
  assert.match(stylesSource, /\.tps-home-capture-preview-body/);
  assert.match(stylesSource, /\.tps-home-workout-card/);
  assert.match(stylesSource, /\.tps-home-workout-card-title/);
  assert.doesNotMatch(stylesSource, /\.tps-home-workout-logs-body/);
  assert.doesNotMatch(stylesSource, /\.tps-home-workout-log-row/);
  assert.match(stylesSource, /\.tps-home-component-quick-capture/);
  assert.match(stylesSource, /\.tps-home-capture-preview--home/);
  assert.match(stylesSource, /overflow: auto/);
  assert.match(stylesSource, /flex-direction: column/);
});

test('desktop Home quick-capture edits preserve hidden TPS metadata without exposing stale payloads', async () => {
  assert.match(
    viewSource,
    /const replacement = editTarget && originalEditLine != null\s*\?\s*preserveTpsInlinePropsMetadata\(originalEditLine, value\)/u,
    'the desktop edit-save path must merge the edited value with metadata from the original line',
  );

  const {
    preserveTpsInlinePropsMetadata,
    stripTaskInlinePropsMetadata,
  } = await loadPureModule('../src/utils/task-line-metadata.ts');
  const original = [
    '- [ ] Original title [priority:: low]',
    '%% tps-inline-props:{"createdDate":"2026-07-28 08:15:00","externalId":"reminders:abc","remindersSyncedCompleted":false} %%',
  ].join(' ');
  const edited = [
    '- [ ] Renamed title [priority:: high]',
    '%% tps-inline-props:{"createdDate":"stale-visible-value","externalId":"stale-visible-id"} %%',
  ].join(' ');

  const saved = preserveTpsInlinePropsMetadata(original, edited);

  assert.equal(
    stripTaskInlinePropsMetadata(saved),
    '- [ ] Renamed title [priority:: high]',
    'only the edited user-visible line should remain visible',
  );
  assert.match(saved, /"createdDate":"2026-07-28 08:15:00"/u);
  assert.match(saved, /"externalId":"reminders:abc"/u);
  assert.match(saved, /"remindersSyncedCompleted":false/u);
  assert.doesNotMatch(saved, /stale-visible/u);
  assert.equal((saved.match(/tps-inline-props:/gu) || []).length, 1);
});

test('TPS Home selected-day daily-note opens use the shared focused-tab opener', () => {
  assert.match(captureServiceSource, /this\.plugin\.openFileInLeaf\(file, false/);
  assert.doesNotMatch(captureServiceSource, /getLeaf\(false\)\.openFile/);
  assert.doesNotMatch(captureServiceSource, /await this\.plugin\.app\.workspace\.getLeaf\(false\)\.openFile/);
});

test('TPS Home defaults to a Daily Note feed Base plus reusable dashboard components', () => {
  assert.match(typesSource, /export type HomeBuiltInComponentId = 'quick-capture' \| 'calendar' \| 'food-tracker' \| 'workout-tracker' \| 'open-unscheduled-tasks'/);
  assert.match(typesSource, /export type HomeBaseComponent = \{ type: 'base'; path: string \}/);
  assert.match(typesSource, /export type HomeCommandComponent = \{ type: 'command'; commandId: string; title\?: string; icon\?: string \}/);
  assert.match(typesSource, /export interface HomeComponentLayout/);
  assert.match(typesSource, /homeComponentLayouts: Record<string, HomeComponentLayout>/);
  assert.match(typesSource, /export type HomeComponentId = HomeBuiltInComponentId \| HomeBaseComponent \| HomeCommandComponent/);
  assert.match(constantsSource, /HOME_DAILY_NOTE_FEED_BASE_PATH = 'Daily Note Feed\.base'/);
  assert.match(constantsSource, /name: Daily note\s+createAction: default\s+filters:/);
  assert.match(constantsSource, /\{ type: 'base', path: HOME_DAILY_NOTE_FEED_BASE_PATH \}/);
  assert.match(constantsSource, /homeComponentLayouts: \{\}/);
  assert.match(constantsSource, /homeComponentActions:/);
  assert.match(constantsSource, /homeCalendarBasePath: 'home-schedule\.base'/);
  assert.match(mainSource, /normalizeHomeComponents/);
  assert.match(mainSource, /normalizeHomeComponentLayouts/);
  assert.match(mainSource, /trimmed === 'quick-capture'/);
  assert.doesNotMatch(mainSource, /normalized\.splice\(foodIndex \+ 1, 0, 'workout-tracker'\)/);
  assert.match(viewSource, /HOME_COMPONENTS/);
  assert.match(viewSource, /renderQuickCapture/);
  assert.match(viewSource, /renderCalendar/);
  assert.match(viewSource, /renderFoodBase/);
  assert.match(viewSource, /renderWorkoutBase/);
  assert.doesNotMatch(viewSource, /renderFinances/);
  assert.doesNotMatch(viewSource, /getHomeFinanceTransactionsBaseFile/);
  assert.doesNotMatch(viewSource, /getFinancesPlugin/);
  assert.doesNotMatch(constantsSource, /'finances'/);
  assert.doesNotMatch(typesSource, /'finances'/);
  assert.match(logBaseViewSource, /lineMatchesHomeDateContext\(fields, file\)/);
  assert.match(homeFoodDateSource, /fields\.date/);
  assert.match(logBaseViewSource, /displayInlineValue/);
  assert.match(logBaseViewSource, /frontmatter\.accountName \|\| frontmatter\.title/);
  assert.match(pluginApiSource, /dailyNotes:/);
  assert.match(pluginApiSource, /ensureForIsoDate/);
  assert.match(pluginApiSource, /getDailyNotePathForIsoDate/);
  assert.match(viewSource, /renderOpenTasksBase/);
  assert.match(viewSource, /renderCommandPanel/);
  assert.match(constantsSource, /homeFoodBasePath: 'Food Log\.base'/);
  assert.match(constantsSource, /homeWorkoutBasePath: 'Activity Log\.base'/);
  assert.match(constantsSource, /homeOpenTasksBasePath: 'Open Unscheduled Tasks\.base'/);
  assert.doesNotMatch(viewSource, /renderPanel\(grid, 'Feed'/);
  assert.doesNotMatch(viewSource, /renderPanel\(grid, 'Logs'/);
});

test('TPS Home components render only Bases or command-triggered workflows', () => {
  assert.match(viewSource, /tps-home-native-capture-editor/);
  assert.match(viewSource, /tps-home-embedded-markdown-view/);
  assert.match(viewSource, /tps-home-native-capture-textarea/);
  assert.match(captureServiceSource, /openCaptureModal/);
  assert.match(viewSource, /renderBasePanel/);
  assert.match(viewSource, /MarkdownRenderer\.render\(this\.app, `!\[\[\$\{baseFile\.path\}\]\]`, host, sourcePath, embedComponent\)/);
  assert.match(viewSource, /getHomeFoodBaseFile/);
  assert.match(viewSource, /getHomeOpenTasksBaseFile/);
  assert.match(stylesSource, /\.tps-home-base-host/);
  assert.match(stylesSource, /--tps-home-base-host-max-height: min\(70vh, 680px\)/);
  assert.match(stylesSource, /\.tps-home-base-host,\s*\.tps-home-calendar-base-host \{\s*[\s\S]*max-height: var\(--tps-home-base-host-max-height\);\s*[\s\S]*overflow: auto;/);
  assert.match(stylesSource, /-webkit-overflow-scrolling: touch/);
  assert.match(stylesSource, /\.tps-home-capture-preview--home \.tps-home-capture-preview-body \{[\s\S]*overflow: auto;[\s\S]*touch-action: pan-y;[\s\S]*-webkit-overflow-scrolling: touch;/);
  assert.match(stylesSource, /body\.is-mobile \.tps-home-native-capture-editor--mobile,[\s\S]*min-height: 0;[\s\S]*height: auto;[\s\S]*max-height: none;/);
  assert.match(stylesSource, /body\.is-mobile \.tps-home-native-capture > \.tps-home-capture-actions,[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(stylesSource, /body\.is-mobile \.tps-home-native-capture \.tps-home-capture-shortcut,[\s\S]*display: none;/);
  assert.match(stylesSource, /touch-action: pan-x pan-y/);
  assert.match(stylesSource, /\.tps-home-scroll-host \{\s*[\s\S]*cursor: auto;[\s\S]*overflow: auto;/);
  assert.match(viewSource, /private registerHomeInnerScrollHandlers\(\): void/);
  assert.doesNotMatch(viewSource, /activeHomeScrollHost|suppressHomeScrollHostClick|pendingHomeScrollTouch/);
  assert.doesNotMatch(viewSource, /this\.registerDomEvent\(this\.contentEl, '(?:pointerdown|pointerup|wheel)'/);
  assert.doesNotMatch(stylesSource, /is-tps-home-scroll-active/);
  assert.match(viewSource, /this\.registerDomEvent\(document, 'wheel'[\s\S]*const modal = this\.getHomeOutsideScrollModal\(event\.target\);[\s\S]*this\.closeHomeModalForOutsideScroll\(modal\);[\s\S]*this\.scrollHomeElement\(this\.contentEl, event\.deltaY\);[\s\S]*passive: false/);
  assert.match(viewSource, /this\.registerDomEvent\(document, 'touchmove'[\s\S]*const modal = this\.getHomeOutsideScrollModal\(event\.target, touch\.clientX, touch\.clientY\);[\s\S]*this\.closeHomeModalForOutsideScroll\(modal\);[\s\S]*this\.scrollHomeElement\(this\.contentEl, deltaY\);[\s\S]*passive: false/);
  assert.match(viewSource, /private getHomeOutsideScrollModal\(target: EventTarget \| null, clientX\?: number, clientY\?: number\): HTMLElement \| null/);
  assert.match(viewSource, /if \(this\.app\.workspace\.activeLeaf\?\.view !== this\) return null;/);
  assert.match(viewSource, /if \(targetEl && modal\.contains\(targetEl\)\) \{/);
  assert.match(viewSource, /private closeHomeModalForOutsideScroll\(modal: HTMLElement\): void/);
  assert.match(viewSource, /modal\.querySelector<HTMLElement>\('\.modal-close-button, button\[aria-label="Close"\], button\[aria-label="Close modal"\]'\)/);
  assert.match(viewSource, /private getHomeElementMaxScrollTop\(element: HTMLElement\): number/);
  assert.doesNotMatch(viewSource, /this\.registerDomEvent\(this\.contentEl, 'touchmove'/);
  assert.doesNotMatch(viewSource, /private lastHomeInnerTouchY/);
  assert.match(viewSource, /private consumeHomeScrollEvent\(event: Event\): void/);
  assert.match(viewSource, /event\.stopImmediatePropagation\(\);/);
  assert.match(viewSource, /private scrollHomeElement\(host: HTMLElement, deltaY: number\)/);
  assert.match(stylesSource, /\.tps-home-capture/);
  assert.doesNotMatch(viewSource, /buildModel/);
  assert.doesNotMatch(viewSource, /model\.openUnscheduledTasks/);
  assert.doesNotMatch(viewSource, /renderTaskPanel\(grid/);
  assert.doesNotMatch(viewSource, /renderFoodTracker\(grid/);
  assert.doesNotMatch(viewSource, /tps-home-command-card/);
  assert.match(contextTargetServiceSource, /if \(target\.closest\('\.tps-home-panel'\)\) return false;/);
});

test('TPS Home stamps explicit Base identity for embedded filter resolution', () => {
  assert.match(viewSource, /panel\.dataset\.tpsBasePath = baseFile\.path/);
  assert.match(viewSource, /host\.dataset\.tpsBasePath = baseFile\.path/);
  assert.match(tpsListViewSource, /\[data-tps-base-path\]/);
  assert.match(logBaseViewSource, /host\?\.dataset\.tpsBasePath/);
  assert.match(viewSource, /await this\.stampHomeBaseDefinition\(panel, host, baseFile\)/);
  assert.match(viewSource, /dataset\.tpsBaseDefinition = serialized/);
  assert.match(tpsListViewSource, /getStampedBaseFilterRoots/);
  assert.match(logBaseViewSource, /getStampedBaseFilterRoots/);
  assert.match(tpsListBridgeSource, /inheritBaseEmbedContext\(containerEl\)/);
  assert.match(tpsListBridgeSource, /containerEl\.dataset\.tpsBaseDefinition = host\.dataset\.tpsBaseDefinition/);
  assert.match(viewSource, /withBaseEmbedRenderContext/);
  assert.match(tpsListBridgeSource, /getCurrentBaseEmbedRenderContext/);
  assert.match(logBaseViewSource, /getCurrentBaseEmbedRenderContext/);
  assert.match(baseEmbedContextSource, /renderContextStack/);
  assert.match(baseEmbedContextSource, /takePendingBaseEmbedRenderContext/);
  assert.match(baseEmbedContextSource, /definitionHasViewType/);
});

test('TPS Home Base components expose a focused Open Base context action', () => {
  assert.match(viewSource, /panel\.addEventListener\('contextmenu', \(event: MouseEvent\) => \{/);
  assert.match(viewSource, /this\.openHomeComponentBaseContextMenu\(event, panel, component\)/);
  assert.match(viewSource, /if \(event\.defaultPrevented\) return;/);
  assert.match(viewSource, /panel\.dataset\.tpsBasePath \|\| configuredPath/);
  assert.ok((viewSource.match(/panel\.dataset\.tpsBasePath = baseFile\.path/g) || []).length >= 2);
  assert.match(viewSource, /item\.setTitle\(baseFile \? 'Open Base' : 'Open Base \(not found\)'\)/);
  assert.match(viewSource, /item\.setDisabled\(!baseFile\)/);
  assert.match(viewSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(viewSource, /this\.plugin\.openFileInLeaf\(\s*baseFile,\s*'tab'/);
  assert.match(viewSource, /component-base:menu-open/);
  assert.match(viewSource, /component-base:open-done/);
  assert.match(contextTargetServiceSource, /if \(target\.closest\('\.tps-home-panel'\)\) return false;/);
});

test('TPS Home can move, remove, and add components', () => {
  assert.match(viewSource, /private editMode = false/);
  assert.match(viewSource, /Edit Home layout/);
  assert.match(viewSource, /Done editing Home/);
  assert.match(viewSource, /const addButton = this\.createIconButton\(actions, 'plus', 'Add Home component'/);
  assert.match(viewSource, /addButton\.createSpan\(\{ text: 'Add component' \}\)/);
  assert.match(viewSource, /this\.homeAddComponentButton = addButton/);
  assert.match(viewSource, /this\.registerDomEvent\(window, 'click'/);
  assert.match(viewSource, /const hitsButtonBounds = event\.clientX >= rect\.left/);
  assert.match(viewSource, /this\.showAddComponentMenu\(button, event\.clientX, event\.clientY\)/);
  assert.match(viewSource, /if \(!this\.editMode\) return;/);
  assert.match(viewSource, /showAddComponentMenu/);
  assert.match(viewSource, /window\.setTimeout\(\(\) => \{\s*if \(!this\.editMode \|\| !anchor\.isConnected\) return;\s*menu\.showAtPosition/);
  assert.doesNotMatch(viewSource, /menu\.showAtMouseEvent\(event\)/);
  assert.match(viewSource, /\.filter\(\(file\) => file\.extension === 'base'/);
  assert.match(viewSource, /onClick\(\(\) => void this\.addComponent\(\{ type: 'base', path: file\.path \}\)\)/);
  assert.match(viewSource, /onClick\(\(\) => void this\.addComponent\(\{ type: 'command', commandId: command\.id, title: command\.name \}\)\)/);
  assert.match(viewSource, /getHomeBaseComponentKey/);
  assert.match(viewSource, /getHomeCommandComponentKey/);
  assert.match(mainSource, /trimmed\.toLowerCase\(\)\.endsWith\('\.base'\)/);
  assert.match(mainSource, /component = \{ type: 'base', path: normalizePath\(trimmed\)\.replace/);
  assert.match(mainSource, /\(value as \{ type\?: unknown \}\)\.type === 'command'/);
  assert.match(mainSource, /commandId = String\(\(value as \{ commandId\?: unknown \}\)\.commandId/);
  assert.match(mainSource, /`command:\$\{component\.commandId\.toLowerCase\(\)\}`/);
  assert.match(viewSource, /moveComponent/);
  assert.match(viewSource, /removeComponent/);
  assert.match(viewSource, /addComponent/);
  assert.match(viewSource, /setHomeComponents/);
  assert.match(viewSource, /homeComponentLayouts/);
  assert.match(viewSource, /finishComponentPanel\(panel, component/);
  assert.match(viewSource, /startHomeComponentResize\(event, component, panel, 'height'\)/);
  assert.match(viewSource, /startHomeComponentResize\(event, component, preview, 'capturePreviewHeight'\)/);
  assert.match(viewSource, /toggleHomeComponentSpan/);
  assert.match(viewSource, /resetHomeComponentLayout/);
  assert.match(viewSource, /resetHomeLayout/);
  assert.match(viewSource, /pruneHomeComponentLayouts/);
  assert.match(stylesSource, /\.tps-home-panel--wide/);
  assert.match(stylesSource, /\.tps-home-panel--custom-height/);
  assert.match(stylesSource, /\.tps-home-panel--custom-preview-height \.tps-home-capture-preview--home/);
  assert.match(stylesSource, /\.tps-home-resize-handle/);
  assert.match(stylesSource, /\.tps-home-component-controls/);
  assert.match(stylesSource, /\.tps-home-command/);
  assert.match(viewSource, /const host = heading\.createDiv\(\{ cls: 'tps-home-panel-actions' \}\)/);
  assert.match(stylesSource, /\.tps-home-panel-actions/);
  assert.match(stylesSource, /\.tps-home-root--editing \.tps-home-panel/);
  assert.match(stylesSource, /\.tps-home-root--editing \.tps-home-panel > :not\(\.tps-home-panel-heading\)/);
  assert.match(viewSource, /Add command to this component/);
  assert.match(viewSource, /Target selected Daily Note/);
  assert.doesNotMatch(viewSource, /headerActions:/);
  assert.match(viewSource, /this\.editMode\s*\? baseFile\?\.name \|\| 'Base not found'/);
  assert.match(viewSource, /private setHomePanelFileLabel\(panel: HTMLElement, filename: string\)/);
  assert.match(viewSource, /event\.stopImmediatePropagation\(\);\s*onClick\(event\)/);
  assert.match(stylesSource, /\.tps-home-add-component-button/);
  assert.match(stylesSource, /\.tps-home-panel-file/);
});

test('TPS Home edit mode owns the configured Base for each built-in Base panel', () => {
  assert.match(viewSource, /import \{ FileSuggestModal \} from '\.\.\/modals\/FileSuggestModal'/);
  assert.match(
    viewSource,
    /if \(this\.editMode\) \{\s*const controls = panel\.createDiv\(\{ cls: 'tps-home-component-controls' \}\);\s*this\.createHomeBuiltInBasePickerButton\(controls, component\)/,
  );
  assert.match(viewSource, /cls: 'tps-home-secondary-button tps-home-component-base-button'/);
  assert.match(viewSource, /const accessibleLabel = `\$\{label\} for \$\{title\}`/);
  assert.match(viewSource, /attr: \{ 'aria-label': accessibleLabel, title: accessibleLabel, type: 'button' \}/);
  assert.match(viewSource, /button\.createSpan\(\{ text: label \}\)/);
  assert.match(viewSource, /new FileSuggestModal\(this\.app, async \(file\) => \{/);
  assert.match(viewSource, /\{ extensions: \['base'\], caseSensitiveExtensions: true \}/);
  assert.match(viewSource, /if \(!this\.editMode \|\| file\.extension !== 'base'\) return;/);
  assert.match(viewSource, /this\.homeBaseSettingWriter\.write\(settingKey, selectedPath/);
  assert.match(viewSource, /set: \(path\) => \{\s*this\.plugin\.settings\[settingKey\] = path/);
  assert.match(viewSource, /persist: \(\) => this\.plugin\.saveSettings\(\)/);
  assert.match(viewSource, /if \(result !== 'applied'\) return/);
  assert.match(viewSource, /const scrollTop = this\.contentEl\.scrollTop/);
  assert.match(viewSource, /await this\.render\(\);\s*this\.restoreHomeBuiltInBasePickerFocus\(componentId, scrollTop\)/);
  assert.match(viewSource, /candidate\.dataset\.tpsHomeComponentKey === componentId/);
  assert.match(viewSource, /querySelector<HTMLButtonElement>\('\.tps-home-component-base-button'\)/);
  assert.match(viewSource, /focus\(\{ preventScroll: true \}\)/);

  const focusRestoreStart = viewSource.indexOf('  private restoreHomeBuiltInBasePickerFocus(');
  const focusRestoreEnd = viewSource.indexOf('  private openHomeComponentBaseContextMenu(', focusRestoreStart);
  assert.ok(focusRestoreStart >= 0 && focusRestoreEnd > focusRestoreStart);
  const focusRestoreSource = viewSource.slice(focusRestoreStart, focusRestoreEnd);
  assert.equal((focusRestoreSource.match(/this\.contentEl\.scrollTop = scrollTop/gu) || []).length, 2);
  assert.doesNotMatch(focusRestoreSource, /setTimeout|requestAnimationFrame/);

  assert.match(stylesSource, /\.tps-home-component-base-button \{[\s\S]*height: auto;[\s\S]*white-space: normal;/);
  assert.match(stylesSource, /\.tps-home-component-controls button:focus-visible/);
  assert.match(stylesSource, /body\.is-mobile \.tps-home-component-controls,[\s\S]*body\.is-phone \.tps-home-component-controls \{[\s\S]*flex-wrap: wrap;/);
  assert.match(stylesSource, /body\.is-mobile \.tps-home-component-base-button,[\s\S]*body\.is-phone \.tps-home-component-base-button \{[\s\S]*flex: 1 1 100%;[\s\S]*min-height: 40px;[\s\S]*height: auto;/);
  assert.match(stylesSource, /body\.is-mobile \.tps-home-component-controls \.tps-home-icon-button,[\s\S]*body\.is-phone \.tps-home-component-controls \.tps-home-icon-button \{[\s\S]*flex: 0 0 40px;[\s\S]*width: 40px;[\s\S]*min-height: 40px;/);

  assert.match(viewSource, /if \(componentId === 'calendar'\) return 'homeCalendarBasePath'/);
  assert.match(viewSource, /if \(componentId === 'food-tracker'\) return 'homeFoodBasePath'/);
  assert.match(viewSource, /if \(componentId === 'workout-tracker'\) return 'homeWorkoutBasePath'/);
  assert.match(viewSource, /if \(componentId === 'open-unscheduled-tasks'\) return 'homeOpenTasksBasePath'/);

  const pickerStart = viewSource.indexOf('  private openHomeBuiltInBasePicker(');
  const pickerEnd = viewSource.indexOf('  private openHomeComponentBaseContextMenu(', pickerStart);
  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart);
  const pickerSource = viewSource.slice(pickerStart, pickerEnd);
  assert.doesNotMatch(
    pickerSource,
    /settings\.(?:homeComponents|homeComponentLayouts|homeComponentActions)\s*=/,
    'choosing a built-in Base must not replace component, layout, or action collections',
  );
});

test('TPS Home treats configured built-in Base paths as authoritative', () => {
  assert.match(
    viewSource,
    /private getHomeCalendarBaseFile\(\): TFile \| null \{\s*return this\.getBaseFileFromSetting\(this\.plugin\.settings\.homeCalendarBasePath\);\s*\}/,
  );
  assert.match(
    viewSource,
    /const configuredFile = this\.getBaseFileFromSetting\(configuredPath\);\s*if \(configuredFile\) return configuredFile;\s*if \(!this\.isCanonicalHomeBasePath\(configuredPath, DEFAULT_SETTINGS\.homeFoodBasePath\)\) return null;\s*return await this\.ensureDefaultFoodLogBaseFile\(\)/,
  );
  assert.match(
    viewSource,
    /const configuredFile = this\.getBaseFileFromSetting\(configuredPath\);\s*if \(configuredFile\) return configuredFile;\s*if \(!this\.isCanonicalHomeBasePath\(configuredPath, DEFAULT_SETTINGS\.homeWorkoutBasePath\)\) return null;\s*return await this\.ensureDefaultWorkoutLogBaseFile\(\)/,
  );
  assert.match(
    viewSource,
    /private getHomeOpenTasksBaseFile\(\): TFile \| null \{\s*return this\.getBaseFileFromSetting\(this\.plugin\.settings\.homeOpenTasksBasePath\);\s*\}/,
  );
  assert.match(viewSource, /private getBaseFileFromSetting\(path: string \| undefined\): TFile \| null/);
  assert.match(viewSource, /let baseFile = this\.getBaseFileFromSetting\(component\.path\)/);
  assert.match(viewSource, /baseFile = await this\.ensureHomeDailyNoteFeedBaseFile\(\)/);
  assert.match(viewSource, /normalizePath\(component\.path\) === HOME_DAILY_NOTE_FEED_BASE_PATH/);
  assert.doesNotMatch(viewSource, /normalizePath\(component\.path\)\.toLowerCase\(\) === HOME_DAILY_NOTE_FEED_BASE_PATH\.toLowerCase\(\)/);
  assert.doesNotMatch(viewSource, /calendarPlugin\?\.settings\?\.sidebarBasePath/);
  assert.doesNotMatch(viewSource, /'home-schedule\.base'/);
  assert.doesNotMatch(viewSource, /'scheduled\.base'/);
  assert.doesNotMatch(viewSource, /getBaseFileFromSetting\([^\n]+,\s*'[^']+\.base'/);
});

test('Home Base selection uses the exact lowercase extension supported by Calendar Base', async () => {
  const { FileSuggestModal } = await loadFileSuggestModal();
  const TestTFile = globalThis.__homeFileSuggestTestTFile;
  const files = [
    new TestTFile('Supported.base', 'base'),
    new TestTFile('Unsupported.BASE', 'BASE'),
    new TestTFile('Note.md', 'md'),
  ];
  const app = {
    vault: { getAllLoadedFiles: () => files },
    metadataCache: { getFileCache: () => null },
  };

  const legacy = new FileSuggestModal(app, () => {}, { extensions: ['base'] });
  assert.deepEqual(legacy.getItems().map((file) => file.path), ['Supported.base', 'Unsupported.BASE']);

  const exact = new FileSuggestModal(app, () => {}, {
    extensions: ['base'],
    caseSensitiveExtensions: true,
  });
  assert.deepEqual(exact.getItems().map((file) => file.path), ['Supported.base']);
  assert.match(fileSuggestModalSource, /caseSensitiveExtensions\?: boolean/);
  assert.match(viewSource, /configured === canonical/);
});

test('TPS Home can add and run command modal components', () => {
  assert.match(viewSource, /private renderCommandPanel\(parent: HTMLElement, component: HomeCommandComponent\): void/);
  assert.match(viewSource, /const command = this\.getCommand\(component\.commandId\)/);
  assert.match(viewSource, /this\.createComponentPanel\(parent, component, 'Command'\)/);
  assert.match(viewSource, /cls: 'tps-home-command'/);
  assert.match(viewSource, /setIcon\(button, component\.icon \|\| 'terminal'\)/);
  assert.match(viewSource, /button\.addEventListener\('click', \(\) => \{[\s\S]*void this\.runCommand\(component\.commandId\)/);
  assert.match(viewSource, /private getCommands\(\): Array<\{ id: string; name: string \}>/);
  assert.match(viewSource, /commands\.listCommands\(\)/);
  assert.match(viewSource, /commands\?\.executeCommandById/);
  assert.match(viewSource, /Command is no longer available/);
  assert.match(viewSource, /this\.isHomeCommandComponent\(component\)/);
  assert.match(viewSource, /this\.isHomeCommandComponent\(value\)/);
});

test('TPS Table create command override uses selectable commands and resilient execution', () => {
  assert.match(mainSource, /function getCommandOptionValues\(plugin: TPSGlobalContextMenuPlugin\): Record<string, string>/);
  assert.match(mainSource, /registerBasesView\(TPS_TABLE_VIEW_TYPE/);
  assert.doesNotMatch(mainSource, /LEGACY_TPS_LOG_TABLE_VIEW_TYPE/);
  assert.doesNotMatch(mainSource, /registerBasesView\(LEGACY/);
  assert.doesNotMatch(logBaseViewSource, /tps-log-table/);
  assert.match(mainSource, /plugin\.app as any\)\?\.commands\?\.commands/);
  assert.match(mainSource, /type: 'dropdown',\s+displayName: 'Command'/);
  assert.match(mainSource, /options: getCommandOptionValues\(plugin\)/);
  assert.doesNotMatch(logBaseViewSource, /addButton\.addEventListener\('click', async \(\) => \{/);
  assert.doesNotMatch(logBaseViewSource, /tps-log-base-toolbar/);
  assert.doesNotMatch(logBaseViewSource, /tps-log-base-add/);
  assert.match(logBaseViewSource, /\(this\.containerEl as any\)\.__tpsTableView = this/);
  assert.match(logBaseViewSource, /hasCreateCommandOverride\(\): boolean/);
  assert.match(mainSource, /private registerTpsTableNativeCreateHandler\(\): void/);
  assert.match(mainSource, /this\.registerDomEvent\(document, 'click'/);
  assert.match(mainSource, /private async handleTpsTableNativeCreateClick\(evt: MouseEvent\): Promise<void>/);
  assert.match(mainSource, /private getTpsTableNativeCreateScope\(target: Element\): HTMLElement \| null/);
  assert.match(mainSource, /private getTpsBaseNativeCreateScope\(target: Element, rootSelector: string\): HTMLElement \| null/);
  assert.match(mainSource, /const boundedOwner = target\.closest<HTMLElement>\(/);
  assert.match(mainSource, /'\.tps-home-panel'/);
  assert.match(mainSource, /getVisibleTpsBaseCreateRoot\(boundedOwner, rootSelector\) \? boundedOwner : null/);
  assert.match(mainSource, /getVisibleTpsBaseCreateRoot\(leaf, rootSelector\) \? leaf : null/);
  assert.match(mainSource, /root\.isConnected && root\.getClientRects\(\)\.length > 0/);
  assert.doesNotMatch(mainSource, /let node: HTMLElement \| null = target/);
  assert.match(mainSource, /private handleTpsHealthFoodTableRowContextMenu\(evt: MouseEvent, row: HTMLElement\): boolean/);
  assert.match(mainSource, /api\.openFoodLogEntryMenuFromLine\(evt, path, oneBasedLine - 1, ''\)/);
  assert.match(mainSource, /context-menu:health-food-handoff/);
  assert.match(mainSource, /'\.internal-embed'/);
  assert.match(mainSource, /'\.markdown-embed'/);
  assert.match(mainSource, /'\.canvas-node-content'/);
  assert.match(mainSource, /'\.tps-home-base-host'/);
  assert.match(mainSource, /getVisibleTpsBaseCreateRoot\(scope, '\.tps-log-base'\)/);
  assert.match(mainSource, /!view\.hasCreateCommandOverride\(\)/);
  assert.match(nativeCreateOwnerSource, /candidate\.closest<HTMLElement>\(NATIVE_BASE_CREATE_CHROME_SELECTOR\)/);
  assert.match(nativeCreateOwnerSource, /target\.closest\(NATIVE_BASE_CREATE_EXCLUDED_SELECTOR\)/);
  assert.match(mainSource, /evt\.preventDefault\(\);\s+evt\.stopPropagation\(\);\s+evt\.stopImmediatePropagation\(\);/);
  assert.match(mainSource, /await view\.runCreateCommandOverride\(\)/);
  assert.match(mainSource, /basePath: tableRoot\.dataset\.tpsBasePath \|\| null/);
  assert.match(mainSource, /homeComponent: tableRoot\.closest<HTMLElement>\('\.tps-home-panel'\)/);
  assert.match(logBaseViewSource, /if \(await this\.runCreateCommandOverride\(\)\) return;/);
  assert.match(logBaseViewSource, /if \(await this\.runCreateCommandOverride\(\)\) return;/);
  assert.match(logBaseViewSource, /executeCommandById\.call\(commands, command\.id\)/);
  assert.match(logBaseViewSource, /commandRecord\?\.callback/);
  assert.match(logBaseViewSource, /create-command-unavailable/);
  assert.match(logBaseViewSource, /createEl\('table', \{ cls: 'bases-table tps-log-base-table' \}\)/);
  assert.match(logBaseViewSource, /createEl\('thead', \{ cls: 'bases-table-header tps-log-base-head' \}\)/);
  assert.match(logBaseViewSource, /createEl\('tbody', \{ cls: 'tps-log-base-body' \}\)/);
  assert.match(logBaseViewSource, /createEl\('th', \{ cls: 'bases-table-cell bases-table-header-cell tps-log-base-cell tps-log-base-cell--header'/);
  assert.match(logBaseViewSource, /createEl\('td', \{ cls: `bases-table-cell tps-log-base-cell/);
  assert.match(stylesSource, /\.tps-log-base-table\s*\{[\s\S]*display:\s*table;[\s\S]*table-layout:\s*fixed;[\s\S]*border-collapse:\s*separate;[\s\S]*border-spacing:\s*0;/);
  assert.match(stylesSource, /\.tps-log-base-head\s*\{[\s\S]*display:\s*table-header-group;/);
  assert.match(stylesSource, /\.tps-log-base-body\s*\{[\s\S]*display:\s*table-row-group;/);
  assert.match(stylesSource, /\.tps-log-base-row\s*\{[\s\S]*display:\s*table-row;/);
  assert.match(stylesSource, /\.tps-log-base-cell\s*\{[\s\S]*display:\s*table-cell;/);
  assert.match(stylesSource, /\.tps-log-base-cell--header\s*\{[\s\S]*position:\s*static;/);
  assert.match(stylesSource, /\.tps-log-base-cell--header\s*\{[\s\S]*background:\s*var\(--background-secondary\) !important;/);
});

test('TPS Table supports persistent task-only Shift-click range selection without opening rows', () => {
  assert.match(logBaseViewSource, /private selectedEntryIds = new Set<string>\(\)/);
  assert.match(logBaseViewSource, /private selectionAnchorId: string \| null = null/);
  assert.match(logBaseViewSource, /private renderedTaskEntryOrder: string\[\] = \[\]/);
  assert.match(logBaseViewSource, /this\.renderedTaskEntryOrder = getTpsTableTaskSelectionOrder\(renderedEntries\)/);
  assert.match(logBaseViewSource, /function getLogEntrySelectionId\(/);
  assert.match(logBaseViewSource, /getLogEntryStableIdentity\(\{ fields \}\)/);
  assert.match(logBaseViewSource, /hashSelectionIdentity\(line\)/);
  assert.match(logBaseViewSource, /this\.selectedEntryIds = new Set\(\[\.\.\.this\.selectedEntryIds\]\.filter\(\(id\) => visibleEntryIds\.has\(id\)\)\)/);
  assert.match(logBaseViewSource, /row\.addEventListener\('click', \(evt: MouseEvent\) => this\.handleEntryClick\(evt, entry\)\)/);
  assert.match(logBaseViewSource, /handleEntryModifierClick\(evt, entry\)[\s\S]{0,120}\{ capture: true \}/);
  assert.match(logBaseViewSource, /evt\.stopImmediatePropagation\(\)/);
  assert.match(logBaseViewSource, /constrainTpsTableTaskSelection\(this\.selectedEntryIds, this\.renderedTaskEntryOrder\)/);
  assert.match(logBaseViewSource, /toggleOrderedSelection\(taskSelection, id, this\.renderedTaskEntryOrder\)/);
  assert.match(logBaseViewSource, /mode: result\.removed \? 'toggle-off' : 'toggle-on'/);
  assert.match(logBaseViewSource, /link\.addEventListener\('click', \(event: MouseEvent\) => \{\s*if \(event\.shiftKey \|\| event\.metaKey \|\| event\.ctrlKey\) return;/);
  assert.match(logBaseViewSource, /if \(evt\.shiftKey && taskSelectable\) \{\s*evt\.preventDefault\(\);\s*evt\.stopPropagation\(\);\s*this\.selectEntryRange\(entry\.selectionId\);\s*return;/);
  assert.match(logBaseViewSource, /getOrderedSelectionRange\(this\.renderedTaskEntryOrder, this\.selectionAnchorId, id\)/);
  assert.match(logBaseViewSource, /applyEntryContextSelection\(evt: MouseEvent, row: HTMLElement\): boolean/);
  assert.match(logBaseViewSource, /async applyTpsTableRowSelection\(/);
  assert.match(logBaseViewSource, /syncTpsTableSelectionRows\?\.\(/);
  assert.match(logBaseViewSource, /releaseTpsTableSelection\?\.\(this\.containerEl\)/);
  assert.match(logBaseViewSource, /const entryId = row\.dataset\.entryId/);
  assert.match(logBaseViewSource, /else if \(!this\.selectedEntryIds\.has\(entryId\)\) \{\s*this\.selectOnlyEntry\(entryId\)/);
  assert.match(logBaseViewSource, /row\.classList\.toggle\('tps-log-base-row--selected', selected\)/);
  assert.match(logBaseViewSource, /row\.setAttribute\('aria-selected', selected \? 'true' : 'false'\)/);
  assert.equal(
    (logBaseViewSource.match(/this\.reconcileRenderedTaskSelection\(\)/gu) || []).length,
    2,
    'empty and populated Table rerenders must both reconcile the canonical task selection',
  );
  assert.match(
    logBaseViewSource,
    /if \(!entries\.length\) \{[\s\S]{0,500}this\.reconcileRenderedTaskSelection\(\);[\s\S]{0,180}return;/u,
    'an empty rerender must clear task contexts which are no longer rendered',
  );
  assert.match(
    logBaseViewSource,
    /private reconcileRenderedTaskSelection\(\): void \{[\s\S]{0,900}reconcileTpsTableSelectionRows\?\.\([\s\S]{0,200}this\.containerEl/u,
    'a populated rerender must replace canonical contexts with the newly rendered selected rows',
  );
  assert.match(logBaseViewSource, /if \(!isTpsTableTaskSelectionEntry\(entry\)\) return;/);
  assert.match(logBaseViewSource, /row\.dataset\.tpsTableBatchSelectable = 'true'/);
  assert.match(logBaseViewSource, /if \(row\.dataset\.tpsTableBatchSelectable !== 'true'\) \{\s*this\.selectOnlyEntry\(entryId\);/);
  assert.match(logBaseViewSource, /\.tps-log-base-row--selected\[data-entry-id\]\[data-tps-table-batch-selectable="true"\]/);
  assert.match(logBaseViewSource, /void this\.openEntry\(entry\)/);
  assert.match(logBaseViewSource, /requestLineItemDelete\(\{/);
  assert.match(logBaseViewSource, /source: 'tps-table-menu'/);
  assert.match(logBaseViewSource, /resolveLineIndex: \(lines\) => resolveEntryLineNumber\(lines, entry\)/);
  assert.match(stylesSource, /\.tps-log-base-row--selected \.tps-log-base-cell\s*\{[\s\S]*color-mix\(in srgb, var\(--interactive-accent\) 10%, transparent\)/);
});

test('TPS Table batch selection helpers exclude bullets and headings while preserving task order', async () => {
  const {
    constrainTpsTableTaskSelection,
    getTpsTableTaskSelectionOrder,
    isTpsTableTaskSelectionEntry,
  } = await loadPureModule('../src/views/tps-table-selection.ts');
  const entries = [
    { selectionId: 'bullet-a', line: '- Plain bullet' },
    { selectionId: 'task-a', line: '- [ ] First task' },
    { selectionId: 'heading-a', line: '## Heading' },
    { selectionId: 'task-b', line: '1. [x] Second task' },
  ];

  assert.equal(isTpsTableTaskSelectionEntry(entries[0]), false);
  assert.equal(isTpsTableTaskSelectionEntry(entries[1]), true);
  assert.deepEqual(getTpsTableTaskSelectionOrder(entries), ['task-a', 'task-b']);
  assert.deepEqual(
    [...constrainTpsTableTaskSelection(['bullet-a', 'task-a', 'heading-a', 'task-b'], ['task-a', 'task-b'])],
    ['task-a', 'task-b'],
  );
});

test('TPS Home shows a running time-tracked note indicator from the timer service', () => {
  assert.match(viewSource, /private homeActiveTimerButton: HTMLButtonElement \| null = null/);
  assert.match(viewSource, /private homeActiveTimerTarget: HomeActiveTimerTarget \| null = null/);
  assert.match(viewSource, /getActiveWorkout\?: \(\) => HomeActiveWorkoutState \| null/);
  assert.match(viewSource, /type HomeActiveTimerTarget =/);
  assert.match(viewSource, /this\.registerInterval\(window\.setInterval\(\(\) => \{\s*void this\.refreshHomeActiveTimerButton\(\);\s*\}, 1000\)\)/);
  assert.match(viewSource, /this\.homeActiveTimerButton = this\.createIconButton\(actions, 'timer', 'Open running time-tracked note'/);
  assert.match(viewSource, /this\.homeActiveTimerButton\.addClass\('tps-home-active-timer-button'\)/);
  assert.match(viewSource, /this\.homeActiveTimerButton\.style\.display = 'none'/);
  assert.match(viewSource, /private async refreshHomeActiveTimerButton\(\): Promise<void>/);
  assert.match(viewSource, /private async getHomeActiveTimerTarget\(\): Promise<HomeActiveTimerTarget \| null>/);
  assert.match(viewSource, /const status = await this\.plugin\.timeTrackingService\.getRuntimeStatus\(\)/);
  assert.match(viewSource, /if \(status\.active\) \{/);
  assert.match(viewSource, /isWorkoutTimeTrackingSession\(status\.active\) \? 'workout' : 'time-tracking'/);
  assert.match(viewSource, /return null;\s+\}/);
  assert.match(viewSource, /private isWorkoutTimeTrackingSession\(session: TimeTrackingSession\): boolean/);
  assert.match(viewSource, /kind === 'workout' \|\| runType === 'workout'/);
  assert.match(viewSource, /tps-health-workout/);
  assert.match(viewSource, /workoutsFolder/);
  assert.doesNotMatch(viewSource, /const workout = typeof healthApi\?\.getActiveWorkout === 'function' \? healthApi\.getActiveWorkout\(\) : null/);
  assert.doesNotMatch(viewSource, /workout\?\.path \|\| healthApi\?\.getActiveWorkoutPath\?\.\(\) \|\| workout\?\.dailyNotePath/);
  assert.match(viewSource, /button\.style\.display = target \? '' : 'none'/);
  assert.match(viewSource, /private getHomeActiveTimerElapsedMs\(target: HomeActiveTimerTarget\): number/);
  assert.match(viewSource, /if \(target\.session\) \{/);
  assert.match(viewSource, /const startedAt = Date\.parse\(target\.startedAt\)/);
  assert.match(viewSource, /Open running \$\{target\.kind === 'workout' \? 'workout' : 'time-tracked note'\}: \$\{elapsed\} \| \$\{target\.title\}/);
  assert.match(viewSource, /target\.session[\s\S]{0,80}openHydratedSessionTarget\(target\.session\)/);
  assert.match(viewSource, /private async openHomeWorkoutTarget\(path: string\): Promise<boolean>/);
  assert.match(viewSource, /this\.plugin\.openFileInLeaf/);
  assert.match(viewSource, /No running time-tracked note\./);
  assert.match(stylesSource, /\.tps-home-active-timer-button/);
  assert.doesNotMatch(viewSource, /status\.paused/);
});

test('TPS Home calendar renders an actual Base embed', () => {
  assert.match(viewSource, /MarkdownRenderer/);
  assert.match(viewSource, /getHomeCalendarBaseFile/);
  assert.match(viewSource, /homeCalendarBasePath/);
  assert.doesNotMatch(viewSource, /calendarPlugin\?\.settings\?\.sidebarBasePath/);
  assert.match(viewSource, /calendarPlugin\?\.api\?\.renderBaseCalendarEmbed \|\| calendarPlugin\?\.renderBaseCalendarEmbed/);
  assert.doesNotMatch(viewSource, /preserveDayCount/);
  assert.match(viewSource, /renderCalendarEmbed\.call\([\s\S]*?host,\s*baseFile\.path,\s*\)/);
  assert.match(viewSource, /Object\.values\(plugins\.plugins\)/);
  assert.match(viewSource, /manifestId === 'tps-calendar-base'/);
  assert.match(viewSource, /tps-home-calendar-base-host tps-home-scroll-host tps-auto-base-embed__panel/);
  assert.match(viewSource, /MarkdownRenderer\.render\(this\.app, `!\[\[\$\{baseFile\.path\}\]\]`, host, baseFile\.path, embedComponent\)/);
  assert.match(viewSource, /scheduleCalendarEmbedResize\(host\)/);
  assert.match(viewSource, /scheduleHomeCalendarScrollToNow\(calendarComponent, today\)/);
  assert.match(viewSource, /private scheduleHomeCalendarScrollToNow\(calendarComponent: any, date: any\): void/);
  assert.match(viewSource, /calendarComponent\.scrollToNow\(\)/);
  assert.match(viewSource, /private isSelectedHomeDateToday\(date: any\): boolean/);
  assert.match(viewSource, /selected\.isSame\(moment\(\), 'day'\)/);
  assert.doesNotMatch(viewSource, /Previous calendar range/);
  assert.doesNotMatch(viewSource, /calendarComponent\?\.navigateToday\?\.\(\)/);
  assert.match(viewSource, /calendarComponent\?\.navigateToDate\?\.\(today\.toDate\?\.\(\) \?\? today\)/);
  assert.doesNotMatch(viewSource, /homeCalendarComponent/);
  assert.doesNotMatch(viewSource, /lastHomeCalendarScrollToNowAt/);
  assert.doesNotMatch(viewSource, /component\.navigateToDate\?\.\(new Date\(\)\)/);
  assert.match(viewSource, /applyHomeDateContext\(element, date, getMoment\(\)\)/);
  assert.match(viewSource, /private selectedDate/);
  assert.match(viewSource, /Previous Home day/);
  assert.match(viewSource, /Show today on Home/);
  assert.match(viewSource, /'aria-pressed': String\(this\.isSelectedHomeDateToday\(today\)\)/);
  assert.match(viewSource, /todayButton\.classList\.toggle\('is-selected-date-today', this\.isSelectedHomeDateToday\(today\)\)/);
  assert.match(stylesSource, /body\.is-mobile \.tps-home-actions/);
  assert.match(stylesSource, /body\.is-mobile \.tps-home-actions,[\s\S]*body\.is-phone \.tps-home-actions \{[\s\S]*position: static;/);
  assert.match(stylesSource, /body\.is-mobile \.tps-home-actions,[\s\S]*body\.is-phone \.tps-home-actions \{[\s\S]*flex: 1 1 100%;/);
  assert.doesNotMatch(stylesSource, /body\.is-mobile \.tps-home-actions,[\s\S]*body\.is-phone \.tps-home-actions \{[^}]*position: fixed;/);
  assert.doesNotMatch(stylesSource, /tps-home-root--nav-hidden/);
  assert.doesNotMatch(viewSource, /handleHomeScroll/);
  assert.match(stylesSource, /\.tps-home-calendar-today-button/);
  assert.match(stylesSource, /\.tps-home-calendar-today-button\.is-selected-date-today/);
  assert.doesNotMatch(stylesSource, /body\.is-mobile \.tps-home-actions \.tps-home-calendar-today-button,[\s\S]*?body\.is-phone \.tps-home-actions \.tps-home-calendar-today-button \{[^}]*background: var\(--interactive-accent\)/);
  assert.match(viewSource, /window\.dispatchEvent\(new Event\('resize'\)\)/);
  assert.match(stylesSource, /\.tps-home-calendar-base-host/);
  assert.match(stylesSource, /\.tps-home-calendar-base-host \.bases-header/);
  assert.match(stylesSource, /\.tps-home-calendar-base-host \.bases-calendar-wrapper\.bases-calendar-embedded/);
  assert.match(stylesSource, /\.tps-home-calendar-base-host \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-axis,/);
  assert.match(stylesSource, /--tps-embed-axis-width: 64px/);
  assert.match(stylesSource, /\.tps-home-calendar-base-host[\s\S]*fc-scrollgrid > colgroup > col:first-child/);
  assert.match(stylesSource, /\.tps-home-calendar-base-host[\s\S]*fc-scrollgrid tr > :first-child/);
  assert.match(stylesSource, /\.tps-home-calendar-base-host \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-scrollgrid table \{\s*width: 100% !important;\s*table-layout: fixed !important;/);
  assert.doesNotMatch(stylesSource, /\.tps-home-calendar-base-host \.bases-calendar-wrapper \{\s*[\s\S]*height: 100% !important/);
  assert.doesNotMatch(viewSource, /tps-home-calendar-list/);
});

test('TPS Home date context helper stamps selected-day Base context', async () => {
  const { applyHomeDateContext } = await loadHomeContextModule();
  const element = { dataset: {} };

  applyHomeDateContext(element, createMomentFactory()('2026-07-05'), createMomentFactory());

  assert.deepEqual(element.dataset, {
    tpsContextSource: 'home',
    tpsContextScheduled: '2026-07-05 00:00:00',
    tpsContextDate: '2026-07-05',
  });
});

test('TPS Home delegates open-task rows to the configured TPS List Base', () => {
  assert.match(viewSource, /renderOpenTasksBase/);
  assert.match(viewSource, /getHomeOpenTasksBaseFile/);
  if (openTasksBaseSource) {
    assert.match(openTasksBaseSource, /type: tps-list/);
    assert.match(openTasksBaseSource, /kind == "task"/);
    assert.match(openTasksBaseSource, /scheduled\.isEmpty\(\)/);
    assert.match(openTasksBaseSource, /start\.isEmpty\(\)/);
    assert.match(openTasksBaseSource, /due\.isEmpty\(\)/);
    assert.equal((openTasksBaseSource.match(/!file\.path\.startsWith\("Archive\/"\)/g) || []).length, 1);
    assert.equal((openTasksBaseSource.match(/!file\.path\.startsWith\("_archive\/"\)/g) || []).length, 1);
    assert.equal((openTasksBaseSource.match(/!task\.path\.contains\("Archive\/"\)/g) || []).length, 1);
    assert.equal((openTasksBaseSource.match(/!task\.path\.contains\("_archive\/"\)/g) || []).length, 1);
  }
  assert.doesNotMatch(viewSource, /createTaskRow/);
  assert.doesNotMatch(viewSource, /taskApiService\.setCheckbox/);
  assert.doesNotMatch(viewSource, /taskUndoStack/);
});

test('TPS List and TPS Table keep task titles primary and source files column-driven', () => {
  assert.match(logBaseViewSource, /if \(configured\.length\) return keys\.map\(\(key\) => \(\{ key, label: labelForKey\(key\) \}\)\);/);
  assert.match(logBaseViewSource, /private isFileLinkColumn\(key: string\): boolean/);
  assert.match(logBaseViewSource, /internal-link tps-log-base-file-link/);
  assert.match(stylesSource, /\.tps-log-base-file-link \{[\s\S]*color: var\(--link-color\);/);
  if (openTasksBaseSource) {
    assert.match(openTasksBaseSource, /order:\s*\n\s*- title\s*\n\s*- file\.name\s*\n\s*- priority\s*\n\s*- scheduled/);
  }
  if (tasksBaseSource) {
    assert.match(tasksBaseSource, /order:\s*\n\s*- title\s*\n\s*- file\.name\s*\n\s*- scheduled/);
  }
  if (foodLogBaseSource) {
    assert.match(foodLogBaseSource, /- file\.name\s*\n\s*- title/);
  }
});

test('GCM owns TPS List Bases registration and bundles the task-aware renderer', () => {
  assert.match(mainSource, /registerBasesView\(TPS_LIST_VIEW_TYPE/);
  assert.match(mainSource, /name: 'tps list'/);
  assert.match(mainSource, /createTpsListView\(controller, containerEl, this\)/);
  assert.match(tpsListBridgeSource, /export const TPS_LIST_VIEW_TYPE = 'tps-list'/);
  assert.doesNotMatch(tpsListBridgeSource, /getPluginById\(plugin\.app, 'tps-kanban'\)/);
  assert.doesNotMatch(tpsListBridgeSource, /createTpsListBasesView/);
  assert.match(tpsListBridgeSource, /TpsListView/);
  assert.match(tpsListBridgeSource, /using-local-renderer/);
  assert.doesNotMatch(tpsListBridgeSource, /TPS-Kanban/);
  assert.match(tpsListBridgeSource, /gcmPlugin: plugin/);
  assert.match(tpsListBridgeSource, /containerEl\.addEventListener\('click'/);
  assert.match(tpsListBridgeSource, /plugin\.openBaseNotePreviewFromClick\(event, file, link, true\)/);
  assert.match(tpsListBridgeSource, /plugin\.openBaseNotePreviewFromClick\(event, file, anchorEl, true\)/);
  assert.match(stylesSource, /\.tps-list-native-rows\s*\{[\s\S]*list-style:\s*none;[\s\S]*padding:\s*0;/);
  assert.match(stylesSource, /\.tps-list-native-row\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*var\(--checkbox-size, 18px\) minmax\(0, 1fr\);/);
  assert.match(stylesSource, /\.tps-list-native-row--task\s*\{[\s\S]*padding-inline-start:\s*var\(--tps-list-task-indent, 0px\);/);
  assert.doesNotMatch(stylesSource, /\.tps-list-native-row--task\s*\{[\s\S]*margin-left:\s*calc\(-18px/);
});

test('TPS Home food tracker uses TPS Table totals and keeps selected-day logging', () => {
  assert.match(viewSource, /addFoodLogPanelAction/);
  assert.match(viewSource, /openHomeFoodLogger/);
  assert.match(viewSource, /getHomeFoodLogDateContext/);
  assert.match(viewSource, /foodLogTarget: 'daily-note'/);
  assert.match(viewSource, /focusAfterLog: false/);
  assert.match(viewSource, /healthPlugin\.openFoodLogger\(dateContext\)/);
  assert.match(viewSource, /text: 'Log food'/);
  assert.match(viewSource, /tps-home-food-log-button/);
  assert.match(viewSource, /renderFoodBase/);
  assert.match(viewSource, /getHomeFoodBaseFile/);
  assert.match(viewSource, /ensureDefaultFoodLogBaseFile/);
  assert.match(viewSource, /appAny\.tpsHealth/);
  assert.match(viewSource, /getHealthPlugin/);
  assert.match(viewSource, /TPS-health \(Dev\)/);
  assert.match(viewSource, /healthApi\.ensureFoodLogBase/);
  assert.match(viewSource, /panel\.dataset\.tpsHomeFoodDate = dateIso/);
  assert.doesNotMatch(viewSource, /renderHomeFoodMacroSummary|getDailyFoodMacroTotals|food-macros:/);
  assert.doesNotMatch(stylesSource, /tps-home-food-macro/);
  assert.match(mainSource, /key: 'totalsRow'[\s\S]*off: 'Off'[\s\S]*top: 'Top'[\s\S]*bottom: 'Bottom'/);
  assert.match(logBaseViewSource, /normalizeTotalsRowPosition\(this\.getConfigValue\('totalsRow'\)\)/);
  assert.match(logBaseViewSource, /renderTotalsRow\(tbody, entries, columns, totalsPosition\)/);
  assert.match(stylesSource, /\.tps-log-base-row--totals \.[\s\S]*font-variant-numeric: tabular-nums;/);
  assert.match(stylesSource, /\.tps-home-component-food-tracker \.bases-header,[\s\S]*\.tps-home-component-food-tracker \.view-header \{\s*display: none !important;/);
  assert.match(stylesSource, /\.tps-home-component-food-tracker \.tps-health-food-log-toolbar \{\s*display: none !important;/);
  assert.match(stylesSource, /\.tps-home-component-food-tracker \.tps-health-food-log-summary \{\s*display: none !important;/);
  assert.match(stylesSource, /\.tps-home-component-food-tracker \.tps-health-food-log-entry \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto;\s*grid-template-areas:/);
  assert.match(stylesSource, /\.tps-home-component-food-tracker \.tps-health-food-log-entry-name \{[\s\S]*white-space: nowrap;/);
  assert.match(stylesSource, /\.tps-home-component-food-tracker \.tps-health-food-log-entry-actions \{[\s\S]*grid-template-columns: repeat\(2, 44px\);/);
  assert.match(stylesSource, /\.tps-home-component-food-tracker \.tps-home-base-host \{[\s\S]*overflow: auto;[\s\S]*cursor: auto;/);
  assert.match(stylesSource, /\.tps-home-component-food-tracker \.tps-home-base-viewport \.tps-log-base-table-scroll \{[\s\S]*overflow: visible !important;/);
  assert.match(stylesSource, /\.tps-home-component-food-tracker \.tps-log-base-table \{[\s\S]*width: 100% !important;[\s\S]*table-layout: fixed;/);
  assert.match(logBaseViewSource, /isHomeFoodSummary\(\)/);
  assert.match(logBaseViewSource, /\['food', 'cal', 'protein', 'carbs', 'fat'\]/);
  assert.match(logBaseViewSource, /protein: 'P', carbs: 'C', fat: 'F'/);
});

test('TPS Home Base panels use one bounded native scroll viewport', () => {
  assert.match(viewSource, /host\.addClass\('tps-home-base-viewport'\)/);
  assert.match(viewSource, /host\.dataset\.tpsHomeScrollOwner = 'base-viewport'/);
  assert.match(viewSource, /host\.setAttr\('role', 'region'\)/);
  assert.match(stylesSource, /\.tps-home-base-viewport \{[\s\S]*overflow: auto !important;[\s\S]*overscroll-behavior: contain;[\s\S]*-webkit-overflow-scrolling: touch;/);
  assert.match(stylesSource, /\.tps-home-panel--custom-height \.tps-home-base-host,[\s\S]*\.tps-home-panel--custom-height \.tps-home-calendar-base-host \{[\s\S]*height: 0;[\s\S]*min-height: 0;[\s\S]*max-height: none;/);
  assert.match(stylesSource, /\.tps-home-base-viewport \.tps-log-base-table-scroll \{\s*overflow: visible !important;/);
});

test('TPS Home activity log delegates to the configured TPS Health Activity Base', () => {
  assert.match(viewSource, /renderWorkoutBase/);
  assert.match(viewSource, /addWorkoutPanelAction/);
  assert.match(viewSource, /text: 'Start workout'/);
  assert.match(viewSource, /openHomeWorkoutStarter/);
  assert.match(viewSource, /healthPlugin\.openWorkoutStarter\(dateContext\)/);
  assert.match(viewSource, /start-workout:context-api-unavailable/);
  assert.match(viewSource, /decorateHomeWorkoutPanel/);
  assert.match(viewSource, /text: 'No activity logged'/);
  assert.match(viewSource, /is-tps-home-workout-empty/);
  assert.match(stylesSource, /\.tps-home-component-workout-tracker \.bases-header,[\s\S]*display: none !important;/);
  assert.match(stylesSource, /\.tps-home-workout-empty \{/);
  assert.match(viewSource, /getHomeWorkoutBaseFile/);
  assert.match(viewSource, /panel\.dataset\.tpsHomeActivityDate = selectedDate/);
  assert.match(viewSource, /addHomeBaseContextFilter/);
  assert.doesNotMatch(viewSource, /HOME_WORKOUT_SCOPED_BASE_PATH/);
  assert.doesNotMatch(viewSource, /_assets\/TPS Home Workout Log\.base/);
  assert.match(typesSource, /TpsRecordKind = [^;]*'food' \| 'log' \| 'workflow' \| 'run'/);
  assert.match(typesSource, /WorkflowRunType = ExtensibleLiteral<'workflow' \| 'workout'>/);
  assert.match(homeWorkoutBaseSource, /'\s+- or:'[\s\S]*'\s+- kind == "workout"'[\s\S]*'\s+- runKind == "run"'[\s\S]*'\s+- runType == "workout"'[\s\S]*'\s+- workflowType == "workout"'/);
  assert.doesNotMatch(viewSource, /if \(runKind === 'run' && runType === 'workout'\) return true/);
  assert.match(viewSource, /this\.plugin\.settings\.homeWorkoutBasePath/);
  assert.match(constantsSource, /homeWorkoutBasePath: 'Activity Log\.base'/);
  assert.match(viewSource, /DEFAULT_SETTINGS\.homeWorkoutBasePath/);
  assert.match(viewSource, /ensureDefaultWorkoutLogBaseFile/);
  assert.match(viewSource, /ensureActivityLogBase \|\| healthApi\?\.ensureWorkoutLogBase/);
  assert.doesNotMatch(viewSource, /scheduleHomeWorkoutDateFilter/);
  assert.doesNotMatch(viewSource, /applyHomeWorkoutDateFilter/);
  assert.doesNotMatch(viewSource, /tps-home-filtered-row-hidden/);
  assert.doesNotMatch(stylesSource, /\.tps-home-filtered-row-hidden/);
  assert.match(viewSource, /typeof \(value as any\)\.format === 'function'/);
  assert.match(viewSource, /format\('YYYY-MM-DD'\)/);
  assert.doesNotMatch(settingsTabSource, /Home activity Base path/);
  assert.match(mainSource, /this\.settings\.homeWorkoutBasePath/);
  assert.match(mainSource, /'workout-tracker'/);
  assert.doesNotMatch(viewSource, /class HomeWorkoutLogsModal/);
  assert.doesNotMatch(stylesSource, /tps-home-workout-logs-modal/);
});

test('TPS Home scopes Food tracker rows explicitly without changing the Base source set', async () => {
  const { resolveHomeFoodLineDateKey } = await loadPureModule('../src/views/home-food-date.ts');
  assert.match(viewSource, /renderFoodBase/);
  assert.match(viewSource, /getHomeFoodBaseFile/);
  assert.match(logBaseViewSource, /data-tps-context-source="home"/);
  assert.match(viewSource, /panel\.dataset\.tpsHomeFoodDate = dateIso/);
  assert.match(logBaseViewSource, /lineMatchesHomeDateContext\(fields, file\)/);
  assert.match(logBaseViewSource, /resolveHomeFoodLineDateKey\(fields, file\.path\)/);
  assert.match(logBaseViewSource, /runHomeScopedFoodLogCommand/);
  assert.match(logBaseViewSource, /create-command:home-food-log/);
  assert.match(logBaseViewSource, /health\.openFoodLogger\(dateContext\)/);
  assert.match(logBaseViewSource, /home-date-filter:skip-line/);
  assert.doesNotMatch(logBaseViewSource, /getHomeContextDailyNoteFile/);
  assert.doesNotMatch(logBaseViewSource, /byPath\.set\(homeDailyNote\.path/);
  assert.match(homeFoodDateSource, /fields\.dailynotepath/);
  assert.equal(resolveHomeFoodLineDateKey({
    dailynotepath: '2026-07-07.md',
    completeddate: '2026-07-08T00:46:00.000Z',
  }, '2026-07-07.md'), '2026-07-07');
  assert.equal(resolveHomeFoodLineDateKey({ completeddate: '2026-07-09T01:34:00.000Z' }, 'Food Log.md'), '2026-07-09');
  assert.equal(resolveHomeFoodLineDateKey({}, 'Daily Notes/2026/07/08.md'), '2026-07-08');
  if (foodLogBaseSource) {
    assert.match(foodLogBaseSource, /type: tps-table/);
    assert.match(foodLogBaseSource, /lineFilterKey: food/);
    assert.match(foodLogBaseSource, /totalsRow: top/);
    assert.match(foodLogBaseSource, /createAction: command/);
    assert.match(foodLogBaseSource, /createCommandId: tps-health:log-food/);
    assert.match(foodLogBaseSource, /file\.path == "Food Log\.md"/);
    assert.match(foodLogBaseSource, /file\.folder == "Daily Notes"/);
  }
  assert.doesNotMatch(viewSource, /createFoodRow/);
  assert.doesNotMatch(viewSource, /openFoodEntryMenu/);
  assert.match(mainSource, /openFoodLogEntryMenuFromLine/);
});

test('TPS Table title edits preserve record fields and stale writes resolve by stable identity', async () => {
  const { readInlineFields, resolveEntryLineNumber, setVisibleLineText, visibleLineText } = await loadPureModule('../src/views/log-line-utils.ts');
  const original = '- [ ] Old set [type:: workoutSet] [setId:: set-1] <!-- [reps:: 8] [weight:: 100] -->';
  const updated = setVisibleLineText(original, 'Bench press');
  assert.equal(updated, '- [ ] Bench press [type:: workoutSet] [setId:: set-1] <!-- [reps:: 8] [weight:: 100] -->');
  const linked = '- [[Exercises/Bench Press|Bench press]] [type:: workoutSet] [setId:: set-2]';
  assert.equal(
    setVisibleLineText(linked, 'Incline bench press'),
    '- [[Exercises/Bench Press|Incline bench press]] [type:: workoutSet] [setId:: set-2]',
  );
  assert.equal(visibleLineText('- [type:: foodLog] Greek yogurt <!-- [foodId:: food-1] -->'), 'Greek yogurt');
  assert.deepEqual(readInlineFields(updated), {
    type: 'workoutSet',
    setid: 'set-1',
    reps: '8',
    weight: '100',
  });
  const financeLine = '- Coffee [financeId:: finance-1] [account:: [[Finances/Accounts/Checking]]] [date:: 2026-07-10]';
  assert.deepEqual(readInlineFields(financeLine), {
    financeid: 'finance-1',
    account: '[[Finances/Accounts/Checking]]',
    date: '2026-07-10',
  });
  assert.equal(visibleLineText(financeLine), 'Coffee');

  const movedLines = ['- unrelated', '- inserted', original];
  assert.equal(resolveEntryLineNumber(movedLines, {
    lineNumber: 1,
    line: original,
    fields: readInlineFields(original),
  }), 2);
  assert.equal(resolveEntryLineNumber([original, original], {
    lineNumber: 4,
    line: original,
    fields: readInlineFields(original),
  }), -1);
  assert.equal(resolveEntryLineNumber([original, original], {
    lineNumber: 0,
    line: original,
    fields: readInlineFields(original),
  }), -1, 'a duplicate at the preferred coordinate must remain ambiguous');
  assert.match(logBaseViewSource, /context-menu:health-food-handoff/);
  assert.match(logBaseViewSource, /openFoodLogEntryMenuFromLine/);
  assert.match(logBaseViewSource, /plugin\.openFileInLeaf/);
  assert.match(logLineUtilsSource, /\['foodid', 'setid', 'tpsid', 'logid', 'workoutid', 'financeid'\]/);
});

test('Home workout date scoping composes in memory without generated Base writes', async () => {
  const { addHomeBaseContextFilter } = await loadPureModule('../src/views/home-base-context.ts');
  const source = JSON.stringify({
    filters: { or: ['kind == "workout"', { and: ['runKind == "run"', 'runType == "workout"'] }] },
    views: [{ type: 'tps-table', filters: { and: ['status != "wont-do"'] } }],
  });
  const scoped = JSON.parse(addHomeBaseContextFilter(source, 'workoutDate == date("2026-07-09")'));
  assert.deepEqual(scoped.filters, {
    and: [
      { or: ['kind == "workout"', { and: ['runKind == "run"', 'runType == "workout"'] }] },
      'workoutDate == date("2026-07-09")',
    ],
  });
  assert.deepEqual(scoped.views[0].filters, { and: ['status != "wont-do"'] });
  assert.doesNotMatch(viewSource, /app\.vault\.modify\(existing, scopedBody\)/);
  assert.doesNotMatch(viewSource, /app\.vault\.create\(HOME_WORKOUT_SCOPED_BASE_PATH/);
});

test('TPS Home does not keep a second inline task or food parser', () => {
  assert.doesNotMatch(viewSource, /readInlineFieldValue/);
  assert.match(viewSource, /parseTaskLine,[\s\S]*?from '\.\.\/utils\/task-line-metadata'/u);
  assert.doesNotMatch(viewSource, /function parseTaskLine|const parseTaskLine\s*=/u);
  assert.doesNotMatch(viewSource, /getTaskDisplayTitle/);
  assert.doesNotMatch(viewSource, /readTodayFood/);
  assert.doesNotMatch(viewSource, /readDailyFoodTotals/);
});
