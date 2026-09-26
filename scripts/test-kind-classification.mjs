import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle=await build({entryPoints:['src/utils/kind-classification.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {encodeKind,decodeKind,normalizeClassificationTag}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const mappings={'food-entry':{tag:'kind/food/transaction'},food:{tag:'library/Food'}};
test('full tags encode/decode without a required depth and preserve unrelated fields',()=>{
 const before={kind:'food-entry',title:'Lunch',tags:['personal'],calories:100};
 const encoded=encodeKind(mappings,before);
 assert.deepEqual(encoded,{title:'Lunch',tags:['personal','kind/food/transaction'],calories:100});
 assert.equal(before.kind,'food-entry');assert.deepEqual(before.tags,['personal']);
 assert.equal(decodeKind(mappings,encoded).kind,'food-entry');
 assert.deepEqual(encodeKind(mappings,decodeKind(mappings,encoded)),encoded);
 assert.equal(decodeKind(mappings,{tags:['LIBRARY/food']}).kind,'food');
 for(const tag of ['food','personal/nutrition/entries/custom','食べ物/記録'])assert.equal(decodeKind({food:{tag}},encodeKind({food:{tag}},{kind:'food'})).kind,'food');
});
test('ancestor tags do not determine classification and conflicting types fail closed',()=>{
 assert.equal(decodeKind(mappings,{tags:['kind/food/transaction/other']}).kind,undefined);
 assert.throws(()=>decodeKind(mappings,{tags:['kind/food/transaction','library/Food']}),/Ambiguous/);
 assert.throws(()=>encodeKind(mappings,{kind:'food-entry',tags:['library/Food']}),/Ambiguous/);
 assert.throws(()=>encodeKind(mappings,{kind:'food-entry',tags:[{name:'bad'}]}),/Tags must/);
 for(const tag of ['a//b','with spaces','#','a/'])assert.throws(()=>normalizeClassificationTag(tag));
 assert.equal(normalizeClassificationTag(' #kind/food '),'kind/food');
});
test('existing property mappings remain compatible; mapping changes are authoritative',()=>{
 const old={food:{parentKind:'entity',key:'entityKind',value:'food'}};
 assert.deepEqual(decodeKind(old,encodeKind(old,{kind:'food',title:'Food'})),{kind:'food',title:'Food'});
 assert.equal(decodeKind({food:{tag:'new'}},{tags:['library/Food']}).kind,undefined);
});
