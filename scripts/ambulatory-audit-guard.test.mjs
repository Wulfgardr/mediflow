/* @Codex: route and owner mutations for all eight ordinary ambulatory writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ambulatoryAuditContract, validateRequiredAmbulatoryAudit } from './audit-quality-gate.mjs';

const core = fs.readFileSync('lib/ambulatory-write.ts', 'utf8');
const adapter = fs.readFileSync('lib/network-ambulatory-write.ts', 'utf8');
const clear = fs.readFileSync('lib/test-container-clear.ts', 'utf8');
const cases = [
    ['POST', 'host', 'create', 'app/api/ambulatories/route.ts'],
    ['PUT', 'host', 'update', 'app/api/ambulatories/[id]/route.ts'],
    ['DELETE', 'host', 'delete', 'app/api/ambulatories/[id]/route.ts'],
    ['POST', 'host', 'clear', 'app/api/ambulatories/clear/route.ts'],
    ['POST', 'network', 'create', 'app/api/v1/network/ambulatories/route.ts'],
    ['PUT', 'network', 'update', 'app/api/v1/network/ambulatories/[id]/route.ts'],
    ['DELETE', 'network', 'delete', 'app/api/v1/network/ambulatories/[id]/route.ts'],
    ['POST', 'network', 'clear', 'app/api/v1/network/ambulatories/clear/route.ts'],
];
for (const [handler, mode, operation, route] of cases) {
    const spec = ambulatoryAuditContract(handler, mode, operation);
    const routeSource = fs.readFileSync(route, 'utf8');
    const check = (coreSource = core, adapterSource = adapter, routeText = routeSource, clearSource = clear) =>
        validateRequiredAmbulatoryAudit({ spec, routeSource: routeText, coreSource, adapterSource, clearSource });
    test(`ambulatory ${mode} ${operation} audit wiring`, () => {
        assert.deepEqual(check(), []);
        const mutants = [
            core.replaceAll("behavior: 'immediate'", "behavior: 'deferred'"),
            core.replaceAll('writeAuditEventInTransaction(tx,', 'writeAuditEventInTransaction(dbServer,'),
            core.replaceAll('.changes !== 1', '.changes === 1'),
            core.replaceAll(spec.eventType, 'ambulatory.wrong'),
            ...(operation === 'clear' ? [] : [core.replaceAll('auditDefaultChange(tx, context, surface,', 'auditDefaultChange(dbServer, context, surface,')]),
        ];
        for (const mutant of mutants) {
            assert.notEqual(mutant, core);
            assert.notDeepEqual(check(mutant), []);
        }
        const unreachable = core.replaceAll(
            `writeAuditEventInTransaction(tx, ambulatoryAuditInput(context, surface, '${spec.eventType}'`,
            `if (false) writeAuditEventInTransaction(tx, ambulatoryAuditInput(context, surface, '${spec.eventType}'`,
        );
        assert.notEqual(unreachable, core);
        assert.notDeepEqual(check(unreachable), []);
        if (mode === 'network') {
            const mutant = adapter.replaceAll("'network'", "'host'");
            assert.notDeepEqual(check(core, mutant), []);
        }
        if (operation === 'clear') {
            assert.notDeepEqual(check(core.replace("'patient.updated', 'patient', patient.id", "'patient.deleted', 'patient', patient.id")), []);
            assert.notDeepEqual(check(core.replace('result.unlinkedPatients', 'result.clearedPatients')), []);
            assert.notDeepEqual(check(core, adapter, routeSource, clear.replace('updated.changes !== 1', 'updated.changes === 1')), []);
            assert.notDeepEqual(check(core, adapter, routeSource, clear.replace('tombstone.changes !== 1', 'tombstone.changes === 1')), []);
            assert.notDeepEqual(check(core, adapter, routeSource, clear.replace('removedMembershipRows !== memberIds.length', 'removedMembershipRows === memberIds.length')), []);
        }
        const routeMutant = routeSource.replace(spec.serviceExport + '(', 'unapprovedWrite(');
        assert.notEqual(routeMutant, routeSource);
        assert.notDeepEqual(check(core, adapter, routeMutant), []);
    });
}
