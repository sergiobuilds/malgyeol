import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from coordination_voice import institutional_context


class FollowupContextTests(unittest.TestCase):
    def test_previous_name_never_survives_in_offer_after_profile_change(self):
        request = self.request()
        request['citizenProfile']['name'] = '변경시민'
        request['inquiries'][1]['answer']['conditions'] = ['시험시민 님에게 30분 뒤 2개 무료 전달']
        disclosure = institutional_context(request, self.inquiry())
        self.assertNotIn('시험시민', str(disclosure))
        self.assertEqual(disclosure['previousOffer']['conditions'], ['30분', '2개', '무료'])

    def request(self):
        return {'revision': 2, 'district': '서대문구',
                'citizenProfile': {'name': '시험시민', 'address': '시험로 12길 3, 401호'},
                'consent': {'sharedFields': ['district', 'needs'], 'allowCoordination': True},
                'needs': [{'id': 'n', 'description': '식사 전달',
                           'choice': '안내한 시간에 집에서 받겠습니다'}],
                'inquiries': [
                    {'id': 'old', 'needId': 'n', 'institutionId': 'i', 'revision': 1,
                     'status': 'answered', 'answer': {'conditions': ['30분'], 'outcome': 'available'}},
                    {'id': 'current-offer', 'needId': 'n', 'institutionId': 'i', 'revision': 2,
                     'status': 'answered', 'answer': {'conditions': ['죽 1식', '45분 이내', '무료 전달'],
                         'summary': '시험시민에게 제공', 'nextAction': '시험로 12길 3, 401호로 전달',
                         'outcome': 'available', 'requiresChoice': True}},
                    {'id': 'other', 'needId': 'other-need', 'institutionId': 'other-institution',
                     'revision': 2, 'status': 'answered',
                     'answer': {'conditions': ['다른 시민 조건'], 'outcome': 'available'}}]}

    def inquiry(self):
        return {'id': 'followup', 'needId': 'n', 'institutionId': 'i',
                'programId': 'just-dream', 'contactPurpose': '문의', 'revision': 2}

    def test_same_institution_followup_retains_actual_offer_conditions_only(self):
        request = self.request()
        disclosure = institutional_context(request, self.inquiry())
        self.assertEqual(disclosure['previousOffer']['conditions'], ['1식', '45분', '무료'])
        self.assertNotIn('30분', str(disclosure))
        self.assertNotIn('다른 시민 조건', str(disclosure))
        self.assertNotIn('시험시민', str(disclosure))
        self.assertNotIn('401호', str(disclosure))
        changed = copy.deepcopy(request)
        changed['inquiries'][1]['answer']['conditions'][1] = '60분 이내'
        self.assertIn('60분', institutional_context(changed, self.inquiry())['previousOffer']['conditions'])

    def test_unconsented_profile_and_contact_values_in_conditions_are_omitted(self):
        request = self.request()
        request['inquiries'][1]['answer']['conditions'] += [
            '시험시민 성함 확인', '시험로 12길 3, 401호로 무료 전달', '010-0000-0000으로 연락']
        disclosure = institutional_context(request, self.inquiry())
        self.assertEqual(disclosure['previousOffer']['conditions'], ['1식', '45분', '무료'])

    def test_profile_revision_keeps_offer_as_historical_conditions_to_reconfirm(self):
        request = self.request()
        request['revision'] = 3
        inquiry = {**self.inquiry(), 'revision': 3}
        disclosure = institutional_context(request, inquiry)
        self.assertEqual(disclosure['previousOffer']['conditions'], ['1식', '45분', '무료'])
        self.assertTrue(disclosure['previousOffer']['requiresReconfirmation'])

    def test_without_needs_consent_or_matching_institution_no_previous_offer(self):
        request = self.request()
        request['consent']['sharedFields'] = ['district']
        self.assertNotIn('previousOffer', institutional_context(request, self.inquiry()))
        request = self.request()
        inquiry = {**self.inquiry(), 'institutionId': 'new'}
        self.assertNotIn('previousOffer', institutional_context(request, inquiry))
