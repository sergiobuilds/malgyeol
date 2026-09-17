"""Role-bound voice tools; phone destinations never enter model-visible data."""
import json
import os
import sqlite3
from pathlib import Path
from urllib.parse import urlencode

PROGRAMS = {'foodbank-market', 'mobile-market', 'just-dream', 'care-sos'}
SHARED_FIELDS = {'summary', 'district', 'constraints', 'needs'}

class ToolError(Exception):
    """Safe, fixed messages only; never wrap provider exceptions."""


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
        return {k:visible(v) for k,v in value.items() if k not in {'phone','citizenRef','providerCallId'}}
    if isinstance(value,list): return [visible(v) for v in value]
    return value


def encode(value): return json.dumps(visible(value),ensure_ascii=False)

class Routing:
    def __init__(self,data):
        self.allowed=set(data['allowedNumbers'])
        self.citizens=dict(data['citizenNumbers']); self.institutions=dict(data['institutionNumbers'])
        if any(v not in self.allowed for v in [*self.citizens.values(),*self.institutions.values()]):
            raise ToolError('허용된 통화 경로가 필요합니다.')
    def destination(self,role,ref):
        mapping=self.institutions if role=='institution' else self.citizens
        number=mapping.get(ref)
        if not number or number not in self.allowed: raise ToolError('허용된 통화 경로가 필요합니다.')
        return number
    def citizen(self,number):
        # Normalization is also applied by the private config loader.
        def normalized(v): return '+82'+v[1:] if v.startswith('0') else v
        return next((k for k,v in self.citizens.items() if normalized(v)==normalized(number)),None)

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

