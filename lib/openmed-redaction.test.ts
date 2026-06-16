/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildOpenMedUpstreamCall,
    normalizeOpenMedLabel,
    normalizeOpenMedResponse,
    parseSystemRedactionRequest,
    REDACTION_VERSION,
    resolveOpenMedRedactionConfig,
} from './openmed-redaction';

test('resolveOpenMedRedactionConfig prefers env override and clamps defaults', () => {
    const config = resolveOpenMedRedactionConfig(
        {
            baseUrl: 'http://127.0.0.1:9999',
            defaultLanguage: 'en',
            defaultMethod: 'replace',
            defaultConfidenceThreshold: '2',
        },
        {
            ...process.env,
            OPENMED_BASE_URL: 'http://127.0.0.1:18080',
            OPENMED_REDACTION_CONFIDENCE_THRESHOLD: '0.5',
        },
    );

    assert.equal(config.baseUrl, 'http://127.0.0.1:18080');
    assert.equal(config.defaultLanguage, 'en');
    assert.equal(config.defaultMethod, 'mask');
    assert.equal(config.defaultConfidenceThreshold, 0.5);
});

test('parseSystemRedactionRequest rejects invalid payloads and accepts minimal extract input', () => {
    assert.deepEqual(parseSystemRedactionRequest(null), {
        ok: false,
        error: 'JSON body required.',
    });

    assert.deepEqual(parseSystemRedactionRequest({ action: 'extract', text: '  ' }), {
        ok: false,
        error: 'Text is required.',
    });

    const parsed = parseSystemRedactionRequest({
        action: 'extract',
        text: 'Mario Rossi',
        confidenceThreshold: 0.4,
    });

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.action, 'extract');
    assert.equal(parsed.value.text, 'Mario Rossi');
    assert.equal(parsed.value.confidenceThreshold, 0.4);
});

test('parseSystemRedactionRequest preserves leading whitespace for upstream offsets', () => {
    /* @Codex */
    const parsed = parseSystemRedactionRequest({
        action: 'extract',
        text: '  Mario Rossi',
    });

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.text, '  Mario Rossi');
});

test('normalizeOpenMedLabel compresses mixed upstream taxonomy to MediFlow types', () => {
    assert.equal(normalizeOpenMedLabel('FIRSTNAME'), 'person_name');
    assert.equal(normalizeOpenMedLabel('national_id'), 'national_id');
    assert.equal(normalizeOpenMedLabel('phone_number'), 'phone');
    assert.equal(normalizeOpenMedLabel('SECONDARYADDRESS'), 'street_address');
    assert.equal(normalizeOpenMedLabel('CITY'), 'city');
    assert.equal(normalizeOpenMedLabel('STATE'), 'state');
    assert.equal(normalizeOpenMedLabel('unexpected_label'), 'other');
});

test('buildOpenMedUpstreamCall and normalizeOpenMedResponse keep a stable redaction.v1 shape', () => {
    const config = resolveOpenMedRedactionConfig({
        baseUrl: 'http://127.0.0.1:18080',
        defaultLanguage: 'it',
        defaultConfidenceThreshold: '0.5',
    });

    const request = {
        action: 'deidentify' as const,
        text: 'Mario Rossi, CF RSSMRA84A15H501Z',
    };

    const upstream = buildOpenMedUpstreamCall(request, config);
    assert.equal(upstream.pathname, '/pii/deidentify');
    assert.deepEqual(upstream.payload, {
        text: 'Mario Rossi, CF RSSMRA84A15H501Z',
        lang: 'it',
        confidence_threshold: 0.5,
        method: 'mask',
    });

    const response = normalizeOpenMedResponse(request, config, {
        model_name: 'OpenMed/Test',
        deidentified_text: '[FIRSTNAME] [LASTNAME], CF [national_id]',
        pii_entities: [
            { text: 'Mario', label: 'FIRSTNAME', start: 0, end: 5, confidence: 0.98 },
            { text: 'RSSMRA84A15H501Z', label: 'national_id', start: 17, end: 33, confidence: 0.93 },
            { text: 'Roma', label: 'CITY', confidence: 0.51 },
        ],
    });

    assert.equal(response.version, REDACTION_VERSION);
    assert.equal(response.provider, 'openmed');
    assert.equal(response.action, 'deidentify');
    assert.equal(response.language, 'it');
    assert.equal(response.method, 'mask');
    assert.equal(response.confidenceThreshold, 0.5);
    assert.equal(response.redactedText, '[FIRSTNAME] [LASTNAME], CF [national_id]');
    assert.equal(response.entityCount, 3);
    assert.deepEqual(response.entities.map((entity) => ({
        text: entity.text,
        type: entity.type,
        critical: entity.critical,
    })), [
        { text: 'Mario', type: 'person_name', critical: true },
        { text: 'RSSMRA84A15H501Z', type: 'national_id', critical: true },
        { text: 'Roma', type: 'city', critical: false },
    ]);
});

test('normalizeOpenMedResponse preserves padded redacted text and original-space offsets', () => {
    /* @Codex */
    const config = resolveOpenMedRedactionConfig({});
    const request = {
        action: 'deidentify' as const,
        text: '  Mario Rossi',
    };

    const upstream = buildOpenMedUpstreamCall(request, config);
    assert.equal(upstream.payload.text, '  Mario Rossi');

    const response = normalizeOpenMedResponse(request, config, {
        deidentified_text: '  [FIRSTNAME] [LASTNAME]',
        pii_entities: [
            { text: 'Mario', label: 'FIRSTNAME', start: 2, end: 7, confidence: 0.98 },
        ],
    });

    assert.equal(response.redactedText, '  [FIRSTNAME] [LASTNAME]');
    assert.equal(response.entities[0]?.start, 2);
    assert.equal(response.entities[0]?.end, 7);
});
