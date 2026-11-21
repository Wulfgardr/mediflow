import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AGENT_OPERATIONS } from '../lib/agent-mandate-contract.ts';
import { validatePinChangeInput } from '../lib/security/pin-change.ts';
import { element, find, flatten, mountContract, text, type TestNode } from './settings/settings-presentation.test-support.ts';

const PASSPHRASE = 'cavallo batteria graffetta corretta';
const ALPHANUMERIC_PIN = 'AbC!09';
const DEMO_LONG_PIN = 'demo086086';
const EXPECTED_PASSPHRASE_MESSAGE = 'Sembra la passphrase: qui serve il PIN di conferma.';
const EXPECTED_DIGITS_MESSAGE = 'Il PIN richiede da 4 a 8 cifre.';

function sharedPinImports(pinInputDouble?: Record<string, unknown>) {
    return {
        '@/components/settings/settings-ui': {
            SETTINGS_INPUT_CLASS: 'fixture-input',
            SETTINGS_LABEL_CLASS: 'fixture-label',
            SETTINGS_PRIMARY_BUTTON_CLASS: 'fixture-primary',
            SETTINGS_SECONDARY_BUTTON_CLASS: 'fixture-secondary',
        },
        ...(pinInputDouble ? { '@/lib/security/pin-input': pinInputDouble } : {}),
    };
}

function inputById(tree: unknown, id: string): TestNode {
    return find(tree, node => node.type === 'input' && node.props.id === id);
}

function normalizedText(node: unknown): string {
    return text(node).replace(/\s+/gu, ' ').trim();
}

function inputInsideLabel(tree: unknown, labelPrefix: string): TestNode {
    const label = find(tree, node => node.type === 'label' && normalizedText(node).includes(labelPrefix));
    return find(label, node => node.type === 'input');
}

function change(input: TestNode, value: string): void {
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

test('Agenti mandate PIN blocks a pasted passphrase with the passphrase message, keeps digits-only rule and sends valid digits', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mounted = mountContract('app/settings/agenti/page.tsx', 'default', {
        imports: {
            ...sharedPinImports(pinInput ?? undefined),
            '@/lib/agent-mandate-contract': { AGENT_OPERATIONS },
            '@/components/ui/confirm-dialog': { useConfirm: () => async () => ({ confirmed: false }) },
            '@/lib/agent-mandate-client': { generateMandateKeys: async () => ({ publicKey: 'k', wrappedPrivateKey: 'w' }) },
        },
        globals: {
            fetch: async (url: string, init?: { body?: string }) => {
                if (init?.body) sent.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
                return new Response('[]', { status: 200 });
            },
            crypto: globalThis.crypto,
        },
    });
    let tree = mounted.render();
    const field = inputInsideLabel(tree, 'PIN di conferma');
    assert.equal(field.props.maxLength, undefined);
    change(field, PASSPHRASE);
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN di conferma').props.value, PASSPHRASE);
    assert.ok(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), text(tree));
    assert.equal(find(tree, node => node.type === 'button' && text(node).includes('Crea mandato')).props.disabled, true);
    const form = find(tree, node => node.type === 'form' && node.props.id === 'mandato-nuovo');
    (form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
    assert.equal(sent.length, 0);

    change(inputInsideLabel(tree, 'PIN di conferma'), ALPHANUMERIC_PIN);
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN di conferma').props.value, ALPHANUMERIC_PIN);
    assert.ok(text(tree).includes(EXPECTED_DIGITS_MESSAGE), text(tree));
    assert.equal(find(tree, node => node.type === 'button' && text(node).includes('Crea mandato')).props.disabled, true);

    change(inputInsideLabel(tree, 'PIN di conferma'), '2468');
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN di conferma').props.value, '2468');
    assert.equal(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), false);
    assert.equal(text(tree).includes(EXPECTED_DIGITS_MESSAGE), false);
    assert.equal(find(tree, node => node.type === 'button' && text(node).includes('Crea mandato')).props.disabled, false);
    const validForm = find(tree, node => node.type === 'form' && node.props.id === 'mandato-nuovo');
    (validForm.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, '/api/agent-mandates');
    assert.equal(sent[0].body.pin, '2468');
});

