import type { Page, APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { bootstrapUnlockedSession, onboardingPassphrase } from './utils';
import { AGENT_OPERATIONS, type AgentOperation } from '../lib/agent-mandate-contract';

export const agentVisitPin = '24682468';
export const agentVisitPassphrase = 'mandato sintetico visita novembre';
export async function createSyntheticAgentMandate(page: Page, credential: 'passphrase' | 'pin' = 'passphrase', captureRecovery = false) {
    const pin = agentVisitPin, passphrase = agentVisitPassphrase;
    let recovery: { key: string; content: Buffer } | null = null;
    await bootstrapUnlockedSession(page, pin);
    await page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Impostazioni', exact: true }).click();
    if (credential === 'passphrase') {
        await page.getByRole('link', { name: 'Accesso', exact: true }).click();
        const adoption = page.getByTestId('settings-access-adopt');
        const change = page.getByTestId('settings-access-passphrase');
        const accessForm = adoption.or(change);
        await expect(accessForm).toBeVisible();
        if (await adoption.isVisible()) {
            await adoption.getByLabel('PIN attuale', { exact: true }).fill(pin);
        } else {
            await change.getByLabel('Passphrase attuale', { exact: true }).fill(onboardingPassphrase(pin));
        }
        await accessForm.getByLabel('Nuova passphrase', { exact: true }).fill(passphrase);
        await accessForm.getByLabel('Conferma nuova passphrase', { exact: true }).fill(passphrase);
        await accessForm.getByRole('button', { name: 'Prepara il nuovo kit', exact: true }).click();
        const kit = page.getByTestId('recovery-kit');
        const download = page.waitForEvent('download');
        const key = captureRecovery ? await kit.getByLabel('Chiave di recupero', { exact: true }).innerText() : null;
        await kit.getByRole('button', { name: 'Scarica kit di recupero' }).click();
        const artifact = await download;
        if (key !== null) recovery = { key, content: await readFile((await artifact.path())!) };
        await kit.getByRole('checkbox').check();
        await kit.getByRole('button', { name: 'Attiva la nuova passphrase' }).click();
        await page.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
        await expect(page.getByLabel('Passphrase', { exact: true })).toBeEnabled();
        await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
        await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
        await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Agenti', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Agenti', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nuovo mandato', exact: true })).toBeVisible();
    await page.getByLabel('PIN di conferma', { exact: true }).fill(pin);
    await page.getByLabel('Autorizzo il passaggio di documenti e trascrizioni al fornitore scelto', { exact: true }).check();
    const creation = page.waitForResponse(response => response.url().endsWith('/api/agent-mandates') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Crea mandato', exact: true }).click();
    const created = await creation; expect(created.status()).toBe(201);
    const mandate = created.request().postDataJSON().mandate;
    expect(mandate).toMatchObject({ provider: 'openai', allowsClinicalEgress: true });
    expect(mandate.durationMs).toBe(43200000);
    return { ...mandate, recovery };
}

export async function pairSyntheticVisitAgent(page: Page, agent: APIRequestContext, operations: AgentOperation[] = [...AGENT_OPERATIONS]) {
    const mandate = await createSyntheticAgentMandate(page);
    const request = await agent.post('/api/agent/v1/pairings', { data: { name: 'Synthetic cassette client', operations } });
    expect(request.status()).toBe(201);
    const requested = await request.json();
    const pollPath = '/api/agent/v1/pairings?requestId=' + requested.receipt.id;
    const polling = { Authorization: 'Pairing ' + requested.pairingCredential.claim };
    expect((await agent.get(pollPath, { headers: polling })).status()).toBe(202);
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    await page.getByRole('button', { name: 'Approva ' + requested.receipt.code, exact: true }).click();
    const issued = await agent.get(pollPath, { headers: polling }); expect(issued.status()).toBe(200);
    const result = await issued.json();
    expect((await agent.storageState()).cookies).toEqual([]);
    return { mandate, token: result.credential.token as string, agentRef: result.receipt.agentRef as string };
}
