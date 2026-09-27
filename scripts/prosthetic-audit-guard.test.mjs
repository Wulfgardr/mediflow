/* @Codex: source mutations check the bounded guard; SQLite tests establish behavior. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prostheticAuditContract, validateRequiredProstheticAudit } from './audit-quality-gate.mjs';

const source = fs.readFileSync('lib/prosthetic-prescription-write.ts', 'utf8');
const cases = [
    ['POST', 'host', 'create', 'app/api/prosthetic-prescriptions/route.ts'],
    ['PUT', 'host', 'update', 'app/api/prosthetic-prescriptions/[id]/route.ts'],
    ['DELETE', 'host', 'delete', 'app/api/prosthetic-prescriptions/[id]/route.ts'],
    ['POST', 'network', 'create', 'app/api/v1/network/prosthetic-prescriptions/route.ts'],
    ['PUT', 'network', 'update', 'app/api/v1/network/prosthetic-prescriptions/[id]/route.ts'],
];
for (const [handler, mode, operation, route] of cases) {
    const spec = prostheticAuditContract(handler, mode, operation);
    const routeSource = fs.readFileSync(route, 'utf8');
    const check = (coreSource = source, adapter = routeSource) => validateRequiredProstheticAudit({ spec, routeSource: adapter, coreSource });
    test(`prosthetic ${mode} ${operation}: candidate wiring and transaction order`, () => {
        assert.deepEqual(check(), []);
        const mutants = [
            source.replaceAll("behavior: 'immediate'", "behavior: 'deferred'"),
            source.replaceAll('writeAuditEventInTransaction(tx,', 'writeAuditEventInTransaction(dbServer,'),
            source.replaceAll('writeAuditEventInTransaction(tx,', 'return { status: 200, value: { success: true } }; writeAuditEventInTransaction(tx,'),
            source.replaceAll('.changes !== 1', '.changes === 1'),
            source.replace('    const actor = auditContextFromSession(context.session);', "    eventType = 'prosthetic.prescription.updated';\n    const actor = auditContextFromSession(context.session);"),
            source.replaceAll(spec.eventType, 'prosthetic.prescription.wrong'),
            source.replace('eventType, outcome:', "eventType: 'prosthetic.prescription.wrong', outcome:"),
            source.replaceAll('writeAuditEventInTransaction(tx,', 'if (false) writeAuditEventInTransaction(tx,'),
        ];
        for (const mutant of mutants) { assert.notEqual(mutant, source); assert.notDeepEqual(check(mutant), []); }
        const adapter = routeSource.replace(spec.serviceExport + '(', 'unapprovedWrite(');
        assert.notEqual(adapter, routeSource); assert.notDeepEqual(check(source, adapter), []);
    });
}

/* @Codex: review reproduced both bypasses against the initial guard. */
test('prosthetic create rejects an unaudited write and success before the approved transaction', () => {
    const spec = prostheticAuditContract('POST', 'host', 'create');
    const coreSource = source.replace('    return dbServer.transaction((tx): MutationResponse => {',
        '    if (rawBody.skipAudit) { dbServer.insert(prostheticPrescriptions).values(normalized.values).run(); return { status: 201, value: { id: normalized.values.id, version: 1 } }; }\n    return dbServer.transaction((tx): MutationResponse => {');
    assert.notEqual(coreSource, source);
    assert.notDeepEqual(validateRequiredProstheticAudit({ spec, coreSource, routeSource: fs.readFileSync(cases[0][3], 'utf8') }), []);
});
