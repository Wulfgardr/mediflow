import Database from 'better-sqlite3';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from './fixtures/isolated-runtime';
import { agentVisitPassphrase, agentVisitPin, createSyntheticAgentMandate } from './agent-visit-utils';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';

test.describe.configure({ retries: 0 });

test('one PIN-approved registration receives a twelve-hour mandate on each unlock', async ({ page, isolatedRuntime, playwright }, testInfo) => {
    test.setTimeout(150000);
    const agent = await playwright.request.newContext({ baseURL: isolatedRuntime.url });
    const registrationName = 'Client sintetico rinnovabile';
    const operations = ['visita.apri', 'visita.nota', 'visita.chiudi'];
    const bearer = (token: string) => ({ Authorization: 'Bearer ' + token });
    try {
        await page.clock.install();
        const template = await createSyntheticAgentMandate(page);
        const pending = await agent.post('/api/agent/v1/pairings', { data: { name: registrationName, operations } });
        expect(pending.status()).toBe(201);
        const { receipt, pairingCredential } = await pending.json();
        const poll = () => agent.get('/api/agent/v1/pairings?requestId=' + receipt.id,
            { headers: { Authorization: 'Pairing ' + pairingCredential.claim } });
        const unlock = async () => {
            const confirmed = page.waitForResponse(response => response.url().endsWith('/api/agent-mandates/unlock'));
            await page.getByLabel('Passphrase', { exact: true }).fill(agentVisitPassphrase);
            await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
            const response = await confirmed;
            expect(response.status()).toBe(204);
            expect(Object.keys(response.request().postDataJSON())).toEqual(['ticket']);
            await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
        };
        const lock = async () => {
            const confirmation = page.waitForResponse(response => response.url().endsWith('/api/auth/lock'));
            await page.getByRole('button', { name: 'Blocca', exact: true }).first().click();
            expect((await confirmation).ok()).toBe(true);
            await expect(page.getByLabel('Passphrase', { exact: true })).toBeEnabled();
        };
        expect((await poll()).status()).toBe(202);
        await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
        await expect(page.getByRole('heading', { name: registrationName + ' ' + receipt.code })).toBeVisible();
        const optIn = page.getByLabel('Rinnova allo sblocco', { exact: true });
        await expect(optIn).toBeVisible();
        await optIn.check();
        const pin = page.getByLabel('PIN per ' + registrationName, { exact: true });
        await pin.fill('0000');
        await page.getByRole('button', { name: 'Approva ' + receipt.code, exact: true }).click();
        await expect(page.getByText('Operazione non riuscita. Riprova.', { exact: true })).toBeVisible();
        expect((await poll()).status()).toBe(202);
        await pin.fill(agentVisitPin);
        await page.getByRole('button', { name: 'Approva ' + receipt.code, exact: true }).click();
        await expect(page.getByRole('button', { name: 'Revoca ' + registrationName, exact: true })).toBeVisible();
        const approved = await poll();
        expect(approved.status()).toBe(200);
        const registered = await approved.json();
        expect(registered.credential).toBeNull();
        const longToken = registered.registrationCredential.token;
        const retrieve = (token = longToken) => agent.get('/api/agent/v1/mandate', { headers: bearer(token) });
        expect((await retrieve()).status()).toBe(401);
        await lock();
        await unlock();

        const first = await retrieve();
        expect(first.status()).toBe(200);
        const { credential, receipt: renewed } = await first.json();
        expect(renewed).toMatchObject({ agentRef: receipt.id, issuedAt: expect.any(Number), expiresAt: expect.any(Number) });
        expect(renewed.expiresAt - renewed.issuedAt).toBe(43200000);
        expect(renewed.mandateRef).not.toBe(template.id);
        const context = await agent.get('/api/agent/v1/context', { headers: bearer(credential.token) });
        expect(context.status()).toBe(200);
        expect(await context.json()).toMatchObject({ operations, publicKey: template.publicKey });
        const visitId = randomUUID();
        const anchor = sealAgentItemNode(template.publicKey, { mandateRef: renewed.mandateRef, visitId, itemId: visitId, kind: 'anchor' },
            new TextEncoder().encode(JSON.stringify({ fiscalCode: 'SYNTHETIC_CF_6742' })));
        const deposit = (token: string) => agent.post('/api/agent/v1/visits', {
            headers: bearer(token), data: { operation: 'visita.apri', visitId, anchor },
        });
        expect((await deposit(longToken)).status()).toBe(401);
        expect((await retrieve('mfr_' + randomBytes(32).toString('base64url'))).status()).toBe(401);
        expect((await deposit(credential.token)).status()).toBe(201);
        const itemId = randomUUID();
        const note = new TextEncoder().encode(JSON.stringify({ text: 'SYNTHETIC_RENEWED_MANDATE_NOTE' }));
        const item = { id: itemId, kind: 'note', envelope: sealAgentItemNode(template.publicKey,
            { mandateRef: renewed.mandateRef, visitId, itemId, kind: 'note' }, note), byteLength: note.length, documentHash: null };
        expect((await agent.post('/api/agent/v1/visits', { headers: bearer(credential.token),
            data: { operation: 'visita.nota', visitId, expectedRevision: 1, item } })).status()).toBe(201);
        const closed = await agent.post('/api/agent/v1/visits', { headers: bearer(credential.token),
            data: { operation: 'visita.chiudi', visitId, expectedRevision: 2 } });
        expect(closed.status()).toBe(201);
        expect((await closed.json()).receipt).toMatchObject({ status: 'closed', itemCount: 1 });
        expect((await agent.storageState()).cookies).toEqual([]);
        await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
        await expect(page.getByText(/Ultimo rinnovo/u)).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('agente-rinnovato.png'), fullPage: true });

        const idleLock = page.waitForResponse(response => response.url().endsWith('/api/auth/lock'));
        await page.clock.fastForward('15:01');
        expect((await idleLock).request().headers()['x-mediflow-lock-reason']).toBe('inactivity');
        await expect(page.getByLabel('Passphrase', { exact: true })).toBeEnabled();
        expect((await deposit(credential.token)).status()).toBe(401);
        expect((await retrieve()).status()).toBe(401);
        await unlock();
        const second = await retrieve();
        expect(second.status()).toBe(200);
        const replacement = await second.json();
        expect(replacement.receipt.mandateRef).not.toBe(renewed.mandateRef);
        expect((await deposit(credential.token)).status()).toBe(401);
        const syntheticArchive = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
        try {
            const expiry = Date.now() - 1;
            expect(syntheticArchive.prepare('UPDATE agent_mandates SET created_at=?,expires_at=? WHERE id=?')
                .run(expiry - 43200000, expiry, replacement.receipt.mandateRef).changes).toBe(1);
        } finally { syntheticArchive.close(); }
        expect((await deposit(replacement.credential.token)).status()).toBe(401);
        expect((await retrieve()).status()).toBe(401);

        await lock();
        await unlock();
        const third = await retrieve();
        expect(third.status()).toBe(200);
        const latest = await third.json();
        const latestContext = await agent.get('/api/agent/v1/context', { headers: bearer(latest.credential.token) });
        expect(latestContext.status()).toBe(200);
        await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
        await page.getByRole('button', { name: 'Revoca ' + registrationName, exact: true }).click();
        await expect(page.getByRole('button', { name: 'Revoca ' + registrationName, exact: true })).toHaveCount(0);
        expect((await deposit(latest.credential.token)).status()).toBe(401);
        expect((await retrieve()).status()).toBe(401);
        await lock();
        await unlock();
        expect((await retrieve()).status()).toBe(401);
    } finally { await agent.dispose(); }
});
