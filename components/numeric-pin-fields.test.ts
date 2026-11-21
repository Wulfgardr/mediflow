import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENT_OPERATIONS } from '../lib/agent-mandate-contract.ts';
import { element, find, flatten, mountContract, text, type TestNode } from './settings/settings-presentation.test-support.ts';

const PASSPHRASE = 'cavallo batteria graffetta corretta';
const EXPECTED_MESSAGE = 'PIN di 4-8 cifre, non la passphrase.';

function numericPinImports(pinInputDouble?: Record<string, unknown>) {
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

test('Agenti mandate PIN field rejects a pasted passphrase, shows the message and makes no request', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    let fetches = 0;
    const mounted = mountContract('app/settings/agenti/page.tsx', 'default', {
        imports: {
            ...numericPinImports(pinInput ?? undefined),
            '@/lib/agent-mandate-contract': { AGENT_OPERATIONS },
            '@/components/ui/confirm-dialog': { useConfirm: () => async () => ({ confirmed: false }) },
            '@/lib/agent-mandate-client': { generateMandateKeys: async () => ({ publicKey: 'k', wrappedPrivateKey: 'w' }) },
        },
        globals: {
            fetch: async () => { fetches += 1; return new Response('{}', { status: 200 }); },
            crypto: globalThis.crypto,
        },
    });
    let tree = mounted.render();
    const pinInputNode = inputInsideLabel(tree, 'PIN di conferma');
    change(pinInputNode, PASSPHRASE);
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN di conferma').props.value, '');
    assert.ok(text(tree).includes(EXPECTED_MESSAGE), text(tree));
    const submitButton = find(tree, node => node.type === 'button' && text(node).includes('Crea mandato'));
    assert.equal(submitButton.props.disabled, true);
    const form = find(tree, node => node.type === 'form' && node.props.id === 'mandato-nuovo');
    (form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
    assert.equal(fetches, 0);

    change(inputInsideLabel(tree, 'PIN di conferma'), '2468');
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN di conferma').props.value, '2468');
    assert.equal(text(tree).includes(EXPECTED_MESSAGE), false);
    assert.equal(find(tree, node => node.type === 'button' && text(node).includes('Crea mandato')).props.disabled, false);
});

test('Agenti renewal approval PIN field rejects a pasted passphrase and explains why without submitting', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    let fetches = 0;
    const mounted = mountContract('app/settings/agenti/page.tsx', 'default', {
        states: {
            0: [{ id: 'm1', provider: 'openai', operations: [...AGENT_OPERATIONS], revokedAt: null, expiresAt: Date.now() + 60_000 }],
            1: [{ id: 'p1', name: 'Client sintetico', code: 'ABCD1234', operations: ['visita.apri'] }],
            4: 'p1',
        },
        imports: {
            ...numericPinImports(pinInput ?? undefined),
            '@/lib/agent-mandate-contract': { AGENT_OPERATIONS },
            '@/components/ui/confirm-dialog': { useConfirm: () => async () => ({ confirmed: false }) },
            '@/lib/agent-mandate-client': { generateMandateKeys: async () => ({ publicKey: 'k', wrappedPrivateKey: 'w' }) },
        },
        globals: {
            fetch: async () => { fetches += 1; return new Response('{}', { status: 200 }); },
            crypto: globalThis.crypto,
        },
    });
    let tree = mounted.render();
    change(inputInsideLabel(tree, 'PIN per Client sintetico'), PASSPHRASE);
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN per Client sintetico').props.value, '');
    assert.ok(text(tree).includes(EXPECTED_MESSAGE), text(tree));
    const approveButton = find(tree, node => node.type === 'button' && normalizedText(node).includes('Approva ABCD1234'));
    assert.equal(approveButton.props.disabled, true);
    assert.equal(fetches, 0);

    change(inputInsideLabel(tree, 'PIN per Client sintetico'), '2468');
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN per Client sintetico').props.value, '2468');
    assert.equal(text(tree).includes(EXPECTED_MESSAGE), false);
    assert.equal(find(tree, node => node.type === 'button' && normalizedText(node).includes('Approva ABCD1234')).props.disabled, false);
});

test('Accesso PIN change rejects a pasted passphrase without calling changePin', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    let changePinCalls = 0;
    const mounted = mountContract('app/settings/accesso/page.tsx', 'default', {
        states: { 2: 'pin' },
        imports: {
            ...numericPinImports(pinInput ?? undefined),
            '@/components/security-provider': {
                useSecurity: () => ({
                    user: { id: 'u1', displayName: 'Medico', ambulatoryName: 'Studio' },
                    changePin: async () => { changePinCalls += 1; return { ok: true }; },
                    lock: () => {},
                    unlockCredential: 'pin',
                    preparePassphraseChange: async () => ({ ok: true }),
                }),
            },
            '@/components/recovery-kit': { PassphraseAccessForm: () => element('div', {}) },
        },
    });
    let tree = mounted.render();
    change(inputById(tree, 'current-pin'), PASSPHRASE);
    tree = mounted.render();
    assert.equal(inputById(tree, 'current-pin').props.value, '');
    assert.ok(text(tree).includes(EXPECTED_MESSAGE), text(tree));
    const button = find(tree, node => node.type === 'button' && text(node).includes('Aggiorna PIN'));
    await (button.props.onClick as () => Promise<void>)();
    assert.equal(changePinCalls, 0);

    change(inputById(tree, 'current-pin'), '1234');
    tree = mounted.render();
    assert.equal(inputById(tree, 'current-pin').props.value, '1234');
    assert.equal(text(tree).includes(EXPECTED_MESSAGE), false);
});

