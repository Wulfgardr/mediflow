import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { FhirExportPrecheckError, buildFhirDiagnosisWarningMessage, prepareFhirBundleFromRecords } from './export-precheck';
import { buildFhirExportBlockingToast } from './export-error-message';
import { SCALES } from '../scale-definitions';
import { prepareScaleSubmission } from '../scale-submission';
import type { FhirBundleInput, FhirClinicalEntryInput } from './types';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const modulesPath = 'app/patients/[id]/modules/page.tsx';
const editorPath = 'app/patients/[id]/edit/page.tsx';

function handlerSource(path: string, names: string[]): string {
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declarations = new Map<string, string>();
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(source))) {
            declarations.set(node.name.getText(source), `const ${node.getText(source)};`);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return names.map(name => {
        assert.ok(declarations.has(name), `Missing production handler ${name}`);
        return declarations.get(name)!;
    }).join('\n');
}

function transpile(source: string): string {
    return ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
}

function fixture(metadata: Record<string, unknown>): FhirBundleInput {
    const input: FhirBundleInput = JSON.parse(read('native/contracts/fhir-golden-input.v1.json'));
    input.patient.diagnoses = [];
    input.entries = [{ id: 'synthetic-scale', patientId: input.patient.id,
        date: '2025-03-11T12:00:00Z', type: 'scale', content: 'Synthetic note', metadata }];
    return input;
}

async function runConsumer(consumer: 'modules' | 'editor' | 'share', input: FhirBundleInput) {
    const toasts: unknown[] = [];
    const logs: unknown[] = [];
    const calls = { download: 0, share: 0, objectUrl: 0, confirmations: 0, recordReads: 0 };
    const table = <T,>(records: T[]) => ({ filter: () => ({ toArray: async () => records }) });
    const db = {
        patients: { get: async () => input.patient },
        entries: { ...table(input.entries), get: async (recordId: string) => {
            calls.recordReads++;
            return input.entries.find(entry => entry.id === recordId);
        } },
        therapies: table(input.therapies), checkups: table(input.checkups), observations: table(input.observations),
    };
    const generatorExports = {};
    vm.runInNewContext(transpile(read('lib/fhir/bundle-generator.ts')), {
        exports: generatorExports,
        require: (name: string) => {
            if (name === '../db') return { db };
            assert.equal(name, './export-precheck');
            return { prepareFhirBundleFromRecords, buildFhirDiagnosisWarningMessage };
        },
    });
    const names = consumer === 'editor' ? ['handleAction']
        : ['prepareFhirExport', 'handleExportConfirm', 'handleShareFhir'];
    const context = vm.createContext({
        id: input.patient.id, patient: { ...input.patient, version: 1 }, actionType: 'export', db,
        FhirExportPrecheckError, buildFhirExportBlockingToast,
        require: (name: string) => {
            assert.equal(name, '@/lib/fhir/bundle-generator');
            return generatorExports;
        },
        fetch: async () => ({ ok: true, json: async () => ({ hasErrors: false, hasWarnings: false }) }),
        confirm: async () => { calls.confirmations++; return { confirmed: true }; },
        showToast: (...args: unknown[]) => toasts.push(args),
        console: { error: (...args: unknown[]) => logs.push(args) },
        File, Blob, DOMException,
        URL: { createObjectURL: () => { calls.objectUrl++; return 'blob:synthetic'; }, revokeObjectURL: () => {} },
        document: {
            createElement: () => ({ click: () => { calls.download++; } }),
            body: { appendChild: () => {}, removeChild: () => {} },
        },
        navigator: { share: async () => { calls.share++; } },
    });
    vm.runInContext(transpile(handlerSource(consumer === 'editor' ? editorPath : modulesPath, names)), context);
    await vm.runInContext(consumer === 'editor' ? 'handleAction({})'
        : consumer === 'share' ? 'handleShareFhir()' : 'handleExportConfirm()', context);
    return { calls, toasts, logs };
}

