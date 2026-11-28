import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildOperationalCatalog } from './check-fabric-operational-catalog';
import { getFabricCapabilityDescriptor } from '../lib/ai-providers/fabric/catalog';

const descriptors = [{ ...getFabricCapabilityDescriptor('icd_lookup'), entryPoint: 'lib/synthetic-service.ts' }];
function fixture() {
    return new Map([
        ['lib/synthetic-service.ts', 'export function lookup() { return 7; }'],
        ['app/api/synthetic/route.ts', "import { lookup } from '@/lib/synthetic-service'; export function GET() { requireSession(); return lookup(); }"],
        ['components/synthetic.tsx', "export const read = () => fetch('/api/synthetic');"],
        ['experiments/gpui-patient-pilot/transport/src/synthetic.rs', 'let endpoint = "/api/synthetic";'],
        ['native/MediFlowMac/Synthetic.swift', 'let endpoint = "/api/synthetic"'],
        ['lib/synthetic-service.test.ts', "import { lookup } from './synthetic-service'; test('lookup', () => assert.equal(lookup(), 7));"],
    ]);
}
test('derives service, authentication, consumers and coverage from source paths', () => {
    const result = buildOperationalCatalog(fixture(), descriptors);
    for (const expected of ['requireSession', 'components/synthetic.tsx', 'synthetic.rs', 'Synthetic.swift', 'lib/synthetic-service.test.ts']) assert.ok(result.text.includes(expected), expected);
});
test('rejects a capability when the actual API guard is removed', () => {
    const sources = fixture();
    sources.set('app/api/synthetic/route.ts', sources.get('app/api/synthetic/route.ts')!.replace('requireSession();', ''));
    assert.throws(() => buildOperationalCatalog(sources, descriptors), /icd_lookup: permesso non risolto/);
});
test('rejects a capability when its service loses test coverage', () => {
    const sources = fixture(); sources.delete('lib/synthetic-service.test.ts');
    assert.throws(() => buildOperationalCatalog(sources, descriptors), /icd_lookup: test mancante/);
});
test('rejects a catalog descriptor whose entry point has disappeared', () => {
    const sources = fixture(); sources.delete('lib/synthetic-service.ts');
    assert.throws(() => buildOperationalCatalog(sources, descriptors), /icd_lookup: servizio mancante/);
});

function sharedAuthenticationFixture() {
    const sources = fixture();
    sources.set('lib/shared-auth.ts', `
        export function authorize() { return requireSession() !== null; }
        export function unusedGuard() { return requireScope(); }
    `);
    sources.set('app/api/synthetic/route.ts', `
        import { lookup } from '@/lib/synthetic-service';
        import { authorize } from '@/lib/shared-auth';
        const handle = createRoute({ authorize: () => authorize(), lookup });
        export function GET() { return handle(); }
    `);
    sources.set('app/api/sibling/route.ts', `
        import { lookup } from '@/lib/synthetic-service';
        import { authorize } from '@/lib/shared-auth';
        export function GET() { if (authorize()) return lookup(); }
    `);
    return sources;
}
test('rejects a bypassed callback despite shared authentication and an authenticated sibling', () => {
    const sources = sharedAuthenticationFixture();
    assert.doesNotThrow(() => buildOperationalCatalog(sources, descriptors));
    sources.set('app/api/synthetic/route.ts', sources.get('app/api/synthetic/route.ts')!
        .replace('authorize: () => authorize()', 'authorize: () => true'));
    assert.throws(() => buildOperationalCatalog(sources, descriptors), /icd_lookup: permesso non risolto.*synthetic/);
});