test('Agenti renewal approval PIN blocks a pasted passphrase with the passphrase message and accepts valid digits', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mounted = mountContract('app/settings/agenti/page.tsx', 'default', {
        states: {
            0: [{ id: 'm1', provider: 'openai', operations: [...AGENT_OPERATIONS], revokedAt: null, expiresAt: Date.now() + 60_000 }],
            1: [{ id: 'p1', name: 'Client sintetico', code: 'ABCD1234', operations: ['visita.apri'] }],
            4: 'p1',
        },
        imports: {
            ...sharedPinImports(pinInput ?? undefined),
            '@/lib/agent-mandate-contract': { AGENT_OPERATIONS },
            '@/components/ui/confirm-dialog': { useConfirm: () => async () => ({ confirmed: false }) },
            '@/lib/agent-mandate-client': { generateMandateKeys: async () => ({ publicKey: 'k', wrappedPrivateKey: 'w' }) },
        },
        globals: {
            fetch: async (url: string, init?: { body?: string }) => {
                if (init?.body) sent.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
                return new Response('[]', { status: 200 });
            },
            crypto: globalThis.crypto,
        },
    });
    let tree = mounted.render();
    change(inputInsideLabel(tree, 'PIN per Client sintetico'), PASSPHRASE);
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN per Client sintetico').props.value, PASSPHRASE);
    assert.ok(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), text(tree));
    assert.equal(find(tree, node => node.type === 'button' && normalizedText(node).includes('Approva ABCD1234')).props.disabled, true);
    assert.equal(sent.length, 0);

    change(inputInsideLabel(tree, 'PIN per Client sintetico'), '2468');
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN per Client sintetico').props.value, '2468');
    assert.equal(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), false);
    const approveButton = find(tree, node => node.type === 'button' && normalizedText(node).includes('Approva ABCD1234'));
    assert.equal(approveButton.props.disabled, false);
    (approveButton.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, '/api/agent-mandates/pairings');
    assert.equal(sent[0].body.pin, '2468');
});

test('Accesso PIN change accepts existing alphanumeric PINs, blocks a passphrase in new PIN and submits alphanumeric new PIN', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    const calls: Array<{ currentPin: string; newPin: string }> = [];
    const mounted = mountContract('app/settings/accesso/page.tsx', 'default', {
        states: { 2: 'pin' },
        imports: {
            ...sharedPinImports(pinInput ?? undefined),
            '@/lib/security/pin-change': { validatePinChangeInput },
            '@/components/security-provider': {
                useSecurity: () => ({
                    user: { id: 'u1', displayName: 'Medico', ambulatoryName: 'Studio' },
                    changePin: async (currentPin: string, newPin: string) => {
                        calls.push({ currentPin, newPin });
                        return { ok: true };
                    },
                    lock: () => {},
                    unlockCredential: 'pin',
                    preparePassphraseChange: async () => ({ ok: true }),
                }),
            },
            '@/components/recovery-kit': { PassphraseAccessForm: () => element('div', {}) },
        },
    });
    let tree = mounted.render();
    assert.equal(inputById(tree, 'new-pin').props.placeholder, '4-8 caratteri');
    assert.equal(inputById(tree, 'current-pin').props.inputMode, 'text');
    assert.equal(inputById(tree, 'new-pin').props.inputMode, 'text');
    assert.equal(inputById(tree, 'confirm-pin').props.inputMode, 'text');

    change(inputById(tree, 'current-pin'), DEMO_LONG_PIN);
    tree = mounted.render();
    assert.equal(inputById(tree, 'current-pin').props.value, DEMO_LONG_PIN);
    assert.equal(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), false);

    change(inputById(tree, 'new-pin'), PASSPHRASE);
    tree = mounted.render();
    assert.equal(inputById(tree, 'new-pin').props.value, PASSPHRASE);
    assert.ok(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), text(tree));
    const disabledButton = find(tree, node => node.type === 'button' && text(node).includes('Aggiorna PIN'));
    assert.equal(disabledButton.props.disabled, true);
    await (disabledButton.props.onClick as () => Promise<void>)();
    assert.equal(calls.length, 0);

    change(inputById(tree, 'new-pin'), ALPHANUMERIC_PIN);
    tree = mounted.render();
    change(inputById(tree, 'confirm-pin'), ALPHANUMERIC_PIN);
    tree = mounted.render();
    assert.equal(inputById(tree, 'new-pin').props.value, ALPHANUMERIC_PIN);
    assert.equal(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), false);
    const enabledButton = find(tree, node => node.type === 'button' && text(node).includes('Aggiorna PIN'));
    assert.equal(enabledButton.props.disabled, false);
    await (enabledButton.props.onClick as () => Promise<void>)();
    assert.deepEqual(calls, [{ currentPin: DEMO_LONG_PIN, newPin: ALPHANUMERIC_PIN }]);
});

