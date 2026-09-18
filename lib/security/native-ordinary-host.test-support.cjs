/* @Codex — synthetic in-memory row adapter. Real native lifecycle/owner/capture.
 * No SQLite, platform qualification, provider or decrypt is emulated as PASS. */
'use strict';
const Module = require('node:module');
const f = require('./native-ordinary.test-support.cjs');
const tables = {
 patients:['id','version','deletedAt','isArchived','notes','diagnoses','updatedAt','firstName','lastName','taxCode','birthDate'],
 entries:['id','patientId','title','content','date','version','updatedAt','deletedAt'],
 therapies:['id','patientId','drugName','dosage','activePrinciple','aic','atc','updatedAt','startDate','version','deletedAt','status'],
 observations:['id','patientId','display','value','unitCode','observedAt','version','updatedAt','deletedAt'],
 attachments:['id','patientId','name','summarySnapshot','createdAt','documentSourceRef','documentRevision','documentFreshnessEpoch'],
};
for (const [table,names] of Object.entries(tables)) {
 f.schema[table] = Object.fromEntries([['$table',table],...names.map(name=>[name,{table,name}])]);
 f.rows[table] ??= [];
}
let sessionCookie = null;
const counters={acquisition:0,ingest:0,provider:0,clinicalWrites:0};
const get=(row,col)=>row.$joined ? row[col.table]?.[col.name] : row[col.name];
const load=Module._load;
Module._load=function(request,parent,...args){
 if(request==='next/headers') return {cookies:async()=>({get:name=>name==='mediflow_session' && sessionCookie ? {name,value:sessionCookie}:undefined})};
 if(request==='next/server') return {NextResponse:{json:(value,options)=>Response.json(value,options)}};
 if(request==='drizzle-orm') return {
   sql:(strings,...values)=>({strings:[...strings],values}),
   eq:(col,value)=>row=>get(row,col)===(value && typeof value==='object' && value.table ? get(row,value):value),
   inArray:(col,values)=>row=>values.includes(get(row,col)),
   and:(...predicates)=>row=>predicates.every(p=>!p||p(row)),isNull:col=>row=>get(row,col)==null,
   asc:col=>({col,direction:1}),desc:col=>({col,direction:-1}),
 };
 return load.call(this,request,parent,...args);
};
f.db.dbServer.select=function(fields){
 let table,predicate=()=>true,limit=Infinity,ordering=[],join=null;
 const query={from(value){table=value.$table;return query},where(value){predicate=value;return query},
   orderBy(...value){ordering=value;return query},limit(value){limit=value;return query},
   innerJoin(value,on){join={table:value.$table,on};return query},
   all(){
     if(table==='patients' && fields?.notes) counters.acquisition++;
     let found=f.rows[table].slice();
     if(join) found=found.flatMap(row=>f.rows[join.table].map(other=>({$joined:true,[table]:row,[join.table]:other})).filter(join.on));
     found=found.filter(predicate).sort((a,b)=>{for(const {col,direction} of ordering){const av=get(a,col),bv=get(b,col);if(av!==bv){if(av==null)return -direction;if(bv==null)return direction;if(av<bv)return -direction;if(av>bv)return direction}}return 0}).slice(0,limit);
     return found.map(row=>fields?Object.fromEntries(Object.entries(fields).map(([k,col])=>[k,get(row,col)])):{...row});
   },get(){return query.all()[0]}};
 return query;
};
f.db.dbServer.all=()=>{throw Error('SYNTHETIC_SQL_ALL_NOT_IMPLEMENTED')};
f.db.dbServer.transaction=operation=>operation(f.db.dbServer);
// Fixed SQL templates used by the original attachment authority/DS operation only.
f.db.dbServer.get=query=>{
 if(!query?.strings || !Array.isArray(query.values))throw Error('SYNTHETIC_SQL_UNSUPPORTED');
 const text=query.strings.join('?').replace(/\s+/g,' '),v=query.values;
 if(text.includes('FROM settings'))return f.rows.settings.find(row=>row.key===v[0]);
 if(text.includes('FROM attachments AS a INNER JOIN patients_to_ambulatories')){
  const row=f.rows.attachments.find(row=>row.id===v[0] && row.patientId===v[1]);
  return row && f.rows.patientsToAmbulatories.some(x=>x.patientId===v[1] && x.ambulatoryId===v[2]) ?
    {documentSourceRef:row.documentSourceRef,documentRevision:row.documentRevision,documentFreshnessEpoch:row.documentFreshnessEpoch}:undefined;
 }
 if(text.includes('FROM attachments WHERE id = ? AND patient_id = ?')){
  const row=f.rows.attachments.find(row=>row.id===v[1] && row.patientId===v[2]);
  return row ? {id:row.id,patientId:row.patientId,data:v[0]?.strings.join('') === "''" ? '' : row.data,
    sourceRef:row.documentSourceRef,revision:row.documentRevision,freshnessEpoch:row.documentFreshnessEpoch}:undefined;
 }
 throw Error('SYNTHETIC_SQL_UNSUPPORTED');
};
for(const op of ['insert','update','delete']) f.db.dbServer[op]=()=>{counters.clinicalWrites++;throw Error('SYNTHETIC_READ_ONLY')};
const originalReset=f.reset;
f.reset=()=>{
 sessionCookie=null; originalReset();for(const k of Object.keys(counters))counters[k]=0;
 const at=new Date('2026-09-18T10:00:00Z');
 Object.assign(f.rows.patients[0],{notes:'Nota esclusivamente sintetica host',diagnoses:JSON.stringify([{system:'ICD-10',code:'Z00.0',description:'Controllo sintetico'}]),updatedAt:at,firstName:'Synthetic',lastName:'Fixture',taxCode:null,birthDate:null});
 f.rows.entries.push({id:'synthetic-entry-1',patientId:'synthetic-patient',title:'Evento sintetico',content:'Evento esclusivamente sintetico host',date:at,version:1,updatedAt:at,deletedAt:null});
 f.rows.therapies.push({id:'synthetic-therapy-1',patientId:'synthetic-patient',drugName:'Terapia sintetica',dosage:'Dose sintetica',activePrinciple:null,aic:null,atc:null,updatedAt:at,startDate:at,version:1,deletedAt:null,status:'active'});
 f.rows.observations.push({id:'synthetic-observation-1',patientId:'synthetic-patient',display:'Parametro sintetico',value:'10',unitCode:'u',observedAt:at,version:1,updatedAt:at,deletedAt:null});
 f.rows.attachments.push({id:'synthetic-attachment-1',patientId:'synthetic-patient',name:'Documento sintetico',summarySnapshot:'Sintesi esclusivamente sintetica host',createdAt:at,data:Buffer.from('Testo documento esclusivamente sintetico host.').toString('base64'),documentSourceRef:'a'.repeat(64),documentRevision:1,documentFreshnessEpoch:1});
};
f.reset();
function preparation(functionId='patient_insight'){
 return {functionId,patientId:'synthetic-patient',ambulatoryId:'synthetic-ambulatory',patientRevision:1,
   input:functionId==='document_synthesis'?{attachmentId:'synthetic-attachment-1'}:{selector:'current_'+functionId}};
}
module.exports={...f,counters,preparation,setSessionCookie(value){sessionCookie=value}};
