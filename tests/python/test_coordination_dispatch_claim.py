import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from coordination_tools import Journal, Routing, ToolError
from coordination_voice import VoiceRuntime

class DispatchClaimTests(unittest.IsolatedAsyncioTestCase):
    async def test_startup_releases_only_claims_without_any_persisted_attempt(self):
        for persisted in [False,True]:
            with self.subTest(persisted=persisted),tempfile.TemporaryDirectory() as directory:
                request={'id':'r','revision':1,'inquiries':[{'id':'q','status':'prepared','revision':1}],
                         'attempts':[{'id':'a','inquiryId':'q','idempotencyKey':'dispatch:q:0','status':'unknown'}] if persisted else []}
                class API:
                    async def send(self,method,path,body=None):
                        self.assert_method=method
                        return {'requests':[request]}
                journal=Journal(Path(directory)/'voice.sqlite')
                journal.put('dispatch:q:0',{'state':'dispatching'})
                runtime=VoiceRuntime(API(),journal,Routing({'allowedNumbers':[],'institutionNumbers':{},'citizenNumbers':{}}))
                try:
                    await runtime.recover()
                    self.assertEqual(journal.get('dispatch:q:0') is not None,persisted)
                finally:journal.close()

    async def test_definitive_attempt_rejection_releases_claim_unknown_keeps_it(self):
        for code in ['HTTP_409','TRANSPORT_UNKNOWN']:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                request={'id':'r','citizenRef':'c','revision':1,'consent':{'institutionIds':['i']},
                         'inquiries':[{'id':'q','institutionId':'i','status':'prepared','revision':1}],'attempts':[]}
                class API:
                    posts=0
                    async def send(self,method,path,body=None):
                        if method=='POST':
                            self.posts+=1;raise ToolError('safe',code=code)
                        return {'request':request}
                journal=Journal(Path(directory)/'voice.sqlite');api=API()
                routing=Routing({'allowedNumbers':['+821000000001'],'institutionNumbers':{'i':'+821000000001'},'citizenNumbers':{}})
                runtime=VoiceRuntime(api,journal,routing)
                try:
                    for _ in range(2):
                        try:await runtime.dispatch_request(request)
                        except ToolError:pass
                    self.assertEqual(api.posts,2 if code=='HTTP_409' else 1)
                    self.assertEqual(journal.get('dispatch:q:0') is None,code=='HTTP_409')
                finally:journal.close()
