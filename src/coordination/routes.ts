import { timingSafeEqual } from 'node:crypto';
import { CoordinationEngine, CoordinationError } from './engine.ts';
import { getInstitution, listInstitutions, listPrograms } from './catalog.ts';
import type { AnswerInput, AttemptResult, ProgramId } from './types.ts';

type Body = Record<string, unknown>;
export interface CoordinationHttpResult { status: number; body: unknown }
function validToken(supplied: string, secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return false;
  const actual=Buffer.from(supplied), expected=Buffer.from(`Bearer ${secret}`);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
class InvalidInput extends Error {}
function str(value:unknown, maximum=2000):string {
  if (typeof value!=='string' || !value.trim() || value.length>maximum) throw new InvalidInput();
  return value.trim();
}
function strings(value:unknown):string[] {
  if (!Array.isArray(value) || value.length>50) throw new InvalidInput();
  return value.map(v=>str(v));
}
function bool(value:unknown):boolean { if(typeof value!=='boolean') throw new InvalidInput(); return value; }
function record(value:unknown):Body { if(!value || typeof value!=='object' || Array.isArray(value)) throw new InvalidInput(); return value as Body; }
function choice<T extends string>(value:unknown, options:readonly T[]):T {
  if(typeof value!=='string' || !options.includes(value as T)) throw new InvalidInput(); return value as T;
}
const programs:ProgramId[]=['foodbank-market','mobile-market','just-dream','care-sos'];

export function createCoordinationRoutes(engine:CoordinationEngine, credentials:{operator?:string;agent?:string}) {
  return (method:string,url:URL,authorization:string,body:Body={}):CoordinationHttpResult|undefined => {
    if(!url.pathname.startsWith('/api/support/')&&!url.pathname.startsWith('/api/coordination/')) return undefined;
    const reply=(status:number,value:unknown):CoordinationHttpResult=>({status,body:value});
    const error=(status:number,code:string,message:string)=>reply(status,{error:{code,message}});
    try {
      if(url.pathname.startsWith('/api/support/')) {
        if(method!=='GET') return error(405,'METHOD_NOT_ALLOWED','지원망은 조회할 수 있습니다.');
        if(url.pathname==='/api/support/programs') return reply(200,{programs:listPrograms()});
        if(url.pathname==='/api/support/institutions') {
          const programId=url.searchParams.get('programId');
          const district=url.searchParams.get('district'),query=url.searchParams.get('query');
          return reply(200,{institutions:listInstitutions({...(programId?{programId:choice(programId,programs)}:{}),...(district?{district}:{}),...(query?{query}:{})})});
        }
        const institutionId=url.pathname.match(/^\/api\/support\/institutions\/([^/]+)$/)?.[1];
        const institution=institutionId?getInstitution(institutionId):undefined;
        return institution?reply(200,{institution}):error(404,'NOT_FOUND','기관을 찾을 수 없습니다.');
      }
      if(!validToken(authorization,credentials.operator)&&!validToken(authorization,credentials.agent)) return error(403,'FORBIDDEN','담당자 연결이 필요합니다.');
      if(url.pathname==='/api/coordination/requests') {
        if(method==='GET') return reply(200,{requests:engine.listRequests()});
        if(method==='POST') {
          if(!Array.isArray(body.needs)||body.needs.length<1||body.needs.length>20) throw new InvalidInput();
          return reply(201,{request:engine.createRequest({citizenRef:str(body.citizenRef,160),summary:str(body.summary),district:str(body.district,100),constraints:strings(body.constraints),needs:body.needs.map(v=>{
            const n=record(v);return {description:str(n.description),category:str(n.category,100),...(n.constraints===undefined?{}:{constraints:strings(n.constraints)})};
          })})});
        }
        return error(405,'METHOD_NOT_ALLOWED','요청 방식이 올바르지 않습니다.');
      }
      const m=url.pathname.match(/^\/api\/coordination\/requests\/([^/]+)(?:\/(.*))?$/);
      if(!m) return error(404,'NOT_FOUND','요청을 찾을 수 없습니다.');
      const id=m[1]!,action=m[2]??'';
      if(!engine.getRequest(id)) return error(404,'NOT_FOUND','요청을 찾을 수 없습니다.');
      if(method==='GET'&&!action) return reply(200,{request:engine.getRequest(id)});
      if(method==='GET'&&action==='events') return reply(200,{events:engine.events(id)});
      if(method==='PATCH'&&!action) return reply(200,{request:engine.reviseRequest(id,{
        ...(body.summary===undefined?{}:{summary:str(body.summary)}),...(body.district===undefined?{}:{district:str(body.district,100)}),...(body.constraints===undefined?{}:{constraints:strings(body.constraints)})
      })});
      if(method!=='POST') return error(405,'METHOD_NOT_ALLOWED','요청 방식이 올바르지 않습니다.');
      if(action==='consent') return reply(200,{request:engine.recordConsent(id,{purpose:str(body.purpose),institutionIds:strings(body.institutionIds),sharedFields:strings(body.sharedFields),allowCoordination:bool(body.allowCoordination)})});
      if(action==='inquiries') {
        const institutionId=str(body.institutionId,160), programId=choice(body.programId,programs), contactPurpose=str(body.contactPurpose);
        const institution=getInstitution(institutionId);
        if(!institution?.programs.some(p=>p.programId===programId)||!institution.contacts.some(c=>c.purpose===contactPurpose)) return error(400,'INVALID_CONTACT','해당 사업의 문의 창구를 선택해 주세요.');
        return reply(201,{inquiry:engine.addInquiry(id,{needId:str(body.needId,160),institutionId,programId,contactPurpose,questions:strings(body.questions)})});
      }
      const attempt=action.match(/^inquiries\/([^/]+)\/attempts$/);
      if(attempt) return reply(200,{attempt:engine.startAttempt(id,attempt[1]!,str(body.idempotencyKey,160))});
      const result=action.match(/^attempts\/([^/]+)\/result$/);
      if(result) return reply(200,{request:engine.finishAttempt(id,result[1]!,{status:choice<AttemptResult['status']>(body.status,['completed','no-answer','failed','unknown']),...(body.providerCallId===undefined?{}:{providerCallId:str(body.providerCallId,160)})})});
      const answer=action.match(/^inquiries\/([^/]+)\/answer$/);
      if(answer) return reply(200,{request:engine.recordAnswer(id,answer[1]!,{outcome:choice<AnswerInput['outcome']>(body.outcome,['available','declined','alternative']),summary:str(body.summary),conditions:strings(body.conditions),nextAction:str(body.nextAction),requiresChoice:bool(body.requiresChoice)})});
      const need=action.match(/^needs\/([^/]+)\/(choice|stop)$/);
      if(need) return reply(200,{request:need[2]==='stop'?engine.stopNeed(id,need[1]!):engine.recordChoice(id,need[1]!,str(body.choice))});
      if(action==='callback') return reply(200,{request:engine.recordCallback(id,{status:choice(body.status,['completed','no-answer','failed'] as const),summary:str(body.summary)})});
      return error(404,'NOT_FOUND','요청을 찾을 수 없습니다.');
    } catch(e) {
      if(e instanceof InvalidInput) return error(400,'INVALID_INPUT','입력 내용을 확인해 주세요.');
      if(e instanceof CoordinationError) return error(e.status,e.code,'현재 진행 상태와 요청 내용을 확인해 주세요.');
      throw e;
    }
  };
}
