import fs from 'node:fs';
import path from 'node:path';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const check = (value, message) => { if (!value) throw new Error(message); };

export function assessExpectedRedErrors(result) {
  const errors = result.errors ?? [];
  const normalized = errors.map(error => (error.message ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim());
  const kinds = normalized.map(message => {
    if (message === 'Test timeout of 45000ms exceeded.') return 'test-timeout';
    if (/^Error: locator\.isEnabled: (?:Target page, context or browser has been closed|Test timeout of 45000ms exceeded\.)\nCall log:\n\s*- waiting for getByRole\('button', \{ name: 'Rinnova accesso', exact: true \}\)/.test(message)
      && /at unlockIfNeeded \([^\n]*[\/]e2e[\/]utils\.ts:151:46\)/.test(message)
      && !message.includes('[cause]:')) return 'native-renew-isEnabled';
    return 'unapproved';
  });
  return { accepted: errors.length === 2 && kinds.filter(kind => kind === 'test-timeout').length === 1
      && kinds.filter(kind => kind === 'native-renew-isEnabled').length === 1,
    primaryError: result.error ?? null, errors, kinds };
}

function results(report) {
  return (report.suites ?? []).flatMap(function visit(suite) {
    return [...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => ({ title: spec.title, ...test }))),
      ...(suite.suites ?? []).flatMap(visit)];
  });
}
function findFiles(root, name) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? findFiles(file, name) : entry.name === name ? [file] : [];
  });
}
export function classify(phase, command, phaseDir, manifest) {
  const report = read(path.join(phaseDir, 'report.json'));
  check((report.errors ?? []).length === 0, phase + ': runner/cleanup error');
  const tests = results(report);
  check(tests.length === (phase === 'consumers' ? 2 : 1), phase + ': wrong selection/count');
  for (const test of tests) check(test.results.length === 1 && test.results[0].retry === 0, phase + ': unexpected retry');
  check(report.config.projects.every(project => project.outputDir === path.join(phaseDir, 'test-output')), 'Reporter output identity mismatch');
  if (phase === 'consumers') {
    check(command.code === 0 && tests.every(test => test.results[0].status === 'passed'), 'Consumer failure');
    return { phase, outcome: 'PASS', tests: tests.map(test => test.title) };
  }
  check(tests[0].title === manifest.title, 'Official UI test identity mismatch');
  const captures = findFiles(path.join(phaseDir, 'test-output'), 'interleaving.json');
  check(captures.length === 1, phase + ': fixture capture absent/ambiguous');
  const capture = read(captures[0]);
  check(capture.confirmedReceipt && !capture.routeError && capture.lockRequests === 1, 'Fixture receipt/request failure');
  check(capture.events.some(event => event.event === 'fixture-disposed'), 'Fixture cleanup incomplete');
  const status = tests[0].results[0];
  if (phase === 'green') {
    check(command.code === 0 && status.status === 'passed'
      && capture.releaseSource === 'pin-ready-assertion' && capture.expectCalls === 1
      && capture.enabledCalls === 0 && capture.loginRequests === 1
      && capture.events.some(event => event.event === 'green-observable-completion'), 'GREEN properties not met');
    return { phase, outcome: 'PASS', tests: [manifest.title] };
  }
  const errorReview = assessExpectedRedErrors(status);
  fs.writeFileSync(path.join(phaseDir, 'expected-red-errors.json'), JSON.stringify(errorReview, null, 2) + '\n', { flag: 'wx' });
  check(errorReview.accepted, phase + ': unexpected test/hook/fixture/teardown error; see expected-red-errors.json');
  const events = capture.events;
  const index = event => events.findIndex(item => item.event === event);
  const blocked = events.find(event => event.event === 'observable-block-precondition');
  check(command.code === 1 && ['failed', 'timedOut'].includes(status.status)
    && capture.releaseSource === 'renew-isVisible-true'
    && capture.expectCalls === 0 && capture.enabledCalls === 1 && capture.loginRequests === 0
    && events.some(event => event.event === 'native-renew-isVisible-result' && event.visible === true)
    && index('delivery-release') > index('native-renew-isVisible-result')
    && index('ready-between-native-queries') > index('delivery-release')
    && index('observable-block-precondition') > index('ready-between-native-queries')
    && blocked?.pinEnabled && blocked.renewCount === 0 && blocked.loginRequests === 0 && blocked.lockRequests === 1,
  phase + ': nonzero is not the expected observable driver RED');
  check(findFiles(path.join(phaseDir, 'test-output'), 'interleaving-before-isEnabled.png').length === 1,
    'Missing observed pre-block screenshot');
  return { phase, outcome: 'EXPECTED_RED', rawExit: command.code, tests: [manifest.title], errorReview };
}

