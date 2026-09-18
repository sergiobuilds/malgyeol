import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoWorkflowStore } from '../src/demo-workflow/store.ts';
import { DemoWorkflowService } from '../src/demo-workflow/service.ts';
import type { DemoProvider, InquiryOutcome, Requirements, Seed, InquiryTask, Plan, Receipt } from '../src/demo-workflow/types.ts';
const now = Date.parse('2030-01-01T00:00:00Z');
const requirements: Requirements = {item:'식사',quantity:2,region:'서초구',neededBy:'2030-01-02T00:00:00Z',maxCostKrw:0,dietaryRestrictions:['땅콩 제외'],alternatives:['빵','죽'],receivingMethod:'delivery',noMatchPreference:'offer_callback',consent:{contact:true,submit:true,callback:true}};
const proof = {mode:'SIMULATION' as const,ref:'independent-provider-observation',observedAt:new Date(now).toISOString()};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function available(task:InquiryTask, seed:Seed):InquiryOutcome { return {kind:'available',proof,terms:{item:task.item,quantity:seed.requirements.quantity,costKrw:0,receivingMethod:'delivery',dietaryRestrictions:['땅콩 제외'],promisedBy:'2030-01-01T12:00:00Z'}}; }
function provider(inquire:DemoProvider['inquire'],submit?:DemoProvider['submit']):DemoProvider & {submissions:Plan[]} {
 const submissions:Plan[]=[];
 return {mode:'SIMULATION',institutions:[{id:'a',name:'모의A'},{id:'b',name:'모의B'},{id:'c',name:'모의C'}],submissions,inquire,async submit(plan,key){submissions.push(plan);return submit?submit(plan,key):{id:key,planHash:plan.hash,institutionId:plan.task.institutionId,terms:plan.terms,proof};}};
}
function setup(p:DemoProvider, path=':memory:', concurrency=2) {const store=new DemoWorkflowStore(path);return {store,service:new DemoWorkflowService(store,p,()=>now,200,concurrency)};}
function approve(service:DemoWorkflowService, patch:Partial<Requirements>={}) {service.begin('call','citizen');service.update('call',{...requirements,...patch},'실제 시민 답변을 대신하는 독립 시험 입력');const seed=service.prepareSeed('call');service.approve('call',seed.seedHash,seed.nonce,'1');return seed;}

test('independent: unapproved and stale approval perform zero inquiry or submit',async()=>{
 let inquiries=0;const p=provider(async(t,s)=>{inquiries++;return available(t,s)});const {store,service}=setup(p);
 try {service.begin('call','citizen');service.update('call',requirements,'사용자 답변');await assert.rejects(service.run('call'),/APPROVAL_REQUIRED/);const old=service.prepareSeed('call');service.update('call',{quantity:3},'3개로 바꾸어 주세요');assert.throws(()=>service.approve('call',old.seedHash,old.nonce,'1'),/APPROVAL_IDENTITY_MISMATCH/);assert.equal(inquiries,0);assert.equal(p.submissions.length,0);}finally{store.close();}
});

test('independent: concurrent inquiries, no newly started task after selection, late result cannot submit',async()=>{
 let active=0,max=0;const started:string[]=[];let sawAbort=false;
 const p=provider(async(t,s,signal)=>{started.push(t.id);active++;max=Math.max(max,active);if(t.institutionId==='b')signal.addEventListener('abort',()=>{sawAbort=true});await delay(t.institutionId==='a'?5:40);active--;return available(t,s)});
 const {store,service}=setup(p);try{approve(service);await service.run('call');await delay(55);assert.equal(max,2);assert.deepEqual(started,['a:0','b:0']);assert.ok(sawAbort);assert.equal(p.submissions.length,1);const state=store.read('call')!;assert.ok(state.ev1?.pass&&state.ev2?.pass);assert.ok(state.events.some(e=>e.stage==='Run1.late_ignored'));assert.ok(!state.callback?.message.includes('오고 있습니다'));assert.match(state.callback!.message,/모의 지원 신청이 접수/);}finally{store.close();}
});