for (const consumer of ['modules', 'editor', 'share'] as const) {
    for (const [label, metadata, expected] of [
        ['fraction', { title: 'Scala sintetica', score: 1.5 }, 'La scala «Scala sintetica» del 11/03/2025 non ha un punteggio intero valido. Correggila o eliminala, poi riprova.'],
        ['missing score', { title: 'Scala sintetica' }, 'La scala «Scala sintetica» del 11/03/2025 non ha un punteggio intero valido. Correggila o eliminala, poi riprova.'],
        ['rounded fraction', { title: 'Scala sintetica', score: '1.0000000000000001' }, 'La scala «Scala sintetica» del 11/03/2025 non ha un punteggio intero valido. Correggila o eliminala, poi riprova.'],
        ['underflow', { title: 'Scala sintetica', score: '1e-999' }, 'La scala «Scala sintetica» del 11/03/2025 non ha un punteggio intero valido. Correggila o eliminala, poi riprova.'],
        ['empty title', { title: '', score: 3 }, 'La scala del 11/03/2025 non ha un titolo valido. Correggila o eliminala, poi riprova.'],
        ['blank title', { title: '   ', score: 3 }, 'La scala del 11/03/2025 non ha un titolo valido. Correggila o eliminala, poi riprova.'],
        ['missing title', { score: 3 }, 'La scala del 11/03/2025 non ha un titolo valido. Correggila o eliminala, poi riprova.'],
        ['missing title and score', {}, 'La scala del 11/03/2025 non ha un titolo valido. Correggila o eliminala, poi riprova.'],
    ] as const) {
        test(`${consumer}: ${label} shows the corrective toast without download, share, warnings or clinical logs`, async () => {
            const input = fixture(metadata);
            input.patient.diagnoses = [{ id: 'synthetic-unknown', system: 'UNKNOWN', code: 'SYN', description: 'Synthetic diagnosis', date: '2025-03-11' }];
            const before = structuredClone(input);
            const { calls, toasts, logs } = await runConsumer(consumer, input);
            assert.deepEqual(toasts, [[{ tone: 'error', title: 'Esportazione bloccata', description: expected }]]);
            assert.deepEqual(calls, { download: 0, share: 0, objectUrl: 0, confirmations: 0, recordReads: 1 });
            assert.deepEqual(logs, []);
            assert.deepEqual(input, before);
        });
    }
    test(`${consumer}: valid scale reaches the requested handoff`, async () => {
        const { calls, logs } = await runConsumer(consumer, fixture({ title: 'Scala sintetica', score: '03' }));
        assert.equal(calls.download, consumer === 'share' ? 0 : 1);
        assert.equal(calls.share, consumer === 'share' ? 1 : 0);
        assert.equal(calls.recordReads, 0);
        assert.deepEqual(logs, []);
    });
}

test('all current scale writers produce accepted titles and integer scores at both answer extremes', async () => {
    for (const definition of Object.values(SCALES).filter(scale => !scale.retired)) {
        for (const extreme of ['min', 'max'] as const) {
            const answers = Object.fromEntries(definition.questions.map(question => [question.id,
                Math[extreme](...question.options!.map(option => Number(option.value)))]));
            const submission = prepareScaleSubmission(definition.id, answers);
            const input = fixture(submission.metadata);
            assert.ok(await prepareFhirBundleFromRecords(input), definition.id);
        }
    }
});

test('UI resolves identity locally without displaying another patient record', () => {
    const error = new FhirExportPrecheckError('INVALID_SCALE_SCORE', 'synthetic-scale');
    assert.equal(JSON.stringify(error).includes('Scala sintetica'), false);
    for (const path of [modulesPath, editorPath]) {
        const source = read(path);
        assert.match(source, /entry\?\.patientId === id \? entry : undefined/);
        assert.match(source, /import \{ FhirExportPrecheckError \} from '@\/lib\/fhir\/export-precheck'/);
        assert.match(source, /import \{ buildFhirExportBlockingToast \} from '@\/lib\/fhir\/export-error-message'/);
    }
    const entry: FhirClinicalEntryInput = fixture({ title: 'Scala sintetica', score: 1.5 }).entries[0];
    assert.ok(buildFhirExportBlockingToast(error, entry).description?.includes('Scala sintetica'));
});
