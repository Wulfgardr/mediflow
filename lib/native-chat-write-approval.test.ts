import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeChatWriteApprovals, NativeChatWriteDenied } from './native-chat-write-approval.ts';

function setup() {
    let time = 0;
    const approvals = createNativeChatWriteApprovals<Readonly<{ kind: string }>>(() => time);
    const binding = { session: {}, scope: 'synthetic-scope', selection: 1, resource: 'synthetic-patient-a' };
    return { approvals, binding, at: (value: number) => { time = value; } };
}
const kind = 'synthetic-write';
{
    test(`${kind}: one authorization cannot issue two previews or consume twice`, () => {
        const { approvals, binding } = setup();
        const view = approvals.open(binding);
        const preview = approvals.preview(view, binding, 'synthetic-command', { kind }, () => undefined);
        assert.throws(() => approvals.preview(view, binding, 'other-command', { kind }, () => undefined), NativeChatWriteDenied);
        assert.equal(approvals.consume('synthetic-command', binding), preview);
        assert.throws(() => approvals.consume('synthetic-command', binding), NativeChatWriteDenied);
        approvals.check(preview);
        approvals.finish('synthetic-command');
        assert.throws(() => approvals.check(preview), NativeChatWriteDenied);
        assert.throws(() => approvals.consume('synthetic-command', binding), NativeChatWriteDenied);
    });
    test(`${kind}: revocation during asynchronous verification prevents commit`, async () => {
        const { approvals, binding } = setup();
        const view = approvals.open(binding);
        approvals.preview(view, binding, 'synthetic-command', { kind }, () => undefined);
        const preview = approvals.consume('synthetic-command', binding);
        await Promise.resolve();
        approvals.revoke('synthetic-command', binding);
        assert.throws(() => approvals.check(preview), NativeChatWriteDenied);
    });
    test(`${kind}: 30 seconds and 5 minutes are independent server limits`, () => {
        for (const [openedAt, previewAt, commitAt, allowed] of [
            [0, 0, 29_999, true], [0, 0, 30_000, false],
            [0, 299_999, 299_999, true], [0, 299_999, 300_000, false],
        ] as const) {
            const { approvals, binding, at } = setup();
            at(openedAt); const view = approvals.open(binding);
            at(previewAt); approvals.preview(view, binding, 'synthetic-command', { kind }, () => undefined);
            const preview = approvals.consume('synthetic-command', binding);
            at(commitAt);
            if (allowed) approvals.check(preview);
            else assert.throws(() => approvals.check(preview), NativeChatWriteDenied);
        }
        const { approvals, binding, at } = setup();
        const view = approvals.open(binding); at(300_000);
        assert.throws(() => approvals.preview(view, binding, 'synthetic-command', { kind }, () => undefined), NativeChatWriteDenied);
    });
    test(`${kind}: another operator, scope, selection or a reversed clock cannot authorize`, () => {
        const { approvals, binding, at } = setup();
        const view = approvals.open(binding);
        for (const replacement of [{ ...binding, session: {} }, { ...binding, scope: 'another-scope' }, { ...binding, selection: 2 }, { ...binding, resource: 'synthetic-patient-b' }]) {
            assert.throws(() => approvals.preview(view, replacement, 'synthetic-command', { kind }, () => undefined), NativeChatWriteDenied);
        }
        approvals.preview(view, binding, 'synthetic-command', { kind }, () => undefined);
        for (const replacement of [{ ...binding, session: {} }, { ...binding, scope: 'another-scope' }]) {
            assert.throws(() => approvals.consume('synthetic-command', replacement), NativeChatWriteDenied);
            assert.throws(() => approvals.revoke('synthetic-command', replacement), NativeChatWriteDenied);
        }
        const preview = approvals.consume('synthetic-command', binding);
        at(-1); assert.throws(() => approvals.check(preview), NativeChatWriteDenied);
    });
}
