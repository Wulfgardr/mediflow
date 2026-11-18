import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { serviceAuditContract, validateRequiredServiceAudit } from './audit-quality-gate.mjs';

const source = fs.readFileSync('lib/service-prescription-write.ts', 'utf8');
const cases = [
    ['POST', 'host', 'create', 'parent', 'app/api/service-prescriptions/route.ts'],
    ['PUT', 'host', 'update', 'parent', 'app/api/service-prescriptions/[id]/route.ts'],
    ['DELETE', 'host', 'delete', 'parent', 'app/api/service-prescriptions/[id]/route.ts'],
    ['POST', 'host', 'create', 'item', 'app/api/service-prescription-items/route.ts'],
    ['PUT', 'host', 'update', 'item', 'app/api/service-prescription-items/[id]/route.ts'],
    ['DELETE', 'host', 'delete', 'item', 'app/api/service-prescription-items/[id]/route.ts'],
    ['POST', 'network', 'create', 'parent', 'app/api/v1/network/service-prescriptions/route.ts'],
    ['PUT', 'network', 'update', 'parent', 'app/api/v1/network/service-prescriptions/[id]/route.ts'],
    ['POST', 'network', 'create', 'item', 'app/api/v1/network/service-prescription-items/route.ts'],
    ['PUT', 'network', 'update', 'item', 'app/api/v1/network/service-prescription-items/[id]/route.ts'],
];
for (const [handler, mode, operation, resource, route] of cases) {
    const spec = serviceAuditContract(handler, mode, operation, resource);
    const routeSource = fs.readFileSync(route, 'utf8');
    const check = (coreSource = source, adapter = routeSource) => validateRequiredServiceAudit({ spec, routeSource: adapter, coreSource });
    test(`service ${resource} ${mode} ${operation}: transaction and delegate`, () => {
        assert.deepEqual(check(), []);
        const mutants = [
            source.replaceAll("behavior: 'immediate'", "behavior: 'deferred'"),
            source.replaceAll('writeAuditEventInTransaction(tx,', 'writeAuditEventInTransaction(dbServer,'),
            source.replaceAll('.changes !== 1', '.changes === 1'),
            source.replaceAll(spec.eventType, 'service.prescription.wrong'),
            source.replaceAll('writeAuditEventInTransaction(tx,', 'if (false) writeAuditEventInTransaction(tx,'),
        ];
        for (const mutant of mutants) { assert.notEqual(mutant, source); assert.notDeepEqual(check(mutant), []); }
        const adapter = routeSource.replace(spec.serviceExport + '(', 'unapprovedWrite(');
        assert.notEqual(adapter, routeSource); assert.notDeepEqual(check(source, adapter), []);
    });
    if (operation === 'create' && resource === 'item') {
        test(`service item ${mode}: synchronous delegate keeps the transaction and surface`, () => {
            assert.deepEqual(check(), []);
            const call = mode === 'host'
                ? "createHostServicePrescriptionItemInTransaction(tx, context, rawBody)"
                : "createServicePrescriptionItemInTransaction(tx, context, body, surface, authorizeCommit)";
            const mutations = [
                [`tx => ${call}`, `async tx => ${call}`],
                [call, call.replace('(tx,', '(dbServer,')],
                ['function createServicePrescriptionItemInTransaction', 'async function createServicePrescriptionItemInTransaction'],
                mode === 'host'
                    ? ["parsed.data, 'host', null", "parsed.data, 'network', null"]
                    : [call, call.replace('surface,', "'host',")],
            ];
            for (const [from, to] of mutations) {
                const mutant = source.replace(from, to);
                assert.notEqual(mutant, source);
                assert.notDeepEqual(check(mutant), [], from);
            }
        });
    }
}
