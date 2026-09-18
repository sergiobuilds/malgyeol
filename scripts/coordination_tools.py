"""Role-bound voice tools; phone destinations never enter model-visible data."""
import json
import re
import os
import sqlite3
import copy
import hashlib
from pathlib import Path
from urllib.parse import urlencode

PROGRAMS = {'foodbank-market', 'mobile-market', 'just-dream', 'care-sos'}
SHARED_FIELDS = {'summary', 'district', 'constraints', 'needs','citizenProfile.name','citizenProfile.address'}

class ToolError(Exception):
    """Safe, fixed messages only; never wrap provider exceptions."""
    def __init__(self,message,*,code='INPUT_REQUIRED',definitive=False):
        super().__init__(message)
        self.code=code
        self.definitive=definitive


def object_json(value):
    try:
        if not isinstance(value,str) or len(value)>16000: raise ValueError()
        result=json.loads(value)
        if not isinstance(result,dict): raise ValueError()
        return result
    except (ValueError,TypeError): raise ToolError('입력 형식을 확인해 주세요.') from None


def text(value):
    if not isinstance(value,str) or not value.strip() or len(value)>2000:
        raise ToolError('필요한 내용을 짧게 말씀해 주세요.')
    return value.strip()


def strings(value):
    if not isinstance(value,list) or len(value)>50: raise ToolError('목록 형식을 확인해 주세요.')
    return [text(v) for v in value]


def visible(value):
    if isinstance(value,dict):
        return {k:visible(v) for k,v in value.items() if k not in {'phone','citizenRef','providerCallId','intakeKey','intakeSignature'}}
    if isinstance(value,list): return [visible(v) for v in value]
    return value


def encode(value): return json.dumps(visible(value),ensure_ascii=False)

class Routing:
    def __init__(self,data):
        self.allowed=set(data['allowedNumbers'])
        self.citizens=dict(data['citizenNumbers']); self.institutions=dict(data['institutionNumbers'])
        self.demo_callers=dict(data.get('demoCallers',{}))
        self.demo_authorization=data.get('demoAuthorization',False)
        if type(self.demo_authorization) is not bool or (self.demo_authorization and not self.demo_callers):
            raise ToolError('시연 사전승인 설정을 확인해 주세요.')
        self.public_intake=data.get('publicIntake',False)
        self.demo_time=data.get('demoTime')
        self.service_number=None
        if any(n not in self.allowed for n in self.demo_callers):
            raise ToolError('시연 번호 설정을 확인해 주세요.')
        if any(v not in self.allowed for v in [*self.citizens.values(),*self.institutions.values()]):
            raise ToolError('허용된 통화 경로가 필요합니다.')
    def destination(self,role,ref):
        mapping=self.institutions if role=='institution' else self.citizens
        number=mapping.get(ref)
        if not number or number not in self.allowed: raise ToolError('허용된 통화 경로가 필요합니다.')
        return number
    def citizen(self,number):
        # Normalization is also applied by the private config loader.
        from coordination_config import normalize_number
        try:number=normalize_number(number)
        except ValueError:return None
        return self.demo_callers.get(number) or next((k for k,v in self.citizens.items() if v==number),None)

