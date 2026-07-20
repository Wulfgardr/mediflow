import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDbChangeBus } from './live-query-scope';

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `invalid source markers: ${startMarker} -> ${endMarker}`);
    return source.slice(start, end);
}

/* @Codex */
test('a table notification wakes only matching and unscoped subscribers', () => {
    const bus = createDbChangeBus();
    let patientInvalidations = 0;
    let observationInvalidations = 0;
    let globalInvalidations = 0;

    bus.subscribe(() => { patientInvalidations += 1; }, ['patients']);
    bus.subscribe(() => { observationInvalidations += 1; }, ['observations']);
    bus.subscribe(() => { globalInvalidations += 1; });

    bus.notify('observations');

    assert.equal(patientInvalidations, 0);
    assert.equal(observationInvalidations, 1);
    assert.equal(globalInvalidations, 1);
});

test('an unscoped notification wakes every subscriber', () => {
    const bus = createDbChangeBus();
    let patientInvalidations = 0;
    let observationInvalidations = 0;
    let globalInvalidations = 0;

    bus.subscribe(() => { patientInvalidations += 1; }, ['patients']);
    bus.subscribe(() => { observationInvalidations += 1; }, ['observations']);
    bus.subscribe(() => { globalInvalidations += 1; });

    bus.notify();

    assert.equal(patientInvalidations, 1);
    assert.equal(observationInvalidations, 1);
    assert.equal(globalInvalidations, 1);
});

test('subscriptions observe their latest scope and can unsubscribe', () => {
    const bus = createDbChangeBus();
    let scope: readonly string[] = ['patients'];
    let scopedInvalidations = 0;
    let globalInvalidations = 0;
    bus.subscribeWithScopeResolver(() => { scopedInvalidations += 1; }, () => scope);
    const unsubscribeGlobal = bus.subscribe(() => { globalInvalidations += 1; }, []);

    bus.notify('patients');
    scope = ['observations'];
    bus.notify('patients');
    bus.notify('observations');
    unsubscribeGlobal();
    bus.notify();

    assert.equal(scopedInvalidations, 3);
    assert.equal(globalInvalidations, 3);
});

test('composite mutations retain every required invalidation', () => {
    const serviceSource = readFileSync('components/service-prescription-manager.tsx', 'utf8');
    const deleteBlock = sourceBetween(serviceSource, 'const deleteItem', 'const headerActions');
    assert.doesNotMatch(deleteBlock, /servicePrescriptionItems\.delete/);
    assert.match(deleteBlock, /try\s*\{[\s\S]*servicePrescriptions\.delete[\s\S]*\}\s*catch \(error\) \{[^}]*notifyDbChange\('service_prescriptions'\);[^}]*throw error;\s*\}\s*finally\s*\{[^}]*notifyDbChange\('service_prescription_items'\);\s*\}/);
    const clipboardSource = readFileSync('hooks/use-patient-clipboard.ts', 'utf8');
    assert.match(clipboardSource, /return await executePatientClipboardPaste\(\s*clipboard,\s*targetAmbulatoryId,\s*isTestEnvironment,/);
    assert.match(clipboardSource, /notifyDbChange\(\)/);
    assert.doesNotMatch(clipboardSource, /fetch\(/);
    const helperSource = readFileSync('lib/patient-clipboard.ts', 'utf8');
    assert.match(helperSource, /endpoint = '\/api\/patients\/move'/);
    assert.match(helperSource, /hasExactPatientVersions/);
    assert.doesNotMatch(helperSource, /api\/patients\/unassign/);
});

test('both React hooks retain dynamic scope resolver wiring', () => {
    const source = readFileSync('lib/live-query.ts', 'utf8');
    const hookBlocks = [
        sourceBetween(source, 'export function useLiveQuery<', 'export type LiveQueryState'),
        sourceBetween(source, 'export function useLiveQueryState<', '    return { data, error, loading };'),
    ];
    for (const hookBlock of hookBlocks) {
        assert.match(hookBlock, /const tablesRef = useRef\(tables\);\s*tablesRef\.current = tables;/);
        assert.match(hookBlock, /dbChangeBus\.subscribeWithScopeResolver\(\(\) => \{[\s\S]*?\}, \(\) => tablesRef\.current\), \[\]\)/);
    }
});
