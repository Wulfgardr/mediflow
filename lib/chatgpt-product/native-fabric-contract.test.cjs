const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('four native consumers offer local host execution alongside explicit ordinary',()=>{
 const root='native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/';
 const views=fs.readFileSync(root+'NativeOrdinaryViews.swift','utf8');
 assert.ok(views.includes("NativeFabricExperience"), "local Fabric consumer is missing");
 for(const op of ['prepare','project','generate','cancel','status'])
  assert.ok(fs.existsSync('app/api/v1/network/ai/fabric/'+op+'/route.ts'),op);
});

test('supplemental OpenAPI names five routes, closed requests and existing projection authority',()=>{
 const ordinary=JSON.parse(fs.readFileSync('docs/openapi/native-ordinary-v1.json'));
 const spec=JSON.parse(fs.readFileSync('docs/openapi/native-fabric-v1.json'));
 assert.equal(Object.keys(spec.paths).length,5);
 const schemas={...ordinary.components.schemas,...spec.components.schemas};
 for(const [endpoint,methods]of Object.entries(spec.paths)){
  for(const method of Object.keys(methods)){
   const source=fs.readFileSync('app'+endpoint+'/route.ts','utf8');
   assert.ok(source.includes('handleNativeFabricHttp'));assert.ok(source.includes('function '+method.toUpperCase()+'('));
   assert.equal(methods[method]['x-authority-ceiling'],'proposal_only');
  }
 }
 const command=schemas.NativeFabricAttempt;assert.equal(command.additionalProperties,false);assert.deepEqual(command.required,['attemptId']);
 function walk(value){if(!value||typeof value!=='object')return;if(value.$ref){const parts=value.$ref.split('/');assert.ok(parts[0]==='#');if(parts[1]==='components'&&parts[2]==='schemas')assert.ok(schemas[parts[3]],value.$ref)};for(const child of Object.values(value))walk(child)}
 walk(spec);
});
