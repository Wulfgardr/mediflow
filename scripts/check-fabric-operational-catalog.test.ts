import assert from 'node:assert/strict';
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
