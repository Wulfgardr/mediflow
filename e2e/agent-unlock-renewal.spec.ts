import Database from 'better-sqlite3';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from './fixtures/isolated-runtime';
import { documentRequests } from './fixtures/trusted-web-request';
import { agentVisitPassphrase, agentVisitPin, createSyntheticAgentMandate } from './agent-visit-utils';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';

test.describe.configure({ retries: 0 });

const pinAccount = test.extend({ existingPin: agentVisitPin });

for (const credentialKind of ['passphrase', 'pin'] as const) (credentialKind === 'pin' ? pinAccount : test)(`a registered agent receives a twelve-hour mandate on ${credentialKind} unlock and tab renewal`, async ({ page, context: browserContext, isolatedRuntime, playwright }, testInfo) => {
    test.setTimeout(150000);
    const agent = await playwright.request.newContext({ baseURL: isolatedRuntime.url });
    const unlockLabel = credentialKind === 'pin' ? 'PIN operatore' : 'Passphrase';
    let secret = credentialKind === 'pin' ? agentVisitPin : agentVisitPassphrase;
    const registrationName = 'Client sintetico rinnovabile';
    const operations = ['visita.apri', 'visita.nota', 'visita.chiudi'];
    const bearer = (token: string) => ({ Authorization: 'Bearer ' + token });
    try {
        await page.clock.install();
        const template = await createSyntheticAgentMandate(page, credentialKind, true);
        const pending = await agent.post('/api/agent/v1/pairings', { data: { name: registrationName, operations } });
        expect(pending.status()).toBe(201);
        const { receipt, pairingCredential } = await pending.json();
        const poll = () => agent.get('/api/agent/v1/pairings?requestId=' + receipt.id,
            { headers: { Authorization: 'Pairing ' + pairingCredential.claim } });
        const opensRenewal = (url: string) => url.endsWith('/api/agent-mandates/unlock');
        const unlock = async (renewalExpected = true) => {
            const unexpected: string[] = [];
            const observe = (request: { url(): string }) => { if (opensRenewal(request.url())) unexpected.push(request.url()); };
            if (!renewalExpected) page.on('request', observe);
            try {
                const confirmed = renewalExpected ? page.waitForResponse(response => opensRenewal(response.url())) : null;
                await page.getByLabel(unlockLabel, { exact: true }).fill(secret);
                await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
                if (confirmed) {
                    const response = await confirmed;
                    expect(response.status()).toBe(204);
                    expect(Object.keys(response.request().postDataJSON())).toEqual(['ticket']);
                }
                await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
                expect(unexpected).toEqual([]);
            } finally { page.off('request', observe); }
        };
        const lock = async () => {
            const confirmation = page.waitForResponse(response => response.url().endsWith('/api/auth/lock'));
            await page.getByRole('button', { name: 'Blocca', exact: true }).first().click();
            expect((await confirmation).ok()).toBe(true);
            await expect(page.getByLabel(unlockLabel, { exact: true })).toBeEnabled();
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
        await expect(page.getByLabel(unlockLabel, { exact: true })).toBeEnabled();
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
        if (template.recovery) {
            secret = 'passphrase sintetica recuperata';
            const confirmations: string[] = [];
            const countConfirmation = (request: { url(): string }) => {
                if (request.url().endsWith('/api/agent-mandates/unlock')) confirmations.push(request.url());
            };
            page.on('request', countConfirmation);
            try {
                await page.getByRole('button', { name: 'Recupera con kit e chiave', exact: true }).click();
                await page.getByLabel('Kit di recupero', { exact: true }).setInputFiles({
                    name: 'synthetic-kit.json', mimeType: 'application/json', buffer: template.recovery.content,
                });
                await page.getByLabel('Chiave di recupero', { exact: true }).fill(template.recovery.key);
                await page.getByLabel('Nuova passphrase', { exact: true }).fill(secret);
                await page.getByLabel('Conferma nuova passphrase', { exact: true }).fill(secret);
                await page.getByRole('button', { name: 'Prepara il nuovo kit', exact: true }).click();
                const kitPanel = page.getByTestId('recovery-kit');
                await kitPanel.getByRole('button', { name: 'Scarica kit di recupero', exact: true }).click();
                await kitPanel.getByRole('checkbox').check();
                const recovery = page.waitForResponse(response => response.url().endsWith('/api/auth/passphrase/recover'));
                await kitPanel.getByRole('button', { name: 'Attiva la nuova passphrase', exact: true }).click();
                expect((await recovery).status()).toBe(200);
                await expect(kitPanel).toBeHidden();
                await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toHaveCount(0);
                expect((await retrieve()).status()).toBe(401);
                expect(confirmations).toHaveLength(0);
            } finally { page.off('request', countConfirmation); }
            await page.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
            await expect(page.getByLabel(unlockLabel, { exact: true })).toBeEnabled();
            expect((await retrieve()).status()).toBe(401);
        }
        await unlock();
        const third = await retrieve();
        expect(third.status()).toBe(200);
        const latest = await third.json();
        const latestContext = await agent.get('/api/agent/v1/context', { headers: bearer(latest.credential.token) });
        expect(latestContext.status()).toBe(200);
        const secondTab = await browserContext.newPage();
        let sharedToken: string;
        try {
            await secondTab.goto(isolatedRuntime.url);
            const renew = secondTab.getByRole('button', { name: 'Rinnova accesso', exact: true });
            await expect(renew).toBeVisible();
            expect((await (await retrieve()).json()).receipt.mandateRef).toBe(latest.receipt.mandateRef);
            const confirmation = secondTab.waitForResponse(response => response.url().endsWith('/api/agent-mandates/unlock'));
            await renew.click();
            const confirmed = await confirmation;
            expect(confirmed.status()).toBe(204);
            await expect(secondTab.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
            const afterShare = await retrieve();
            expect(afterShare.status()).toBe(200);
            const shared = await afterShare.json();
            expect(shared.receipt.mandateRef).not.toBe(latest.receipt.mandateRef);
            expect(shared.receipt.expiresAt - shared.receipt.issuedAt).toBe(43200000);
            const replay = await secondTab.evaluate(async ({ body, etag }) => {
                const confirm = (binding: string) => fetch('/api/agent-mandates/unlock', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'If-Match': binding }, body });
                const repeated = await confirm(etag);
                const stale = await confirm('"stale-abcdefghijklmnopqrstuvwxyz"');
                return [repeated.status, stale.status];
            }, { body: confirmed.request().postData()!, etag: confirmed.request().headers()['if-match'] });
            expect(replay).toEqual([204, 403]);
            if (credentialKind === 'pin') {
                const future = await agent.post('/api/agent/v1/pairings', { data: { name: 'Client sintetico successivo', operations } });
                expect(future.status()).toBe(201);
                const pending = await future.json();
                await page.getByLabel('PIN di conferma', { exact: true }).fill(agentVisitPin);
                const templateResponse = page.waitForResponse(response => response.url().endsWith('/api/agent-mandates') && response.request().method() === 'POST');
                await page.getByRole('button', { name: 'Crea mandato', exact: true }).click();
                expect((await templateResponse).status()).toBe(201);
                await page.getByLabel('Rinnova allo sblocco', { exact: true }).check();
                await page.getByLabel('PIN per Client sintetico successivo', { exact: true }).fill(agentVisitPin);
                const approval = page.waitForResponse(response => response.url().endsWith('/api/agent-mandates/pairings') && response.request().method() === 'POST');
                await page.getByRole('button', { name: 'Approva ' + pending.receipt.code, exact: true }).click();
                expect((await approval).status()).toBe(200);
                const approved = await agent.get('/api/agent/v1/pairings?requestId=' + pending.receipt.id,
                    { headers: { Authorization: 'Pairing ' + pending.pairingCredential.claim } });
                expect(approved.status()).toBe(200);
                const futureToken = (await approved.json()).registrationCredential.token;
                expect((await retrieve(futureToken)).status()).toBe(401);
                const duplicate = await secondTab.evaluate(async ({ body, etag }) => (await fetch('/api/agent-mandates/unlock', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body,
                })).status, { body: confirmed.request().postData()!, etag: confirmed.request().headers()['if-match'] });
                expect(duplicate).toBe(204);
                expect((await retrieve(futureToken)).status()).toBe(401);
                await page.getByRole('button', { name: 'Revoca Client sintetico successivo', exact: true }).click();
                await page.getByRole('button', { name: 'Conferma revoca', exact: true }).click();
                await expect(page.getByRole('button', { name: 'Revoca Client sintetico successivo', exact: true })).toHaveCount(0);
            }
            expect((await (await retrieve()).json()).receipt.mandateRef).toBe(shared.receipt.mandateRef);
            expect((await deposit(latest.credential.token)).status()).toBe(401);
            const primary = await documentRequests(page).get('/api/auth/check');
            expect(primary.status()).toBe(200);
            expect((await primary.json()).hasSession).toBe(true);
            sharedToken = shared.credential.token;
        } finally { await secondTab.close(); }
        await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
        await page.getByRole('button', { name: 'Revoca ' + registrationName, exact: true }).click();
        await page.getByRole('button', { name: 'Conferma revoca', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Revoca ' + registrationName, exact: true })).toHaveCount(0);
        expect((await deposit(sharedToken)).status()).toBe(401);
        expect((await retrieve()).status()).toBe(401);
        await lock();
        await unlock(false);
        expect((await retrieve()).status()).toBe(401);
        const emptyTab = await browserContext.newPage();
        try {
            const unexpected: string[] = [];
            emptyTab.on('request', request => { if (opensRenewal(request.url())) unexpected.push(request.url()); });
            await emptyTab.goto(isolatedRuntime.url);
            await emptyTab.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
            await expect(emptyTab.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
            expect(unexpected).toEqual([]);
        } finally { await emptyTab.close(); }
    } finally { await agent.dispose(); }
});
