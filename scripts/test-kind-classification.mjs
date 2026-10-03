import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle=await build({entryPoints:['src/utils/kind-classification.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {encodeKind,decodeKind,kindDiscriminator,normalizeClassificationTag,kindReadClassifications,matchesKind}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
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
test('property classifications cannot overwrite existing record fields or shared keys',()=>{
 const map={transaction:{parentKind:'transaction',key:'transactionKind',value:'financial'}};
 assert.throws(()=>encodeKind(map,{kind:'transaction',transactionKind:'food',amount:12}),/conflicts with an existing field/);
 assert.throws(()=>encodeKind(map,{kind:'transaction',TransactionKind:'food'}),/conflicts with an existing field/);
 assert.deepEqual(encodeKind(map,{kind:'transaction',amount:12}),{kind:'transaction',transactionKind:'financial',amount:12});
 assert.throws(()=>encodeKind({transaction:{parentKind:'transaction',key:'Kind',value:'financial'}},{kind:'transaction'}),/Invalid classification/);
});

test('configured kind-list writer preserves unrelated kind values and reads explicit legacy forms',()=>{
 const mapped={'food-entry':{primary:{kindList:{key:'kind',value:'transaction/macros'}},aliases:[
  {tag:'kind/food/transaction'},{scalar:{key:'kind',value:'food-entry'}},
  {key:'transactionKind',parentKind:'transaction',value:'food'},
 ]}};
 const original={kind:['transaction/macros','user/special'],title:'Lunch',tags:['manual']};
 const decoded=decodeKind(mapped,original);
 assert.equal(decoded.kind,'food-entry');
 assert.deepEqual(encodeKind(mapped,decoded,original),original);
 assert.deepEqual(encodeKind(mapped,{kind:'food-entry',title:'Old lunch',tags:['manual']},{kind:'food-entry'}),
  {kind:['transaction/macros'],title:'Old lunch',tags:['manual']});
 assert.equal(decodeKind(mapped,{kind:'food-entry'}).kind,'food-entry');
 assert.equal(decodeKind(mapped,{tags:['kind/food/transaction']}).kind,'food-entry');
 assert.equal(decodeKind(mapped,{kind:'transaction',transactionKind:'food'}).kind,'food-entry');
 assert.equal(matchesKind(mapped,{kind:['transaction/macros','user/special']},'food-entry'),true);
 assert.equal(kindReadClassifications(mapped,'food-entry').length,4);
 assert.throws(()=>encodeKind(mapped,{kind:'food-entry'},{kind:'wrong'}),/must be a list/u);
 assert.throws(()=>decodeKind({...mapped,other:{kindList:{key:'kind',value:'user/special'}}},original),/Ambiguous/u);
});

test('kind-list paths and property keys come from mappings, not built-in taxonomy',()=>{
 const mapped={arbitrary:{kindList:{key:'myKinds',value:'alpha/beta/gamma'}}};
 assert.deepEqual(encodeKind(mapped,{kind:'arbitrary',title:'Entry'}),{myKinds:['alpha/beta/gamma'],title:'Entry'});
 assert.equal(decodeKind(mapped,{myKinds:['alpha/beta/gamma']}).kind,'arbitrary');
 for(const invalid of ['', 'alpha', 'alpha//beta', 'alpha/beta space'])
  assert.throws(()=>encodeKind({arbitrary:{kindList:{key:'myKinds',value:invalid}}},{kind:'arbitrary'}),/Invalid kind list/u);
 for(const reserved of ['tpsId','tpsSchemaVersion','title','createdDate','modifiedDate','tags']) {
  assert.throws(()=>encodeKind({arbitrary:{kindList:{key:reserved,value:'alpha/beta'}}},{kind:'arbitrary'}),/Invalid kind list/u);
  assert.throws(()=>decodeKind({arbitrary:{scalar:{key:reserved,value:'alpha'}}},{[reserved]:'alpha'}),/Invalid scalar/u);
 }
});

test('a disabled writer continues to read its configured legacy classification',()=>{
 const mapped={undecided:{primary:{tag:'kind/physical'},aliases:[{scalar:{key:'kind',value:'physical'}}],writeDisabled:true}};
 assert.equal(decodeKind(mapped,{tags:['kind/physical']}).kind,'undecided');
 assert.equal(decodeKind(mapped,{kind:'physical'}).kind,'undecided');
 assert.throws(()=>encodeKind(mapped,{kind:'undecided',title:'Item'}),/disabled until a writer is configured/u);
});

test('shared visible kind paths use an existing caller identity without inventing a new property',()=>{
 const mapped={purchase:{kindList:{key:'kind',value:'transaction/financial'}},investment:{kindList:{key:'kind',value:'transaction/financial'}}};
 const raw={kind:['transaction/financial','user/reviewed'],type:'investment',amount:20};
 assert.deepEqual(decodeKind(mapped,raw),raw,'a shared path alone cannot identify one internal record type');
 assert.equal(decodeKind(mapped,raw,'investment').kind,'investment');
 assert.equal(matchesKind(mapped,raw,'purchase'),true);
 assert.equal(matchesKind(mapped,raw,'investment'),true);
 assert.deepEqual(encodeKind(mapped,{kind:'investment',type:'investment',amount:20},raw),raw);
 assert.throws(()=>decodeKind(mapped,raw,'missing'),/Expected record kind/u);
 assert.throws(()=>decodeKind({...mapped,other:{tag:'other/type'}},{...raw,tags:['other/type']},'investment'),/Ambiguous/u);
});
test('a shared kind path and its own legacy tag can be decoded with an existing caller identity',()=>{
 const mapped={
  purchase:{primary:{kindList:{key:'kind',value:'transaction/financial'}},aliases:[{tag:'old/purchase'}]},
  investment:{primary:{kindList:{key:'kind',value:'transaction/financial'}},aliases:[{tag:'old/investment'}]},
 };
 const raw={kind:['transaction/financial'],tags:['old/investment'],type:'investment'};
 assert.deepEqual(decodeKind(mapped,raw),raw);
 assert.equal(decodeKind(mapped,raw,'investment').kind,'investment');
 assert.deepEqual(encodeKind(mapped,{kind:'investment',type:'investment',tags:['old/investment']},raw),
  {kind:['transaction/financial'],type:'investment'});
 assert.throws(()=>decodeKind(mapped,raw,'purchase'),/Ambiguous/u);
});
test('a configured kind-list writer retires shared legacy tags without removing manual tags',()=>{
 const mapped={
  purchase:{primary:{kindList:{key:'recordKind',value:'transaction/money'}},aliases:[{tag:'legacy/purchase'}]},
  investment:{primary:{kindList:{key:'recordKind',value:'transaction/money'}},aliases:[{tag:'legacy/investment'}]},
  unrelated:{tag:'other/type'},
  otherKind:{kindList:{key:'recordKind',value:'other/path'}},
 };
 const old={tags:['legacy/purchase','manual'],type:'investment'};
 const input={kind:'investment',...old};
 const written=encodeKind(mapped,input,old);
 assert.deepEqual(written,{recordKind:['transaction/money'],tags:['manual'],type:'investment'});
 assert.deepEqual(input,{kind:'investment',...old});
 assert.equal(decodeKind(mapped,written,'investment').kind,'investment');
 assert.deepEqual(encodeKind(mapped,{kind:'investment',recordKind:['transaction/money'],tags:['manual']},written),
  {recordKind:['transaction/money'],tags:['manual']});
 assert.throws(()=>encodeKind(mapped,{...input,tags:['legacy/purchase','other/type']},old),/Ambiguous/u);
 assert.throws(()=>encodeKind(mapped,{...input,recordKind:['other/path']},old),/Ambiguous/u);
});

test('configured discriminator resolves shared list paths and is written without a built-in key or value',()=>{
 const mapped={
  purchase:{primary:{kindList:{key:'category',value:'transaction/money'}},aliases:[{tag:'old/purchase'}],discriminator:{key:'recordType',value:'ordinary'}},
  investment:{primary:{kindList:{key:'category',value:'transaction/money'}},aliases:[{tag:'old/investment'}],discriminator:{key:'recordType',value:'investment'}},
 };
 const investment={category:['transaction/money'],recordType:'investment',amount:20};
 assert.deepEqual(kindDiscriminator(mapped,'investment'),{key:'recordType',value:'investment'});
 assert.equal(decodeKind(mapped,investment).kind,'investment');
 assert.equal(decodeKind(mapped,{...investment,recordType:'ordinary'}).kind,'purchase');
 assert.deepEqual(decodeKind(mapped,{category:['transaction/money'],amount:20}),{category:['transaction/money'],amount:20});
 assert.equal(matchesKind(mapped,investment,'investment'),true);
 assert.equal(matchesKind(mapped,investment,'purchase'),false);
 assert.equal(matchesKind(mapped,{category:['transaction/money']},'investment'),false);
 assert.equal(matchesKind(mapped,{tags:['old/investment']},'investment'),true);
 assert.throws(()=>decodeKind({investment:mapped.investment},{category:['transaction/money']}),/discriminator/u);
 assert.deepEqual(encodeKind(mapped,{kind:'investment',amount:20}),investment);
 assert.throws(()=>encodeKind(mapped,{kind:'investment',recordType:'ordinary',amount:20}),/discriminator property/u);
 assert.throws(()=>encodeKind(mapped,{kind:'investment',amount:20},{recordType:'ordinary'}),/discriminator property/u);
 assert.throws(()=>decodeKind(mapped,investment,'purchase'),/Ambiguous|discriminator/u);
 assert.equal(decodeKind(mapped,{tags:['old/investment'],amount:20}).kind,'investment','a unique legacy alias stays readable');
 assert.throws(()=>kindDiscriminator({investment:{...mapped.investment,discriminator:{key:'category',value:'x'}}},'investment'),/Invalid shared kind discriminator/u);
 assert.throws(()=>kindDiscriminator({investment:{...mapped.investment,discriminator:{key:'recordType',value:'  '}}},'investment'),/Invalid shared kind discriminator/u);
});

test('the planned shared-path configuration encodes and decodes every record type without legacy tags',()=>{
 const groups={
  'transaction/financial':{ 'finance-transaction':['type','transaction'], 'investment-transaction':['type','investmentTransaction'] },
  'entity/food':{food:['tpsRecordType','food'],meal:['tpsRecordType','meal'],recipe:['tpsRecordType','recipe']},
  'transaction/macros':{'food-entry':['tpsRecordType','food-entry'],'meal-entry':['tpsRecordType','meal-entry']},
  'transaction/workout':{'workout-session':['tpsRecordType','workout-session'],'workout-exercise':['tpsRecordType','workout-exercise']},
  'task/project':{project:['tpsRecordType','project'],collection:['tpsRecordType','collection']},
 };
 const configured=Object.fromEntries(Object.entries(groups).flatMap(([path,kinds])=>Object.entries(kinds).map(([kind,[key,value]])=>[
  kind,{primary:{kindList:{key:'kind',value:path}},aliases:[],discriminator:{key,value}},
 ])));
 for(const [path,kinds] of Object.entries(groups))for(const [kind,[key,value]] of Object.entries(kinds)){
  const raw=encodeKind(configured,{kind,title:kind});
  assert.deepEqual(raw.kind,[path]);
  assert.equal(raw[key],value);
  assert.equal(Object.hasOwn(raw,'tags'),false);
  assert.equal(decodeKind(configured,raw).kind,kind);
  assert.equal(matchesKind(configured,raw,kind),true);
  for(const other of Object.keys(kinds).filter(candidate=>candidate!==kind))assert.equal(matchesKind(configured,raw,other),false);
 }
});
