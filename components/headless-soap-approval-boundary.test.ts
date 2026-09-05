/* @Codex */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const coordinatorPath = 'components/headless-soap-approval.tsx';
const dialogPath = 'components/headless-soap-approval-dialog.tsx';
const ownerFactory = 'createClinicianSoapExplicitGestureOwner';

function productionTypeScriptSources(directory: string): string[] {
    const ignoredDirectories = new Set(['.git', '.next', 'coverage', 'node_modules']);
    const sources: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) {
                sources.push(...productionTypeScriptSources(resolve(directory, entry.name)));
            }
            continue;
        }
        if (/\.(?:ts|tsx)$/u.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)) {
            sources.push(resolve(directory, entry.name));
        }
    }
    return sources.sort();
}

function repositoryPath(absolutePath: string): string {
    return relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
}

function importDeclarations(source: string): string[] {
    return source.match(/\bimport\s+(?!\()[\s\S]*?;/gu) ?? [];
}

function importSpecifiers(source: string): string[] {
    const specifiers: string[] = [];
    for (const declaration of importDeclarations(source)) {
        const match = declaration.match(/(?:\bfrom\s+|^\s*import\s*)['"]([^'"]+)['"]/u);
        if (match?.[1]) specifiers.push(match[1]);
    }
    for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
        if (match[1]) specifiers.push(match[1]);
    }
    return specifiers;
}

function receivesOrInvokesExplicitGesture(source: string): boolean {
    return /\bonExplicitGesture\s*\??\s*:/u.test(source)
        || /\bonExplicitGesture\s*\(\s*\)/u.test(source)
        || /\bonClick\s*=\s*\{\s*onExplicitGesture\s*\}/u.test(source);
}

test('H5a keeps explicit SOAP approval inside one dedicated UI boundary without route or transport authority', () => {
    const sources = productionTypeScriptSources(repositoryRoot);
    const ownerImporters = sources.filter((path) => importDeclarations(readFileSync(path, 'utf8'))
        .some((declaration) => new RegExp(`\\b${ownerFactory}\\b`, 'u').test(declaration)))
        .map(repositoryPath);
    assert.deepEqual(ownerImporters, [coordinatorPath],
        `${coordinatorPath} must be the sole production importer of ${ownerFactory}`);

    const coordinatorAbsolute = resolve(repositoryRoot, coordinatorPath);
    assert.ok(existsSync(coordinatorAbsolute), `${coordinatorPath} must exist`);
    const coordinatorSource = readFileSync(coordinatorAbsolute, 'utf8');
    const coordinatorImports = importDeclarations(coordinatorSource);
    const coordinatorSpecifiers = importSpecifiers(coordinatorSource);

    assert.ok(coordinatorImports.some((declaration) => /\buseSecurity\b/u.test(declaration)
        && /['"]\.\/security-provider(?:\.tsx)?['"]/u.test(declaration)),
    `${coordinatorPath} must obtain H4 seal capabilities from useSecurity`);
    assert.match(coordinatorSource, /\buseSecurity\s*\(\s*\)/u);
    assert.match(coordinatorSource, /\bsealClinicianSoapEntry\b/u);
    assert.match(coordinatorSource, /\breopenClinicianSoapEntry\b/u);
    assert.equal(coordinatorImports.some((declaration) =>
        /\b(?:sealClinicianSoapEntry|reopenClinicianSoapEntry)\b/u.test(declaration)), false,
    'seal/reopen must not be imported outside useSecurity');
    assert.equal(coordinatorSpecifiers.some((specifier) =>
        /clinician-soap-entry-seal(?:-codec-internal)?(?:\.ts)?$/u.test(specifier)), false,
    'the H4 seal owner and codec must remain behind SecurityProvider');

    const forbiddenCoordinatorImport = /chat|mini|planner|session[-_/a-z]*physician[-_/a-z]*review[-_/a-z]*authority|pin|proof|writer|database|(?:^|[/'"_.-])db(?:$|[/'"_.-])/iu;
    assert.deepEqual(coordinatorImports.filter((declaration) => forbiddenCoordinatorImport.test(declaration)), [],
        'the H5a coordinator must not import conversational, review-authority, PIN/proof, writer, or DB seams');

    const dialogAbsolute = resolve(repositoryRoot, dialogPath);
    assert.ok(existsSync(dialogAbsolute), `${dialogPath} must exist`);
    const dialogSource = readFileSync(dialogAbsolute, 'utf8');
    assert.match(dialogSource, /\bHeadlessSoapApprovalDialog\b/u);
    assert.match(dialogSource, /\bonExplicitGesture\s*\??\s*:/u);
    assert.ok(/\bonExplicitGesture\s*\(\s*\)/u.test(dialogSource)
        || /\bonClick\s*=\s*\{\s*onExplicitGesture\s*\}/u.test(dialogSource),
    `${dialogPath} must invoke the explicit gesture only from its dedicated CTA`);

    const gestureConsumers = sources.filter((path) =>
        receivesOrInvokesExplicitGesture(readFileSync(path, 'utf8'))).map(repositoryPath);
    assert.deepEqual(gestureConsumers, [dialogPath],
        `${dialogPath} must be the sole production receiver/invoker of onExplicitGesture`);

    const h5aToken = /\b(?:createClinicianSoapExplicitGestureOwner|HeadlessSoapApprovalDialog|onExplicitGesture)\b|headless-soap-approval/u;
    const h5aParticipants = sources.filter((path) => h5aToken.test(readFileSync(path, 'utf8')));
    const routeParticipants = h5aParticipants.map(repositoryPath)
        .filter((path) => /^app\/(?:.*\/)?route\.(?:ts|tsx)$/u.test(path));
    assert.deepEqual(routeParticipants, [], 'H5a must not add or reuse an application route');

    const forbiddenTransportImport = /route(?:[./-]|$)|transport|next\/server|app\/api|node:https?|axios|undici/iu;
    const forbiddenTransportCall = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|axios)\s*(?:\(|\.)|\bnavigator\s*\.\s*sendBeacon\s*\(/u;
    for (const path of h5aParticipants) {
        const source = readFileSync(path, 'utf8');
        assert.deepEqual(importSpecifiers(source).filter((specifier) => forbiddenTransportImport.test(specifier)), [],
            `${repositoryPath(path)} must not import a route or transport`);
        assert.doesNotMatch(source, forbiddenTransportCall,
            `${repositoryPath(path)} must not create an H5a transport`);
    }
});
