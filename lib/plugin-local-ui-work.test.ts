import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalUiWork, readLocalUiWorkScope } from './plugin-local-ui-work.ts';

const first = { request: '00000000-0000-0000-0000-000000000001', link: 'initial' };
const second = { request: '00000000-0000-0000-0000-000000000002', link: '00000000-0000-0000-0000-000000000003' };
const opening = { scope: first, intent: 'patient_insight', patientId: 'first', anchor: '#patient-insight' };

test('only the confirmed function and patient acquire the opening once', () => {
    const work = createLocalUiWork();
    assert.deepEqual(readLocalUiWorkScope(`${first.request}/${first.link}`), first);
    assert.equal(readLocalUiWorkScope(`${first.request}/wrong-link`), null);
    work.open(opening);
    assert.equal(work.begin('smart_import', 'first', assert.fail), null);
    assert.equal(work.begin('patient_insight', 'second', assert.fail), null);
    let interrupted = false;
    assert.ok(work.begin('patient_insight', 'first', () => { interrupted = true; }));
    assert.equal(work.begin('patient_insight', 'first', assert.fail), null);
    work.revoke(second.link);
    assert.equal(interrupted, false);
    work.revoke(first.link);
    assert.equal(interrupted, true);
});

test('changing the view discards an unused opening and completion releases cancellation', () => {
    const work = createLocalUiWork();
    work.open(opening);
    work.move('#diario');
    work.move(opening.anchor);
    assert.equal(work.begin(opening.intent, opening.patientId, assert.fail), null);
    work.open(opening);
    const finish = work.begin(opening.intent, opening.patientId, assert.fail);
    assert.ok(finish);
    finish();
    work.cancel(first.request);
    work.revoke(first.link);
    work.reset();
});

test('a stale request cancellation cannot retire another link or take its opening', () => {
    const work = createLocalUiWork();
    const stopped: string[] = [];
    work.open(opening);
    work.begin(opening.intent, opening.patientId, () => stopped.push('first'));
    work.open({ ...opening, scope: second });
    work.cancel(first.request);
    assert.deepEqual(stopped, ['first']);
    work.begin(opening.intent, opening.patientId, () => stopped.push('second'));
    work.cancel(first.request);
    assert.deepEqual(stopped, ['first']);
    work.revoke(second.link);
    work.revoke(second.link);
    assert.deepEqual(stopped, ['first', 'second']);
});

test('a late navigation from a revoked connection cannot re-arm generation', () => {
    const work = createLocalUiWork();
    work.revoke(first.link);
    work.open(opening);
    assert.equal(work.isRevoked(first), true);
    assert.equal(work.begin(opening.intent, opening.patientId, assert.fail), null);
    work.open({ ...opening, scope: second });
    assert.equal(work.isRevoked(second), false);
    assert.ok(work.begin(opening.intent, opening.patientId, assert.fail));
});