test('PatientDocumentCreate confirmation PIN uses the shared length check without truncation', () => {
    const source = readFileSync('components/patient-document-create.tsx', 'utf8');
    const input = source.slice(source.indexOf('<input id="patient-document-pin"'), source.indexOf('/>', source.indexOf('<input id="patient-document-pin"')));
    assert.ok(input.length > 0);
    assert.doesNotMatch(input, /maxLength/u);
    assert.match(input, /inputMode="text"/u);
    assert.match(source, /const pinError = confirmationPinError\(pin\) \?\? pinSubmitError;/u);
    assert.match(source, /const pinProblem = validateConfirmationPinSubmission\(pin\);\s*if \(pinProblem\) \{ setPinSubmitError\(pinProblem\); return; \}/u);
    assert.match(source, /role="alert"[^>]*>\{pinError\}/u);
});

test('PatientProfileNotesReview confirmation PIN blocks a pasted passphrase and sends short alphanumeric PINs', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    const sent: Array<Record<string, unknown>> = [];
    const signal = new AbortController().signal;
    const preparedView = {
        kind: 'prepared',
        reference: 'ref-1',
        digest: 'dig-1',
        expiresAt: Date.now() + 60_000,
        expectedRevision: 1,
        selectionEpoch: 1,
        notes: 'ENC:notes',
        recipient: { id: 'p1', firstName: 'Lucia', lastName: 'Sintetica' },
    };
    const mounted = mountContract('components/patient-profile-review-pilot.tsx', 'PatientProfileNotesReview', {
        props: { patientId: 'p1', mode: 'commit' },
        states: {
            1: {
                patientId: 'p1',
                userId: 'u1',
                signal,
                mode: 'commit',
                value: {
                    kind: 'editing',
                    draft: { notes: 'Nota sintetica', revision: 1, epoch: 1 },
                },
            },
            2: '',
        },
        imports: {
            ...sharedPinImports(pinInput ?? undefined),
            './security-provider': { useSecurity: () => ({ isLocked: false, isAuthenticated: true, user: { id: 'u1' } }) },
            './ui/button': { Button: (props: Record<string, unknown>) => element('button', props) },
            '@/lib/db': {
                db: {
                    getSessionReadSignal: () => signal,
                    patients: { prepareWritePayload: async () => ({ notes: 'ENC:notes' }) },
                    decryptPatientProfileReviewNotes: async () => 'Nota sintetica',
                    decryptPatientProfileReviewRecipient: async () => 'Sintetica Lucia',
                },
            },
            '@/lib/patient-profile-scoped-browser-adapter': { createPatientProfileScopedBrowserAdapter: () => ({ open: async () => ({}), reset: () => {} }) },
            '@/packages/patient-profile-contracts/src/review': { isProfileReviewView: () => true, PROFILE_REVIEW_POLICY: 'review' },
            '@/packages/patient-profile-contracts/src/notes-commit': {
                isProfileNotesCommitReceipt: () => true,
                isProfileNotesCommitReference: () => true,
                isProfileNotesCommitView: () => true,
                PROFILE_NOTES_COMMIT_POLICY: 'commit',
            },
        },
        globals: {
            URL,
            window: { location: { href: 'http://127.0.0.1/patients/p1/notes-review' }, history: { state: null, replaceState: () => {} } },
            fetch: async (_url: string, init?: { body?: string }) => {
                const payload = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {};
                sent.push(payload);
                return payload.kind === 'prepare'
                    ? new Response(JSON.stringify(preparedView), { status: 200 })
                    : new Response(JSON.stringify({ reference: 'ref-1', digest: 'dig-1', revision: 2 }), { status: 200 });
            },
        },
    });
    let tree = mounted.render();
    const prepareButton = flatten(tree).find(node => node.type === 'button' && text(node).includes('Prepara la revisione'));
    assert.ok(prepareButton);
    (prepareButton.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    tree = mounted.render();
    const pinField = inputInsideLabel(tree, 'PIN di conferma');
    assert.equal(pinField.props.maxLength, undefined);
    assert.equal(pinField.props.inputMode, 'text');
    change(pinField, PASSPHRASE);
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN di conferma').props.value, PASSPHRASE);
    assert.ok(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), text(tree));
    const confirmButton = flatten(tree).find(node => node.type === 'button' && text(node).includes('Conferma e salva le note'));
    assert.ok(confirmButton);
    assert.equal(confirmButton.props.disabled, true);
    (confirmButton.props.onClick as () => void)();
    assert.equal(sent.filter(item => item.kind === 'confirm').length, 0);

    change(inputInsideLabel(tree, 'PIN di conferma'), ALPHANUMERIC_PIN);
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN di conferma').props.value, ALPHANUMERIC_PIN);
    assert.equal(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), false);
    const enabledButton = flatten(tree).find(node => node.type === 'button' && text(node).includes('Conferma e salva le note'));
    assert.ok(enabledButton);
    assert.equal(enabledButton.props.disabled, false);
    (enabledButton.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    const confirms = sent.filter(item => item.kind === 'confirm');
    assert.equal(confirms.length, 1);
    assert.equal(confirms[0].candidatePin, ALPHANUMERIC_PIN);
});

