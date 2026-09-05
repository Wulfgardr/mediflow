/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SMART_IMPORT_PROPOSAL_WIRE_LIMITS, parsePatientSmartImportProposalWire, serializePatientSmartImportProposalWire } from '../../smart-import-proposal-wire.ts';

const ISO = '2026-08-23T12:00:00.000Z';
const diagnosis = (overrides: Record<string, unknown> = {}) => ({ label: 'Sintesi', icdQuery: 'SINT', confidence: 'high', evidence: 'Evidenza', sourceId: 'source.synthetic.1', explicitCode: undefined, ...overrides });
const therapy = (overrides: Record<string, unknown> = {}) => ({ drugMention: 'Farmaco', drugQuery: 'Farmaco', confidence: 'medium', evidence: 'Evidenza', sourceId: 'source.synthetic.1', activePrinciple: undefined, dosage: undefined, motivation: undefined, therapyState: undefined, reviewNote: undefined, ...overrides });
const item = (overrides: Record<string, unknown> = {}) => ({ serviceName: 'Esame', confidence: 'low', evidence: 'Evidenza', sourceId: 'source.synthetic.1', category: undefined, codeSystem: undefined, serviceCode: undefined, ...overrides });
const service = (overrides: Record<string, unknown> = {}) => ({ serviceName: 'Servizio', confidence: 'high', evidence: 'Evidenza', sourceId: 'source.synthetic.1', category: undefined, priority: undefined, codeSystem: undefined, serviceCode: undefined, clinicalQuestion: undefined, provider: undefined, prescribedAt: undefined, requestReference: undefined, items: undefined, ...overrides });
const proposal = (overrides: Record<string, unknown> = {}) => ({ schemaVersion: 'mediflow.smart-import.proposal.v1', generatedAt: ISO,
    contract: { validJson: true, validTask: true, legacyContract: false }, summary: '', diagnoses: [diagnosis()], therapies: [therapy()], servicePrescriptions: [service()], writesPerformed: 0, ...overrides });

test('serializes canonical domain optionals to a detached frozen wire snapshot', () => {
    const domain = proposal(); const serialized = serializePatientSmartImportProposalWire(domain); const parsed = parsePatientSmartImportProposalWire(serialized);
    assert.ok(serialized); assert.ok(parsed); assert.equal('explicitCode' in serialized.diagnoses[0], false); assert.equal('items' in serialized.servicePrescriptions[0], false);
    assert.equal(Object.isFrozen(parsed), true); assert.equal(Object.isFrozen(parsed.diagnoses), true);
    domain.diagnoses[0].label = 'Mutazione'; assert.equal(parsed.diagnoses[0].label, 'Sintesi');
    assert.equal(JSON.stringify(serialized).includes('undefined'), false);
});

test('preserves valid optionals and rejects null, wire undefined, required gaps, and closed-contract violations', () => {
    const valid = serializePatientSmartImportProposalWire(proposal({ diagnoses: [diagnosis({ explicitCode: 'A1' })], therapies: [therapy({ therapyState: 'active' })], servicePrescriptions: [service({ category: 'lab', items: [item({ serviceCode: 'X' })] })] }));
    assert.equal(valid?.diagnoses[0].explicitCode, 'A1'); assert.equal(valid?.servicePrescriptions[0].items?.[0].serviceCode, 'X');
    const missing = diagnosis(); delete (missing as Record<string, unknown>).label;
    for (const value of [proposal({ diagnoses: [diagnosis({ explicitCode: null })] }), proposal({ diagnoses: [diagnosis({ label: undefined })] }), proposal({ diagnoses: [missing] }),
        proposal({ diagnoses: [diagnosis({ confidence: 'unknown' })] }), proposal({ generatedAt: 'invalid' }), proposal({ schemaVersion: 'other' }),
        proposal({ contract: { validJson: true, validTask: false, legacyContract: false } }), proposal({ writesPerformed: 1 }), proposal({ writesPerformed: Number.NaN })]) {
        assert.equal(serializePatientSmartImportProposalWire(value), null);
    }
    const wireUndefined = { ...proposal(), diagnoses: [{ ...diagnosis(), explicitCode: undefined }] };
    assert.equal(parsePatientSmartImportProposalWire(wireUndefined), null);
});

