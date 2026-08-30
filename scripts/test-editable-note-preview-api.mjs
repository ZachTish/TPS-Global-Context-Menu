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
  assert.match(managerSource, /showBaseLinkEditablePreview\([\s\S]{0,180}options: \{ focusEditor\?: boolean \} = \{\},[\s\S]{0,80}Promise<boolean>/u);
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
