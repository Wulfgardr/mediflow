// @Codex MF085-002/003: run only against an explicitly disposable, loopback synthetic home-base.
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('Untouched/partial scales do not write; explicit zero and complete POMA-28 do', async ({ page, baseURL }) => {
    test.skip(process.env.E2E_SCALES_SYNTHETIC_ONLY !== '1', 'Requires an isolated synthetic database and explicit opt-in');
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL || 'http://127.0.0.1:3000').hostname);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await page.evaluate(async () => {
        const suffix = String(Date.now()).slice(-3);
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Synthetic', lastName: `ScaleTest${suffix}`,
                taxCode: `SCLTST80A01H${suffix}X`, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }),
        });
        if (!response.ok) throw new Error(`Synthetic patient setup failed: ${response.status}`);
        return (await response.json() as { id: string }).id;
    });
    let writes = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/entries') writes++;
    });

    await page.goto(`/patients/${patientId}/scales/adl`);
    const form = page.locator('#scala');
    await expect(form.getByRole('button', { name: 'Avanti', exact: true })).toBeDisabled();
    expect(writes).toBe(0);
    for (let index = 0; index < 6; index++) {
        await expect(form.getByText(`Domanda ${index + 1} di 6`, { exact: true })).toBeVisible();
        const next = form.getByRole('button', { name: index === 5 ? 'Completa' : 'Avanti', exact: true });
        await expect(next).toBeDisabled();
        expect(writes).toBe(0);
        await form.getByRole('button', { name: /^0\./ }).click();
        await expect(next).toBeEnabled();
        await next.click();
    }
    await expect.poll(() => writes).toBe(1);
    await expect(page).not.toHaveURL(/\/scales\/adl$/);

    await page.goto(`/patients/${patientId}/scales/tinetti`);
    await expect(page.getByText(/Versione Tinetti precedente ritirata/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Completa', exact: true })).toHaveCount(0);
    expect(writes).toBe(1);

    await page.goto(`/patients/${patientId}/scales/tinetti-poma28-v1`);
    const maxima = [1, 2, 2, 2, 2, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1];
    for (let index = 0; index < maxima.length; index++) {
        await expect(form.getByText(`Domanda ${index + 1} di 20`, { exact: true })).toBeVisible();
        const next = form.getByRole('button', { name: index === 19 ? 'Completa' : 'Avanti', exact: true });
        await expect(next).toBeDisabled();
        expect(writes).toBe(1);
        await form.getByRole('button', { name: new RegExp(`^${maxima[index]}\\.`) }).click();
        await next.click();
    }
    await expect.poll(() => writes).toBe(2);
    await expect(page).not.toHaveURL(/\/scales\/tinetti-poma28-v1$/);
});
