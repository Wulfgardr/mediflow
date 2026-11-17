import { expect, test } from './fixtures/isolated-runtime';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pairSyntheticVisitAgent, agentVisitPassphrase } from './agent-visit-utils';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';

test.describe.configure({ retries: 0 });
test('a cookie-free agent deposits encrypted text while the doctor is idle-locked and reopens it after process restart', async ({ page, isolatedRuntime, playwright }, testInfo) => {
    test.setTimeout(150000);
    const agent = await playwright.request.newContext({ baseURL: isolatedRuntime.url });
    try {
        await page.clock.install();
        const { mandate, token } = await pairSyntheticVisitAgent(page, agent, ['visita.apri', 'visita.nota', 'visita.chiudi']);
        await page.clock.fastForward(16 * 60 * 1000);
        await expect(page.getByLabel('Passphrase', { exact: true })).toBeVisible();
        const visitId = randomUUID(), itemId = randomUUID();
        const sentinel = 'SYNTHETIC_AGENT_CASSETTE_REOPEN_6742';
        const context = { mandateRef: mandate.id, visitId };
        const anchor = sealAgentItemNode(mandate.publicKey, { ...context, itemId: visitId, kind: 'anchor' }, new TextEncoder().encode(JSON.stringify({ fiscalCode: 'SYNTHETIC_CF_6742' })));
        const headers = { Authorization: 'Bearer ' + token };
        const open = await agent.post('/api/agent/v1/visits', { headers, data: { operation: 'visita.apri', visitId, anchor } });
        expect(open.status()).toBe(201);
        const bytes = new TextEncoder().encode(JSON.stringify({ text: sentinel }));
        const item = { id: itemId, kind: 'note', envelope: sealAgentItemNode(mandate.publicKey, { ...context, itemId, kind: 'note' }, bytes), byteLength: bytes.length, documentHash: null };
        const add = await agent.post('/api/agent/v1/visits', { headers, data: { operation: 'visita.nota', visitId, expectedRevision: 1, item } });
        expect(add.status()).toBe(201);
        const therapyId = randomUUID();
        const therapy = { id: therapyId, kind: 'therapy', envelope: sealAgentItemNode(mandate.publicKey, { ...context, itemId: therapyId, kind: 'therapy' }, bytes), byteLength: bytes.length, documentHash: null };
        const denied = await agent.post('/api/agent/v1/visits', { headers, data: { operation: 'visita.proponi.terapia', visitId, expectedRevision: 2, item: therapy } });
        expect(denied.status()).toBe(403);
        const close = await agent.post('/api/agent/v1/visits', { headers, data: { operation: 'visita.chiudi', visitId, expectedRevision: 2 } });
        expect(close.status()).toBe(201);
        const closed = await close.json();
        expect(closed.receipt.itemCount).toBe(1);
        expect(JSON.stringify(closed)).not.toContain(token);
        for (const file of ['medical.db', 'medical.db-wal']) {
            try { expect(readFileSync(path.join(isolatedRuntime.dataDirectory, file)).includes(Buffer.from(sentinel))).toBe(false); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        await isolatedRuntime.restart();
        await page.clock.resume();
        await page.goto(isolatedRuntime.url + '/in-arrivo');
        await page.getByLabel('Passphrase', { exact: true }).fill(agentVisitPassphrase);
        await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
        await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
        await expect(page.getByText(sentinel, { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'SYNTHETIC_CF_6742', exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('cassetta-riaperta.png'), fullPage: true });
        expect(readFileSync(path.join(isolatedRuntime.dataDirectory, '..', 'server.log'), 'utf8')).not.toContain(token);
        expect((await agent.storageState()).cookies).toEqual([]);
    } finally { await agent.dispose(); }
});