class Journal:
    def __init__(self,path):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if not self.path.exists():
            fd=os.open(self.path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
        self.db=sqlite3.connect(self.path)
        self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS voice_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');self.db.commit()
    def get(self,key):
        row=self.db.execute('SELECT value FROM voice_state WHERE key=?',(key,)).fetchone()
        return json.loads(row[0]) if row else None
    def put(self,key,value):
        with self.db:self.db.execute('INSERT INTO voice_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,json.dumps(value,ensure_ascii=False)))
    def claim(self,key,value):
        with self.db:
            result=self.db.execute('INSERT OR IGNORE INTO voice_state VALUES (?,?)',(key,json.dumps(value,ensure_ascii=False)))
        return result.rowcount==1
    def entries(self,prefix):
        return [(k,json.loads(v)) for k,v in self.db.execute('SELECT key,value FROM voice_state WHERE substr(key,1,?)=?',(len(prefix),prefix))]
    def close(self): self.db.close()
    def delete(self,key):
        with self.db:self.db.execute('DELETE FROM voice_state WHERE key=?',(key,))

class VoiceTools:
    def __init__(self,api,journal,context):
        self.api=api;self.journal=journal;self.context=context;self.catalog={}
        self.routing=None
    def require_recipient(self):
        if self.context['role']!='callback': return
        confirmation=self.journal.get('recipient:'+self.context['callId']) or {}
        if confirmation.get('status')!='confirmed' or confirmation.get('requestId')!=self.context.get('requestId'):
            raise ToolError('먼저 요청하신 본인인지 확인해 주세요.')
    def role(self,*allowed):
        if self.context['role'] not in allowed: raise ToolError('이 통화에서 처리할 수 없는 요청입니다.')
        self.require_recipient()
    def path(self,suffix=''):
        request_id=self.context.get('requestId')
        if not request_id: raise ToolError('먼저 create_request로 이미 들은 지역·필요를 저장하세요. 시민에게 같은 내용을 다시 묻지 말고 저장 후 이 도구를 다시 호출하세요.',code='REQUEST_REQUIRED')
        return '/api/coordination/requests/'+request_id+suffix
    async def current(self):
        self.require_recipient()
        r=(await self.api.send('GET',self.path()))['request']
        if self.context.get('citizenRef') and r['citizenRef']!=self.context['citizenRef']:
            raise ToolError('요청 연결을 확인해 주세요.')
        return r
    async def confirm_recipient(self,recipient_role:str,utterance:str):
        """요청한 본인 여부 질문 후 실제 최근 답변 전체를 기록. 확인 후에만 요청 내용을 반환."""
        if self.context['role']!='callback': raise ToolError('회신 통화에서만 수신자를 확인합니다.')
        quote=text(utterance)
        normalize=lambda v:re.sub(r'[\s.,!?。]', '',v)
        heard=normalize(self.context.get('_heard',''))
        actual=normalize(quote)
        negative=['아니','본인아','다른사람','가족','대신','자동응답','음성사서함','소리샘','메시지','남겨','모르','잘못','지금없','부재','안했','않았','적없','한적없','기억없']
        accepted_roles={'self'}|set(self.context.get('authorizedRecipientRoles',[]))
        # Match the complete affirmative response, not a fragment that also
        # appears in denials such as '제가 전화 안 했는데요'.
        affirmative=(r'(?:네|예)?(?:네|예|맞아요|맞습니다|접니다|저예요|본인입니다|'
                     r'(?:제가|저는)?(?:아까|앞서|방금)?(?:요청|전화)(?:한|했던)(?:본인|사람)(?:입니다|이에요|맞아요|맞습니다)|'
                     r'(?:제가|저는)?본인(?:이)?(?:맞아요|맞습니다|입니다)|'
                     r'제가(?:요청|전화)(?:했습니다|했어요)|제가맞(?:아요|습니다))')
        positive=re.fullmatch(affirmative,actual) is not None
        if not actual or actual!=heard or recipient_role not in accepted_roles or not positive or any(v in actual for v in negative):
            self.journal.put('recipient:'+self.context['callId'],{'status':'not-confirmed','requestId':self.context.get('requestId')})
            raise ToolError('상세 안내를 진행하지 않습니다. 요청하신 분께 다시 연결하겠습니다.')
        # Do not release data merely because the destination number matched.
        r=(await self.api.send('GET',self.path()))['request']
        if not self.context.get('citizenRef') or r['citizenRef']!=self.context['citizenRef']:
            raise ToolError('요청 연결을 확인해 주세요.')
        self.journal.put('recipient:'+self.context['callId'],{'status':'confirmed','requestId':r['id'],'role':recipient_role,'utterance':quote[:160]})
        targets=[]
        if r.get('inquiries'):
            known={i['id']:i for i in (await self.api.send('GET','/api/support/institutions'))['institutions']}
            seen=set()
            for inquiry in reversed(r['inquiries']):
                institution=known.get(inquiry['institutionId'])
                if not institution or not any(p['programId']==inquiry.get('programId') for p in institution['programs']) or not any(c['purpose']==inquiry.get('contactPurpose') for c in institution['contacts']):
                    continue
                indexes=[index for index,need in enumerate(r['needs']) if need['id']==inquiry.get('needId') and need.get('status')!='stopped']
                if not indexes:continue
                target={'need_index':indexes[0],'institution_id':institution['id'],'program_id':inquiry['programId'],'contact_purpose':inquiry['contactPurpose']}
                key=tuple(target.values())
                if key in seen:continue
                seen.add(key);self.catalog[institution['id']]=institution;targets.append(target)
        return encode({'request':r,'followupTargets':targets,'message':'수신자 역할 확인 후 결과 안내를 진행합니다.',
                       'nextAction':'기관 답변을 안내하고 시민 선택을 record_choice로 기록하세요. 같은 기관 재문의는 followupTargets의 인자를 prepare_inquiry에 그대로 사용하세요. 이미 검증된 기관이므로 다시 검색할 필요가 없습니다. 다른 기관은 시민이 대안을 원할 때 조회하고 별도 동의를 받으세요.'})
    async def end_without_disclosure(self):
        """다른 수신자·자동응답기·역할확인 불가 시 개별 내용 없이 통화 종료. 전달 완료 아님."""
        if self.context['role']!='callback': raise ToolError('회신 통화 종료 도구입니다.')
        self.journal.put('end:'+self.context['callId'],{'reason':'recipient-not-confirmed'})
        return encode({'message':'개별 내용을 안내하지 않고 짧게 인사 후 통화를 마쳐 주세요.','ending':True})
    async def end_without_request(self,utterance:str):
        """접수 전 시민이 안내만 원하거나 접수·통화 종료를 명시했을 때만 사용.
        utterance는 실제 최근 발화 전체. 이미 요청이 있으면 기존 취소·준비 흐름을 사용.
        기관 문의나 회신을 약속하지 않고 인사 후 종료.
        """
        self.role('citizen')
        if self.context.get('requestId'):
            raise ToolError('이미 접수된 요청이 있습니다. 취소 의사는 stop_need에 반영하고 기존 요청 흐름에서 종료하세요.',code='REQUEST_EXISTS')
        actual=re.sub(r'[\s.,!?。]', '',text(utterance))
        heard=re.sub(r'[\s.,!?。]', '',self.context.get('_heard',''))
        intent=r'(?:네|예)?(?:안내만(?:받을게요|원해요|필요해요)|(?:접수|신청)(?:는|은)?(?:안할게요|하지않을게요|안해요|하지마세요)|(?:오늘은)?(?:그만할게요|여기까지할게요|통화마칠게요|통화끝낼게요|끊을게요)|이제끊을게요)(?:감사합니다|고맙습니다)?'
        if actual!=heard or re.fullmatch(intent,actual) is None:
            raise ToolError('접수 없이 안내만 원하는지 또는 통화를 마칠지 시민에게 짧게 확인하고 실제 답변 전체를 기록하세요.',code='END_INTENT_REQUIRED')
        self.journal.put('end:'+self.context['callId'],{'reason':'citizen-no-request'})
        return encode({'message':'기관 문의나 회신을 약속하지 말고 짧게 인사 후 통화를 마쳐 주세요.','ending':True})
    async def create_request(self,input_json:str):
        """새 요청 저장. input_json은 JSON 객체 문자열:
        {"summary":"오늘 바로 먹을 음식과 집까지 전달 필요","district":"서대문구","constraints":["외출 어려움"],
        "needs":[{"description":"바로 먹을 식사 전달","category":"식사","constraints":[],
        "requestDetails":{"quantity":"1식","requestedDate":"오늘 밤","deliveryMethod":"집까지 전달"}}]}.
        summary/needs 필수. 등록 시민 district/프로필은 서버에서 채우므로 다시 질문하지 않음.
        신규 시민 district 필수. citizenProfile 선택 객체는 name/address 필수, age(정수)/household/mobility/contactPreference 선택.
        실제 발화와 등록 정보만 사용. requestDetails는 이번 요청 조건만 기록. 내부 ID·번호를 넣지 않음.
        """
        self.role('citizen')
        if self.context.get('requestId'): return encode({'request':await self.current()})
        d=object_json(input_json)
        if set(d)-{'summary','district','constraints','needs','citizenProfile'}: raise ToolError('허용된 요청 항목만 전달해 주세요.')
        d['summary']=text(d.get('summary'));d['district']=text(d.get('district',self.context.get('district')));d['constraints']=strings(d.get('constraints',[]))
        if not isinstance(d.get('needs'),list) or not 1<=len(d['needs'])<=20: raise ToolError('필요한 도움을 정리해 주세요.')
        d['needs']=[{'description':text(n.get('description')),'category':text(n.get('category')),'constraints':strings(n.get('constraints',[])),
                     **({'requestDetails':n['requestDetails']} if 'requestDetails' in n else {})} for n in d['needs'] if isinstance(n,dict)]
        if not d['needs']: raise ToolError('필요한 도움을 정리해 주세요.')
        if self.context.get('citizenProfile'):
            profile=copy.deepcopy(self.context['citizenProfile'])
            if 'citizenProfile' in d:
                if not isinstance(d['citizenProfile'],dict):raise ToolError('시민 정보는 객체로 전달해 주세요.')
                profile.update(d['citizenProfile'])
            d['citizenProfile']=profile
        d['citizenRef']=self.context['citizenRef']
        d['intakeKey']='voice-'+hashlib.sha256(self.context['callId'].encode()).hexdigest()
        # Claim before POST: a lost HTTP response must not create another request.
        key='create:'+self.context['callId']
        if not self.journal.claim(key,{'state':'sending'}):
            candidates=(await self.api.send('GET','/api/coordination/requests?'+urlencode({'citizenRef':d['citizenRef']})))['requests']
            saved=next((r for r in candidates if r.get('citizenRef')==d['citizenRef'] and r.get('intakeKey')==d['intakeKey']),None)
            if not saved:raise ToolError('이 접수의 저장 결과를 담당자가 대조해야 합니다. 중복 접수를 만들지 마세요.',code='CREATE_UNRESOLVED')
            result={'request':saved}
        else:
            try:result=await self.api.send('POST','/api/coordination/requests',d)
            except ToolError as error:
                if error.definitive:self.journal.delete(key)
                else:self.journal.put(key,{'state':'needs-reconciliation'})
                raise
        self.context['requestId']=result['request']['id'];self.journal.put('call:'+self.context['callId'],{k:v for k,v in self.context.items() if not k.startswith('_')})
        self.journal.put(key,{'state':'completed','requestId':self.context['requestId']})
        destination=self.journal.get('return:'+self.context['callId'])
        if destination:
            self.journal.put('request-return:'+self.context['requestId'],{**destination,'citizenRef':self.context['citizenRef']})
        return encode({**result,'nextAction':'search_institutions로 기관 조회 → prepare_inquiry로 질문 준비 → 기관과 전달 범위를 설명하고 record_consent로 실제 동의 저장 → finish_conversation 순서로 진행하세요.'})
    async def set_callback_number(self,number:str,utterance:str):
        """발신번호가 없거나 시민이 회신 번호 변경을 요청한 경우만 사용.
        number는 시민이 직접 말한 번호. utterance는 회신 요청을 포함한 실제 최근 발화 전체.
        번호를 추측하거나 기관번호로 대체하지 않음. 저장 후 번호를 말로 확인하고 회신 동의를 구함.
        """
        self.role('citizen')
        from coordination_config import normalize_number
        try:normalized=normalize_number(number)
        except ValueError:raise ToolError('전화번호 형식으로 다시 전달해 주세요.') from None
        quote=text(utterance)
        heard=self.context.get('_heard','')
        digits=re.sub(r'[^0-9]','',quote)
        domestic='0'+normalized[3:] if normalized.startswith('+82') else normalized[1:]
        if quote!=heard or digits not in {domestic,normalized[1:]} or any(word in quote.replace(' ','') for word in ['하지마','아니','말고','안돼']):
            raise ToolError('시민이 원하는 회신 번호를 실제 발화 전체로 다시 확인하세요.')
        if normalized==self.context.get('_serviceNumber'):raise ToolError('시민이 받을 회신 번호를 질문하세요.')
        destination={'number':normalized,'source':'spoken'}
        self.journal.put('return:'+self.context['callId'],destination)
        if self.context.get('requestId'):
            self.journal.put('request-return:'+self.context['requestId'],{**destination,'citizenRef':self.context['citizenRef']})
        self.context['callbackAvailable']=True
        return encode({'saved':True,'message':'말씀하신 번호로 회신할 경로를 기록했습니다.'})
    async def search_institutions(self,program_id:str,district:str,query:str):
        """기관 조회. program_id는 foodbank-market(푸드뱅크·마켓), mobile-market(찾아가는 마켓),
        just-dream(그냥드림), care-sos(돌봄SOS) 중 하나. district는 '서대문구'처럼 구 이름.
        query는 우선 빈 문자열. 결과의 id/programs/contacts.purpose를 prepare_inquiry에 사용.
        목록은 재고·야간운영·가정배달 확정 정보가 아님. 해당 조건은 기관에 문의.
        """
        self.role('citizen','callback')
        if program_id not in PROGRAMS: raise ToolError('지원사업을 확인해 주세요.')
        result=await self.api.send('GET','/api/support/institutions?'+urlencode({'programId':program_id,'district':district,'query':query}))
        if self.routing is not None:
            for institution in result['institutions']:
                institution['voiceRoutingReady']=institution['id'] in self.routing.institutions
        self.catalog.update({i['id']:i for i in result['institutions']})
        return encode({**result,'nextAction':'결과가 있으면 그 기관 id·사업 programId·contacts.purpose를 사용해 prepare_inquiry를 호출하세요. 없다면 검색 조건이나 사업을 바꿔 조회하세요.'})
    async def prepare_inquiry(self,need_index:int,institution_id:str,program_id:str,contact_purpose:str,questions_json:str):
        """조회 결과 기관으로 문의 준비. need_index는 저장된 needs의 0부터 시작하는 순번.
        institution_id/program_id/contact_purpose는 조회 결과의 id/programs.programId/contacts.purpose 또는 confirm_recipient의 followupTargets를 그대로 사용. 같은 기관 재문의는 재검색 없이 가능.
        questions_json은 질문 문자열 배열의 JSON. 예: ["바로 먹을 음식 재고와 수량은?","오늘 집까지 전달 가능한가요?","시간·비용·접수 조건은?"]
        동의 후 시민 통화가 끝나면 발신. 문의 준비 자체는 재고나 배달 확정이 아님.
        """
        self.role('citizen','callback');r=await self.current()
        if self.routing is not None and institution_id not in self.routing.institutions:
            raise ToolError('이 기관의 전화 연결 설정이 필요합니다. voiceRoutingReady=true인 다른 후보를 조회하거나 담당자에게 경로 설정을 요청하세요. 시민에게 연락을 약속하지 마세요.',code='INSTITUTION_ROUTE_REQUIRED')
        institution=self.catalog.get(institution_id)
        if not institution or not any(p['programId']==program_id for p in institution['programs']) or not any(c['purpose']==contact_purpose for c in institution['contacts']):
            raise ToolError('조회한 사업과 창구에서 선택해 주세요.')
        if type(need_index)!=int or not 0<=need_index<len(r['needs']): raise ToolError('도움 항목을 확인해 주세요.')
        try: questions=strings(json.loads(questions_json))
        except (ValueError,TypeError): raise ToolError('질문 목록을 확인해 주세요.') from None
        if not questions: raise ToolError('기관에 물을 내용을 정리해 주세요.')
        result=await self.api.send('POST',self.path('/inquiries'),{'needId':r['needs'][need_index]['id'],'institutionId':institution_id,'programId':program_id,'contactPurpose':contact_purpose,'questions':questions})
        if (self.context.get('demoAuthorization') is True and self.routing is not None
                and self.routing.demo_authorization and r['citizenRef'] in self.routing.demo_callers.values()
                and institution_id in self.routing.institutions):
            ids=set((r.get('consent') or {}).get('institutionIds',[]))|{institution_id}
            body={'purpose':'목업 시연 운영자 사전승인: 기관 문의와 조건 조율. 실제 주문·배달 확정 제외',
                  'institutionIds':sorted(ids & set(self.routing.institutions)),
                  'sharedFields':sorted(SHARED_FIELDS),'allowCoordination':True}
            await self.api.send('POST',self.path('/consent'),body)
            self.journal.put('consent:'+self.context['callId'],{'source':'demo-operator-authorization','scope':body})
            return encode({**result,'authorizationSource':'demo-operator-authorization',
                           'nextAction':'승인된 목업 시연 정보로 기관 문의·조건 조율 준비를 마쳤습니다. 이름·주소 공유 동의를 다시 묻지 마세요. 실제 주문이나 배달은 확정하지 않습니다. finish_conversation으로 종료 준비하세요.'})
        return encode({**result,'nextAction':'시민에게 이 기관·문의 목적·전달 범위를 설명하고 동의를 받으세요. 실제 최근 동의 발화로 record_consent를 호출해야 기관 발신이 준비됩니다.'})
    async def record_consent(self,input_json:str):
        """기관·문의 목적·전달정보·조율범위를 설명하고 실제 동의를 받은 뒤 기록.
        input_json은 {"purpose":"식사 재고와 전달 문의","institutionIds":["조회한 기관 id"],
        "sharedFields":["district","needs","constraints"],"allowCoordination":true,"utterance":"실제 최근 동의 발화"}.
        sharedFields 허용값: summary,district,constraints,needs,citizenProfile.name,citizenProfile.address.
        이름·상세주소는 전달 필요와 동의를 확인한 경우만 선택. allowCoordination=false는 정보 문의만.
        utterance를 만들어내거나 부정 발화 일부를 긍정 동의로 바꾸지 않음.
        """
        self.role('citizen','callback');d=object_json(input_json)
        if self.context['role']=='citizen' and self.context.get('callbackAvailable') is False:
            raise ToolError('먼저 시민이 받을 회신 번호를 질문하고 set_callback_number로 기록하세요.',code='CALLBACK_REQUIRED')
        utterance=text(d.get('utterance'))
        heard=self.context.get('_heard','')
        normalize=lambda value:re.sub(r'[\s.,!?。]', '',value)
        actual=normalize(utterance)
        negative=['동의안','동의하지','하지마','말하지마','말아','싫어','아니','안돼','안해','않','거절','보류','잠깐','말고','빼고','만알려','만전달']
        if not actual or actual!=normalize(heard) or any(v in actual for v in negative):
            raise ToolError('시민의 명확한 동의를 다시 확인해 주세요.')
        r=await self.current();ids=strings(d.get('institutionIds'));fields=strings(d.get('sharedFields'))
        known={q['institutionId'] for q in r['inquiries']}|set(self.catalog)
        if not ids or not set(ids)<=known or not set(fields)<=SHARED_FIELDS or type(d.get('allowCoordination'))!=bool:
            raise ToolError('설명한 기관과 전달 범위를 확인해 주세요.')
        body={'purpose':text(d.get('purpose')),'institutionIds':ids,'sharedFields':fields,'allowCoordination':d['allowCoordination']}
        result=await self.api.send('POST',self.path('/consent'),body)
        self.journal.put('consent:'+self.context['callId'],{'utterance':utterance,'scope':body})
        return encode(result)
    async def record_answer(self,input_json:str):
        """실제로 들은 기관 답변 저장. input_json은 {"outcome":"available|declined|alternative",
        "summary":"답변 요약","conditions":["음식 종류·수량","전달 방법·시간","비용·접수 조건"],
        "nextAction":"실제 다음 행동","requiresChoice":true}.
        outcome은 세 값 중 하나, requiresChoice는 boolean. 답변 누락은 먼저 추가 질문.
        시민 선택이 필요한 시간·비용·방식 변경은 requiresChoice=true. 통화 완료 후 원장 반영.
        """
        self.role('institution');d=object_json(input_json)
        if d.get('outcome') not in {'available','declined','alternative'} or type(d.get('requiresChoice'))!=bool: raise ToolError('답변 조건을 확인해 주세요.')
        answer={'outcome':d['outcome'],'summary':text(d.get('summary')),'conditions':strings(d.get('conditions')),'nextAction':text(d.get('nextAction')),'requiresChoice':d['requiresChoice']}
        self.journal.put('answer:'+self.context['callId'],answer)
        return encode({'saved':True,'message':'답변을 기록했습니다.'})
    async def record_choice(self,need_index:int,choice:str):
        """기관이 제시한 중요 조건에 대한 시민의 선택 기록. 자동 수락 금지."""
        self.role('callback','citizen');r=await self.current()
        if type(need_index)!=int or not 0<=need_index<len(r['needs']): raise ToolError('도움 항목을 확인해 주세요.')
        result=await self.api.send('POST',self.path('/needs/'+r['needs'][need_index]['id']+'/choice'),{'choice':text(choice)})
        return encode({**result,'nextAction':'시민 선택을 답변한 기관에 전달할 후속 문의가 필요합니다. confirm_recipient의 followupTargets 인자로 prepare_inquiry를 바로 호출하세요. 같은 기관은 다시 검색하지 않습니다. 전달 범위가 넓어졌으면 추가 동의 후 finish_conversation을 호출하세요.'})
    async def revise_request(self,input_json:str):
        """시민이 알려준 요청 정정 또는 배달용 이름·주소를 기존 요청에 저장.
        input_json은 {"summary":"정정 요약","district":"지역","constraints":["제약"],
        "citizenProfile":{"name":"시민이 말한 이름","address":"시민이 말한 상세주소"}} 중 필요한 항목.
        citizenProfile은 name과 address 모두 필수이며 기존 age/household/mobility/contactPreference는 보존.
        회신에서는 본인 확인 후 사용. 저장은 기관 공유 동의가 아님.
        프로필 변경 뒤 전달 필드를 설명하고 record_consent로 다시 동의받고 문의를 재준비.
        """
        self.role('citizen','callback');d=object_json(input_json)
        if not d or set(d)-{'summary','district','constraints','citizenProfile'}: raise ToolError('정정할 내용을 확인해 주세요.')
        for k in d:
            if k=='citizenProfile':
                if not isinstance(d[k],dict) or not d[k].get('name') or not d[k].get('address'):
                    raise ToolError('시민이 알려준 이름과 상세주소를 citizenProfile.name, citizenProfile.address에 함께 기록하세요.')
            else:d[k]=strings(d[k]) if k=='constraints' else text(d[k])
        return encode(await self.api.send('PATCH',self.path(),d))
    async def stop_need(self,need_index:int):
        """시민이 취소한 도움 항목만 중단. 다른 도움은 보존."""
        self.role('citizen','callback');r=await self.current()
        if type(need_index)!=int or not 0<=need_index<len(r['needs']): raise ToolError('도움 항목을 확인해 주세요.')
        return encode(await self.api.send('POST',self.path('/needs/'+r['needs'][need_index]['id']+'/stop'),{}))
    async def finish_conversation(self,summary:str=''):
        """대화 결과를 정리. 인사를 마친 뒤 통화를 종료할 준비 표시."""
        self.require_recipient()
        if self.context['role']=='citizen':
            r=await self.current()
            active=[n for n in r['needs'] if n.get('status')!='stopped']
            prepared=[q for q in r['inquiries'] if q['status']=='prepared' and q['revision']==r['revision']]
            covered={q.get('needId') for q in prepared}
            missing=[index for index,need in enumerate(r['needs']) if need.get('status')!='stopped' and need['id'] not in covered]
            if missing:
                raise ToolError(f'기관 문의 준비가 빠진 need_index={missing} 항목만 search_institutions와 prepare_inquiry로 준비하세요. 기존 요청을 다시 접수하거나 이미 준비된 문의를 반복하지 마세요. 같은 정보를 시민에게 다시 묻지 마세요.',code='INQUIRY_REQUIRED')
            consent=r.get('consent') or {}
            if prepared and any(q['institutionId'] not in consent.get('institutionIds',[]) for q in prepared):
                raise ToolError('준비된 기관·문의·전달 범위를 안내하고 실제 동의를 record_consent에 저장하세요. 저장 후 finish_conversation을 호출하세요.',code='CONSENT_REQUIRED')
            if active and self.context.get('callbackAvailable') is False:
                raise ToolError('먼저 회신 번호를 set_callback_number로 확보하세요.',code='CALLBACK_REQUIRED')
        elif self.context['role']=='callback':
            r=await self.current()
            for need in r['needs']:
                if need.get('status')=='awaiting-choice':
                    raise ToolError('기관 조건에 대한 시민 선택을 질문하고 record_choice로 기록하세요.',code='CHOICE_REQUIRED')
                if need.get('status')=='open' and need.get('choice') and not any(q['needId']==need['id'] and q['status']=='prepared' and q['revision']==r['revision'] for q in r['inquiries']):
                    raise ToolError('기록된 시민 선택을 기관에 전달할 후속 문의를 search_institutions와 prepare_inquiry로 준비하세요.',code='FOLLOWUP_REQUIRED')
            consent=r.get('consent') or {}
            if any(q['status']=='prepared' and q['revision']==r['revision'] and q['institutionId'] not in consent.get('institutionIds',[]) for q in r['inquiries']):
                raise ToolError('새 기관과 전달 범위를 설명하고 record_consent로 동의를 갱신하세요.',code='CONSENT_REQUIRED')
        elif self.context['role']=='institution' and not self.journal.get('answer:'+self.context['callId']):
            raise ToolError('기관에서 실제로 들은 답변을 record_answer에 먼저 저장하세요. 빠진 조건은 추가 질문한 뒤 저장하고 finish_conversation을 호출하세요.',code='ANSWER_REQUIRED')
        if not summary:
            summary=({'citizen':'기관 문의 준비 및 시민 동의 저장 완료',
                      'callback':'본인 확인 및 시민 안내·후속 업무 준비 완료',
                      'institution':(self.journal.get('answer:'+self.context['callId']) or {}).get('summary','기관 답변 기록')})[self.context['role']]
        self.journal.put('finish:'+self.context['callId'],{'summary':text(summary)})
        message='마지막 안내와 인사를 마쳐 주세요.'
        if self.context['role']=='citizen':
            message=('기관 문의 준비와 동의 저장만 완료됐습니다. 실제 기관 전화는 이 통화 종료 후 시작합니다. '
                     '문의했다거나 확인했다고 말하지 마세요. "통화를 마친 뒤 기관에 연락하고 결과를 다시 알려드릴게요"라고 안내하고 인사하세요.')
        return encode({'message':message,'ending':True})
    def handlers(self):
        names=['finish_conversation']
        if self.context['role']=='institution': names+=['record_answer']
        else:
            names+=['search_institutions','prepare_inquiry','record_consent','record_choice','revise_request','stop_need']
            if self.context['role']=='citizen': names+=['create_request','set_callback_number','end_without_request']
            if self.context['role']=='callback': names+=['confirm_recipient','end_without_disclosure']
        return [getattr(self,n) for n in names]
