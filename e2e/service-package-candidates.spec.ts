import { expect, test } from './fixtures/isolated-runtime';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, openUnlockedDocument, unlockIfNeeded } from './utils';

test('WUL-923: candidati personali da storico in Impostazioni Repertori (vuoto, 50 prescrizioni, revisione, correzione, scarto)', async ({ page, baseURL }) => {
    test.setTimeout(180_000);

    const externalOrigins: string[] = [];
    const aiRequests: string[] = [];
    const pageErrors: string[] = [];
    let trackingReviewWrites = false;
    const unexpectedClinicalWrites: string[] = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(baseURL!).origin) {
            externalOrigins.push(url.origin);
            return route.abort();
        }
        return route.continue();
    });
    await page.route('**/api/siss/session-status', (route) =>
        route.fulfill({ json: { status: 'unavailable', source: 'synthetic', checkpoints: [] } }),
    );
    page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (/^\/api\/(ai|chat|smart-import|document-synthesis|insights)/u.test(pathname)) {
            aiRequests.push(`${request.method()} ${pathname}`);
        }
        if (
            trackingReviewWrites
            && request.method() !== 'GET'
            && /^\/api\/(service-prescriptions|service-prescription-items|therapies|entries)/u.test(pathname)
        ) {
            unexpectedClinicalWrites.push(`${request.method()} ${pathname}`);
        }
    });

    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await openUnlockedDocument(page, '/settings/repertori');

    const panel = page.getByTestId('service-package-candidates-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: /^Gruppi di prestazioni dallo storico/u }).click();

    await panel.getByTestId('analyze-service-candidates-button').click();
    await expect(panel.getByTestId('service-candidates-empty')).toBeVisible();
    await assertNoHorizontalOverflow(page, [{ label: 'repertori-vuoto', selector: 'document' }]);

    await page.evaluate(async () => {
        const createPatient = async (index: number, diagnoses: Array<{ code: string; system: string; description: string; date: null }>) => {
            const response = await fetch('/api/patients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    firstName: `NomeSyn${index}`,
                    lastName: `CognomeSyn${index}`,
                    taxCode: `SYN923${String(index).padStart(10, '0')}`,
                    birthDate: '1970-01-01T00:00:00.000Z',
                    diagnoses,
                }),
            });
            if (response.status !== 201) throw new Error(`Patient create failed: ${response.status}`);
            const data = (await response.json()) as { id: string };
            return data.id;
        };

        const createPrescriptionWithItems = async (
            patientId: string,
            name: string,
            services: Array<{ code: string; name: string }>,
        ) => {
            const rxRes = await fetch('/api/service-prescriptions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientId,
                    prescribedAt: '2026-10-15T09:00:00.000Z',
                    status: 'prescribed',
                    category: 'lab',
                    serviceName: name,
                    source: 'manual',
                }),
            });
            if (rxRes.status !== 201) throw new Error(`Prescription create failed: ${rxRes.status}`);
            const rx = (await rxRes.json()) as { id: string };

            for (let ordinal = 0; ordinal < services.length; ordinal += 1) {
                const itemRes = await fetch('/api/service-prescription-items', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        patientId,
                        prescriptionId: rx.id,
                        ordinal,
                        status: 'prescribed',
                        category: 'lab',
                        codeSystem: 'REGIONAL_PRESTAZIONI',
                        serviceCode: services[ordinal].code,
                        serviceName: services[ordinal].name,
                        matchStatus: 'matched',
                    }),
                });
                if (itemRes.status !== 201) throw new Error(`Item create failed: ${itemRes.status}`);
            }
        };

        const diabetesPatients: string[] = [];
        for (let i = 1; i <= 10; i += 1) {
            diabetesPatients.push(await createPatient(i, [
                { code: '5A11', system: 'ICD-11', description: 'Diabete mellito di tipo 2', date: null },
            ]));
        }
        const singlePatientId = await createPatient(11, [
            { code: 'BA00', system: 'ICD-11', description: 'Ipertensione essenziale', date: null },
        ]);
        const variedPatients: string[] = [];
        for (let i = 12; i <= 15; i += 1) {
            variedPatients.push(await createPatient(i, [
                { code: 'BA00', system: 'ICD-11', description: 'Ipertensione essenziale', date: null },
            ]));
        }

        const triplet = [
            { code: '90.28.1', name: 'EMOGLOBINA GLICATA' },
            { code: '90.27.1', name: 'GLUCOSIO [S/P]' },
            { code: '90.16.3', name: 'CREATININA [S/P]' },
        ];
        for (let p = 0; p < 30; p += 1) {
            await createPrescriptionWithItems(diabetesPatients[p % 10], `Controllo diabetologico ${p + 1}`, triplet);
        }

        const singlePair = [
            { code: '90.37.4', name: 'POTASSIO [S]' },
            { code: '90.40.4', name: 'SODIO [S]' },
        ];
        for (let p = 0; p < 10; p += 1) {
            await createPrescriptionWithItems(singlePatientId, `Controllo elettroliti ${p + 1}`, singlePair);
        }

        for (let p = 0; p < 10; p += 1) {
            await createPrescriptionWithItems(variedPatients[p % variedPatients.length], `Controllo vario ${p + 1}`, [
                { code: `99.${p}.1`, name: `Esame sintetico A${p}` },
                { code: `99.${p}.2`, name: `Esame sintetico B${p}` },
            ]);
        }
    });

    trackingReviewWrites = true;

    await panel.getByTestId('analyze-service-candidates-button').click();
    await expect(panel.getByTestId('service-candidates-summary')).toContainText('50 prescrizioni analizzate');
    await expect(panel.getByTestId('service-candidates-summary')).toContainText('15 pazienti');

    const cards = panel.getByTestId('service-candidate-card');
    await expect(cards).toHaveCount(1);
    const card = cards.first();
    await expect(card).toContainText('Candidato personale');
    await expect(card.getByTestId('candidate-review-status')).toHaveText('Da valutare');
    await expect(card.getByTestId('candidate-frequency')).toContainText('30 prescrizioni');
    await expect(card.getByTestId('candidate-frequency')).toContainText('10 pazienti');
    await expect(card).toContainText('EMOGLOBINA GLICATA (90.28.1)');
    await expect(card).toContainText('GLUCOSIO [S/P] (90.27.1)');
    await expect(card).toContainText('CREATININA [S/P] (90.16.3)');
    await expect(card.getByTestId('candidate-diagnosis')).toContainText('Diabete mellito di tipo 2 (5A11)');

    const insufficientDisclosure = panel.getByTestId('service-candidates-insufficient-disclosure');
    await insufficientDisclosure.getByRole('button').click();
    await expect(panel.getByTestId('service-candidate-insufficient-card')).toContainText('osservato su 1 paziente');

    await card.getByRole('button', { name: 'Conserva', exact: true }).click();
    await expect(card.getByTestId('candidate-review-status')).toHaveText('Conservato');

    await card.getByRole('button', { name: 'Correggi', exact: true }).click();
    const editor = card.getByTestId('candidate-correction-editor');
    await expect(editor).toBeVisible();
    await editor.getByLabel('Nome del gruppo').fill('Controllo metabolico personale');
    await editor.getByLabel('CREATININA [S/P] (90.16.3)').uncheck();
    await editor.getByLabel('Nota personale').fill('Solo promemoria personale');
    await editor.getByRole('button', { name: 'Salva correzione', exact: true }).click();

    await expect(card.getByTestId('candidate-review-status')).toHaveText('Corretto');
    await expect(card.getByRole('heading', { level: 3 })).toHaveText('Controllo metabolico personale');
    await expect(card).not.toContainText('CREATININA [S/P] (90.16.3)');
    await expect(card).toContainText('Nota personale: Solo promemoria personale');

    const persistedRaw = await page.evaluate(async () => {
        const res = await fetch('/api/settings/servicePackageCandidates.personalReview.v1', { cache: 'no-store' });
        return res.text();
    });
    expect(persistedRaw).toContain('Controllo metabolico personale');
    expect(persistedRaw).not.toContain('SYN923');
    expect(persistedRaw).not.toContain('NomeSyn');
    expect(persistedRaw).not.toContain('exemption');
    expect(persistedRaw).not.toContain('periodicity');

    await card.getByRole('button', { name: 'Scarta', exact: true }).click();
    await expect(panel.getByTestId('service-candidate-card')).toHaveCount(0);
    const discardedDisclosure = panel.getByTestId('service-candidates-discarded-disclosure');
    await discardedDisclosure.getByRole('button').click();
    const discardedCard = panel.getByTestId('service-candidate-discarded-card');
    await expect(discardedCard).toHaveCount(1);
    await discardedCard.getByRole('button', { name: 'Ripristina', exact: true }).click();
    await expect(panel.getByTestId('service-candidate-card')).toHaveCount(1);
    await expect(panel.getByTestId('service-candidate-card').first().getByTestId('candidate-review-status')).toHaveText('Da valutare');

    await panel.getByTestId('service-candidate-card').first().getByRole('button', { name: 'Conserva', exact: true }).click();
    await expect(panel.getByTestId('service-candidate-card').first().getByTestId('candidate-review-status')).toHaveText('Conservato');

    await page.reload();
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    await panel.getByRole('button', { name: /^Gruppi di prestazioni dallo storico/u }).click();
    await panel.getByTestId('analyze-service-candidates-button').click();
    await expect(panel.getByTestId('service-candidate-card').first().getByTestId('candidate-review-status')).toHaveText('Conservato');

    let failSettingsRead = true;
    let putCountDuringFailedRead = 0;
    await page.route('**/api/settings/servicePackageCandidates.personalReview.v1', (route) => {
        if (route.request().method() === 'GET' && failSettingsRead) {
            return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated read failure' }) });
        }
        if (route.request().method() === 'PUT' && failSettingsRead) {
            putCountDuringFailedRead += 1;
        }
        return route.continue();
    });

    await panel.getByTestId('analyze-service-candidates-button').click();
    await expect(panel.getByTestId('service-candidates-error')).toBeVisible();
    await expect(panel.getByTestId('service-candidates-error')).toContainText('Impossibile leggere le valutazioni salvate');
    expect(putCountDuringFailedRead).toBe(0);

    failSettingsRead = false;
    await page.unroute('**/api/settings/servicePackageCandidates.personalReview.v1');
    trackingReviewWrites = false;

    await page.evaluate(async () => {
        const resPatients = await fetch('/api/patients', { cache: 'no-store' });
        const allPatients = (await resPatients.json()) as Array<{ id: string }>;
        const targetPatients = allPatients.slice(0, 3);
        const secondPair = [
            { code: '90.62.2', name: 'EMOCROMO CON FORMULA' },
            { code: '90.22.3', name: 'FERRITINA [S]' },
        ];
        for (let p = 0; p < 6; p += 1) {
            const patientId = targetPatients[p % targetPatients.length].id;
            const rxRes = await fetch('/api/service-prescriptions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientId,
                    prescribedAt: '2026-10-16T09:00:00.000Z',
                    status: 'prescribed',
                    category: 'lab',
                    serviceName: `Controllo ematochimico ${p + 1}`,
                    source: 'manual',
                }),
            });
            if (rxRes.status !== 201) throw new Error(`Second pair rx failed: ${rxRes.status}`);
            const rx = (await rxRes.json()) as { id: string };
            for (let ordinal = 0; ordinal < secondPair.length; ordinal += 1) {
                const itemRes = await fetch('/api/service-prescription-items', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        patientId,
                        prescriptionId: rx.id,
                        ordinal,
                        status: 'prescribed',
                        category: 'lab',
                        codeSystem: 'REGIONAL_PRESTAZIONI',
                        serviceCode: secondPair[ordinal].code,
                        serviceName: secondPair[ordinal].name,
                        matchStatus: 'matched',
                    }),
                });
                if (itemRes.status !== 201) throw new Error(`Second pair item failed: ${itemRes.status}`);
            }
        }
    });

    trackingReviewWrites = true;
    await panel.getByTestId('analyze-service-candidates-button').click();
    await expect(panel.getByTestId('service-candidate-card')).toHaveCount(2);
    const firstCard = panel.getByTestId('service-candidate-card').filter({ hasText: 'EMOGLOBINA GLICATA' });
    const secondCard = panel.getByTestId('service-candidate-card').filter({ hasText: 'FERRITINA [S]' });
    await expect(firstCard.getByTestId('candidate-review-status')).toHaveText('Conservato');
    await expect(secondCard.getByTestId('candidate-review-status')).toHaveText('Da valutare');

    const secondTab = await page.context().newPage();
    secondTab.on('pageerror', (error) => pageErrors.push(error.message));
    await secondTab.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(baseURL!).origin) {
            externalOrigins.push(url.origin);
            return route.abort();
        }
        return route.continue();
    });
    await secondTab.route('**/api/siss/session-status', (route) =>
        route.fulfill({ json: { status: 'unavailable', source: 'synthetic', checkpoints: [] } }),
    );

    await openUnlockedDocument(secondTab, '/settings/repertori');
    const secondPanel = secondTab.getByTestId('service-package-candidates-panel');
    await secondPanel.getByRole('button', { name: /^Gruppi di prestazioni dallo storico/u }).click();
    await secondPanel.getByTestId('analyze-service-candidates-button').click();
    await expect(secondPanel.getByTestId('service-candidate-card')).toHaveCount(2);

    await firstCard.getByRole('button', { name: 'Rimetti da valutare', exact: true }).click();
    await expect(firstCard.getByTestId('candidate-review-status')).toHaveText('Da valutare');
    await firstCard.getByRole('button', { name: 'Correggi', exact: true }).click();
    const firstEditor = firstCard.getByTestId('candidate-correction-editor');
    await firstEditor.getByLabel('Nome del gruppo').fill('Profilo glicemico scheda 1');
    await firstEditor.getByRole('button', { name: 'Salva correzione', exact: true }).click();
    await expect(firstCard.getByTestId('candidate-review-status')).toHaveText('Corretto');

    const secondTabSecondCard = secondPanel.getByTestId('service-candidate-card').filter({ hasText: 'FERRITINA [S]' });
    await secondTabSecondCard.getByRole('button', { name: 'Conserva', exact: true }).click();
    await expect(secondTabSecondCard.getByTestId('candidate-review-status')).toHaveText('Conservato');

    const mergedRaw = await page.evaluate(async () => {
        const res = await fetch('/api/settings/servicePackageCandidates.personalReview.v1', { cache: 'no-store' });
        return res.text();
    });
    expect(mergedRaw).toContain('Profilo glicemico scheda 1');
    expect(mergedRaw).toContain('EMOCROMO CON FORMULA');
    await secondTab.close();

    await assertNoHorizontalOverflow(page, [{ label: 'repertori-candidati', selector: 'document' }]);
    expect(externalOrigins).toEqual([]);
    expect(aiRequests).toEqual([]);
    expect(unexpectedClinicalWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
});
