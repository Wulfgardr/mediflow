import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import { chromium } from '@playwright/test';
import { createSyntheticSpecialistDemo } from './synthetic-demo.test-support.ts';
import { createSpecialistNativeSurface } from './native-surface.ts';

// Harness manuale: usa l'helper nativo reale, mai una conferma simulata.
const [scenario, executable] = process.argv.slice(2);
assert.ok(['cancel', 'protected', 'manual'].includes(scenario!));
assert.ok(executable && process.env.MEDIFLOW_DATA_DIR);
const f = await createSyntheticSpecialistDemo(scenario === 'manual' ? 'manual' : 'protected', createSpecialistNativeSurface(executable));
let doctor: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
    assert.notEqual(new URL(f.portal.origin).port, '3000');
    const cap = await f.selectLocal();
    await f.service.prepare(cap);
    if (scenario === 'cancel') {
        await assert.rejects(f.service.approve(cap));
        await assert.rejects(f.service.execute(cap));
    } else if (scenario === 'protected') {
        assert.equal((await f.service.approve(cap)).state, 'authorized');
        assert.equal((await f.service.execute(cap)).state, 'confirmed');
        await assert.rejects(f.service.execute(cap));
    } else {
        assert.equal(f.service.inspect(f.plan.operationId).state, 'awaiting_manual_act');
        await assert.rejects(f.service.execute(cap));
        assert.equal(f.portal.traffic.filter(item => ['/submit', '/physician-submit'].includes(item.path)).length, 0);
        doctor = await chromium.launch({ headless: false });
        const context = await doctor.newContext({ serviceWorkers: 'block', acceptDownloads: false });
        await context.addCookies([f.portal.cookie]);
        const page = await context.newPage(); await page.goto(`${f.portal.origin}/portal`);
        const input = createInterface({ input: process.stdin, output: process.stdout });
        try { await input.question('Controlla i dati inventati, invia e firma nel simulatore; premi Invio per riconciliare.\n'); }
        finally { input.close(); }
        assert.equal((await f.service.reconcile(cap)).state, 'confirmed');
    }
    const sends = f.portal.traffic.filter(item => ['/submit', '/physician-submit'].includes(item.path)).length;
    const records = f.db.prepare('SELECT count(*) FROM service_prescriptions WHERE request_reference IS NOT NULL').pluck().get();
    assert.equal(sends, scenario === 'cancel' ? 0 : 1);
    assert.equal(records, scenario === 'cancel' ? 0 : 1);
    console.log(JSON.stringify({ scenario, state: f.service.inspect(f.plan.operationId).state, sends, records,
        nativeAuthentication: 'da attestare con osservazione di Leonardo' }));
} finally { await doctor?.close(); await f.close(); }