// W baseline results are observations, never expected causal REDs.
function attachmentJson(result, name, phaseDir) {
  const attachments = (result.attachments ?? []).filter(item => item.name === name);
  check(attachments.length <= 1, 'Ambiguous diagnostic attachment: ' + name);
  if (!attachments.length) return null;
  const item = attachments[0];
  check(item.contentType === 'application/json', 'Unexpected diagnostic content type');
  if (item.body !== undefined) return JSON.parse(Buffer.from(item.body, 'base64').toString('utf8'));
  check(item.path && fs.realpathSync(item.path).startsWith(fs.realpathSync(phaseDir) + path.sep), 'Attachment escapes phase output');
  return read(item.path);
}
export function classifyBaseline(baseline, command, phaseDir) {
  const report = read(path.join(phaseDir, 'result.json'));
  check((report.errors ?? []).length === 0, baseline.phase + ': runner/teardown error');
  const tests = results(report);
  check(tests.length === 1 && tests[0].title === baseline.title, baseline.phase + ': wrong test selection');
  check(report.config.projects.every(project => project.outputDir === path.join(phaseDir, 'results')), 'Baseline output identity mismatch');
  check(tests[0].results.length === 1 && tests[0].results[0].retry === 0, 'Unexpected baseline repeat/retry');
  const result = tests[0].results[0];
  check((command.code === 0 && result.status === 'passed')
    || (command.code === 1 && ['failed', 'timedOut'].includes(result.status)), 'Baseline runner/status disagreement');
  const observation = attachmentJson(result, baseline.attachment, phaseDir);
  const outcome = { phase: baseline.phase, caseOutcome: result.status === 'passed' ? 'PASS' : 'FAIL',
    rawExit: command.code, test: baseline.title, status: result.status, primaryError: result.error ?? null, errors: result.errors ?? [],
    causalRed: false, diagnosticErrors: [], observation: { available: observation !== null } };
  const markedFailures = (result.errors ?? []).flatMap(error =>
    (error.message ?? '').match(/WUL787_DIAGNOSTIC_FAILURE\[[^\]]+\]/g) ?? []);
  outcome.diagnosticFailures = markedFailures;
  if (markedFailures.length) outcome.diagnosticErrors.push('Added observation operation failed: ' + markedFailures.join(', '));
  if (baseline.phase === 'per-data') {
    if (observation) {
      const complete = observation.schemaVersion === 1 && observation.viewport?.width === 320
        && observation.section !== null && observation.register !== null
        && observation.tableCount === 8 && observation.days?.length === 8;
      outcome.observation = { available: true, structurallyComplete: complete, geometry: observation,
        interpretation: 'Original assertion decides case outcome. PASS or different geometry is retained; no automatic fix.' };
      if (!complete) outcome.diagnosticErrors.push('Geometry attachment is structurally incomplete');
    }
  } else {
    const incompatible = /ANYDOC_PROTOCOL_PROBE_INCOMPATIBLE/.test(JSON.stringify(result.errors ?? []));
    if (observation?.compatibility) {
      const restored = observation.restoration?.protocolRestored === true && observation.restoration?.subscriptionRestored === true;
      const complete = !observation.truncated && observation.dropped === 0
        && observation.observerErrors === 0 && observation.pendingCommandCount === 0;
      outcome.observation = { available: true, compatibility: observation.compatibility,
        complete, truncated: observation.truncated, dropped: observation.dropped,
        observerErrors: observation.observerErrors, pendingCommandCount: observation.pendingCommandCount,
        cleanup: observation.restoration, events: observation.events, counts: observation.counts, limits: observation.limits };
      if (!restored) outcome.diagnosticErrors.push('Passive observer restoration incomplete/conflicted');
      if (observation.observerErrors !== 0) outcome.diagnosticErrors.push('Passive observer recorded internal errors');
      if (observation.compatibility.playwright !== '1.58.2') outcome.diagnosticErrors.push('Observer compatibility mismatch');
    } else {
      outcome.observation = { available: observation !== null, compatible: incompatible ? false : 'not established',
        complete: false, cleanup: 'not observed' };
      if (incompatible || outcome.caseOutcome === 'PASS') outcome.diagnosticErrors.push('Passive observer compatibility not established; not a product finding');
    }
    if (/ANYDOC_PROTOCOL_PROBE_RESTORE_CONFLICT/.test(JSON.stringify(result.errors ?? [])))
      outcome.diagnosticErrors.push('Observer restore conflict reported by case');
  }
  if (!observation && outcome.caseOutcome === 'PASS') outcome.diagnosticErrors.push('Passing case omitted required observation');
  // An earlier original assertion can fail before the probe is reached. Preserve it as FAIL/incomplete.
  return outcome;
}
