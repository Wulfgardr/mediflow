import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from '../lib/network-patient-authority-test-fixture.ts';
import { ambulatories, patients, therapies, patientsToAmbulatories, settings, users } from '../lib/schema.ts';
import { bindSessionToArchive, currentArchiveGeneration } from '../lib/security/archive-session-generation.ts';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from '../lib/network-pairing-model.ts';
import { captureNativeLoginSessionFence, createNativeServerSession } from '../lib/security/server-session.ts';

assert.ok(process.env.MEDIFLOW_DATA_DIR, 'owned synthetic data directory required');
const data = process.env.MEDIFLOW_DATA_DIR;
const load = createRequire(import.meta.url);
const bcrypt = load('bcryptjs') as typeof import('bcryptjs');
const cookies = { cookies: new Map<string, string>() };
installNetworkPatientCookieFixture(data, cookies);
const { dbServer, openDbServer } = load('../lib/db-server.ts') as typeof import('../lib/db-server.ts'); openDbServer();
const { nativeProfileSelectionOwner } = load('../lib/security/native-profile-selection-owner.ts') as typeof import('../lib/security/native-profile-selection-owner.ts');
const { createChatTherapyStatusService } = load('../lib/chat-therapy-status.ts') as typeof import('../lib/chat-therapy-status.ts');
const pin = ['2','4','6','8'].join('');
const passwordHash = bcrypt.hashSync(pin, 4);
const tick = Date.now();
async function fixture() {
    const scope = randomUUID(), patientId = randomUUID(), therapyId = randomUUID();
    dbServer.insert(ambulatories).values({ id: scope, name: 'Synthetic', isDefault: true }).run();
    const context = syntheticNetworkPatientAuthority(dbServer, scope);
    context.pairedClient.grantedCapabilities.push('network.replica.readonly-therapies', 'network.replica.write-therapies', 'network.replica.readonly-patients');
    dbServer.update(settings).set({ value: JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients: [context.pairedClient], intents: [] })), archiveGeneration: currentArchiveGeneration() }) }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
    dbServer.update(users).set({ passwordHash, failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null }).where(eq(users.id, context.session.userId)).run();
    cookies.cookies.set('ambulatory_id', scope);
    cookies.cookies.set('mediflow_session', context.session.id);
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: randomUUID() }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: scope }).run();
    dbServer.insert(therapies).values({ id: therapyId, patientId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', version: 1, startDate: new Date() }).run();
    const owner = nativeProfileSelectionOwner.registry.acquire(context.session);
    owner.issueSelection({ expectedEpoch: 0, patientId, ambulatoryId: scope });
    const epoch = owner.snapshotSelectionEpoch(context.session);
    const command = { commandId: randomUUID(), protocol: 'therapy.status.change.v1' as const, archiveGeneration: currentArchiveGeneration(), patientId, therapyId, expectedVersion: 1, target: 'suspended' as const };
    const service = createChatTherapyStatusService(() => tick);
    const { viewId } = await service.open(context, patientId, epoch);
    return { context, command, epoch, service, owner, viewId };
}
function effects(id: string) {
    const db = dbServer.$client;
    return { therapy: db.prepare('SELECT version,status FROM therapies WHERE id=?').get(id), audits: (db.prepare('SELECT count(*) n FROM audit_events WHERE subject_ref=?').get(id) as {n:number}).n };
}


import http from 'node:http';
import fs from 'node:fs';
async function main(){

 const f=await fixture();
 const token='b'.repeat(64);
 f.context.pairedClient.tokenHash=load(process.cwd()+'/lib/network-pairing-model.ts').hashNetworkPairedClientToken(token);
 const session=createNativeServerSession({id:f.context.session.userId,username:f.context.session.username,role:'admin'},{clientId:f.context.pairedClient.clientId,clientPlatform:f.context.pairedClient.clientPlatform,tokenHash:f.context.pairedClient.tokenHash},captureNativeLoginSessionFence())!;
 bindSessionToArchive(session,currentArchiveGeneration());
 f.context.session=session;
 const headers=new Headers(f.context.request.headers);headers.set('x-mediflow-paired-client-token',token);
 f.context.request=new Request(f.context.request,{headers});
 cookies.cookies.set('mediflow_session',session.id);
 dbServer.update(settings).set({value:JSON.stringify({...JSON.parse(serializeNetworkPairingState({clients:[f.context.pairedClient],intents:[]})),archiveGeneration:currentArchiveGeneration()})}).where(eq(settings.key,NETWORK_PAIRING_STATE_KEY)).run();
 f.owner=nativeProfileSelectionOwner.registry.acquire(session);
 f.owner.issueSelection({expectedEpoch:0,patientId:f.command.patientId,ambulatoryId:f.context.scopeAmbulatoryId});


 dbServer.update(therapies).set({drugName:'Synthetic medicine',dosage:'Synthetic dose'}).where(eq(therapies.id,f.command.therapyId)).run();
 const vector=JSON.parse(fs.readFileSync(process.cwd()+'/native/contracts/crypto-golden-vectors.v3.json','utf8'));
 const ports=JSON.parse(fs.readFileSync(process.cwd()+'/experiments/gpui-patient-pilot/transport/tests/fixtures/host-ports.json','utf8'));
 const therapyRoute=load(process.cwd()+'/app/api/auth/native/therapy-status/route.ts');
 const profileRoute=load(process.cwd()+'/app/api/v1/network/patients/[id]/profile-query/route.ts');
 const operations:string[]=[];
 let revokes=0;
 const compare=bcrypt.compare.bind(bcrypt);
 (bcrypt as any).compare=async (value:string,hash:string)=>{
  fs.writeFileSync(process.env.REVIEW_PIN_BARRIER!,'pending');
  await new Promise<void>((resolve,reject)=>{const deadline=Date.now()+15000;const timer=setInterval(()=>{if(fs.existsSync(process.env.REVIEW_PIN_RELEASE!)){clearInterval(timer);resolve();}else if(Date.now()>deadline){clearInterval(timer);reject(new Error('PIN barrier timeout'));}},5);});
  return compare(value,hash);
 };
 const server=http.createServer(async(req,res)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const bytes=Buffer.concat(chunks).toString();
   const path=new URL(req.url!,'http://localhost').pathname;
   const json=bytes?JSON.parse(bytes):{};
   console.log(req.method,path,json.operation ?? '');
   let response:Response;
   const reply=(value:any,status=200)=>Response.json(value,{status,headers:{'Set-Cookie':'mediflow_session='+f.context.session.id}});
   if(path==='/api/auth/check')response=reply({status:'ok',isSetup:true,archiveGeneration:currentArchiveGeneration(),unlock:{credential:'passphrase',kdfVersion:3,salt:vector.salt}});
   else if(path==='/api/auth/native/login')response=reply({success:true,id:f.context.session.userId,username:f.context.session.username,role:'admin',archiveGeneration:currentArchiveGeneration(),salt:vector.salt,encryptedMasterKey:vector.wrappedMasterKey});
   else if(path==='/api/v1/network/capabilities')response=reply({protocolVersion:'1.13.0',operatingMode:'network-home-base',capabilities:[],hostPorts:ports});
   else if(path==='/api/v1/network/ambulatories')response=reply([{id:f.context.scopeAmbulatoryId,name:'Synthetic',version:1}]);
   else if(path==='/api/v1/network/identity')response=reply({scope:{effectiveAmbulatoryId:f.context.scopeAmbulatoryId,requestBinding:'expected-ambulatory-id-v1'},operator:{userId:f.context.session.userId,authChannel:'native'}});
   else if(path==='/api/auth/native/chat-access-confirmation')response=reply({status:'eligible'});
   else if(path==='/api/v1/network/patient-profile/selection-epoch')response=reply({contractVersion:1,selectionEpoch:f.owner.snapshotSelectionEpoch(f.context.session)});
   else {
    const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
    const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers,...(req.method==='GET'?{}:{body:bytes})});
    if(path.endsWith('/profile-query'))response=await profileRoute.POST(request,{params:Promise.resolve({id:f.command.patientId})});
    else if(path===('/api/v1/network/patients/'+f.command.patientId+'/therapies'))response=reply([{id:f.command.therapyId,patientId:f.command.patientId,drugName:'Synthetic medicine',dosage:'Synthetic dose',status:'active',startDate:'2026-10-30',version:1}]);
    else if(path==='/api/auth/native/therapy-status'){
      operations.push(json.operation);
      response = json.operation==='revoke' && process.env.MEDIFLOW_CHAT_WITHDRAW_SCENARIO==='unavailable' && ++revokes===1
        ? reply({status:'unavailable'},503) : await therapyRoute.POST(request);
      if(json.operation==='execute'||json.operation==='revoke') fs.writeFileSync(json.operation==='execute' ? process.env.REVIEW_RESULT! : process.env.REVIEW_REVOKE_RESULT!,JSON.stringify({effects:effects(f.command.therapyId),operations,serverStatus:response.status}));
    } else response=reply({status:'denied'},404);
   }
   const body=await response.text();res.writeHead(response.status,Object.fromEntries(response.headers));res.end(body);
   if(response.status>=400)console.log(req.method,path,response.status,body);
  }catch(error){console.error(error);res.writeHead(500);res.end('{}');}
 });
 server.listen(0,'127.0.0.1',()=>{
  const address=server.address() as import('node:net').AddressInfo;
  if(address.port===3000)throw new Error('3000 forbidden');
  fs.writeFileSync(process.env.REVIEW_CONFIG!,JSON.stringify({synthetic:true,baseURL:'http://127.0.0.1:'+address.port,pairingId:f.context.pairedClient.clientId,pairingToken:token,username:f.context.session.username,scope:f.context.scopeAmbulatoryId,patientId:f.command.patientId,passphrase:vector.passphrase}));
  console.log('READY '+address.port);
 });
}main().catch(error=>{console.error(error);process.exitCode=1;});
