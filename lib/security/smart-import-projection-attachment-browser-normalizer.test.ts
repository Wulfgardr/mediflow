/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SmartImportProjectionAttachmentBrowserNormalizerError, createSmartImportProjectionAttachmentBrowserNormalizer } from './smart-import-projection-attachment-browser-normalizer.ts';

const NOW = '2026-08-23T12:00:00.000Z';
const source = (originKey = 'origin.synthetic.a', kind = 'clinical-entry') => ({ kind, originKey, label: 'Label sintetico', date: NOW, content: 'Contenuto sintetico' });
const input = (overrides: Record<string, unknown> = {}) => ({ patient: { version: 3 }, currentDiagnoses: [{ system: 'ICD-11', code: 'SYN-1', description: 'Diagnosi sintetica' }],
    currentActiveTherapies: [{ drugName: 'Farmaco sintetico', activePrinciple: null, dosage: null, aic: null, atc: null }],
    sources: [source()], therapyCandidateHints: [{ kind: 'clinical-entry', originKey: 'origin.synthetic.a', label: 'Hint sintetico', excerpt: 'Estratto sintetico' }], ...overrides });
const create = () => createSmartImportProjectionAttachmentBrowserNormalizer({ clock: () => new Date(NOW) });
const rejects = (code = 'capture_invalid') => (error: unknown) => error instanceof SmartImportProjectionAttachmentBrowserNormalizerError && error.code === code && error.message === 'Smart Import projection capture rejected.';

test('captures the exact patient version with local ordinals and canonical capturedAt', () => {
    const adapter = create(); const first = adapter.capture(input(), true); const second = adapter.capture(input(), true);
    assert.deepEqual([first.patientRevision, first.sourceRevision, second.sourceRevision, first.capturedAt], [3, 1, 2, NOW]);
    assert.equal(create().capture(input(), true).sourceRevision, 1);
    assert.equal(JSON.stringify(first.sources).includes('origin.synthetic.a'), false);
});

