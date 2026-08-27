/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
    intakeDocumentSynthesisA3a2SealedEvidence,
    type DocumentSynthesisAuthenticSourceSetToken,
} from './document-synthesis-authentic-source-set-intake';

const ROOT = path.resolve(__dirname, '../../..');
const TARGET = path.join(ROOT, 'lib/ai-providers/fabric/document-synthesis-authentic-source-set-intake.ts');
const TEST = path.join(ROOT, 'lib/ai-providers/fabric/document-synthesis-authentic-source-set-intake.test.ts');
const EXCHANGE = path.join(ROOT, 'lib/ai-providers/fabric/document-synthesis-authenticated-attachment-capture.ts');
const EXCHANGE_TEST = path.join(ROOT, 'lib/ai-providers/fabric/document-synthesis-authenticated-attachment-capture.test.ts');
const TARGET_BASENAME = 'document-synthesis-authentic-source-set-intake';

function evidence(sourceText = 'Synthetic A3a2 source text'): object {
    const projection = Object.freeze(Object.assign(Object.create(null), { label: 'S1' as const, sourceText }));
    const digest = Object.freeze(Array.from({ length: 32 }, (_, index) => index));
    return Object.freeze(Object.assign(Object.create(null), { providerProjection: projection, sourceSetDigestSha256: digest }));
}