test('independent: slow preferred alternative wins over fast lower priority alternative',async()=>{
 const p=provider(async(t,s)=>{if(t.priority===0)return {kind:'unavailable',reason:'요청 품목 없음',proof};await delay(t.priority===1?35:2);return available(t,s)});p.institutions=[{id:'a',name:'모의A'}];const {store,service}=setup(p,':memory:',3);
 try{approve(service);await service.run('call');assert.equal(store.read('call')!.plan!.terms.item,'빵');assert.equal(p.submissions.length,1);}finally{store.close();}
});

test('independent: outside-seed pickup terms never submit',async()=>{
 const p=provider(async(t,s)=>{const o=available(t,s);if(o.kind==='available')o.terms.receivingMethod='pickup';return o});const {store,service}=setup(p);
 try{approve(service);await service.run('call');assert.equal(p.submissions.length,0);assert.equal(store.read('call')!.ev1!.pass,false);assert.match(store.read('call')!.callback!.message,/신청하지 않았습니다/);}finally{store.close();}
});

test('independent: receipt mismatch fails EV2 and blocks callback',async()=>{
 const p=provider(async(t,s)=>available(t,s),async plan=>({id:'wrong-receipt',planHash:plan.hash,institutionId:'wrong-provider',terms:plan.terms,proof}));const {store,service}=setup(p);
 try{approve(service);await service.run('call');assert.equal(store.read('call')!.ev2!.pass,false);assert.equal(store.read('call')!.phase,'UNKNOWN');assert.throws(()=>service.claimCallback('call'),/CALLBACK_NOT_READY/);assert.equal(p.submissions.length,1);}finally{store.close();}
});

test('independent: SQLite restart and replay preserve single submission',async()=>{
 const d=mkdtempSync(join(tmpdir(),'demo-independent-'));const path=join(d,'state.sqlite');const p=provider(async(t,s)=>available(t,s));let {store,service}=setup(p,path);
 try{approve(service);await Promise.all([service.run('call'),service.run('call')]);const id=store.read('call')!.receipt!.id;store.close();({store,service}=setup(p,path));await service.run('call');assert.equal(p.submissions.length,1);assert.equal(store.read('call')!.receipt!.id,id);assert.equal(service.recoverInterruptedRuns(),0);}finally{store.close();rmSync(d,{recursive:true,force:true});}
});

test('independent: confirmed future opportunity requires actual callback answer before reservation',async()=>{
 const p=provider(async()=>({kind:'unavailable',reason:'오늘 마감',proof,next:{at:'2030-01-03T00:00:00Z',timezone:'Asia/Seoul',instructions:'오전 9시 접수',proof}}));const {store,service}=setup(p);
 try{approve(service);await service.run('call');const state=store.read('call')!;assert.equal(state.reservation,undefined);assert.match(state.callback!.message,/연락드릴까요|연락을 예약할까요/);const {job}=service.claimCallback('call');assert.ok(job);assert.equal(store.read('call')!.reservation,undefined);service.answerCallback('call',job.id,'1');assert.equal(store.read('call')!.reservation!.status,'SCHEDULED');assert.equal(service.completeCallback('call',job.id,{answered:true,acknowledged:true,completed:true,receiptRef:'local-fake-transcript'}).delivered,true);assert.equal(p.submissions.length,0);}finally{store.close();}
});

test('independent: no-answer never becomes definitive no support',async()=>{
 const p=provider(async()=>({kind:'no-answer',retryAt:'2030-01-01T00:01:00Z'}));const {store,service}=setup(p);
 try{approve(service);await service.run('call');assert.deepEqual(store.read('call')!.ev1!.reasons,['UNVERIFIED']);assert.match(store.read('call')!.callback!.message,/지원 불가로 판단하지 않았습니다/);assert.equal(p.submissions.length,0);}finally{store.close();}
});

test('independent: expired next opportunity must not be offered as future callback',async()=>{
 const p=provider(async()=>({kind:'unavailable',reason:'오늘 마감',proof,next:{at:'2029-12-31T00:00:00Z',timezone:'Asia/Seoul',instructions:'만료된 접수 시간',proof}}));const {store,service}=setup(p);
 try{approve(service);await service.run('call');const state=store.read('call')!;assert.equal(state.callback!.next,undefined);assert.ok(!state.callback!.message.includes('12월 31일'));assert.equal(p.submissions.length,0);}finally{store.close();}
});
