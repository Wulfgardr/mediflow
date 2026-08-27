/* @Codex */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    intakeDocumentSynthesisA3a2SealedEvidence,
    type DocumentSynthesisAuthenticSourceSetToken,
} from './document-synthesis-authentic-source-set-intake';

const ROOT = path.resolve(__dirname, '../../..');
const TARGET = path.join(ROOT, 'lib/ai-providers/fabric/document-synthesis-authentic-source-set-intake.ts');
const TEST = path.join(ROOT, 'lib/ai-providers/fabric/document-synthesis-authentic-source-set-intake.test.ts');
const TARGET_BASENAME = 'document-synthesis-authentic-source-set-intake';

function evidence(sourceText = 'Synthetic A3a2 source text'): object {
    const projection = Object.freeze(Object.assign(Object.create(null), { label: 'S1' as const, sourceText }));
    const digest = Object.freeze(Array.from({ length: 32 }, (_, index) => index));
    return Object.freeze(Object.assign(Object.create(null), { providerProjection: projection, sourceSetDigestSha256: digest }));
}

function cloneExact(value: object): object {
    const input = value as { providerProjection: { label: 'S1'; sourceText: string }; sourceSetDigestSha256: readonly number[] };
    return evidence(input.providerProjection.sourceText.replace(/^/, ''));
}

function sourceFiles(directory: string, includeTests = false): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...sourceFiles(candidate, includeTests));
        else if (/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(entry.name) && (includeTests || !/\.test\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(entry.name))) files.push(candidate);
    }
    return files;
}

function assertZeroProductionImporters(files: readonly string[], target: string): void {
    const realTarget = realpathSync(target);
    assert.equal(realpathSync(target), realTarget, 'the canonical module must resolve to one realpath');
    const importPattern = new RegExp(`(?:from\\s*['\"][^'\"]*${TARGET_BASENAME}|import\\s*\\(\\s*['\"][^'\"]*${TARGET_BASENAME}|export\\s+(?:\\*|\\{[^}]*\\})\\s+from\\s*['\"][^'\"]*${TARGET_BASENAME}|require\\(\\s*['\"][^'\"]*${TARGET_BASENAME})`, 'u');
    const importers = files.filter((file) => realpathSync(file) !== realTarget && importPattern.test(readFileSync(file, 'utf8')));
    assert.deepEqual(importers, [], `production importers must remain empty: ${importers.join(', ')}`);
    assert.doesNotMatch(readFileSync(path.join(ROOT, 'package.json'), 'utf8'), new RegExp(TARGET_BASENAME, 'u'));
}

test('mints an opaque zero-field token for one exact sealed A3a2 evidence identity', () => {
    const input = evidence();
    const token = intakeDocumentSynthesisA3a2SealedEvidence(input);
    assert.ok(token);
    const opaque: DocumentSynthesisAuthenticSourceSetToken = token;
    assert.notEqual(opaque, input);
    assert.equal(Object.getPrototypeOf(token), null);
    assert.equal(Object.isFrozen(token), true);
    assert.deepEqual(Reflect.ownKeys(token), []);
    for (const forbidden of ['then', 'toJSON', 'id', 'counter', 'digest', 'projection']) assert.equal(forbidden in token, false);
    assert.equal(token instanceof Promise, false);
    assert.equal(intakeDocumentSynthesisA3a2SealedEvidence(input), null, 'the consumed identity cannot be retried');
    assert.ok(intakeDocumentSynthesisA3a2SealedEvidence(cloneExact(input)), 'a separate exact identity is a separate packet');
});