class VoiceTools:
    def __init__(self,api,journal,context):
        self.api=api;self.journal=journal;self.context=context;self.catalog={}
    def role(self,*allowed):
        if self.context['role'] not in allowed: raise ToolError('이 통화에서 처리할 수 없는 요청입니다.')
    def path(self,suffix=''):
        request_id=self.context.get('requestId')
        if not request_id: raise ToolError('먼저 필요한 도움을 정리해 주세요.')
        return '/api/coordination/requests/'+request_id+suffix
    async def current(self):
        r=(await self.api.send('GET',self.path()))['request']
        if self.context.get('citizenRef') and r['citizenRef']!=self.context['citizenRef']:
            raise ToolError('요청 연결을 확인해 주세요.')
        return r
    async def create_request(self,input_json:str):
        """시민이 말한 지역·여러 필요·제약을 JSON으로 저장. 임의로 필요를 추정하지 않음."""
        self.role('citizen')
        if self.context.get('requestId'): return encode({'request':await self.current()})
        d=object_json(input_json)
        if set(d)-{'summary','district','constraints','needs'}: raise ToolError('허용된 요청 항목만 전달해 주세요.')
        d['summary']=text(d.get('summary'));d['district']=text(d.get('district'));d['constraints']=strings(d.get('constraints'))
        if not isinstance(d.get('needs'),list) or not 1<=len(d['needs'])<=20: raise ToolError('필요한 도움을 정리해 주세요.')
        d['needs']=[{'description':text(n.get('description')),'category':text(n.get('category')),'constraints':strings(n.get('constraints',[]))} for n in d['needs'] if isinstance(n,dict)]
        if not d['needs']: raise ToolError('필요한 도움을 정리해 주세요.')
        d['citizenRef']=self.context['citizenRef']
        # Claim before POST: a lost HTTP response must not create another request.
        key='create:'+self.context['callId']
        if not self.journal.claim(key,{'state':'sending'}): raise ToolError('접수 기록을 확인하고 있습니다.')
        result=await self.api.send('POST','/api/coordination/requests',d)
        self.context['requestId']=result['request']['id'];self.journal.put('call:'+self.context['callId'],{k:v for k,v in self.context.items() if not k.startswith('_')})
        self.journal.put(key,{'state':'completed','requestId':self.context['requestId']})
        return encode(result)
    async def search_institutions(self,program_id:str,district:str,query:str):
        """네 사업의 지역별 기관과 실제 이용절차 조회. 결과에 있는 기관만 선택."""
        self.role('citizen','callback')
        if program_id not in PROGRAMS: raise ToolError('지원사업을 확인해 주세요.')
        result=await self.api.send('GET','/api/support/institutions?'+urlencode({'programId':program_id,'district':district,'query':query}))
        self.catalog.update({i['id']:i for i in result['institutions']})
        return encode(result)
    async def prepare_inquiry(self,need_index:int,institution_id:str,program_id:str,contact_purpose:str,questions_json:str):
        """조회한 기관에 필요한 질문 준비. 시민 동의 후 통화 종료 시 실행."""
        self.role('citizen','callback');r=await self.current()
        institution=self.catalog.get(institution_id)
        if not institution or not any(p['programId']==program_id for p in institution['programs']) or not any(c['purpose']==contact_purpose for c in institution['contacts']):
            raise ToolError('조회한 사업과 창구에서 선택해 주세요.')
        if type(need_index)!=int or not 0<=need_index<len(r['needs']): raise ToolError('도움 항목을 확인해 주세요.')
        try: questions=strings(json.loads(questions_json))
        except (ValueError,TypeError): raise ToolError('질문 목록을 확인해 주세요.') from None
        if not questions: raise ToolError('기관에 물을 내용을 정리해 주세요.')
        return encode(await self.api.send('POST',self.path('/inquiries'),{'needId':r['needs'][need_index]['id'],'institutionId':institution_id,'programId':program_id,'contactPurpose':contact_purpose,'questions':questions}))
    async def record_consent(self,input_json:str):
        """시민에게 기관·목적·전달정보·조율범위를 설명한 후 명확한 음성 동의 기록."""
        self.role('citizen','callback');d=object_json(input_json)
        utterance=text(d.get('utterance'))
        heard=self.context.get('_heard','')
        if utterance not in heard or any(v in utterance.replace(' ','') for v in ['동의안','동의하지','하지마','싫어','아니요','안돼','안해']):
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
        """기관의 답변·조건·다음 행동 저장. 통화 완료 후 해당 문의에만 적용."""
        self.role('institution');d=object_json(input_json)
        if d.get('outcome') not in {'available','declined','alternative'} or type(d.get('requiresChoice'))!=bool: raise ToolError('답변 조건을 확인해 주세요.')
        answer={'outcome':d['outcome'],'summary':text(d.get('summary')),'conditions':strings(d.get('conditions')),'nextAction':text(d.get('nextAction')),'requiresChoice':d['requiresChoice']}
        self.journal.put('answer:'+self.context['callId'],answer)
        return encode({'saved':True,'message':'답변을 기록했습니다.'})
    async def record_choice(self,need_index:int,choice:str):
        """기관이 제시한 중요 조건에 대한 시민의 선택 기록. 자동 수락 금지."""
        self.role('callback','citizen');r=await self.current()
        if type(need_index)!=int or not 0<=need_index<len(r['needs']): raise ToolError('도움 항목을 확인해 주세요.')
        return encode(await self.api.send('POST',self.path('/needs/'+r['needs'][need_index]['id']+'/choice'),{'choice':text(choice)}))
    async def revise_request(self,input_json:str):
        """시민이 정정한 요청 요약·지역·제약 반영. 이전 조건 문의는 재준비 필요."""
        self.role('citizen','callback');d=object_json(input_json)
        if not d or set(d)-{'summary','district','constraints'}: raise ToolError('정정할 내용을 확인해 주세요.')
        for k in d:d[k]=strings(d[k]) if k=='constraints' else text(d[k])
        return encode(await self.api.send('PATCH',self.path(),d))
    async def stop_need(self,need_index:int):
        """시민이 취소한 도움 항목만 중단. 다른 도움은 보존."""
        self.role('citizen','callback');r=await self.current()
        if type(need_index)!=int or not 0<=need_index<len(r['needs']): raise ToolError('도움 항목을 확인해 주세요.')
        return encode(await self.api.send('POST',self.path('/needs/'+r['needs'][need_index]['id']+'/stop'),{}))
    async def finish_conversation(self,summary:str):
        """대화 결과를 정리. 인사를 마친 뒤 통화를 종료할 준비 표시."""
        self.journal.put('finish:'+self.context['callId'],{'summary':text(summary)})
        return encode({'message':'마지막 안내와 인사를 마쳐 주세요.','ending':True})
    def handlers(self):
        names=['finish_conversation']
        if self.context['role']=='institution': names+=['record_answer']
        else:
            names+=['search_institutions','prepare_inquiry','record_consent','record_choice','revise_request','stop_need']
            if self.context['role']=='citizen': names+=['create_request']
        return [getattr(self,n) for n in names]
