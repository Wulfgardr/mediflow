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

    def test_lock_requires_positive_prior_fixture_values_and_explicit_phase(self):
        for values in [
            ('lock', None, 'saved', 'entry', 1),
            ('lock', 'address', '', 'entry', 1),
            ('lock', 'address', 'saved', None, 1),
            ('lock', 'address', 'saved', 'entry', 0),
            ('lock', 'address', 'saved', 'entry', True),
            ('reread', 'address', 'saved', 'entry', 1),
        ]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                module.phase_input(*values)

    def test_lock_expectations_stay_in_runner_without_app_flags(self):
        payload = module.phase_input('lock', 'Synthetic address', 'Synthetic saved entry', 'fixture-entry', 2)
        result = module.configure_run(self.source(), Path('/own-build'), payload, module.PHASE_METHODS['lock'])
        target = result['TestConfigurations'][0]['TestTargets'][0]
        self.assertEqual(payload['expectedDiaryID'], 'fixture-entry')
        self.assertEqual(payload['expectedPopulationInRange'], 2)
        self.assertEqual(target['OnlyTestIdentifiers'], [
            'MediFlowMobileAppUITests/testRealPairedLockClearsClinicalPresentationBeforeLogoutCompletes'])
        self.assertEqual(target['UITargetAppEnvironmentVariables'], {'OS_ACTIVITY_MODE': 'disable'})
        self.assertEqual(module.phase_input('workflow'), {})
        self.assertEqual(module.phase_input('reread', 'a', 't'), {'expectedAddress': 'a', 'expectedDiaryTitle': 't'})

    def test_module_phases_select_the_exact_method_without_injecting_app_state(self):
        for phase in ['patient', 'therapy', 'checkup', 'observation', 'services', 'prosthetic', 'scale']:
            with self.subTest(phase=phase):
                self.assertEqual(module.phase_input(phase), {})
                result = module.configure_run(self.source(), Path('/own-build'),
                                              {'synthetic': True, 'runID': 'unit-only'}, module.PHASE_METHODS[phase])
                target = result['TestConfigurations'][0]['TestTargets'][0]
                self.assertEqual(target['OnlyTestIdentifiers'], [f'MediFlowMobileAppUITests/{module.PHASE_METHODS[phase]}'])
                self.assertEqual(target['UITargetAppEnvironmentVariables'], {'OS_ACTIVITY_MODE': 'disable'})


if __name__ == '__main__':
    unittest.main()
