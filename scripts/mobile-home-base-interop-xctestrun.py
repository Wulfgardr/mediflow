#!/usr/bin/env python3
# @Codex
"""Create a private, relocatable xctestrun from an existing independent build.

Does not build, install, boot, launch, change the project, or contact a host.
The JSON descriptor stays in the test runner; app credentials are entered by UI.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import stat


PHASE_METHODS = {
    'workflow': 'testRealPairedHostWorkflow',
    'reread': 'testRealPairedOtherClientReread',
    'lock': 'testRealPairedLockClearsClinicalPresentationBeforeLogoutCompletes',
    'therapy': 'testRealPairedTherapyCRUDWithIndependentRereads',
    'checkup': 'testRealPairedCheckupCRUDWithIndependentRereads',
    'observation': 'testRealPairedObservationCRUDWithIndependentRereads',
    'services': 'testRealPairedServiceAndItemLifecycleWithIndependentRereads',
    'prosthetic': 'testRealPairedProstheticCreateAndTestWithIndependentRereads',
    'scale': 'testRealPairedScaleSubmissionWithIndependentReread',
    'patient': 'testRealPairedNewPatientLifecycleWithIndependentRereads',
    'cas-contender': 'testRealPairedDiaryCASContenderPreservesDraftUntilExplicitSave',
    'cas-peer': 'testRealPairedDiaryCASPeerWritesAndRereadsReconciledEntry',
}


def phase_input(phase, address=None, title=None, entry_id=None, population=None, cas=None):
    """Bind opt-in phases to positive prior HTTP/UI fixture evidence."""
    if phase not in PHASE_METHODS:
        raise ValueError('Unknown interoperability phase.')
    if phase in ('reread', 'lock') and not (address and title):
        raise ValueError('Reread/lock requires the prior exact address and diary title.')
    if phase == 'lock' and (not entry_id or type(population) is not int or population < 1):
        raise ValueError('Lock requires a persisted diary ID and a positive in-range population count.')
    if phase != 'lock' and (entry_id is not None or population is not None):
        raise ValueError('Lock-only expectations must select the lock phase explicitly.')
    is_cas = phase in ('cas-contender', 'cas-peer')
    if is_cas != (cas is not None):
        raise ValueError('A CAS phase requires its explicit, previously observed case.')
    if cas is not None:
        if not isinstance(cas, dict) or cas.get('schemaVersion') != 1 or cas.get('synthetic') is not True:
            raise ValueError('CAS case must be synthetic v1.')
        for key in ['fixtureId', 'groupID', 'patientId', 'entryID', 'baseTitle', 'baseBody']:
            if not isinstance(cas.get(key), str) or not cas[key].strip():
                raise ValueError('CAS case needs exact positive prior UI/read values.')
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', cas['groupID']):
            raise ValueError('CAS group ID must be bounded and artifact safe.')
        if type(cas.get('baseVersion')) is not int or cas['baseVersion'] < 1:
            raise ValueError('CAS case requires its actual prior version.')
        if cas.get('baseType') not in ['note', 'visit', 'phone', 'other'] or '\n' in cas['baseBody'] or '\r' in cas['baseBody']:
            raise ValueError('CAS requires the observed one-paragraph manual entry fixture.')
    result = {key: value for key, value in (
        ('expectedAddress', address), ('expectedDiaryTitle', title),
        ('expectedDiaryID', entry_id), ('expectedPopulationInRange', population),
    ) if value is not None}
    if cas is not None:
        result['cas'] = cas
    return result


def rebase(value, test_root):
    if isinstance(value, str):
        return value.replace('__TESTROOT__', str(test_root))
    if isinstance(value, list):
        return [rebase(item, test_root) for item in value]
    if isinstance(value, dict):
        return {key: rebase(item, test_root) for key, item in value.items()}
    return value


def configure_run(source, test_root, payload, method):
    result = rebase(source, test_root)
    if 'TestConfigurations' in result:
        targets = [target for config in result['TestConfigurations'] if config.get('IsEnabled', True)
                   for target in config['TestTargets']]
    else:
        targets = [value for key, value in result.items() if not key.startswith('__') and isinstance(value, dict)]
    matches = [target for target in targets if target.get('BlueprintName') == 'MediFlowMobileAppUITests'
               or target.get('ProductModuleName') == 'MediFlowMobileAppUITests']
    if len(matches) != 1:
        raise ValueError('Expected exactly one enabled MediFlowMobileAppUITests target.')
    target = matches[0]
    if target.get('UseDestinationArtifacts'):
        raise ValueError('Installed-runner reuse is not accepted; use artifacts from the exact build.')
    if any(key.startswith('MEDIFLOW_') for key in target.get('UITargetAppEnvironmentVariables', {})):
        raise ValueError('The source run must not inject MediFlow app overrides.')
    # The platform manpage documents EnvironmentVariables for the test host,
    # separate from UITargetAppEnvironmentVariables. Never inject autologin here.
    target.setdefault('EnvironmentVariables', {})['MEDIFLOW_INTEROP_INPUT'] = json.dumps(payload, separators=(',', ':'))
    target['OnlyTestIdentifiers'] = [f'MediFlowMobileAppUITests/{method}']
    target['SkipTestIdentifiers'] = []
    target['UserAttachmentLifetime'] = 'keepAlways'
    target['SystemAttachmentLifetime'] = 'keepAlways'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--descriptor', required=True, type=Path)
    parser.add_argument('--client', choices=['ios', 'ipados'], required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--phase', choices=list(PHASE_METHODS), default='workflow')
    parser.add_argument('--expected-address')
    parser.add_argument('--expected-diary-title')
    parser.add_argument('--expected-diary-id')
    parser.add_argument('--expected-population-in-range', type=int)
    parser.add_argument('--cas-case', type=Path)
    parser.add_argument('--previous-descriptor', action='append', type=Path, default=[])
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    info = args.descriptor.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        parser.error('Descriptor must be a private regular file (0600).')
    try:
        descriptor = json.loads(args.descriptor.read_text())
    except (ValueError, OSError):
        parser.error('Descriptor could not be read as JSON.')
    if descriptor.get('schemaVersion') != 1 or descriptor.get('synthetic') is not True:
        parser.error('An explicit synthetic v1 descriptor is required.')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', args.run_id):
        parser.error('Run ID must be a bounded artifact-safe marker.')
    cas = None
    if args.cas_case:
        case_info = args.cas_case.lstat()
        if not stat.S_ISREG(case_info.st_mode) or case_info.st_mode & 0o077:
            parser.error('CAS case must be a private regular file.')
        try:
            cas = json.loads(args.cas_case.read_text())
        except (ValueError, OSError):
            parser.error('CAS case could not be read as JSON.')
        if not isinstance(cas, dict) or cas.get('fixtureId') != descriptor['fixtureId'] or cas.get('patientId') != descriptor['patient']['id']:
            parser.error('CAS case belongs to another fixture or patient.')
    try:
        expectations = phase_input(args.phase, args.expected_address, args.expected_diary_title,
                                   args.expected_diary_id, args.expected_population_in_range, cas)
    except ValueError as error:
        parser.error(str(error))
    payload = {
        'schemaVersion': 1, 'synthetic': True, 'fixtureId': descriptor['fixtureId'],
        'runID': args.run_id, 'clientPlatform': args.client,
        'host': descriptor['host'], 'operator': descriptor['operator'], 'patient': descriptor['patient'],
        'client': descriptor['clients'][args.client],
    }
    payload.update(expectations)
    payload['previousPairings'] = []
    for previous_path in args.previous_descriptor:
        previous_info = previous_path.lstat()
        if not stat.S_ISREG(previous_info.st_mode) or previous_info.st_mode & 0o077:
            parser.error('Previous descriptor must be a private regular file (0600).')
        try:
            previous = json.loads(previous_path.read_text())
        except (ValueError, OSError):
            parser.error('Previous descriptor could not be read as JSON.')
        if previous.get('schemaVersion') != 1 or previous.get('synthetic') is not True:
            parser.error('Previous pairing provenance must also be explicit and synthetic.')
        payload['previousPairings'].append({
            'serverURL': previous['host']['httpsURL'], 'id': previous['clients'][args.client]['id'],
        })
    method = PHASE_METHODS[args.phase]
    with args.source.open('rb') as source:
        original = plistlib.load(source)
    configured = configure_run(original, args.source.resolve().parent, payload, method)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        plistlib.dump(configured, output)
    print(f'Private xctestrun created: {args.output}')


if __name__ == '__main__':
    main()
