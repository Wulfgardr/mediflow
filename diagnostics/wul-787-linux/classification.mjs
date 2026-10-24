import fs from 'node:fs';
import path from 'node:path';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const check = (value, message) => { if (!value) throw new Error(message); };

export function assessExpectedRedErrors(result, fixtureCallsite) {
  const errors = result.errors ?? [];
  const normalized = errors.map(error => (error.message ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim());
  const kinds = normalized.map((message, index) => {
    if ('cause' in errors[index]) return 'unapproved';
    if (message === 'Test timeout of 45000ms exceeded.') return 'test-timeout';
    const fixtureFrame = /^\s*at Locator\.locator\.isEnabled \((.+\/e2e\/fixtures\/official-lock-interleaving\.ts):([1-9][0-9]*):([1-9][0-9]*)\)$/m.exec(message);
    const location = errors[index].location;
    const matchesFixtureLocation = fixtureFrame && location?.file === fixtureFrame[1]
      && location.line === Number(fixtureFrame[2]) && location.column === Number(fixtureFrame[3])
      && location.line === fixtureCallsite?.line && location.column === fixtureCallsite?.column;
    if (/^Error: locator\.(?:isEnabled|nativeEnabled): (?:Target page, context or browser has been closed|Test timeout of 45000ms exceeded\.)\nCall log:\n\s*- waiting for getByRole\('button', \{ name: 'Rinnova accesso', exact: true \}\)/.test(message)
      && matchesFixtureLocation
      && /^\s*at unlockIfNeeded \([^\n]+\/e2e\/utils\.ts:151:[1-9][0-9]*\)$/m.test(message)
      && !message.includes('[cause]:') && !('cause' in errors[index])) return 'native-renew-isEnabled';
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
// Observation is preserved independently of the causal RED contract.
export function assessOfficialObservation(capture) {
  const observation = capture?.observation;
  const diagnosticErrors = [];
  if (!observation) return { available: false, complete: false,
    diagnosticErrors: ['Official passive observation absent'], origin: 'not established' };
  const compatible = observation.schemaVersion === 'mediflow.fixture.official-lock-observation.v1'
    && observation.compatibility?.playwright === '1.58.2' && observation.compatibility?.existingConnection === true;
  const restored = observation.restoration?.owned === true && observation.restoration?.descriptorRestored === true;
  const complete = compatible && restored && observation.dropped === 0 && observation.truncated === false
    && observation.observerErrors === 0 && observation.contextUnavailable === 0 && observation.contextChanged === false;
  if (!compatible) diagnosticErrors.push('Official passive observer incompatible');
  if (!restored) diagnosticErrors.push('Official passive observer restoration incomplete/conflicted');
  if (observation.dropped !== 0 || observation.truncated !== false) diagnosticErrors.push('Official passive observation truncated');
  if (observation.observerErrors !== 0 || observation.contextUnavailable !== 0) diagnosticErrors.push('Official passive observer recorded errors');
  if (observation.contextChanged !== false) diagnosticErrors.push('Official page/session context changed');
  return { available: true, compatible, restored, complete, diagnosticErrors,
    contextChanged: observation.contextChanged, missingInitiators: observation.missingInitiators,
    missingStacks: observation.missingStacks, unavailableParents: observation.unavailableParents,
    omittedScripts: observation.omittedScripts, origin: 'not established by the diagnostic classifier' };
}
export function preserveOfficialObservation(phaseDir) {
  const root = path.join(phaseDir, 'test-output');
  const captures = fs.existsSync(root) ? findFiles(root, 'interleaving.json') : [];
  const capture = captures.length === 1 ? read(captures[0]) : null;
  const review = assessOfficialObservation(capture);
  if (captures.length !== 1) review.diagnosticErrors.push('Official capture absent/ambiguous');
  const preserved = { captureCount: captures.length, review, observation: capture?.observation ?? null,
    finalLockRequests: capture?.lockRequests ?? null,
    checkpoint: capture?.events?.find(event => event.event === 'observable-block-precondition') ?? null };
  fs.writeFileSync(path.join(phaseDir, 'official-observation.json'), JSON.stringify(preserved, null, 2) + '\n', { flag: 'wx' });
  return review;
}
function cleanPassed(result) {
  return result.status === 'passed' && (result.errors ?? []).length === 0 && result.error == null;
}
export function assessGreenTransition(capture, result) {
  const issues = [];
  const requireProperty = (value, message) => { if (!value) issues.push(message); };
  const events = Array.isArray(capture.events) ? capture.events : [];
  const matching = name => events.filter(event => event?.event === name);
  const completions = matching('green-observable-completion');
  const completion = completions.length === 1 ? completions[0] : null;
  const index = completion ? events.indexOf(completion) : -1;
  const prefix = completion ? events.slice(0, index + 1) : [];
  const tail = completion ? events.slice(index + 1) : null;
  const countRequests = list => ({
    lock: list.filter(event => event?.event === 'request' && event.pathname === '/api/auth/lock').length,
    login: list.filter(event => event?.event === 'request' && event.pathname === '/api/auth/login').length,
  });
  const all = countRequests(events);
  const before = completion ? countRequests(prefix) : null;
  const after = tail ? countRequests(tail) : null;
  const held = matching('real-receipt-held');
  const delivered = matching('real-receipt-delivered');
  const pin = matching('native-pin-expect-entered');
  const visible = matching('native-renew-isVisible-result');
  const release = matching('delivery-release');
  const disposeEntered = matching('fixture-dispose-entered');
  const disposed = matching('fixture-disposed');
  requireProperty(cleanPassed(result), 'GREEN result or additional result/hook/teardown error');
  requireProperty(Array.isArray(capture.events) && events.length > 0, 'Missing fixture events');
  requireProperty(events.every((event, i) => event && Number.isSafeInteger(event.seq) && event.seq > 0
    && Number.isFinite(event.nodeMonotonicMs) && event.nodeMonotonicMs >= 0
    && (!i || event.seq > events[i - 1].seq && event.nodeMonotonicMs >= events[i - 1].nodeMonotonicMs)),
  'Incoherent fixture event order');
  requireProperty(completions.length === 1, 'Completion absent or ambiguous');
  requireProperty(events.every(event => event?.event !== 'request'
    || ['/api/auth/lock', '/api/auth/login'].includes(event.pathname)), 'Unknown counted request');
  requireProperty(Number.isSafeInteger(capture.lockRequests) && capture.lockRequests === all.lock
    && Number.isSafeInteger(capture.loginRequests) && capture.loginRequests === all.login,
  'Integral request counters disagree with fixture events');
  requireProperty(before?.lock === 1, 'Additional lock before completion');
  requireProperty(before?.login === 1, 'Expected one login through completion');
  requireProperty(capture.confirmedReceipt === true && !capture.routeError && capture.held === false,
    'Fixture receipt/route failure or held receipt');
  requireProperty(held.length === all.lock && delivered.length === all.lock
    && held.every(event => event.status === 200 && event.etagPresent === true), 'Incomplete or invalid receipts across capture');
  requireProperty(completion && prefix.filter(event => event.event === 'real-receipt-held').length === before.lock
    && prefix.filter(event => event.event === 'real-receipt-delivered').length === before.lock,
  'Receipts incomplete through completion');
  requireProperty(capture.releaseSource === 'pin-ready-assertion' && capture.expectCalls === 1
    && capture.visibleCalls === 1 && capture.enabledCalls === 0,
  'GREEN native query counters/release mismatch');
  requireProperty(pin.length === 1 && visible.length === 1 && visible[0].visible === false
    && matching('native-renew-isEnabled-entered').length === 0 && release.length === 1
    && release[0].source === 'pin-ready-assertion'
    && events.indexOf(pin[0]) < events.indexOf(release[0])
    && events.indexOf(release[0]) < events.indexOf(visible[0]) && events.indexOf(visible[0]) < index,
  'GREEN release/native query sequence not observed');
  requireProperty(disposeEntered.length === 1 && disposed.length === 1
    && index < events.indexOf(disposeEntered[0]) && events.indexOf(disposeEntered[0]) < events.indexOf(disposed[0]),
  'Fixture cleanup absent, ambiguous or before completion');
  const observation = assessOfficialObservation(capture);
  for (const issue of observation.diagnosticErrors) issues.push(issue);
  return { accepted: issues.length === 0, issues, completion,
    counts: { all, throughCompletion: before, afterCompletion: after },
    afterCompletion: tail === null ? null : { events: tail, requests: tail.filter(event => event.event === 'request'),
      interpretation: 'Preserved without caller attribution or a claim that these requests are harmless.' },
    receipts: { held: held.length, delivered: delivered.length }, observation,
    primaryError: result.error ?? null, errors: result.errors ?? [] };
}
export function classify(phase, command, phaseDir, manifest) {
  const report = read(path.join(phaseDir, 'report.json'));
  check((report.errors ?? []).length === 0, phase + ': runner/cleanup error');
  const tests = results(report);
  check(tests.length === (phase === 'consumers' ? 2 : 1), phase + ': wrong selection/count');
  for (const test of tests) check(test.results.length === 1 && test.results[0].retry === 0, phase + ': unexpected retry');
  check(report.config.projects.every(project => project.outputDir === path.join(phaseDir, 'test-output')), 'Reporter output identity mismatch');
  if (phase === 'consumers') {
    check(command.code === 0 && tests.every(test => cleanPassed(test.results[0])), 'Consumer failure');
    return { phase, outcome: 'PASS', tests: tests.map(test => test.title) };
  }
  check(tests[0].title === manifest.title, 'Official UI test identity mismatch');
  const captures = findFiles(path.join(phaseDir, 'test-output'), 'interleaving.json');
  check(captures.length === 1, phase + ': fixture capture absent/ambiguous');
  const capture = read(captures[0]);
  const status = tests[0].results[0];
  if (phase === 'green') {
    const transition = assessGreenTransition(capture, status);
    fs.writeFileSync(path.join(phaseDir, 'green-transition.json'), JSON.stringify(transition, null, 2) + '\n', { flag: 'wx' });
    check(command.code === 0 && transition.accepted, 'GREEN passage not qualifying; see green-transition.json');
    return { phase, outcome: 'PASS', tests: [manifest.title], transition };
  }
  check(capture.confirmedReceipt && !capture.routeError && capture.lockRequests === 1, 'Fixture receipt/request failure');
  check(capture.events.some(event => event.event === 'fixture-disposed'), 'Fixture cleanup incomplete');
  check(assessOfficialObservation(capture).diagnosticErrors.length === 0, 'Official passive observation incomplete; see official-observation.json');
  const errorReview = assessExpectedRedErrors(status, manifest.fixtureCallsite);
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
  const nativeFixtureTeardownTimeout = (result.errors ?? []).some(error =>
    /^Tearing down "[^"\r\n]+" exceeded the test timeout of [0-9]+ms\.(?:\r?\n|$)/.test(
      (error.message ?? '').replace(/\x1b\[[0-9;]*m/g, '')));
  if (nativeFixtureTeardownTimeout)
    outcome.diagnosticErrors.push('Native Playwright fixture teardown timeout; see retained result.errors');
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
