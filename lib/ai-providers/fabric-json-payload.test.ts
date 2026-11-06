import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIChatOptions } from './provider';
import { buildOllamaChatPayload } from './ollama';

for (const responseFormat of ['patient_insight', 'smart_import'] as const) {
    test(`${responseFormat} invia uno schema invece del JSON libero`, () => {
        const payload = buildOllamaChatPayload('synthetic', [], 900, { responseFormat } as AIChatOptions);
        assert.equal(typeof payload.format, 'object');
    });
}

import { GENERATIVE_JSON_SCHEMAS } from './generative-json-schemas';
import { DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA } from './document-synthesis-json-schema';
import { PATIENT_INSIGHT_JSON_SCHEMA, SMART_IMPORT_JSON_SCHEMA } from './extraction-json-schemas';
import { validateGenerativeJson } from './generative-json-validation';
import ts from 'typescript';
import path from 'node:path';

const expected = {
    patient_insight: PATIENT_INSIGHT_JSON_SCHEMA,
    smart_import: SMART_IMPORT_JSON_SCHEMA,
    document_synthesis_v2: DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA,
} as const;
for (const [responseFormat, schema] of Object.entries(expected)) {
    test(`${responseFormat} serializza esattamente il contratto condiviso`, () => {
        const payload = buildOllamaChatPayload('synthetic', [], 900, { responseFormat } as AIChatOptions);
        assert.deepEqual(JSON.parse(JSON.stringify(payload)).format, schema);
        assert.strictEqual(payload.format, schema);
    });
}
test('JSON libero e formato assente conservano il comportamento precedente', () => {
    assert.equal(buildOllamaChatPayload('synthetic', [], 900, { responseFormat: 'json' }).format, 'json');
    assert.equal(Object.hasOwn(buildOllamaChatPayload('synthetic', []), 'format'), false);
});

test('la validazione usa lo schema trasmesso e rifiuta campi o tipi errati', () => {
    for (const task of ['patient_insight', 'smart_import'] as const) {
        const data = task === 'patient_insight' ? { currentState: [], alerts: [], nextSteps: [], gaps: [] }
            : { diagnoses: [], therapies: [], servicePrescriptions: [] };
        const valid = { schemaVersion: 'mediflow.ai.extract.v1', task, summary: 'Prova sintetica', data };
        assert.doesNotThrow(() => validateGenerativeJson(task, JSON.stringify(valid)));
        for (const invalid of [{ ...valid, task: 'wrong' }, { ...valid, data: [] }, { ...valid, extra: true }]) {
            assert.throws(() => validateGenerativeJson(task, JSON.stringify(invalid)));
        }
    }
});

test('un nuovo responseFormat privo di schema rompe la mappa tipizzata', () => {
    assert.deepEqual(Object.keys(GENERATIVE_JSON_SCHEMAS).sort(), Object.keys(expected).sort());
    const provider = path.resolve('lib/ai-providers/provider.ts');
    const registry = path.resolve('lib/ai-providers/generative-json-schemas.ts');
    const options: ts.CompilerOptions = { noEmit: true, skipLibCheck: true, strict: true,
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    function diagnostics(mutate: boolean) {
        const host = ts.createCompilerHost(options);
        const read = host.readFile.bind(host);
        host.readFile = file => {
            const source = read(file);
            return mutate && path.resolve(file) === provider
                ? source?.replace("responseFormat?: 'json'", "responseFormat?: 'synthetic_missing_schema' | 'json'") : source;
        };
        return ts.getPreEmitDiagnostics(ts.createProgram([registry], options, host));
    }
    assert.deepEqual(diagnostics(false).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    assert.ok(diagnostics(true).some(d => d.file?.fileName === registry
        && ts.flattenDiagnosticMessageText(d.messageText, '\n').includes('synthetic_missing_schema')));
});
