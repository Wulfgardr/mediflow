import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function extract() {
    const source = ts.createSourceFile('security-provider.tsx', readFileSync('components/security-provider.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found = new Map<string, string>();
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ['clearClientAuthority', 'lock', 'checkAuthStatus'].includes(node.name.getText(source)) && node.initializer)
            found.set(node.name.getText(source), node.initializer.getText(source));
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(found.size, 3);
    return `const clearClientAuthority = ${found.get('clearClientAuthority')};
const lock = ${found.get('lock')};
const checkAuthStatus = ${found.get('checkAuthStatus')};
({ checkAuthStatus });`;
}

test('una riconciliazione senza sessione server non chiude il Recovery Kit appena preparato sulla LockScreen', async () => {
    const preparedKit = { recoveryKey: 'synthetic-recovery-key', kit: { schemaVersion: 'mediflow.recovery-kit.v1', username: 'synthetic-admin', wrappedMasterKey: 'synthetic-wrapped', salt: 'synthetic-salt' } };
    const state = { preparedKit: preparedKit as typeof preparedKit | null };
    const preparedAccessRef = { current: { generation: 1, commit: async () => ({ ok: true }) } as unknown };
    const context = {
        console,
        preparedAccessRef,
        setPreparedKit: (value: typeof preparedKit | null) => { state.preparedKit = value; },
        clearSecuritySession: () => {}, setAgentRenewalFailed: () => {}, wrappingRef: { current: null }, setActiveMasterKey: () => {}, setUser: () => {},
        setIsAuthenticated: () => {}, setIsLocked: () => {},
        authorityAttemptGenerationRef: { current: 1 }, lockReceiptGenerationRef: { current: 0 },
        updateAuthRecoveryState: () => {}, setAuthErrorMessage: () => {},
        requestApplicationLockConfirmation: async () => true,
        checkAuthHealthRequest: async () => ({ response: { ok: true, status: 200 }, controlState: 'accepted',
            payload: { status: 'ok', isSetup: true, hasSession: false, localUiLeaseRequired: false, unlock: null } }),
        setAuthHealth: () => {}, setRequiresSetup: () => {}, showUnlockCredential: () => {}, readUnlockParameters: () => null,
        masterKeyRef: { current: null }, authRecoveryStateRef: { current: 'ready' },
    };
    const { checkAuthStatus } = runInNewContext(ts.transpile(extract(), { target: ts.ScriptTarget.ESNext }), context) as
        { checkAuthStatus: (update: (required: boolean) => void) => Promise<void> };

    await checkAuthStatus(() => {});

    assert.notEqual(state.preparedKit, null, 'il pannello del Recovery Kit resta aperto finché il medico non conferma o annulla');
    assert.notEqual(preparedAccessRef.current, null, 'l\'operazione di recupero preparata non viene persa');
});

async function reconcileWithoutSession(options: { masterKey: unknown; receipts: number; prepared: boolean }) {
    let lockConfirmations = 0;
    const state = { masterKey: options.masterKey, preparedKit: options.prepared ? {} as object | null : null };
    const context = {
        console,
        preparedAccessRef: { current: options.prepared ? { generation: 1, commit: async () => ({ ok: true }) } as unknown : null },
        setPreparedKit: (value: object | null) => { state.preparedKit = value; },
        clearSecuritySession: () => {}, setAgentRenewalFailed: () => {}, wrappingRef: { current: null }, setActiveMasterKey: (value: unknown) => { state.masterKey = value; }, setUser: () => {},
        setIsAuthenticated: () => {}, setIsLocked: () => {},
        authorityAttemptGenerationRef: { current: 1 }, lockReceiptGenerationRef: { current: options.receipts },
        updateAuthRecoveryState: () => {}, setAuthErrorMessage: () => {},
        requestApplicationLockConfirmation: async () => { lockConfirmations += 1; return true; },
        checkAuthHealthRequest: async () => ({ response: { ok: true, status: 200 }, controlState: 'accepted',
            payload: { status: 'ok', isSetup: true, hasSession: false, localUiLeaseRequired: false, unlock: null } }),
        setAuthHealth: () => {}, setRequiresSetup: () => {}, showUnlockCredential: () => {}, readUnlockParameters: () => null,
        masterKeyRef: { current: options.masterKey }, authRecoveryStateRef: { current: 'ready' },
    };
    const { checkAuthStatus } = runInNewContext(ts.transpile(extract(), { target: ts.ScriptTarget.ESNext }), context) as
        { checkAuthStatus: (update: (required: boolean) => void) => Promise<void> };
    await checkAuthStatus(() => {});
    return { lockConfirmations, ...state };
}

test('una LockScreen con blocco già confermato non viene ribloccata a ogni riconciliazione', async () => {
    assert.equal((await reconcileWithoutSession({ masterKey: null, receipts: 1, prepared: false })).lockConfirmations, 0);
});

test('senza sessione server una chiave in memoria si chiude comunque, anche con un kit preparato', async () => {
    const result = await reconcileWithoutSession({ masterKey: { synthetic: true }, receipts: 1, prepared: true });
    assert.equal(result.lockConfirmations, 0);
    assert.equal(result.masterKey, null);
    assert.equal(result.preparedKit, null);
});

test('senza autorità locale la riconciliazione lascia disponibile l’accesso', async () => {
    assert.equal((await reconcileWithoutSession({ masterKey: null, receipts: 0, prepared: false })).lockConfirmations, 0);
});