test('denies and consumes every hostile evidence shape without observing accessors or proxy traps', () => {
    let observations = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'providerProjection', { enumerable: true, get() { observations += 1; return null; } });
    Object.defineProperty(accessor, 'sourceSetDigestSha256', { enumerable: true, value: Object.freeze(Array.from({ length: 32 }, (_, index) => index)) });
    Object.freeze(accessor);
    const proxy = new Proxy(evidence(), { get() { observations += 1; throw new Error('trap'); }, ownKeys() { observations += 1; throw new Error('trap'); } });
    const custom = Object.freeze(Object.assign(Object.create({ inherited: true }), Object.create(null, Object.getOwnPropertyDescriptors(evidence()))));
    const extra = Object.freeze(Object.assign(Object.create(null), evidence(), { extra: true }));
    const hidden = Object.create(null, Object.getOwnPropertyDescriptors(evidence())); Object.defineProperty(hidden, 'hidden', { enumerable: false, value: true }); Object.freeze(hidden);
    const symbol = Object.freeze(Object.assign(Object.create(null), evidence(), { [Symbol('synthetic')]: true }));
    const thenable = Object.freeze(Object.assign(Object.create(null), evidence(), { then() { observations += 1; } }));
    const sparseDigest = Array<number>(32); sparseDigest[0] = 0;
    const sparse = Object.freeze(Object.assign(Object.create(null), { providerProjection: Object.freeze(Object.assign(Object.create(null), { label: 'S1' as const, sourceText: 'Synthetic' })), sourceSetDigestSha256: Object.freeze(sparseDigest) }));
    for (const input of [accessor, proxy, custom, extra, hidden, symbol, thenable, sparse]) {
        assert.equal(intakeDocumentSynthesisA3a2SealedEvidence(input), null);
        assert.equal(intakeDocumentSynthesisA3a2SealedEvidence(input), null, 'denial also burns this object identity');
    }
    assert.equal(observations, 0);
});

test('uses captured intrinsics and has no asynchronous or post-publication work', async () => {
    const input = evidence('Synthetic intrinsic test');
    const originals = { create: Object.create, freeze: Object.freeze, prototype: Object.getPrototypeOf, descriptors: Object.getOwnPropertyDescriptors, keys: Reflect.ownKeys };
    const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator); assert.ok(iterator?.configurable);
    const poison = () => { throw new Error('ambient intrinsic poison'); };
    let token: DocumentSynthesisAuthenticSourceSetToken | null = null;
    try {
        Object.create = poison as typeof Object.create; Object.freeze = poison as typeof Object.freeze;
        Object.getPrototypeOf = poison as typeof Object.getPrototypeOf; Object.getOwnPropertyDescriptors = poison as typeof Object.getOwnPropertyDescriptors;
        Reflect.ownKeys = poison as typeof Reflect.ownKeys;
        Object.defineProperty(Array.prototype, Symbol.iterator, { ...iterator, value: poison });
        token = intakeDocumentSynthesisA3a2SealedEvidence(input);
    } finally {
        Object.create = originals.create; Object.freeze = originals.freeze; Object.getPrototypeOf = originals.prototype;
        Object.getOwnPropertyDescriptors = originals.descriptors; Reflect.ownKeys = originals.keys; Object.defineProperty(Array.prototype, Symbol.iterator, iterator!);
    }
    assert.ok(token);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(intakeDocumentSynthesisA3a2SealedEvidence(input), null);
});

test('keeps the canonical module deep-internal with one realpath and no production importers', () => {
    const production = sourceFiles(ROOT);
    assertZeroProductionImporters(production, TARGET);
    const symbolReferences = sourceFiles(ROOT, true).filter((file) => readFileSync(file, 'utf8').includes('intakeDocumentSynthesisA3a2SealedEvidence')).map((file) => realpathSync(file)).sort();
    assert.deepEqual(symbolReferences, [realpathSync(TARGET), realpathSync(TEST)].sort(), 'only the canonical sink and its allowlisted test may name the sink');
    const directory = mkdtempSync(path.join(os.tmpdir(), 'mediflow-a3b1-import-graph-'));
    try {
        const secondImporter = path.join(directory, 'second-production-importer.ts');
        writeFileSync(secondImporter, `import * as intake from './${TARGET_BASENAME}'; void intake;\n`);
        assert.throws(() => assertZeroProductionImporters([TARGET, secondImporter], TARGET), /production importers must remain empty/u);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
    const source = readFileSync(TARGET, 'utf8');
    assert.match(source, /import 'server-only';/u);
    assert.match(source, /WeakMap/u);
    assert.match(source, /WeakSet/u);
    assert.doesNotMatch(source, /export (?:const|class|interface|\{|function (?!intakeDocumentSynthesisA3a2SealedEvidence))/u);
    const sink = source.slice(source.indexOf('export function intakeDocumentSynthesisA3a2SealedEvidence'));
    assert.ok(sink.indexOf('weakSetAdd') < sink.indexOf('const record = copyEvidence'), 'burn precedes validation and copying');
    assert.ok(sink.indexOf('const record = copyEvidence') < sink.indexOf('const token ='), 'copy precedes token construction');
    assert.match(sink, /ReflectApply\(weakMapSet, authenticSourceSets, \[token, record\]\);\n        return token;/u);
    assert.doesNotMatch(sink, /async|Promise|console\.|setTimeout|setImmediate/u);
});
