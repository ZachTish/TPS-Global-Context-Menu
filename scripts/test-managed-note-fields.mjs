import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const result = await build({ entryPoints: ['src/utils/managed-note-fields.ts'], bundle: true, format: 'esm', write: false });
const {configureManagedNoteField: configure, readManagedNoteField: read, writeManagedNoteField: write, MANAGED_NOTE_FIELDS: fields} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
for (const field of fields) test(`${field}: rename twice retains old note reads and writes only the chosen key`, () => {
 const settings = {}; const fm = {[field]: 'original', title: 'Untouched', tpsId: 'stable'};
 configure(settings, field, 'custom_' + field);
 assert.equal(read(settings, field, fm), 'original');
 write(settings, field, fm, 'updated');
 assert.equal(fm[field], undefined);
 configure(settings, field, 'next_' + field);
 assert.equal(read(settings, field, fm), 'updated');
 write(settings, field, fm, 'final');
 assert.deepEqual(fm, {title: 'Untouched', tpsId: 'stable', ['next_' + field]: 'final'});
 write(settings, field, fm, null); assert.deepEqual(fm, {title:'Untouched',tpsId:'stable'});
});
test('identity collisions and conflicting aliases fail before a note mutation', () => {
 const settings = {};
 for (const bad of ['tpsId','title','tags','sourcePath','__proto__','bad\nkey','']) assert.throws(() => configure(settings,'externalId',bad));
 configure(settings,'externalId','mirrorKey');
 const fm={externalId:'first',mirrorKey:'second',title:'Keep'}; const before=JSON.stringify(fm);
 assert.throws(()=>read(settings,'externalId',fm));assert.throws(()=>write(settings,'externalId',fm,'third'));assert.equal(JSON.stringify(fm),before);
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
 assert.match(settings,/configureManagedNoteField\(this.plugin.settings, field, next\)/);
 assert.match(settings,/setAttribute\('aria-label', labels\[field\]\)/);
 assert.match(settings,/setAttribute\('aria-label', `Apply/);
});

test('a missing field cannot borrow an unrelated property named undefined', () => {
 assert.equal(read({},'externalId',{undefined:'unrelated'}),undefined);
});