test('IntelligentHostCheckupAction confirmation PIN blocks a pasted passphrase and sends short alphanumeric PINs', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    const calls: Array<{ method: string; pin: string }> = [];
    const client = {
        reset: () => {},
        enroll: async (candidatePin: string) => { calls.push({ method: 'enroll', pin: candidatePin }); },
        revokeRole: async (candidatePin: string) => { calls.push({ method: 'revokeRole', pin: candidatePin }); },
        select: async () => ({ checkupRef: 'hcsr_' + 'a'.repeat(64), resourceTitle: 'Checkup', resourceRevision: 1 }),
        revokeOperation: async () => 'revoked',
        read: async () => ({ proposalRef: 'hcsp_' + 'b'.repeat(64), targetStatus: 'completed', expectedRevision: 1, expiresAt: Date.now() + 60_000, resourceTitle: 'Checkup', resourceRevision: 1 }),
        confirm: async (_patientId: string, _proposal: unknown, candidatePin: string) => {
            calls.push({ method: 'confirm', pin: candidatePin });
            return { toStatus: 'completed', newRevision: 2 };
        },
    };
    const proposal = { proposalRef: 'hcsp_' + 'b'.repeat(64), targetStatus: 'completed', expectedRevision: 1, expiresAt: Date.now() + 60_000, resourceTitle: 'Checkup', resourceRevision: 1 };
    const mounted = mountContract('components/intelligent-host-checkup-action.tsx', 'IntelligentHostCheckupAction', {
        states: { 0: client, 1: true, 7: proposal },
        props: { patientId: 'p1', ambulatoryId: 'a1', checkups: [{ id: 'c1', title: 'Checkup', status: 'pending', version: 1 }] },
        imports: {
            ...sharedPinImports(pinInput ?? undefined),
            '@/lib/security/intelligent-host-checkup-browser-adapter': {
                createIntelligentHostCheckupBrowserAdapter: () => client,
                IntelligentHostCheckupBrowserAdapterError: class extends Error {},
            },
            '@/lib/live-query': { notifyDbChange: () => {} },
        },
    });
    let tree = mounted.render();
    const field = find(tree, node => node.type === 'input' && node.props.type === 'password');
    assert.equal(field.props.maxLength, undefined);
    assert.equal(field.props.inputMode, 'text');
    change(field, PASSPHRASE);
    tree = mounted.render();
    assert.equal(find(tree, node => node.type === 'input' && node.props.type === 'password').props.value, PASSPHRASE);
    assert.ok(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), text(tree));
    for (const label of ['Abilita gestione checkup', 'Revoca definitivamente la gestione', 'Conferma modifica con PIN']) {
        const button = find(tree, node => node.type === 'button' && text(node).includes(label));
        assert.equal(button.props.disabled, true, label);
        await (button.props.onClick as () => Promise<void>)();
    }
    assert.equal(calls.length, 0);

    change(find(tree, node => node.type === 'input' && node.props.type === 'password'), ALPHANUMERIC_PIN);
    tree = mounted.render();
    assert.equal(text(tree).includes(EXPECTED_PASSPHRASE_MESSAGE), false);
    const enrollButton = find(tree, node => node.type === 'button' && text(node).includes('Abilita gestione checkup'));
    assert.equal(enrollButton.props.disabled, false);
    await (enrollButton.props.onClick as () => Promise<void>)();
    assert.deepEqual(calls, [{ method: 'enroll', pin: ALPHANUMERIC_PIN }]);
});
