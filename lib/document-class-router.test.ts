import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFileNameHints, routeDocumentClass } from './document-class-router';

test('parseFileNameHints extracts ISO date, class token and provenance markers', () => {
    const hints = parseFileNameHints('2026-03-14__laboratorio__emocromo_signed.pdf');
    assert.equal(hints.documentDate, '2026-03-14');
    assert.equal(hints.classToken, 'laboratorio');
    assert.deepEqual(hints.provenance, ['signed']);
});

test('parseFileNameHints ignores impossible dates and unknown tokens', () => {
    const hints = parseFileNameHints('2026-13-40__foobar__x.pdf');
    assert.equal(hints.documentDate, undefined);
    assert.equal(hints.classToken, undefined);
});

test('a confident filename token wins with high confidence', () => {
    const result = routeDocumentClass({ fileName: '2026-01-02__protesica__carrozzina.pdf' });
    assert.equal(result.classification, 'prosthetic_prescription');
    assert.equal(result.confidence, 'high');
    assert.equal(result.documentDate, '2026-01-02');
});

test('an ambiguous filename token stays medium unless content confirms it', () => {
    const ambiguous = routeDocumentClass({ fileName: '2026-01-02__ricetta__x.pdf' });
    assert.equal(ambiguous.classification, 'medication_prescription');
    assert.equal(ambiguous.confidence, 'medium');

    const confirmed = routeDocumentClass({
        fileName: '2026-01-02__ricetta__x.pdf',
        textSample: 'PROMEMORIA PER L\'ASSISTITO. Quesito diagnostico: sospetta cardiopatia. NRE 1234',
    });
    assert.equal(confirmed.classification, 'specialist_service_prescription');
});

test('a scan producer without readable header routes to mute_or_scanned', () => {
    const result = routeDocumentClass({ producer: 'img2pdf 0.4.4' });
    assert.equal(result.classification, 'mute_or_scanned');
    assert.equal(result.confidence, 'medium');
    assert.ok(result.signals.includes('producer:scan'));
});

test('a post-processing producer is flagged and does not drive classification', () => {
    const result = routeDocumentClass({ producer: 'pdf-lib (https://github.com/Hopding/pdf-lib)' });
    assert.equal(result.postProcessed, true);
    assert.equal(result.classification, 'unknown');
    assert.equal(result.confidence, 'low');
});

test('a known producer (JasperReports) with lab header classifies as lab_report', () => {
    const result = routeDocumentClass({
        producer: 'JasperReports Library version 6.20',
        textSample: 'EMATOLOGIA\nDeterminazione Risultato Unita Limiti di riferimento',
    });
    assert.equal(result.classification, 'lab_report');
});

test('content-only header classifies when filename and producer are absent', () => {
    const result = routeDocumentClass({
        textSample: 'Carta di identita della Repubblica Italiana. Documento di riconoscimento.',
    });
    assert.equal(result.classification, 'identity_document');
    assert.equal(result.confidence, 'medium');
});

test('no usable signal falls back to unknown/low', () => {
    const result = routeDocumentClass({ fileName: 'scan0001.pdf' });
    assert.equal(result.classification, 'unknown');
    assert.equal(result.confidence, 'low');
});
