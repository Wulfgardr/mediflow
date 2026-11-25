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
    ['POST', 'network', 'create', 'app/api/v1/network/ambulatories/route.ts'],
    ['PUT', 'network', 'update', 'app/api/v1/network/ambulatories/[id]/route.ts'],
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
            const catchGuard = "if (error instanceof VersionExhaustedError) return { status: 409, value: { error: 'Patient version cannot advance safely' } };";
            const mutations = [
                core.replace(catchGuard, catchGuard.replace('VersionExhaustedError', 'Error')),
                core.replace(catchGuard, catchGuard.replace('409', '200')),
                core.replace('throw error;', 'return { status: 409, value: { error: "anything" } };'),
                core.replace('throw error;\n    }', 'throw error;\n    } finally { return { status: 200, value: {} }; }'),
                core.replace('const result = clearTestContainerByMembership(tx, ambulatoryId);',
                    'let result; try { result = clearTestContainerByMembership(tx, ambulatoryId); } catch (error) { ' + catchGuard + ' throw error; }'),
                core.replace('const result = clearTestContainerByMembership(tx, ambulatoryId);',
                    'if (true) return { status: 409, value: {} }; const result = clearTestContainerByMembership(tx, ambulatoryId);'),
                core.replace('export function clearAmbulatoryInTransaction', 'export async function clearAmbulatoryInTransaction'),
                core.replace(catchGuard, 'const VersionExhaustedError = Error; ' + catchGuard),
            ];
            for (const mutant of mutations) {
                assert.notEqual(mutant, core);
                assert.notDeepEqual(check(mutant), [], `clear mutation ${mutations.indexOf(mutant)}`);
            }

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

const DESTRUCTIVE_CORE_CALLERS = new Set([
    'lib/security/ambulatory-destructive-service.ts',
    'lib/security/web-ambulatory-destructive-service.ts',
    'lib/ambulatory-host-destructive-test-fixture.ts',
]);
function productSources(directory) {
    return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile() && /\.(ts|tsx|mjs)$/u.test(entry.name) && !/\.test\.|\.spec\./u.test(entry.name))
        .map(entry => `${entry.parentPath}/${entry.name}`.replace(/^\.\//u, ''));
}
export function destructiveAmbulatoryCoreViolations(files, readSource = file => fs.readFileSync(file, 'utf8')) {
    return files.filter(file => file !== 'lib/ambulatory-write.ts' && !DESTRUCTIVE_CORE_CALLERS.has(file)
        && /\b(?:delete|clear)AmbulatoryInTransaction\b/u.test(readSource(file)));
}

test('ADR 0201: only the two confirmed commands reach the ambulatory delete and clear Tx cores', () => {
    const files = [...productSources('app'), ...productSources('lib'), ...productSources('components')];
    assert.deepEqual(destructiveAmbulatoryCoreViolations(files), []);
    assert.deepEqual(destructiveAmbulatoryCoreViolations(['app/api/ambulatories/clear/route.ts'],
        () => "import { clearAmbulatoryInTransaction } from '@/lib/ambulatory-write';"), ['app/api/ambulatories/clear/route.ts']);
    assert.equal(/export (?:async )?function (?:deleteAmbulatory|clearAmbulatory)\b/u.test(core), false);
});

test('ADR 0201: no host route deletes or clears a sede outside the confirmed command', () => {
    assert.equal(/export (?:async )?function DELETE\b/u.test(fs.readFileSync('app/api/ambulatories/[id]/route.ts', 'utf8')), false);
    assert.equal(fs.existsSync('app/api/ambulatories/clear/route.ts'), false);
    for (const route of ['prepare', 'execute']) {
        const source = fs.readFileSync(`app/api/ambulatories/commands/${route}/route.ts`, 'utf8');
        assert.match(source, new RegExp(`webAmbulatoryDestructiveHttp\\(request, '${route}'\\)`, 'u'));
    }
});