test('PatientDocumentCreate confirmation PIN rejects a pasted passphrase without truncating or requesting', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    let requests = 0;
    const confirmPhase = {
        kind: 'confirm',
        view: { commandId: '11111111-1111-4111-8111-111111111111', viewId: 'v1', text: 'Testo sintetico', identity: 'clear', quality: 'clear', candidates: {} },
        source: { fileName: 'referto.pdf', size: 1024, converted: false, reduction: 1 },
        markerKept: true,
        duplicate: null,
    };
    const mounted = mountContract('components/patient-document-create.tsx', 'default', {
        states: {
            0: confirmPhase,
            1: { firstName: 'Lucia', lastName: 'Sintetica', identifierType: 'none', taxCode: '', birthDate: '1980-02-03', birthYear: '', estimatedBirth: false },
            2: false,
            3: '',
        },
        imports: {
            ...numericPinImports(pinInput ?? undefined),
            '@/components/ui/confirm-dialog': { useConfirm: () => async () => ({ confirmed: false }) },
            '@/components/ui/toast-provider': { useToast: () => ({ showToast: () => {} }) },
            '@/lib/db': { db: { sealPatientDocumentSource: async () => ({}) } },
            '@/lib/patient-identity': {
                PATIENT_IDENTIFIER_DUPLICATE: { code: 'PATIENT_IDENTIFIER_DUPLICATE' },
                IDENTIFIER_TYPES: ['cf', 'none'],
                IDENTIFIER_LABELS: { cf: 'Codice fiscale', none: 'Nessuno' },
                birthError: () => null,
                identifierError: () => null,
            },
            '@/lib/patient-creation-focus': { focusPatientCreationTarget: () => {} },
            '@/lib/patient-document-create-client': {
                PATIENT_DOCUMENT_ACCEPT: '.pdf',
                PatientDocumentFileRejected: class extends Error {},
                parsePatientDocumentReceipt: () => null,
                patientDocumentMarker: { read: () => null, write: () => true, clear: () => {} },
                patientDocumentScope: async () => 'scope-1',
                preparePatientDocumentFile: async () => ({}),
                requestPatientDocument: async () => { requests += 1; return { status: 200, body: {} }; },
            },
            '@/lib/patient-document-image-geometry': { OCR_MIN_SHORT_SIDE_PIXELS: 100 },
            '@/lib/patient-document-create-command': {},
        },
        globals: {
            document: { activeElement: null },
        },
    });
    let tree = mounted.render();
    const field = inputById(tree, 'patient-document-pin');
    assert.equal(field.props.maxLength, undefined);
    change(field, PASSPHRASE);
    tree = mounted.render();
    assert.equal(inputById(tree, 'patient-document-pin').props.value, '');
    assert.ok(text(tree).includes(EXPECTED_MESSAGE), text(tree));
    const submitButton = find(tree, node => node.type === 'button' && text(node).includes('Conferma creazione con PIN'));
    assert.equal(submitButton.props.disabled, true);
    const form = find(tree, node => node.type === 'form');
    (form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
    assert.equal(requests, 0);

    change(inputById(tree, 'patient-document-pin'), '314159');
    tree = mounted.render();
    assert.equal(inputById(tree, 'patient-document-pin').props.value, '314159');
    assert.equal(text(tree).includes(EXPECTED_MESSAGE), false);
    assert.equal(find(tree, node => node.type === 'button' && text(node).includes('Conferma creazione con PIN')).props.disabled, false);
});

test('PatientProfileNotesReview confirmation PIN rejects a pasted passphrase without calling the server', async () => {
    const pinInput = await import('../lib/security/pin-input.ts').catch(() => null);
    let fetches = 0;
    const signal = new AbortController().signal;
    const mounted = mountContract('components/patient-profile-review-pilot.tsx', 'PatientProfileNotesReview', {
        props: { patientId: 'p1', mode: 'commit' },
        states: {
            1: {
                patientId: 'p1',
                userId: 'u1',
                signal,
                mode: 'commit',
                value: {
                    kind: 'review',
                    view: { reference: 'ref-1', digest: 'dig-1', expiresAt: Date.now() + 60_000, expectedRevision: 1, selectionEpoch: 1, notes: null },
                    notes: 'Nota sintetica',
                    recipient: 'Sintetica Lucia',
                },
            },
            2: '',
        },
        imports: {
            ...numericPinImports(pinInput ?? undefined),
            './security-provider': { useSecurity: () => ({ isLocked: false, isAuthenticated: true, user: { id: 'u1' } }) },
            './ui/button': { Button: (props: Record<string, unknown>) => element('button', props) },
            '@/lib/db': { db: { getSessionReadSignal: () => signal } },
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
            fetch: async () => { fetches += 1; return new Response('{}', { status: 200 }); },
        },
    });
    let tree = mounted.render();
    const pinField = inputInsideLabel(tree, 'PIN di conferma');
    change(pinField, PASSPHRASE);
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN di conferma').props.value, '');
    assert.ok(text(tree).includes(EXPECTED_MESSAGE), text(tree));
    const confirmButton = flatten(tree).find(node => node.type === 'button' && text(node).includes('Conferma e salva le note'));
    assert.ok(confirmButton);
    assert.equal(confirmButton.props.disabled, true);
    assert.equal(fetches, 0);

    change(inputInsideLabel(tree, 'PIN di conferma'), '2468');
    tree = mounted.render();
    assert.equal(inputInsideLabel(tree, 'PIN di conferma').props.value, '2468');
    assert.equal(text(tree).includes(EXPECTED_MESSAGE), false);
    const enabledButton = flatten(tree).find(node => node.type === 'button' && text(node).includes('Conferma e salva le note'));
    assert.ok(enabledButton);
    assert.equal(enabledButton.props.disabled, false);
});
