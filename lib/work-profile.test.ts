/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
    applyWorkProfileCommand, emptyWorkProfileState, EMPTY_WORK_PROFILE_ANSWERS,
    parseWorkProfileCommand, recommendWorkProfile, workProfilePreview, workProfileStartArea,
    type WorkProfileDraft, type WorkProfileState,
} from './work-profile.ts';

const draft: WorkProfileDraft = { source: 'guided', profile: 'agent', step: 3,
    answers: { activity: 'records', interaction: 'delegate', platform: 'windows' } };
function act(state: WorkProfileState, action: 'save-draft' | 'confirm' | 'rollback' | 'discard-draft', value?: WorkProfileDraft) {
    return applyWorkProfileCommand(state, { id: randomUUID(), expectedRevision: state.revision, action, ...(value ? { draft: value } : {}) });
}

test('explicit preference determines the recommendation independently of the declared platform', () => {
    for (const platform of ['macos', 'windows', 'linux', 'other'] as const) {
        for (const [interaction, expected] of [['screens', 'interactive'], ['delegate', 'agent'], ['mixed', 'both']] as const) {
            const answers = { activity: 'records' as const, interaction, platform };
            assert.equal(recommendWorkProfile(answers).profile, expected);
            assert.ok(recommendWorkProfile(answers).reason);
        }
    }
    assert.equal(recommendWorkProfile({ ...draft.answers, interaction: 'unsure', activity: 'repetitive' }).profile, 'both');
    assert.equal(recommendWorkProfile({ ...draft.answers, interaction: 'unsure' }).profile, 'interactive');
});

test('only fixed nonclinical enums enter the record, and confirmation needs a complete preview', () => {
    const command = { id: randomUUID(), expectedRevision: 0, action: 'save-draft', draft };
    assert.throws(() => parseWorkProfileCommand({ ...command, role: 'admin' }));
    assert.throws(() => parseWorkProfileCommand({ ...command, draft: { ...draft, answers: { ...draft.answers, profession: 'doctor' } } }));
    assert.throws(() => parseWorkProfileCommand({ ...command, draft: { ...draft, answers: { ...draft.answers, activity: 'free text' } } }));
    assert.throws(() => act(emptyWorkProfileState(), 'confirm'), /preview_required/);
    for (const incomplete of [{ ...draft, step: 1 }, { ...draft, answers: EMPTY_WORK_PROFILE_ANSWERS }]) {
        assert.throws(() => act(act(emptyWorkProfileState(), 'save-draft', incomplete), 'confirm'), /preview_required/);
    }
});

test('manual preview needs no answers, and profile is an entry preference without agent readiness', () => {
    const manual = { ...draft, source: 'manual' as const, answers: EMPTY_WORK_PROFILE_ANSWERS };
    const state = act(act(emptyWorkProfileState(), 'save-draft', manual), 'confirm');
    assert.equal(state.active?.profile, 'agent');
    assert.equal(workProfileStartArea(state.active), 'governance');
    assert.match(workProfilePreview(state.active!).agentNote, /non collega né verifica/);
    assert.equal(workProfileStartArea({ ...draft, profile: 'interactive' }), 'incarico');
    assert.equal(workProfileStartArea({ ...draft, profile: 'both' }), 'turno');
    assert.equal(workProfileStartArea(null), 'turno');
});

test('replay is idempotent, stale revisions conflict and repeated selection preserves rollback', () => {
    const preview = act(emptyWorkProfileState(), 'save-draft', draft);
    const command = { id: randomUUID(), expectedRevision: preview.revision, action: 'confirm' as const };
    const active = applyWorkProfileCommand(preview, command);
    assert.equal(applyWorkProfileCommand(active, command), active);
    assert.throws(() => applyWorkProfileCommand(active, { ...command, action: 'rollback' }), /conflict/);
    assert.throws(() => applyWorkProfileCommand(active, { ...command, id: randomUUID() }), /conflict/);
    const changed = act(act(active, 'save-draft', { ...draft, profile: 'both' }), 'confirm');
    const repeated = act(act(changed, 'save-draft', { ...draft, profile: 'both' }), 'confirm');
    assert.equal(repeated.previous?.profile, 'agent');
    assert.equal(act(repeated, 'rollback').active?.profile, 'agent');
    const reset = act(active, 'rollback');
    assert.equal(reset.active, null);
    assert.equal(reset.canRollback, false);
    assert.throws(() => act(reset, 'rollback'), /rollback_unavailable/);
});

test('interrupted draft remains separate from active configuration and can be discarded', () => {
    const active = act(act(emptyWorkProfileState(), 'save-draft', draft), 'confirm');
    const editing = act(active, 'save-draft', { ...draft, profile: 'interactive', step: 1 });
    const resumed = JSON.parse(JSON.stringify(editing));
    assert.equal(resumed.draft.step, 1);
    assert.deepEqual(resumed.active, active.active);
    const discarded = act(resumed, 'discard-draft');
    assert.equal(discarded.draft, null);
    assert.deepEqual(discarded.active, active.active);
});