function runPreImportReentry(kind: 'isProxy' | 'weakMapSet' | 'weakSetHas' | 'weakSetAdd'): unknown {
    const script = `
import { types } from 'node:util';
const exact = (text) => Object.freeze(Object.assign(Object.create(null), {
  providerProjection: Object.freeze(Object.assign(Object.create(null), { label: 'S1', sourceText: text })),
  sourceSetDigestSha256: Object.freeze(Array.from({ length: 32 }, (_, index) => index)),
}));
const outer = exact('Synthetic outer'); const inner = exact('Synthetic inner');
let intake = null; let innerResult = null; let fired = false;
let unhandled = 0; process.on('unhandledRejection', () => { unhandled += 1; });
if (${JSON.stringify(kind)} === 'isProxy') {
  const original = types.isProxy;
  types.isProxy = (value) => { if (intake && !fired) { fired = true; innerResult = intake(inner); } return original(value); };
} else if (${JSON.stringify(kind)} === 'weakMapSet') {
  const original = WeakMap.prototype.set;
  WeakMap.prototype.set = function (key, value) { const result = Reflect.apply(original, this, [key, value]); if (intake && !fired) { fired = true; innerResult = intake(inner); } return result; };
} else {
  const method = ${JSON.stringify(kind)} === 'weakSetHas' ? 'has' : 'add'; const original = WeakSet.prototype[method];
  WeakSet.prototype[method] = function (...args) { const result = Reflect.apply(original, this, args); if (intake && !fired) { fired = true; innerResult = intake(inner); } return result; };
}
({ intakeDocumentSynthesisA3a2SealedEvidence: intake } = await import(${JSON.stringify(pathToFileURL(TARGET).href)}));
const outerResult = intake(outer);
await new Promise((resolve) => setImmediate(resolve));
process.stdout.write(JSON.stringify({ outer: outerResult === null, inner: innerResult === null, outerReplay: intake(outer) === null, innerReplay: intake(inner) === null, recovery: intake(exact('Synthetic recovery')) !== null, unhandled }));
`;
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--import', path.join(ROOT, 'scripts/register-strip-types-loader.mjs'), '--conditions=react-server', '--input-type=module', '--eval', script], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as unknown;
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

function assertCanonicalProductionImporter(files: readonly string[], target: string): void {
    const realTarget = realpathSync(target);
    assert.equal(realpathSync(target), realTarget, 'the canonical module must resolve to one realpath');
    const importPattern = new RegExp(`(?:from\\s*['\"][^'\"]*${TARGET_BASENAME}|import\\s*\\(\\s*['\"][^'\"]*${TARGET_BASENAME}|export\\s+(?:\\*|\\{[^}]*\\})\\s+from\\s*['\"][^'\"]*${TARGET_BASENAME}|require\\(\\s*['\"][^'\"]*${TARGET_BASENAME})`, 'u');
    const importers = files.filter((file) => realpathSync(file) !== realTarget && importPattern.test(readFileSync(file, 'utf8')));
    assert.deepEqual(importers, [], `the legacy A3a3 sink must have no production importer: ${importers.join(', ')}`);
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
    assert.ok(intakeDocumentSynthesisA3a2SealedEvidence(evidence()), 'a separate exact identity is a separate packet');
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

test('poisons the outer intake when pre-import IsProxy, WeakMap, or WeakSet reenters', () => {
    const denied = { outer: true, inner: true, outerReplay: true, innerReplay: true, recovery: true, unhandled: 0 };
    assert.deepEqual(runPreImportReentry('isProxy'), denied);
    assert.deepEqual(runPreImportReentry('weakMapSet'), denied);
    assert.deepEqual(runPreImportReentry('weakSetHas'), denied);
    assert.deepEqual(runPreImportReentry('weakSetAdd'), denied);
});

test('rejects accessor descriptors despite Object.prototype field pollution', () => {
    let reads = 0;
    const projection = Object.freeze(Object.assign(Object.create(null), { label: 'S1' as const, sourceText: 'Synthetic polluted descriptor' }));
    const input = Object.create(null); Object.defineProperties(input, {
        providerProjection: { enumerable: true, get() { reads += 1; return null; } },
        sourceSetDigestSha256: { enumerable: true, value: Object.freeze(Array.from({ length: 32 }, (_, index) => index)) },
    }); Object.freeze(input);
    try {
        Object.defineProperty(Object.prototype, 'writable', { configurable: true, value: false });
        Object.defineProperty(Object.prototype, 'value', { configurable: true, value: projection });
        assert.equal(intakeDocumentSynthesisA3a2SealedEvidence(input), null);
        assert.equal(intakeDocumentSynthesisA3a2SealedEvidence(input), null);
    } finally { delete (Object.prototype as { writable?: unknown }).writable; delete (Object.prototype as { value?: unknown }).value; }
    assert.equal(reads, 0); assert.ok(intakeDocumentSynthesisA3a2SealedEvidence(evidence('Synthetic descriptor recovery')));
});

test('keeps the canonical legacy module deep-internal with one realpath and no production importer', () => {
    const production = sourceFiles(ROOT);
    assertCanonicalProductionImporter(production, TARGET);
    const symbolReferences = sourceFiles(ROOT, true).filter((file) => readFileSync(file, 'utf8').includes('intakeDocumentSynthesisA3a2SealedEvidence')).map((file) => realpathSync(file)).sort();
    assert.deepEqual(symbolReferences, [realpathSync(TARGET), realpathSync(TEST), realpathSync(EXCHANGE_TEST)].sort(),
        'only the canonical sink and allowlisted tests may name the legacy sink');
    const directory = mkdtempSync(path.join(os.tmpdir(), 'mediflow-a3b1-import-graph-'));
    try {
        const secondImporter = path.join(directory, 'second-production-importer.ts');
        writeFileSync(secondImporter, `import * as intake from './${TARGET_BASENAME}'; void intake;\n`);
        assert.throws(() => assertCanonicalProductionImporter([TARGET, EXCHANGE, secondImporter], TARGET), /must have no production importer/u);
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
    const publication = sink.indexOf('ReflectApply(weakMapSet, authenticSourceSets, [token, record])');
    assert.ok(publication < sink.indexOf('if (reentryPoisoned)', publication) && sink.indexOf('if (reentryPoisoned)', publication) < sink.indexOf('return token', publication), 'publication rechecks reentry before returning');
    assert.match(sink, /weakMapDelete/u);
    assert.doesNotMatch(sink, /async|Promise|console\.|setTimeout|setImmediate/u);
});
