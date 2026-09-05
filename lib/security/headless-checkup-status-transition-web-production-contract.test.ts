/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('./headless-checkup-status-transition-web-production.ts', import.meta.url),
  'utf8',
);

test('authorizes a replacement before retiring the current Checkup operation', () => {
  const begin = source.indexOf('export async function selectCheckupStatusTransitionForHostV1');
  const end = source.indexOf('export async function readCheckupStatusTransitionProposalV1');
  const selection = source.slice(begin, end);
  const issue = selection.indexOf('headlessCheckupActiveRoleSessionGrant.issue');
  const authorize = selection.indexOf('headlessCheckupActiveRoleSessionGrant.withCurrentRequest');
  const supervisor = selection.indexOf('portableSupervisorCheckupWebSessionPortV1.matchesCurrentContext');
  const retire = selection.indexOf('\n    disposeState();');
  const publish = selection.indexOf('\n    state = current;');

  assert.ok(begin >= 0 && end > begin);
  assert.ok(issue >= 0 && authorize > issue);
  assert.ok(supervisor > authorize && retire > supervisor,
    'the existing operation survives a role or full Supervisor-context mismatch');
  assert.ok(publish > retire, 'the candidate is published only after authorized retirement');
});

test('does not emit caught exception details from the production selection boundary', () => {
  assert.doesNotMatch(source, /error\.(?:message|name)|String\(error\)/u);
});
