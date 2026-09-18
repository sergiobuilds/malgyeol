import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoWorkflowStore } from '../src/demo-workflow/store.ts';
import { DemoWorkflowService } from '../src/demo-workflow/service.ts';
import { createMockProvider, demoRequirements, fixedMockCatalog } from '../src/demo-workflow/mockProvider.ts';
import type { Requirements } from '../src/demo-workflow/types.ts';
const now=Date.parse('2030-01-01T00:00:00Z');
function setup(){const store=new DemoWorkflowStore();const service=new DemoWorkflowService(store,createMockProvider('success',()=>now),()=>now);return{store,service};}
function seed(service:DemoWorkflowService, id:string, patch:Partial<Requirements>={}){service.update(id,{...demoRequirements(now),...patch},'테스트 고객의 답');return service.prepareSeed(id);}
function approve(service:DemoWorkflowService,id:string,proposal:ReturnType<DemoWorkflowService['prepareSeed']>){service.approve(id,proposal.seedHash,proposal.nonce,'1');}

test('audience independent: intake begins blank with no implicit consent or execution',async()=>{
 const {store,service}=setup();try{const a=service.begin('audience','new-sdk-caller','audience');assert.deepEqual(a.requirements,{});assert.equal(a.approved,false);assert.equal(a.requirements.consent,undefined);await assert.rejects(service.run('audience'),/APPROVAL_REQUIRED/);assert.equal(Object.keys(store.read('audience')!.inquiries).length,0);}finally{store.close();}
});

test('audience independent: proposed consent is not consent until fresh DTMF approval',async()=>{
 const {store,service}=setup();try{service.begin('a','audience','audience');const {consent,...answers}=demoRequirements(now);service.update('a',answers,'식사가 필요해요');const old=service.prepareSeed('a');assert.equal(store.read('a')!.requirements.consent,undefined);assert.equal(store.read('a')!.seed!.approvalRef,undefined);service.approve('a',old.seedHash,old.nonce,'2');assert.equal(store.read('a')!.phase,'INTERVIEW');service.update('a',{quantity:2},'두 개로 고쳐 주세요');const fresh=service.prepareSeed('a');assert.notEqual(fresh.seedHash,old.seedHash);assert.throws(()=>approve(service,'a',old),/APPROVAL_IDENTITY_MISMATCH/);approve(service,'a',fresh);assert.deepEqual(store.read('a')!.requirements.consent,{contact:true,submit:true,callback:true});}finally{store.close();}
});

test('audience independent: catalog never fabricates quantity region dietary or requested item',async()=>{
 for(const patch of [{quantity:999},{region:'부산 해운대구'},{dietaryRestrictions:['밀가루 알레르기']},{item:'냉장고'}]){
  const {store,service}=setup();try{service.begin('a','audience','audience');const proposal=seed(service,'a',patch);approve(service,'a',proposal);await service.run('a');assert.equal(store.read('a')!.receipt,undefined);assert.equal(store.read('a')!.ev1!.pass,false);assert.equal(store.read('a')!.callback!.next,undefined);}finally{store.close();}
 }
});

test('audience independent: accepted offer uses catalog deadline, never caller deadline',async()=>{
 const {store,service}=setup();try{service.begin('a','audience','audience');const proposal=seed(service,'a',{neededBy:new Date(now+12*3600000).toISOString()});approve(service,'a',proposal);await service.run('a');const saved=store.read('a')!;assert.equal(saved.ev2!.pass,true);assert.equal(saved.receipt!.terms.promisedBy,fixedMockCatalog(now)[0]!.terms.promisedBy);assert.notEqual(saved.receipt!.terms.promisedBy,saved.seed!.requirements.neededBy);const {job}=service.claimCallback('a');assert.ok(job);const result=service.completeCallback('a',job.id,{answered:true,acknowledged:false,completed:true,receiptRef:'fake-no-digit'});assert.equal(result.delivered,false);}finally{store.close();}
});

test('audience independent: callback digit1 ends delivery, never schedules another call',async()=>{
 const store=new DemoWorkflowStore();const service=new DemoWorkflowService(store,createMockProvider('unavailable',()=>now),()=>now);
 try{service.begin('a','audience','audience');const proposal=seed(service,'a');approve(service,'a',proposal);await service.run('a');const {job}=service.claimCallback('a');assert.ok(job);assert.equal(job.nextOpportunity,undefined);assert.doesNotMatch(job.message,/예약할까요|연락받고 싶으신가요/);service.answerCallback('a',job.id,'1');assert.equal(store.read('a')!.reservation,undefined);assert.equal(service.completeCallback('a',job.id,{answered:true,acknowledged:true,completed:true,receiptRef:'fake-digit-one'}).delivered,true);assert.equal(service.claimCallback('a').job,null);}finally{store.close();}
});