test('enforces every shared text and collection limit without truncation', () => {
    const textCases: [string, number, (value: string) => Record<string, unknown>][] = [
        ['summary', SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text, (value) => proposal({ summary: value })],
        ['source', SMART_IMPORT_PROPOSAL_WIRE_LIMITS.reference, (value) => proposal({ diagnoses: [diagnosis({ sourceId: value })] })],
        ['code', SMART_IMPORT_PROPOSAL_WIRE_LIMITS.explicitCode, (value) => proposal({ diagnoses: [diagnosis({ explicitCode: value })] })],
        ['priority', SMART_IMPORT_PROPOSAL_WIRE_LIMITS.priority, (value) => proposal({ servicePrescriptions: [service({ priority: value })] })],
    ];
    for (const [, max, make] of textCases) { assert.ok(serializePatientSmartImportProposalWire(make('x'.repeat(max)))); assert.equal(serializePatientSmartImportProposalWire(make('x'.repeat(max + 1))), null); }
    const arrayCases: [number, () => unknown, (items: unknown[]) => Record<string, unknown>][] = [
        [SMART_IMPORT_PROPOSAL_WIRE_LIMITS.diagnoses, diagnosis, (items) => proposal({ diagnoses: items })],
        [SMART_IMPORT_PROPOSAL_WIRE_LIMITS.therapies, therapy, (items) => proposal({ therapies: items })],
        [SMART_IMPORT_PROPOSAL_WIRE_LIMITS.services, service, (items) => proposal({ servicePrescriptions: items })],
        [SMART_IMPORT_PROPOSAL_WIRE_LIMITS.items, item, (items) => proposal({ servicePrescriptions: [service({ items })] })],
    ];
    for (const [max, makeItem, make] of arrayCases) { const value = Array.from({ length: max }, makeItem); assert.ok(serializePatientSmartImportProposalWire(make(value))); assert.equal(serializePatientSmartImportProposalWire(make([...value, makeItem()])), null); }
});

test('rejects hostile descriptors, symbols, inheritance, sparse arrays, custom array properties, and cycles', () => {
    const accessor = proposal(); Object.defineProperty(accessor.diagnoses[0], 'label', { enumerable: true, get() { throw new Error('raw marker'); } });
    const inherited = Object.assign(Object.create({ extra: true }), proposal()); const symbol = proposal(); Object.defineProperty(symbol, Symbol('synthetic'), { value: true }); const extra = proposal({ extra: true });
    const sparse = proposal({ diagnoses: [, diagnosis()] }); const arrayProperty = proposal(); Object.defineProperty(arrayProperty.diagnoses, 'extra', { value: true });
    const cyclic = proposal(); (cyclic.diagnoses[0] as Record<string, unknown>).explicitCode = cyclic;
    const proxy = new Proxy(proposal(), { getOwnPropertyDescriptor() { throw new Error('raw marker'); } });
    for (const value of [accessor, inherited, symbol, extra, sparse, arrayProperty, cyclic, proxy]) assert.equal(serializePatientSmartImportProposalWire(value), null);
});

test('keeps the browser parser free of server and generic JSON dependencies', () => {
    const source = readFileSync(new URL('../../smart-import-proposal-wire.ts', import.meta.url), 'utf8');
    const producer = readFileSync(new URL('../../ai-task-contracts.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^import .*?(?:server-only|node:|server-session|provider|registry)/mu); assert.doesNotMatch(source, /JSON\.stringify/u);
    for (const key of ['text', 'reference', 'explicitCode', 'priority', 'diagnoses', 'therapies', 'services', 'items']) assert.match(producer, new RegExp(`SMART_IMPORT_PROPOSAL_WIRE_LIMITS\\.${key}`, 'u'));
});
