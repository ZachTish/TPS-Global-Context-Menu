import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const result = await build({ entryPoints: ['src/utils/managed-note-fields.ts'], bundle: true, format: 'esm', write: false });
const {configureManagedNoteField: configure, readManagedNoteField: read, writeManagedNoteField: write, MANAGED_NOTE_FIELDS: fields} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
for (const field of fields) test(`${field}: only the configured name is read and no aliases are retained`, () => {
 const settings = {}; configure(settings, field, 'custom_' + field);
 assert.equal(read(settings, field, {[field]: 'old'}), undefined);
 const fm = {['custom_' + field]: 'current', title: 'Untouched'};
 assert.equal(read(settings, field, fm), 'current');
 write(settings, field, fm, 'updated');
 assert.equal(fm['custom_' + field], 'updated');
 configure(settings, field, 'next_' + field);
 assert.equal(read(settings, field, fm), undefined);
 assert.deepEqual(settings.managedNoteFieldAliases[field], []);
});
test('identity collisions are rejected while unrelated old names remain untouched', () => {
 const settings = {};
 for (const bad of ['tpsId','title','tags','sourcePath','__proto__','bad\nkey','']) assert.throws(() => configure(settings,'externalId',bad));
 configure(settings,'externalId','mirrorKey');
 const fm={externalId:'unrelated',mirrorKey:'current'};
 assert.equal(read(settings,'externalId',fm),'current');
 write(settings,'externalId',fm,'next');
 assert.deepEqual(fm,{externalId:'unrelated',mirrorKey:'next'});
});
test('writes no longer add redundant bookkeeping or delete authored type fields', () => {
 const archive=readFileSync('src/services/archive-file-service.ts','utf8');const records=readFileSync('src/services/native-record-service.ts','utf8');const naming=readFileSync('src/services/file-naming-service.ts','utf8');
 assert.doesNotMatch(archive,/frontmatter\.archiveOriginalFolder\s*=/);assert.match(archive,/getArchiveRelativeOriginalFolder\(file.path, archiveFolder\)/);
 assert.doesNotMatch(records,/properties\.sourceLine\s*=|promotionState: 'unlinked'/);
 assert.doesNotMatch(naming,/normalized === 'type' \|\| normalized === 'types'/);
});

test('field configuration stays on Advanced with explicit, labeled apply actions', () => {
 const settings=readFileSync('src/settings-tab.ts','utf8');
 assert.match(settings,/if \(this.activeSettingsPage === 'advanced'\) \{\s*this.renderIntegrationPropertyNames\(activePage\)/);
 assert.match(settings,/configureManagedNoteField\(settings, field, next\)/);
 assert.match(settings,/setAttribute\('aria-label', labels\[field\]\)/);
 assert.match(settings,/setAttribute\('aria-label', `Apply/);
});

test('a missing field cannot borrow an unrelated property named undefined', () => {
 assert.equal(read({},'externalId',{undefined:'unrelated'}),undefined);
});
