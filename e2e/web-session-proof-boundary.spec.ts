import { randomBytes } from 'node:crypto';
import { expect, test } from './fixtures/isolated-runtime';
import { documentRequests, trustedWebRequestHeaders } from './fixtures/trusted-web-request';
import { bootstrapUnlockedSession } from './utils';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.describe.configure({ retries: 0 });

const reads = [
    '/api/patients',
    '/api/system/backup-restore',
    '/api/agent-mandates',
    '/api/agent-mandates/incoming',
    '/api/agent-mandates/registrations',
    '/api/agent-mandates/pairings',
    '/api/agent-mandates/confirmation',
    '/api/agent-mandates/local-kit',
    '/api/agent-mandates/local-kit/context',
] as const;

const sessionMaterial = ['x-mediflow-web-session', 'x-mediflow-web-control'] as const;
const documentProof = 'x-mediflow-web-instance';

test('la sessione Web resta del documento anche sulle rotte di agenti, In arrivo e backup', async ({ page, playwright, isolatedRuntime }) => {
    test.setTimeout(150_000);
    const pin = process.env.E2E_PIN || '1234';
    await bootstrapUnlockedSession(page, pin);
    const web = documentRequests(page);

    const observed = page.waitForRequest(request => new URL(request.url()).pathname === '/api/patients');
    for (const path of reads) {
        const response = await web.get(path);
        expect([401, 403], `${path} dal documento sbloccato`).not.toContain(response.status());
    }
    const documentHeaders = (await observed).headers();
    const replayed: Record<string, string> = {};
    for (const name of sessionMaterial) if (documentHeaders[name]) replayed[name] = documentHeaders[name];
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    if (cookieHeader) replayed.cookie = cookieHeader;
    expect(Object.keys(replayed).length, 'materiale di sessione osservato nel documento').toBeGreaterThan(0);

    const outside = await playwright.request.newContext({ baseURL: isolatedRuntime.url });
    try {
        const forged = randomBytes(32).toString('hex');
        for (const path of reads) {
            const withoutProof = await outside.get(path, { headers: replayed, maxRedirects: 0 });
            expect([401, 403], `${path} senza la prova del documento`).toContain(withoutProof.status());
            const withForgedProof = await outside.get(path, { headers: { ...replayed, [documentProof]: forged }, maxRedirects: 0 });
            expect([401, 403], `${path} con una prova diversa`).toContain(withForgedProof.status());
        }

        const proof = documentHeaders[documentProof];
        expect(proof, 'il documento presenta la propria prova').toMatch(/^[a-f0-9]{64}$/u);
        const admitted = await outside.get('/api/agent-mandates', { headers: { ...replayed, [documentProof]: proof }, maxRedirects: 0 });
        expect(admitted.status(), 'la stessa richiesta con la prova del documento').toBe(200);

        const trusted = trustedWebRequestHeaders(isolatedRuntime.url);
        const mutations = [
            { path: '/api/entries', data: {} },
            { path: '/api/agent-mandates/unlock', data: { sharedTab: '00000000-0000-4000-8000-000000000000' } },
            { path: '/api/agent-mandates/local-kit/context', data: {} },
            { path: '/api/agent-mandates/incoming', data: {} },
        ] as const;
        for (const { path, data } of mutations) {
            const response = await outside.post(path, {
                headers: { ...trusted, ...replayed, [documentProof]: forged, 'Content-Type': 'application/json' },
                data,
                maxRedirects: 0,
            });
            expect([401, 403], `${path} in scrittura con una prova diversa`).toContain(response.status());
        }
        const validated = await web.post('/api/entries', { data: {} });
        expect([401, 403], 'la stessa scrittura dal documento supera il controllo di sessione').not.toContain(validated.status());
    } finally {
        await outside.dispose();
    }
});
