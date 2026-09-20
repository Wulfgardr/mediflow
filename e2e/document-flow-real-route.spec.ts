/* @Codex: full application and authenticated routes, isolated synthetic data only. */
import { expect, test } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, setAiLaneKillSwitch } from './utils';
import { assertDocumentFlowRealRoutes } from './document-flow-real-route.acceptance';
import { AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY } from '../lib/ai-document-synthesis-kill-switch';

test('Documenti: upload, persistenza, consultazione e cancellazione senza generazione implicita', async ({ page, baseURL }, info) => {
    test.skip(process.env.E2E_DOCUMENTS_SYNTHETIC_ONLY !== '1', 'Requires explicit isolated synthetic data');
    expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await setAiLaneKillSwitch(page, AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, 'disabled');
    const patientId = await page.evaluate(async () => {
        const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Documento', lastName: 'Sintetico', taxCode: `DOC${suffix}X`, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }),
        });
        if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
        return (await response.json() as { id: string }).id;
    });
    await assertDocumentFlowRealRoutes(page, info, {
        confirmedSyntheticSandbox: true,
        patientUrl: `${baseURL}/patients/${patientId}/modules`, expectedPageTitle: /MediFlow/,
        synthesis: { mode: 'disabled' },
    });
});
