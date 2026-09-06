/* @Codex */
import { expect, test } from '@playwright/test';
import { completeOnboardingIfNeeded, unlockIfNeeded, assertNoHorizontalOverflow } from './utils';

const endpoint = '/api/onboarding/work-profile';

test('onboarding: persisted preview, resume, changed recommendation, manual entry, conflict and rollback', async ({ page, context, request, browser }) => {
    test.setTimeout(150_000);
    const pageErrors: string[] = [];
    const consoleErrors: { text: string; url: string }[] = [];
    const remoteRequests: string[] = [];
    let expectedLostResponse = false;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error' && !expectedLostResponse) consoleErrors.push({ text: message.text(), url: message.location().url });
    });
    page.on('request', (request) => {
        if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) remoteRequests.push(request.url());
    });
    const read = async () => {
        const response = await context.request.get(endpoint);
        expect(response.ok()).toBeTruthy();
        return response.json();
    };

    expect((await request.get(endpoint)).status()).toBe(401);
    expect((await request.put(endpoint, { data: {} })).status()).toBe(401);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/');
    await expect(page).toHaveTitle(/MediFlow/);
    await completeOnboardingIfNeeded(page, process.env.E2E_PIN || '1234');
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    const panel = page.getByTestId('work-profile-onboarding');
    await expect(panel.getByRole('heading', { name: 'Il tuo modo di lavorare' })).toBeVisible();
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    // Run this spec on a dedicated fresh synthetic DB, never reset a shared node.
    expect((await read()).active).toBeNull();
    if ((await read()).draft) {
        await panel.getByRole('button', { name: 'Scarta la bozza' }).click();
        await expect(panel.getByRole('group', { name: 'Quale attività vuoi organizzare?' })).toBeVisible();
    }
    expect((await context.request.post('/api/settings', { data: { key: 'onboarding.workProfile', value: 'synthetic' } })).status()).toBe(403);
    expect((await context.request.put('/api/settings/onboarding.workProfile', { data: { value: 'synthetic' } })).status()).toBe(403);

    await panel.getByRole('radio', { name: 'Consultare e compilare cartelle' }).check();
    await panel.getByRole('button', { name: 'Salva e continua' }).click();
    await expect(panel.getByRole('group', { name: 'Come preferisci lavorare?' })).toBeVisible();
    await page.reload();
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    await expect(panel.getByRole('group', { name: 'Come preferisci lavorare?' })).toBeVisible();
    expect((await read()).draft.answers.activity).toBe('records');
    await panel.getByRole('radio', { name: 'Preparare il lavoro con un agente' }).check();
    await panel.getByRole('button', { name: 'Salva e continua' }).click();
    await panel.getByRole('radio', { name: 'Windows', exact: true }).check();
    await panel.getByRole('button', { name: 'Mostra anteprima' }).click();
    await expect(panel.getByRole('heading', { name: 'Anteprima del profilo' })).toBeVisible();
    await expect(panel.getByText(/Consigliato:/)).toContainText('Agent');
    await expect(panel.getByText(/non collega né verifica un agente/)).toBeVisible();
    await expect(panel.getByText(/app desktop completa non è attestata/)).toBeVisible();
    expect((await read()).active).toBeNull();
    await page.screenshot({ path: test.info().outputPath('preview-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' }, { label: 'onboarding', selector: '[data-testid="work-profile-onboarding"]' }]);
    await page.screenshot({ path: test.info().outputPath('preview-phone.png'), fullPage: true });
    await panel.getByRole('radio', { name: 'Entrambi · Interactive e Agent' }).check();
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    await panel.getByRole('button', { name: 'Conferma profilo di lavoro' }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Agenda di oggi/, level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true }).getByRole('link', { name: 'Agenda', exact: true })).toHaveAttribute('aria-current', 'page');
    expect((await read()).active.profile).toBe('both');
    await page.setViewportSize({ width: 1440, height: 960 });

    await page.goto('/settings/profilo');
    await expect(panel.getByText(/Profilo salvato:/)).toContainText('Entrambi');
    // Independent cookie/control owners use ordinary login; no session material is copied.
    const sibling = await browser.newPage();
    await sibling.goto(new URL('/settings/profilo', page.url()).href);
    // Let the existing auth bootstrap/lock fence settle before the login gesture.
    await sibling.waitForLoadState('networkidle');
    await unlockIfNeeded(sibling, process.env.E2E_PIN || '1234');
    await expect(sibling.getByTestId('work-profile-onboarding')).toHaveAttribute('aria-busy', 'false');
    await panel.getByRole('button', { name: 'Cambia profilo di lavoro' }).click();
    await expect(panel.getByRole('heading', { name: 'Anteprima del profilo' })).toBeVisible();
    await sibling.getByRole('button', { name: 'Cambia profilo di lavoro' }).click();
    await expect(sibling.getByTestId('work-profile-onboarding').getByRole('alert')).toContainText('un’altra scheda');
    await sibling.getByRole('button', { name: 'Rileggi lo stato' }).click();
    await expect(sibling.getByRole('heading', { name: 'Anteprima del profilo' })).toBeVisible();
    await sibling.close();

    await panel.getByRole('radio', { name: 'Interactive', exact: true }).check();
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    await panel.getByRole('button', { name: 'Conferma profilo di lavoro' }).click();
    await expect(panel.getByText(/Profilo salvato:/)).toContainText('Interactive');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Pazienti in carico/, level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true }).getByRole('link', { name: 'Pazienti', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' })).toBeVisible();
    await page.goto('/settings/profilo');
    await panel.getByRole('button', { name: 'Ripristina la scelta precedente' }).click();
    expect((await read()).active.profile).toBe('interactive');
    await panel.getByRole('button', { name: 'Conferma ripristino del profilo' }).click();
    await expect(panel.getByText(/Profilo salvato:/)).toContainText('Entrambi');

    await panel.getByRole('button', { name: 'Cambia profilo di lavoro' }).click();
    await panel.getByRole('button', { name: 'Scegli manualmente' }).click();
    await expect(panel.getByText(/Percorso manuale:/)).toBeVisible();
    // @Codex: failure before persistence must discard the optimistic radio on reread,
    // even when the server revision did not advance.
    const beforeFailedSave = await read();
    expectedLostResponse = true;
    await page.route(`**${endpoint}`, async (route) => {
        if (route.request().method() === 'PUT' && route.request().postDataJSON().action === 'save-draft') await route.abort('failed');
        else await route.continue();
    });
    await panel.getByRole('radio', { name: 'Agent', exact: true }).check();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Conferma profilo di lavoro' })).toBeDisabled();
    expect(await read()).toEqual(beforeFailedSave);
    await page.unroute(`**${endpoint}`);
    await panel.getByRole('button', { name: 'Rileggi lo stato' }).click();
    await expect(panel.getByRole('radio', { name: 'Interactive', exact: true })).toBeChecked();
    await expect(panel.getByRole('radio', { name: 'Agent', exact: true })).not.toBeChecked();
    await expect(panel.getByRole('button', { name: 'Conferma profilo di lavoro' })).toBeEnabled();
    expectedLostResponse = false;
    await panel.getByRole('radio', { name: 'Agent', exact: true }).check();
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    expectedLostResponse = true;
    await page.route(`**${endpoint}`, async (route) => {
        if (route.request().method() === 'PUT' && route.request().postDataJSON().action === 'confirm') {
            await route.fetch(); // Commit reaches the real SQLite owner; only its response is lost.
            await route.abort('failed');
        } else await route.continue();
    });
    await panel.getByRole('button', { name: 'Conferma profilo di lavoro' }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Conferma profilo di lavoro' })).toBeDisabled();
    await expect(panel.getByText(/Profilo salvato:/)).toHaveCount(0);
    expect((await read()).active).toMatchObject({ profile: 'agent', source: 'manual', answers: { activity: null, interaction: null, platform: null } });
    await page.unroute(`**${endpoint}`);
    await panel.getByRole('button', { name: 'Rileggi lo stato' }).click();
    await expect(panel.getByText(/Profilo salvato:/)).toContainText('Agent');
    expectedLostResponse = false;
    const current = await read();
    const replay = await context.request.put(endpoint, { data: current.lastCommand });
    expect(await replay.json()).toEqual(current);
    await panel.getByRole('link', { name: 'Apri la cartella manualmente' }).click();
    await expect(page).toHaveURL(/[?&]area=turno/);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Stato operativo/, level: 1 })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Impostazioni', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.goto('/settings/profilo');
    await expect(panel.getByText(/Profilo salvato:/)).toContainText('Agent');
    await page.screenshot({ path: test.info().outputPath('saved-profile.png'), fullPage: true });
    expect(pageErrors).toEqual([]);
    // Existing dev auth startup can issue overlapping lock requests. Keep this
    // exact diagnostic visible; it is not a work-profile persistence failure.
    await test.info().attach('console-diagnostics.json', { body: JSON.stringify(consoleErrors, null, 2), contentType: 'application/json' });
    expect(consoleErrors.filter(({ text, url }) => !(url.endsWith('/api/auth/lock') && text.includes('409 (Conflict)')))).toEqual([]);
    expect(remoteRequests).toEqual([]);
    await expect(page.locator('nextjs-error-overlay')).toHaveCount(0);
});