test('rejects missing or invalid patient versions, confirmation, and exact-shape violations', () => {
    for (const version of [undefined, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const value = input(); if (version === undefined) delete (value.patient as { version?: number }).version; else value.patient.version = version as number;
        assert.throws(() => create().capture(value, true), rejects());
    }
    assert.throws(() => create().capture(input(), false as never), rejects('confirmation_required'));
    assert.throws(() => create().capture(input({ rawBytes: 'forbidden' }), true), rejects());
    assert.throws(() => create().capture(input({ sources: [{ ...source(), providerOutput: 'forbidden' }] }), true), rejects());
});

test('deduplicates only identical origin pairs, sorts deterministically, and assigns opaque IDs', () => {
    const sources = [source('origin.z', 'attachment-summary'), source('origin.a', 'patient-notes'), source('origin.b', 'clinical-entry'), source('origin.b', 'clinical-entry')];
    const value = create().capture(input({ sources, therapyCandidateHints: [] }), true);
    assert.deepEqual(value.sources.map(({ kind, id }) => [kind, id]), [
        ['patient-notes', 'source.local.00000000001.01'], ['clinical-entry', 'source.local.00000000001.02'], ['attachment-summary', 'source.local.00000000001.03'],
    ]);
    assert.deepEqual(create().capture(input({ sources: [...sources].reverse(), therapyCandidateHints: [] }), true).sources, value.sources);
    assert.equal(JSON.stringify(value.sources).includes('origin.'), false);
    const conflict = [...sources]; conflict[3] = { ...conflict[3], content: 'different synthetic content' };
    assert.throws(() => create().capture(input({ sources: conflict, therapyCandidateHints: [] }), true), rejects());
});

test('keeps equal content from distinct origins and rejects more than 32 sources', () => {
    const same = { ...source('origin.b'), originKey: 'origin.c' };
    assert.equal(create().capture(input({ sources: [source('origin.b'), same], therapyCandidateHints: [] }), true).sources.length, 2);
    const many = Array.from({ length: 32 }, (_, index) => source(`origin.synthetic.${index}`));
    assert.equal(create().capture(input({ sources: [...many, many[0]], therapyCandidateHints: [] }), true).sources.length, 32);
    assert.equal(create().capture(input({ sources: many, therapyCandidateHints: [] }), true).sources.length, 32);
    assert.throws(() => create().capture(input({ sources: [...many, source('origin.synthetic.33')], therapyCandidateHints: [] }), true), rejects());
});

test('rebinds exact hint duplicates after sorting and rejects unbound or excessive hints', () => {
    const hints = [{ kind: 'clinical-entry', originKey: 'origin.b', label: 'B', excerpt: 'B' }, { kind: 'patient-notes', originKey: 'origin.a', label: 'A', excerpt: 'A' }, { kind: 'clinical-entry', originKey: 'origin.b', label: 'B', excerpt: 'B' }];
    const value = create().capture(input({ sources: [source('origin.b'), source('origin.a', 'patient-notes')], therapyCandidateHints: hints }), true);
    assert.deepEqual(value.therapyCandidateHints.map(({ sourceId, label }) => [sourceId, label]), [['source.local.00000000001.01', 'A'], ['source.local.00000000001.02', 'B']]);
    assert.equal(create().capture(input({ sources: [source('origin.b')], therapyCandidateHints: Array.from({ length: 33 }, () => hints[0]) }), true).therapyCandidateHints.length, 1);
    assert.throws(() => create().capture(input({ therapyCandidateHints: [{ ...hints[0], originKey: 'origin.unbound' }] }), true), rejects());
    assert.throws(() => create().capture(input({ therapyCandidateHints: Array.from({ length: 33 }, (_, index) => ({ ...hints[0], label: `L${index}` })) }), true), rejects());
});

test('fails closed when patient.version changes during the synchronous capture fence', () => {
    const target = { version: 3 }; let descriptors = 0;
    const patient = new Proxy(target, { getOwnPropertyDescriptor(value, key) {
        descriptors += 1; if (descriptors > 1) value.version = 4; return Reflect.getOwnPropertyDescriptor(value, key);
    } });
    assert.throws(() => create().capture(input({ patient }), true), rejects());
});

test('copies diagnoses and therapies before the clock can mutate original arrays or objects', () => {
    const value = input();
    const adapter = createSmartImportProjectionAttachmentBrowserNormalizer({ clock: () => {
        value.currentDiagnoses[0] = { system: 'ICD-11', code: 'SYN-9', description: 'Mutazione sintetica' };
        value.currentActiveTherapies[0] = { drugName: 'Mutazione sintetica', activePrinciple: null, dosage: null, aic: null, atc: null };
        return new Date(NOW);
    } });
    const captured = adapter.capture(value, true);
    assert.deepEqual([captured.currentDiagnoses[0].code, captured.currentActiveTherapies[0].drugName], ['SYN-1', 'Farmaco sintetico']);
});

test('keeps sourceRevision local-only and leaves the shared freshness validator canonical', () => {
    const sourceText = readFileSync(new URL('./smart-import-projection-attachment-browser-normalizer.ts', import.meta.url), 'utf8');
    const validator = readFileSync(new URL('../smart-import-projection.ts', import.meta.url), 'utf8');
    assert.match(sourceText, /browser-adapter-local ordinal/u); assert.match(sourceText, /Number\.MAX_SAFE_INTEGER/u);
    assert.doesNotMatch(sourceText, /console\.|localStorage|sessionStorage|selection|ingest|preview|apply/u);
    assert.doesNotMatch(sourceText, /sourceRevision\s*(?:===|!==|<=|>=|<|>)/u);
    assert.match(validator, /SMART_IMPORT_PROJECTION_FRESHNESS_MS\s*=\s*300_000/u);
});
