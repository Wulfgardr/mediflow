import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Rischio #1 (censimento macchine a stati, 11/11): sulla LockScreen il recupero
// con Recovery Kit apre RecoveryKitPanel (preparedKit). Senza sessione server
// (hasSession === false, lo stato normale a schermo bloccato) la
// riconciliazione ogni 15 s e su focus/visibilitychange chiama lock(), che
// passa da clearClientAuthority() e azzera il kit preparato. Si estraggono le
// tre funzioni reali dal componente e si esegue una riconciliazione mentre il
// pannello è aperto.
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
        clearSecuritySession: () => {}, wrappingRef: { current: null }, setActiveMasterKey: () => {}, setUser: () => {},
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
