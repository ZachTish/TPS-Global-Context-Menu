import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const suggestSource = readFileSync(new URL('../src/services/heading-link-suggest.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const fileNamingSource = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');

test('heading link suggest only triggers from markdown headings and inserts markdown links', () => {
  assert.match(mainSource, /import \{ HeadingLinkSuggest \} from '\.\/services\/heading-link-suggest'/);
  assert.match(mainSource, /addChild\(new HeadingLinkSuggest\(this\)\)/);
  assert.match(suggestSource, /extends Component/);
  assert.match(suggestSource, /registerDomEvent\(document, 'keyup'/);
  assert.match(suggestSource, /registerDomEvent\(document, 'input'/);
  assert.match(suggestSource, /registerDomEvent\(document, 'keydown'/);
  assert.match(suggestSource, /window\.setTimeout\(\(\) => this\.refresh\(\), 0\)/);
  assert.match(suggestSource, /beforeCursor\.match\(/);
  assert.match(suggestSource, /#\{1,6\}/);
  assert.match(suggestSource, /\{2,\}/);
  assert.match(suggestSource, /replace\(\/\[\\u200B-\\u200D\\uFEFF\]\/g, ''\)/);
  assert.match(suggestSource, /query\.startsWith\('#'\)/);
  assert.match(suggestSource, /query\.includes\('\[\['\)/);
  assert.match(suggestSource, /generateMarkdownLink\(/);
  assert.match(suggestSource, /replaceRange\(\s*link,/);
  assert.match(suggestSource, /event\.key === 'Enter' \|\| event\.key === 'Tab'/);
  assert.match(suggestSource, /private handleKeydown\(event: KeyboardEvent\): boolean/);
});

test('heading link suggest matches title filename and aliases', () => {
  assert.match(suggestSource, /frontmatter\?\.title/);
  assert.match(suggestSource, /file\.basename/);
  assert.match(suggestSource, /getAliases\(cache\?\.frontmatter\)/);
  assert.match(suggestSource, /\(frontmatter as any\)\.aliases \?\? \(frontmatter as any\)\.alias/);
  assert.match(suggestSource, /normalizedValue\.startsWith\(normalizedQuery\)/);
  assert.match(suggestSource, /compactValue\.includes\(compactQuery\)/);
});

test('title sync preserves meaningful previous title and basename aliases', () => {
  const writeSource = fileNamingSource.slice(
    fileNamingSource.indexOf('private addMeaningfulAliases'),
    fileNamingSource.indexOf('private getDailyNoteParseFormats'),
  );
  const syncSource = fileNamingSource.slice(
    fileNamingSource.indexOf('private async syncTitleFromFilenameWithOptions'),
    fileNamingSource.indexOf('/**\n     * Update filename based on title'),
  );

  assert.match(writeSource, /aliases \?\? \(frontmatter as any\)\.alias/);
  assert.match(writeSource, /targetKey = aliasKeys\.find/);
  assert.match(writeSource, /normalized === 'alias' \|\| normalized === 'aliases'/);
  assert.match(writeSource, /TEMPLATE_TITLE_MARKERS\.some/);
  assert.match(syncSource, /this\.addMeaningfulAliases\(frontmatter, \[currentTitle, rawBasename\], nextTitle\)/);
});
