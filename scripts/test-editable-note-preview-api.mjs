import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const apiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
const managerSource = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');

async function importTypeScriptUtility(relativeUrl) {
  const source = readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

const requestUtility = await importTypeScriptUtility('../src/utils/editable-note-preview-request.ts');
const documentUtility = await importTypeScriptUtility('../src/utils/editable-note-preview-document.ts');

test('editable preview request normalization rejects unsafe callers and disconnected anchors', () => {
  const connectedAnchor = { isConnected: true };
  assert.deepEqual(
    requestUtility.normalizeEditableNotePreviewRequest({
      sourcePluginId: ' tps-calendar-base ',
      filePath: 'Calendar\\New event.md',
      anchorEl: connectedAnchor,
      focusEditor: true,
    }),
    {
      sourcePluginId: 'tps-calendar-base',
      filePath: 'Calendar/New event.md',
      anchorEl: connectedAnchor,
      focusEditor: true,
    },
  );
  assert.equal(requestUtility.normalizeEditableNotePreviewRequest(null), null);
  assert.equal(requestUtility.normalizeEditableNotePreviewRequest({ sourcePluginId: '', filePath: 'Note.md', anchorEl: connectedAnchor }), null);
  assert.equal(requestUtility.normalizeEditableNotePreviewRequest({ sourcePluginId: 'bad/id', filePath: 'Note.md', anchorEl: connectedAnchor }), null);
  assert.equal(requestUtility.normalizeEditableNotePreviewRequest({ sourcePluginId: 'calendar', filePath: '../Note.md', anchorEl: connectedAnchor }), null);
  assert.equal(requestUtility.normalizeEditableNotePreviewRequest({ sourcePluginId: 'calendar', filePath: '/Note.md', anchorEl: connectedAnchor }), null);
  assert.equal(requestUtility.normalizeEditableNotePreviewRequest({ sourcePluginId: 'calendar', filePath: 'Note.md', anchorEl: { isConnected: false } }), null);
});

test('editable preview document writes preserve live frontmatter bytes, BOM, and line endings', () => {
  const lf = '---\ntitle: Event\ntags: [calendar]\n---\nOriginal body\n';
  const lfParts = documentUtility.splitEditableNotePreviewDocument(lf);
  assert.equal(lfParts.lineEndingsSupported, true);
  assert.equal(lfParts.prefix, '---\ntitle: Event\ntags: [calendar]\n---\n');
  assert.equal(lfParts.body, 'Original body\n');
  assert.equal(documentUtility.composeEditableNotePreviewDocument(lfParts, 'Updated body'), '---\ntitle: Event\ntags: [calendar]\n---\nUpdated body');

  const crlf = '\uFEFF---\r\ntitle: Event\r\n...\r\nOriginal\r\n';
  const crlfParts = documentUtility.splitEditableNotePreviewDocument(crlf);
  assert.equal(crlfParts.lineEndingsSupported, true);
  assert.equal(crlfParts.prefix, '\uFEFF---\r\ntitle: Event\r\n...\r\n');
  assert.equal(crlfParts.eol, '\r\n');
  assert.equal(documentUtility.composeEditableNotePreviewDocument(crlfParts, 'Line one\nLine two'), '\uFEFF---\r\ntitle: Event\r\n...\r\nLine one\r\nLine two');
  assert.notEqual(documentUtility.splitEditableNotePreviewDocument(`${crlfParts.prefix}External edit\r\n`).body, crlfParts.body);

  const eofFence = documentUtility.splitEditableNotePreviewDocument('---\ntitle: Empty\n---');
  assert.equal(documentUtility.composeEditableNotePreviewDocument(eofFence, 'First body line'), '---\ntitle: Empty\n---\nFirst body line');
});

test('editable preview fails closed instead of normalizing mixed or CR-only line endings', () => {
  const mixed = documentUtility.splitEditableNotePreviewDocument(
    '---\r\ntitle: Event\r\n---\r\nLine one\nLine two\r\n',
  );
  assert.equal(mixed.lineEndingsSupported, false);
  assert.throws(
    () => documentUtility.composeEditableNotePreviewDocument(mixed, 'Changed'),
    /cannot preserve mixed or CR-only line endings/u,
  );

  const crOnly = documentUtility.splitEditableNotePreviewDocument(
    '---\rtitle: Event\r---\rOriginal body\r',
  );
  assert.equal(crOnly.lineEndingsSupported, false);
  assert.throws(
    () => documentUtility.composeEditableNotePreviewDocument(crOnly, 'Changed'),
    /cannot preserve mixed or CR-only line endings/u,
  );

  const noLineBreaks = documentUtility.splitEditableNotePreviewDocument('One line');
  assert.equal(noLineBreaks.lineEndingsSupported, true);
  assert.equal(
    documentUtility.composeEditableNotePreviewDocument(noLineBreaks, 'One line\nTwo'),
    'One line\nTwo',
  );
});

test('raw Markdown remains byte-stable on open-close and when one line is appended', () => {
  const complex = [
    '\uFEFF---',
    'title: Complex',
    '---',
    '**bold** and *emphasis* with [[Wiki Note|alias]] and [web](https://example.com)',
    '',
    '- [ ] Task with #tag and `inline code`',
    '',
    '> [!note] Callout',
    '> Keep **all** source syntax.',
    '',
    '![[Embedded Note#Heading]]',
    '',
    '',
  ].join('\r\n');
  const parts = documentUtility.splitEditableNotePreviewDocument(complex);
  const rawEditorValue = documentUtility.normalizeEditableNotePreviewBody(parts.body);
  assert.match(rawEditorValue, /\*\*bold\*\*[\s\S]*\[\[Wiki Note\|alias\]\][\s\S]*- \[ \] Task[\s\S]*> \[!note\][\s\S]*!\[\[Embedded Note#Heading\]\]/u);
  assert.match(rawEditorValue, /\n\n$/u);
  assert.equal(documentUtility.composeEditableNotePreviewDocument(parts, rawEditorValue), complex);

  const appendedEditorValue = `${rawEditorValue}Appended from Calendar\n`;
  assert.equal(
    documentUtility.composeEditableNotePreviewDocument(parts, appendedEditorValue),
    `${complex}Appended from Calendar\r\n`,
  );
});

test('GCM publishes a strict versioned local editable-preview API without Hover Editor routing', () => {
  const uiApi = apiSource.slice(apiSource.indexOf('ui: {'), apiSource.indexOf('diagnostics: {'));
  assert.match(uiApi, /ui:\s*\{\s*version:\s*1,/u);
  assert.match(uiApi, /openEditableNotePreview:\s*async \(request: unknown\): Promise<boolean>/u);
  assert.match(uiApi, /normalizeEditableNotePreviewRequest\(request\)/u);
  assert.match(uiApi, /normalized\.anchorEl instanceof ownerWindow\.HTMLElement/u);
  assert.match(uiApi, /const filePath = normalizePath\(normalized\.filePath\)/u);
  assert.match(uiApi, /file instanceof TFile[\s\S]{0,120}file\.extension\.toLowerCase\(\) !== 'md'/u);
  assert.match(uiApi, /plugin\.persistentMenuManager\.showBaseLinkEditablePreview\([\s\S]{0,240}focusEditor: normalized\.focusEditor/u);
  assert.match(uiApi, /return opened === true/u);
  assert.doesNotMatch(uiApi, /openBaseLinkInHoverEditor|spawnPopover|hover-link/u);
});

test('local editable preview opens only after rendering and supports focus, X, Escape, and guarded close', () => {
  const closeSource = managerSource.slice(
    managerSource.indexOf('private async closeBaseLinkEditablePreview'),
    managerSource.indexOf('private teardownBaseLinkEditablePreview'),
  );
  const forceCloseSource = managerSource.slice(
    managerSource.indexOf('private async forceCloseBaseLinkEditablePreview'),
    managerSource.indexOf('public isBaseLinkEditablePreviewOpen'),
  );
  assert.match(managerSource, /showBaseLinkEditablePreview\([\s\S]{0,180}options: \{ focusEditor\?: boolean; focusTitle\?: boolean; openNote\?: \(\) => Promise<boolean> \} = \{\},[\s\S]{0,80}Promise<boolean>/u);
  assert.match(managerSource, /!parts\.lineEndingsSupported[\s\S]{0,180}card:unsupported-line-endings[\s\S]{0,120}return false/u);
  assert.match(managerSource, /await MarkdownRenderer\.render/u);
  assert.match(managerSource, /this\.baseLinkPreviewReadySession = session/u);
  assert.match(managerSource, /bodySizer\.contentEditable = 'false'/u);
  assert.match(managerSource, /bodySizer\.addEventListener\('click'[\s\S]{0,180}this\.activateBaseLinkPreviewSourceEditor\(\)/u);
  assert.match(managerSource, /bodySizer\.addEventListener\('keydown'[\s\S]{0,180}evt\.key !== 'Enter'[\s\S]{0,220}this\.activateBaseLinkPreviewSourceEditor\(\)/u);
  assert.match(managerSource, /options\.focusEditor === true[\s\S]{0,180}this\.activateBaseLinkPreviewSourceEditor\(\)/u);
  assert.match(managerSource, /getEditablePreviewBodyText\(\): string \{[\s\S]{0,220}normalizeEditableNotePreviewBody\(editorEl\.value\)[\s\S]{0,120}this\.baseLinkPreviewLastSavedBody/u);
  assert.doesNotMatch(managerSource, /serializeEditablePreviewMarkdown|contentEditable = 'true'/u);
  assert.match(managerSource, /tps-gcm-base-link-preview-close[\s\S]{0,220}Dismiss preview[\s\S]{0,220}setIcon\(closeButton, 'x'\)/u);
  assert.match(managerSource, /popover\.addEventListener\('keydown'[\s\S]{0,180}evt\.key !== 'Escape'/u);
  assert.match(managerSource, /await this\.plugin\.app\.vault\.process\(file/u);
  assert.match(managerSource, /const currentParts = splitEditableNotePreviewDocument\(currentRaw\)[\s\S]{0,160}!currentParts\.lineEndingsSupported[\s\S]{0,160}unsupportedLineEndings = true[\s\S]{0,100}return currentRaw/u);
  assert.match(managerSource, /currentParts\.body !== expectedBodyRevision/u);
  assert.match(managerSource, /Not saved — note changed elsewhere/u);
  assert.match(managerSource, /Not saved — unsupported line endings/u);
  assert.match(closeSource, /let safeToClose = await this\.flushBaseLinkPreviewBodySave/u);
  assert.match(closeSource, /if \(!safeToClose\)/u);
  assert.match(closeSource, /if \(editorEl\) editorEl\.readOnly = true/u);
  assert.match(closeSource, /await this\.flushBaseLinkPreviewBodySave/u);
  assert.match(closeSource, /while \([\s\S]*this\.getEditablePreviewBodyText\(\) !== this\.baseLinkPreviewLastSavedBody[\s\S]*await this\.flushBaseLinkPreviewBodySave/u);
  assert.match(forceCloseSource, /finally \{[\s\S]*this\.teardownBaseLinkEditablePreview\(session\)/u);
  assert.match(managerSource, /card:render-failed[\s\S]{0,260}await this\.closeBaseLinkEditablePreview\(\)/u);
  assert.match(managerSource, /!popover\.isConnected\s*\|\| !anchorEl\.isConnected[\s\S]{0,180}this\.teardownBaseLinkEditablePreview\(session\)/u);
  assert.match(managerSource, /session !== this\.baseLinkPreviewSession/u);
  assert.match(managerSource, /const targetDocument = anchorEl\.ownerDocument[\s\S]{0,300}targetDocument\.createElement\('div'\)/u);
  assert.match(managerSource, /targetDocument\.body\.appendChild\(popover\)/u);
  assert.match(managerSource, /targetDocument\.addEventListener\('mousedown'/u);
  assert.match(managerSource, /\(this\.baseLinkPreviewWindow \?\? window\)\.clearTimeout\(this\.baseLinkPreviewRenderTimer\)/u);
  assert.match(stylesSource, /\.tps-gcm-base-link-preview-open,\s*\.tps-gcm-base-link-preview-close/u);
  assert.match(stylesSource, /\.tps-gcm-base-link-preview-close:focus-visible/u);
});

test('preview follows automatic renames while preserving a name being typed', () => {
  const close = managerSource.slice(managerSource.indexOf('private async closeBaseLinkEditablePreview'));
  assert.ok(close.indexOf('const session = this.baseLinkPreviewSession') < close.indexOf('await this.baseLinkPreviewTitleSave()'));
  assert.match(close, /await this\.baseLinkPreviewTitleSave\(\)[\s\S]{0,120}session !== this\.baseLinkPreviewSession/u);
  assert.match(managerSource, /component\.registerEvent\(this\.plugin\.app\.vault\.on\('rename'/u);
  assert.match(managerSource, /if \(renamed !== file\) return;/u);
  assert.match(managerSource, /popover\.dataset\.path = file\.path;/u);
  assert.doesNotMatch(managerSource, /nameInput && nameInput\.value === oldName/u);
  assert.match(managerSource, /baseLinkPreviewTitleSave && !await this\.baseLinkPreviewTitleSave\(\)/u);
});

// Execute the real preview title-input closure without loading the unrelated
// menu/renderer graph. This covers event wiring, save ordering and failure
// behavior in the production code rather than reimplementing the save action.
function loadPreviewTitleInputSetup() {
  const syntax = ts.createSourceFile('manager.ts', managerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let block;
  const visit = node => {
    if (ts.isMethodDeclaration(node) && node.name.getText(syntax) === 'showBaseLinkEditablePreview') {
      block = node.body.statements.find(statement => ts.isIfStatement(statement)
        && statement.expression.getText(syntax) === 'options.focusTitle');
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  assert.ok(block, 'the actual created-note title input must exist');
  const javascript = ts.transpileModule(`(function(context) {
    const { targetDocument, title, file, popover, path, session, options, Notice, logger,
      splitEditableNotePreviewDocument, normalizeEditableNotePreviewBody } = context;
    let nameInput = null;
    ${block.getText(syntax)}
    return nameInput;
  })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(`return ${javascript}`)();
}

const setupPreviewTitleInput = loadPreviewTitleInputSetup();

function loadPreviewBodyFlush(context) {
  const syntax = ts.createSourceFile('manager.ts', managerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let method;
  const visit = node => {
    if (ts.isMethodDeclaration(node) && node.name.getText(syntax) === 'flushBaseLinkPreviewBodySave') method = node;
    else ts.forEachChild(node, visit);
  };
  visit(syntax);
  assert.ok(method);
  const javascript = ts.transpileModule(`(async function(${method.parameters.map(parameter => parameter.getText(syntax)).join(', ')}) ${method.body.getText(syntax)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return new Function('context', `const { TFile, Notice, logger, splitEditableNotePreviewDocument, composeEditableNotePreviewDocument } = context; return ${javascript}`)(context);
}

function previewTitleHarness({ autoRename = true, native = false, reject = false, fail = false, crlf = false, beforeWrite, afterWrite, flushResult = true } = {}) {
  class TFile {}
  const file = Object.assign(new TFile(), { path: 'Inbox/Storage name.md', basename: 'Storage name', parent: { path: 'Inbox' }, extension: 'md' });
  const eol = crlf ? '\r\n' : '\n';
  const state = {
    title: 'Semantic title', body: `Original body${eol}`, draft: `Original body${eol}`,
    directRenames: 0, canonicalRenames: 0, writes: [], order: [], notices: [], focusBody: 0
  };
  const input = {
    value: '', style: {}, attributes: {}, listeners: new Map(),
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    dispatch(type, extras = {}) {
      this.listeners.get(type)?.({ stopPropagation() {}, preventDefault() {}, isComposing: false, ...extras });
    }
  };
  const editor = { readOnly: false };
  const manager = {
    baseLinkPreviewSession: 1,
    baseLinkPreviewReadySession: 1,
    baseLinkPreviewWindow: { clearTimeout() {} },
    baseLinkPreviewSaveTimer: null,
    baseLinkPreviewRenderTimer: null,
    baseLinkPreviewSaveInFlight: null,
    baseLinkPreviewFile: file,
    baseLinkPreviewEditorEl: editor,
    baseLinkPreviewLastSavedBody: documentUtility.normalizeEditableNotePreviewBody(state.body),
    baseLinkPreviewBodyRevision: state.body,
    baseLinkPreviewEl: { isConnected: true, querySelector: () => ({ textContent: '' }) },
    topLinkPreviewTextCache: new Map(),
    isBaseLinkEditablePreviewOpen: () => true,
    getEditablePreviewBodyText: () => documentUtility.normalizeEditableNotePreviewBody(state.draft),
    async flushBaseLinkPreviewBodySave() {
      state.order.push('body');
      if (!flushResult) return false;
      state.body = state.draft;
      manager.baseLinkPreviewLastSavedBody = documentUtility.normalizeEditableNotePreviewBody(state.draft);
      manager.baseLinkPreviewBodyRevision = state.body;
      return true;
    },
    activateBaseLinkPreviewSourceEditor() { state.focusBody++; },
    plugin: {
      noteTitleRenderService: { getDisplayTitle: () => state.title || file.basename },
      app: {
        fileManager: { async renameFile(target, nextPath) {
          state.directRenames++;
          target.path = nextPath;
          target.basename = nextPath.split('/').pop().replace(/\.md$/u, '');
        } },
        vault: {
          cachedRead: async () => `---\ntitle: ${state.title}\n---\n${state.body}`,
          async process(target, transform) {
            assert.equal(target, file);
            const next = transform(`---\ntitle: ${state.title}\n---\n${state.body}`);
            state.body = documentUtility.splitEditableNotePreviewDocument(next).body;
            return next;
          }
        }
      },
      bulkEditService: { async updateFrontmatter(files, updates) {
        state.order.push('title');
        state.writes.push(updates);
        assert.deepEqual(files, [file]);
        assert.equal(editor.readOnly, true, 'preview body autosave cannot interleave the title write');
        await beforeWrite?.(state);
        if (fail) throw Error('Synthetic title save failure');
        if (reject) return 0;
        state.title = updates.title;
        // Match the established canonical writer's full-source normalization.
        state.body = state.body.replace(/\r\n/gu, '\n');
        if (autoRename && !native) {
          state.canonicalRenames++;
          file.basename = updates.title.replace(/[<>:"/\\|?*]/gu, '');
          file.path = `Inbox/${file.basename}.md`;
        }
        await afterWrite?.(state);
        return 1;
      } }
    }
  };
  const context = {
    targetDocument: { createElement: () => input }, title: { replaceWith() {} },
    file, popover: { dataset: {} }, path: { textContent: file.path }, session: 1,
    options: { focusTitle: true },
    Notice: class { constructor(message) { state.notices.push(message); } },
    TFile,
    logger: { flowError() {}, flowWarn() {}, flow() {} },
    splitEditableNotePreviewDocument: documentUtility.splitEditableNotePreviewDocument,
    composeEditableNotePreviewDocument: documentUtility.composeEditableNotePreviewDocument,
    normalizeEditableNotePreviewBody: documentUtility.normalizeEditableNotePreviewBody
  };
  setupPreviewTitleInput.call(manager, context);
  return { input, manager, file, state, editor, save: () => manager.baseLinkPreviewTitleSave(),
    flushBody: () => loadPreviewBodyFlush(context).call(manager, { textContent: '' }) };
}

test('created-note preview initializes the semantic title and keeps unchanged input read-only', async () => {
  const h = previewTitleHarness();
  assert.equal(h.input.value, 'Semantic title');
  assert.equal(h.input.attributes['aria-label'], 'Note title');
  assert.equal(await h.save(), true);
  assert.deepEqual(h.state.writes, []);
  assert.equal(h.state.directRenames, 0);
});

for (const mode of ['auto-rename', 'title-only', 'native-record']) {
  test(`preview title save preserves canonical ${mode} ownership and pending body edits`, async () => {
    const h = previewTitleHarness({ autoRename: mode !== 'title-only', native: mode === 'native-record' });
    h.state.draft = 'Body typed before title save\n';
    h.input.value = '  Human:  title  ';
    assert.equal(await h.save(), true);
    assert.equal(h.state.title, 'Human: title');
    assert.equal(h.state.body, h.state.draft);
    assert.deepEqual(h.state.order, ['body', 'title']);
    assert.equal(h.state.directRenames, 0);
    assert.equal(h.state.canonicalRenames, mode === 'auto-rename' ? 1 : 0);
    assert.equal(h.file.path, mode === 'auto-rename' ? 'Inbox/Human title.md' : 'Inbox/Storage name.md');
    assert.equal(h.editor.readOnly, false);
    assert.equal(await h.save(), true, 'dismissal after acceptance must not resubmit because basename differs');
    assert.equal(h.state.writes.length, 1);
    h.input.value = 'Draft not accepted';
    h.input.dispatch('keydown', { key: 'Escape' });
    assert.equal(h.input.value, 'Human: title');
  });
}

for (const outcome of ['rejected', 'failed', 'body-conflict']) {
  test(`${outcome} preview title save retains input and does not enter the body editor`, async () => {
    const h = previewTitleHarness({ reject: outcome === 'rejected', fail: outcome === 'failed', flushResult: outcome !== 'body-conflict' });
    h.input.value = 'Requested title';
    h.input.dispatch('keydown', { key: 'Enter' });
    assert.equal(await h.save(), false);
    assert.equal(h.input.value, 'Requested title');
    assert.equal(h.state.focusBody, 0);
    assert.equal(h.state.title, 'Semantic title');
    assert.equal(h.file.path, 'Inbox/Storage name.md');
    assert.equal(h.state.directRenames, 0);
    assert.equal(h.editor.readOnly, false);
    if (outcome === 'body-conflict') assert.deepEqual(h.state.writes, []);
  });
}

test('change, Enter and dismissal share a pending title save; newer input saves once afterward', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = previewTitleHarness({ beforeWrite: state => state.writes.length === 1 ? gate : undefined });
  h.input.value = 'First title';
  h.input.dispatch('change');
  await Promise.resolve();
  h.input.value = 'Latest title';
  h.input.dispatch('keydown', { key: 'Enter' });
  const closing = h.save();
  release();
  assert.equal(await closing, true);
  assert.deepEqual(h.state.writes, [{ title: 'First title' }, { title: 'Latest title' }]);
  assert.equal(h.state.title, 'Latest title');
  assert.equal(h.state.directRenames, 0);
  assert.equal(h.editor.readOnly, false);
});

test('change, Enter and dismissal without newer input perform one title write', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = previewTitleHarness({ beforeWrite: () => gate });
  h.input.value = 'Accepted once';
  h.input.dispatch('change');
  h.input.dispatch('keydown', { key: 'Enter' });
  const closing = h.save();
  release();
  assert.equal(await closing, true);
  assert.deepEqual(h.state.writes, [{ title: 'Accepted once' }]);
  assert.equal(h.state.focusBody, 1);
  assert.equal(h.state.directRenames, 0);
});

test('blank preview titles do not flush the body or invoke a writer', async () => {
  const h = previewTitleHarness();
  h.input.value = ' \n ';
  assert.equal(await h.save(), false);
  assert.deepEqual(h.state.order, []);
  assert.equal(h.state.notices[0], 'Title cannot be empty.');
  assert.equal(h.state.directRenames, 0);
});

test('canonical title save advances the preview body revision after CRLF normalization', async () => {
  const h = previewTitleHarness({ crlf: true });
  h.input.value = 'New title';
  assert.equal(await h.save(), true);
  assert.equal(h.manager.baseLinkPreviewBodyRevision, h.state.body);
  assert.equal(h.manager.baseLinkPreviewLastSavedBody, h.state.body);
  h.state.draft = 'Body edited after title save\n';
  assert.equal(await h.flushBody(), true, 'the actual body writer must not falsely conflict after the title writer changes line endings');
  assert.equal(h.state.body, h.state.draft);
  assert.equal(h.state.directRenames, 0);
});

test('title save preserves a concurrent external body change and the next preview edit remains a conflict', async () => {
  const h = previewTitleHarness({ afterWrite: state => { state.body = 'External body revision\n'; } });
  h.input.value = 'New title';
  assert.equal(await h.save(), true);
  assert.equal(h.manager.baseLinkPreviewBodyRevision, 'Original body\n');
  h.state.draft = 'Preview edit based on the old body\n';
  assert.equal(await h.flushBody(), false);
  assert.equal(h.state.body, 'External body revision\n');
});

test('title save restores an already read-only editor exactly', async () => {
  const h = previewTitleHarness();
  h.editor.readOnly = true;
  h.input.value = 'New title';
  assert.equal(await h.save(), true);
  assert.equal(h.editor.readOnly, true);
});
