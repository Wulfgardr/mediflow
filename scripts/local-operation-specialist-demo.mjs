import { createInterface } from 'node:readline/promises';
import { chromium } from '@playwright/test';
import { createSyntheticSpecialistDemo } from '../lib/local-operation/specialist/synthetic-demo.test-support.ts';
import { createSpecialistNativeSurface } from '../lib/local-operation/specialist/native-surface.ts';

const [mode, executable] = process.argv.slice(2);
if (!['protected', 'manual'].includes(mode) || !executable || !process.env.MEDIFLOW_DATA_DIR) {
    console.error('CU_DEMO_CONFIGURATION_REQUIRED'); process.exit(1);
}
let demo, doctor;
try {
    const native = createSpecialistNativeSurface(executable);
    demo = await createSyntheticSpecialistDemo(mode, native);
    const capability = await demo.selectLocal();
    await demo.service.prepare(capability);
    if (mode === 'protected') {
        await demo.service.approve(capability); await demo.service.execute(capability);
    } else {
        doctor = await chromium.launch({ headless: false });
        const context = await doctor.newContext({ serviceWorkers: 'block', acceptDownloads: false });
        await context.addCookies([demo.portal.cookie]);
        const page = await context.newPage(); await page.goto(`${demo.portal.origin}/portal`);
        const input = createInterface({ input: process.stdin, output: process.stdout });
        try { await input.question('Invia e firma nel simulatore, poi premi Invio per riconciliare.\n'); }
        finally { input.close(); }
        await demo.service.reconcile(capability);
    }
    console.log('CU_DEMO_LOCAL_RESULT_AVAILABLE');
} catch { console.error('CU_DEMO_UNAVAILABLE'); process.exitCode = 1; }
finally { await doctor?.close(); await demo?.close(); }
