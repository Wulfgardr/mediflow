# @Codex
import importlib.util
from pathlib import Path
import unittest

module_path = Path(__file__).with_name('mobile-home-base-interop-xctestrun.py')
spec = importlib.util.spec_from_file_location('interop_xctestrun', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrivateXctestrunTests(unittest.TestCase):
    def source(self):
        return {'TestConfigurations': [{'IsEnabled': True, 'TestTargets': [{
            'BlueprintName': 'MediFlowMobileAppUITests',
            'TestHostPath': '__TESTROOT__/Debug-iphonesimulator/Runner.app',
            'TestBundlePath': '__TESTHOST__/PlugIns/Tests.xctest',
            'UITargetAppPath': '__TESTROOT__/Debug-iphonesimulator/MediFlow.app',
            'TestingEnvironmentVariables': {'DYLD_LIBRARY_PATH': '__TESTROOT__/Debug-iphonesimulator'},
            'UITargetAppEnvironmentVariables': {'OS_ACTIVITY_MODE': 'disable'},
        }]}]}

    def test_rebases_build_paths_and_keeps_credentials_in_test_host_only(self):
        original = self.source()
        result = module.configure_run(original, Path('/own-build'), {'synthetic': True, 'client': {'token': 'unit-only'}},
                                      'testRealPairedHostWorkflow')
        target = result['TestConfigurations'][0]['TestTargets'][0]
        self.assertEqual(target['TestHostPath'], '/own-build/Debug-iphonesimulator/Runner.app')
        self.assertEqual(target['TestBundlePath'], '__TESTHOST__/PlugIns/Tests.xctest')
        self.assertEqual(target['TestingEnvironmentVariables']['DYLD_LIBRARY_PATH'], '/own-build/Debug-iphonesimulator')
        self.assertIn('MEDIFLOW_INTEROP_INPUT', target['EnvironmentVariables'])
        self.assertEqual(target['UITargetAppEnvironmentVariables'], {'OS_ACTIVITY_MODE': 'disable'})
        self.assertEqual(target['OnlyTestIdentifiers'], ['MediFlowMobileAppUITests/testRealPairedHostWorkflow'])
        self.assertNotIn('EnvironmentVariables', original['TestConfigurations'][0]['TestTargets'][0])

    def test_refuses_ambiguous_missing_or_installed_only_targets(self):
        for mode in ['duplicate', 'missing', 'installed', 'mocked']:
            source = self.source()
            targets = source['TestConfigurations'][0]['TestTargets']
            if mode == 'duplicate':
                targets.append(dict(targets[0]))
            elif mode == 'missing':
                targets[0]['BlueprintName'] = 'OtherTests'
            elif mode == 'installed':
                targets[0]['UseDestinationArtifacts'] = True
            elif mode == 'mocked':
                targets[0]['UITargetAppEnvironmentVariables']['MEDIFLOW_APPLE_UITEST_PATIENTS'] = '1'
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                module.configure_run(source, Path('/own-build'), {}, 'testRealPairedHostWorkflow')


if __name__ == '__main__':
    unittest.main()