test('ignores an uncalled helper in the entry point', () => {
    const sources = fixture();
    sources.set('app/api/synthetic/route.ts', `
        import { lookup } from '@/lib/synthetic-service';
        function unused() { requireSession(); }
        export function GET() { return lookup(); }
    `);
    assert.throws(() => buildOperationalCatalog(sources, descriptors), /permesso non risolto/);
});
test('follows an imported guard wrapper invoked through an alias', () => {
    const sources = fixture();
    sources.set('lib/auth.ts', 'export function authenticate() { return requireSession(); }');
    sources.set('app/api/synthetic/route.ts', `
        import { lookup } from '@/lib/synthetic-service';
        import { authenticate as check } from '@/lib/auth';
        export function GET() { check(); return lookup(); }
    `);
    const result = buildOperationalCatalog(sources, descriptors);
    assert.ok(result.text.includes('lib/auth.ts: requireSession'));
});
test('keeps a route whose service is reached through a guard-named callback', () => {
    const sources = fixture();
    sources.set('lib/synthetic-preview.ts', `
        export function createSyntheticPreviewService(options) { return { acquire: () => options.createCapability() }; }
        export function createSyntheticPreviewHttpHandler(options) { return () => options.acquirePreview(); }
    `);
    sources.set('lib/synthetic-preview-production.ts', `
        import { lookup } from './synthetic-service';
        import { createSyntheticPreviewService } from './synthetic-preview';
        export const acquireAuthenticatedSyntheticPreview = createSyntheticPreviewService({ createCapability: () => lookup() }).acquire;
    `);
    sources.set('app/api/synthetic/route.ts', `
        import { acquireAuthenticatedSyntheticPreview } from '@/lib/synthetic-preview-production';
        import { createSyntheticPreviewHttpHandler } from '@/lib/synthetic-preview';
        export const POST = withArchiveRequestContext(createSyntheticPreviewHttpHandler({ acquirePreview: acquireAuthenticatedSyntheticPreview }));
    `);
    const result = buildOperationalCatalog(sources, descriptors);
    assert.ok(result.text.includes('app/api/synthetic/route.ts: acquireAuthenticatedSyntheticPreview, withArchiveRequestContext')
        || result.text.includes('app/api/synthetic/route.ts: withArchiveRequestContext'), 'la route resta fra gli ingressi con la sua prova');
});

const navigationFiles = [
    'packages/mcp/src/local-ui-intents.mjs',
    'components/plugin-local-ui-navigation.tsx',
] as const;
const openable = [
    ['patient_insight', 'lib/ai-providers/fabric/patient-insight-host-capability.ts', 'patient-insight'],
    ['document_synthesis', 'lib/ai-providers/fabric/document-synthesis-production-operation.ts', 'document-synthesis'],
    ['smart_import', 'lib/domain/documents/patient-smart-import-host-capability.ts', 'smart-import'],
] as const;

function navigationFixture() {
    const sources = fixture();
    sources.set('plugins/synthetic/client.ts', "export const read = () => fetch('/api/synthetic');");
    for (const file of navigationFiles) sources.set(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    for (const [, service] of openable) {
        sources.set(service, 'export function preview() { requireSession(); }');
        sources.set(service.replace('.ts', '.test.ts'), `import { preview } from '@/${service}';`);
    }
    return sources;
}

function catalogRows(sources: Map<string, string>) {
    const result = buildOperationalCatalog(sources, [
        ...descriptors, ...openable.map(([id]) => getFabricCapabilityDescriptor(id)),
    ]);
    const lines = result.text.split('\n');
    const columns = lines.find(line => line.startsWith('| Funzione |'))!.split(' | ');
    const row = (id: string) => lines.find(line => line.startsWith(`| \`${id}\` |`))!.split(' | ');
    return { column: (id: string, title: string) => row(id)[columns.indexOf(title)], text: result.text };
}

test('documents the product-declared Web opening separately from a plugin service call', () => {
    const { column, text } = catalogRows(navigationFixture());
    for (const [id, , anchor] of openable) {
        assert.equal(column(id, 'Apertura Web dal plugin'), `\`${id}\` → \`#${anchor}\``);
        assert.equal(column(id, 'Chat/plugin · chiamate al servizio'), 'Nessun percorso rilevato');
    }
    assert.equal(column('icd_lookup', 'Apertura Web dal plugin'), 'Nessun percorso rilevato');
    assert.equal(column('icd_lookup', 'Chat/plugin · chiamate al servizio'), '`plugins/synthetic/client.ts`');
    assert.match(text, /Il medico conferma l’apertura nella scheda Web e avvia la generazione nella funzione aperta/u);
});

test('the catalog requires both the declared plugin intent and the Web anchor mapping', () => {
    const sources = navigationFixture();
    sources.set(navigationFiles[0], sources.get(navigationFiles[0])!.replace("  patient_insight: 'patient_insight',", ''));
    sources.set(navigationFiles[1], sources.get(navigationFiles[1])!
        .replace("document_synthesis: 'document-synthesis',", "")
        .replace('const anchors = {', "const anchors = { icd_lookup: 'icd',"));
    const { column } = catalogRows(sources);
    for (const id of ['patient_insight', 'document_synthesis', 'icd_lookup']) {
        assert.equal(column(id, 'Apertura Web dal plugin'), 'Nessun percorso rilevato');
    }
    assert.equal(column('smart_import', 'Apertura Web dal plugin'), '`smart_import` → `#smart-import`');
});
