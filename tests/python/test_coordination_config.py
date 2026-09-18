import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import subprocess

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'coordination_config.py'


class RoutingTests(unittest.TestCase):
    def load_module(self):
        self.assertTrue(SCRIPT.exists(), 'private routing validator is required')
        spec = importlib.util.spec_from_file_location('coordination_config', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_demo_authorization_requires_explicit_boolean_and_mock_mapping(self):
        module=self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'routing.json'
            base={'allowedNumbers':['+821000000001'],'citizenNumbers':{},'institutionNumbers':{}}
            for extra,valid in [({'demoAuthorization':True},False),({'demoAuthorization':'true','demoCallers':{'+821000000001':'mock'}},False),({'demoAuthorization':True,'demoCallers':{'+821000000001':'mock'}},True)]:
                file.write_text(json.dumps({**base,**extra}));os.chmod(file,0o600)
                if valid:self.assertTrue(module.load_routing(file)['demoAuthorization'])
                else:
                    with self.assertRaises(ValueError):module.load_routing(file)

    def test_registered_roles_only_and_domestic_normalization(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory)/'routing.json'
            file.write_text(json.dumps({'allowedNumbers':['01000000001','+821000000002'],
                'citizenNumbers':{'citizen-a':'010-0000-0001'},
                'institutionNumbers':{'institution-a':'+821000000002'}}))
            os.chmod(file, 0o600)
            result = module.load_routing(str(file))
            self.assertEqual(result['citizenNumbers']['citizen-a'], '+821000000001')
            self.assertEqual(result['allowedNumbers'], ['+821000000001','+821000000002'])

    def test_unregistered_destination_rejected_without_echoing_number(self):
        module=self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'routing.json'
            file.write_text(json.dumps({'allowedNumbers':['01000000001'],
                'citizenNumbers':{'citizen-a':'01000000002'},'institutionNumbers':{}}))
            os.chmod(file,0o600)
            with self.assertRaisesRegex(ValueError,'ROUTING_DESTINATION_NOT_ALLOWED') as error:
                module.load_routing(str(file))
            self.assertNotIn('01000000002', str(error.exception))

    def test_world_readable_and_malformed_input_rejected(self):
        module=self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'routing.json';file.write_text('{}');os.chmod(file,0o644)
            with self.assertRaisesRegex(ValueError,'ROUTING_PERMISSIONS'):
                module.load_routing(str(file))
            os.chmod(file,0o600)
            with self.assertRaisesRegex(ValueError,'ROUTING_SCHEMA'):
                module.load_routing(str(file))
            file.write_text('{invalid')
            with self.assertRaisesRegex(ValueError,'ROUTING_SCHEMA'):
                module.load_routing(str(file))

    def test_phone_expression_is_not_an_executable_or_sip_destination(self):
        module=self.load_module()
        for value in ('sip:someone@example.com','https://example.com','+8210;curl example.com',123):
            with self.assertRaisesRegex(ValueError,'ROUTING_NUMBER'):
                module.normalize_number(value)

    def test_runtime_preflight_validates_roles_without_starting_a_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name in ('clawops.env','bridge.env'):
                (root/name).write_text('')
            routing=root/'routing.json'
            routing.write_text(json.dumps({'allowedNumbers':['01000000001','01000000002'],
                'citizenNumbers':{'citizen-a':'01000000001'},'institutionNumbers':{'institution-a':'01000000002'}}))
            os.chmod(routing,0o600)
            result=subprocess.run(['python3',str(SCRIPT.parent/'run-care-runtime.py'),'coordination-check'],
                env={**os.environ,'CARE_SECRET_DIR':str(root),'COORDINATION_ROUTING_PATH':str(routing)},capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('roles=2',result.stdout)
            self.assertNotIn('01000000001',result.stdout+result.stderr)


if __name__ == '__main__':
    unittest.main()

class PublicRoutingTests(unittest.TestCase):
    def test_explicit_demo_mapping_and_public_intake_preserve_role_overlap(self):
        import sys
        sys.path.insert(0,str(SCRIPT.parent))
        from coordination_config import load_routing
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'routing.json'
            p.write_text(json.dumps({'allowedNumbers':['01000000001','01000000002'],
                'citizenNumbers':{'old':'01000000001'},'institutionNumbers':{'i':'01000000002'},
                'demoCallers':{'01000000001':'demo-person','01000000002':'demo-person'},
                'publicIntake':True,'demoTime':'23:00'}));p.chmod(0o600)
            result=load_routing(p)
            self.assertEqual(result['demoCallers']['+821000000002'],'demo-person')
            self.assertTrue(result['publicIntake'])
            self.assertEqual(result['demoTime'],'23:00')

    def test_upgrade_existing_routing_reuses_numbers_without_prompting(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'routing.json'
            p.write_text(json.dumps({'allowedNumbers':['+821000000001','+821000000002'],
                'citizenNumbers':{'old':'+821000000001'},'institutionNumbers':{'i':'+821000000002'}}));p.chmod(0o600)
            result=subprocess.run(['python3',str(SCRIPT.parent/'configure-phone-roles.py'),
                '--routing-file',str(p),'--reuse-existing','--demo-citizen-ref','demo-person','--demo-time','23:00','--public-intake'],
                stdin=subprocess.DEVNULL,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            data=json.loads(p.read_text())
            self.assertEqual(data['demoCallers'],{'+821000000001':'demo-person','+821000000002':'demo-person'})
            self.assertTrue(data['publicIntake'])
            self.assertNotIn('01000000001',result.stdout+result.stderr)
            self.assertEqual(p.stat().st_mode & 0o777,0o600)
