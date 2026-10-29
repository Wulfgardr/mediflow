import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { deny, planDigest, receiptSchema, portalAttributes, type LocalOperationPlan, type LocalOperationReceipt } from '../contract.ts';
import { SYNTHETIC_PORTAL_STYLE, specialistFieldLabel } from './prescription.ts';

export type PortalState = { kind: 'empty' } | { kind: 'draft'; plan: LocalOperationPlan }
    | { kind: 'submitted'; plan: LocalOperationPlan; receipt: LocalOperationReceipt; actor: 'executor' | 'physician' };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function createSyntheticSpecialistPortal() {
    let state: PortalState = { kind: 'empty' }, plan: LocalOperationPlan;
    const key = randomBytes(32), session = randomBytes(32).toString('hex');
    let dropResponse = false, hostileText = '', extraField = '', extraResource = false, afterAct: (() => Promise<void>) | null = null;
    let observed: Partial<Pick<LocalOperationPlan, 'patientId' | 'practiceId' | 'portalAccountId' | 'uiVersion'>> = {};
    let humanRevision = 1;
    const traffic: { method: string; path: string; body: string }[] = [];
    const sign = (receipt: Omit<LocalOperationReceipt, 'evidence'>) => createHmac('sha256', key).update(JSON.stringify(receipt)).digest('hex');
    function page() {
        const values = state.kind === 'empty' ? null : state.plan;
        const visible = { ...plan, ...observed };
        return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Portale inventato</title>
        ${extraResource ? '<link rel="stylesheet" href="/unclassified">' : ''}<style>${SYNTHETIC_PORTAL_STYLE}</style></head>
        <body><h1>Prescrizione specialistica</h1><p>Simulatore con soli dati inventati</p><p>${escape(hostileText)}</p>
        <main ${Object.entries(portalAttributes).map(([key, attribute]) => `${attribute}="${escape(visible[key as keyof typeof portalAttributes])}"`).join(' ')} data-human="${humanRevision}">
        <form method="post" action="/draft">${plan.fields.map(field => `<label>${escape(specialistFieldLabel(field.name))}<input name="${escape(field.name)}" value="${escape(values?.fields.find(item => item.name === field.name)?.value ?? '')}"></label>`).join('')}
        ${extraField ? `<label>Campo nuovo<input name="${escape(extraField)}" value="NEW_FIELD_SENTINEL_51"></label>` : ''}
        <button type="submit">Salva bozza</button><button type="submit" formaction="/submit">Emetti prescrizione</button>
        <button type="submit" formaction="/physician-submit">Invia e firma come medico</button></form>
        <p role="status">${state.kind === 'submitted' ? 'Ricevuta disponibile' : state.kind === 'draft' ? 'Bozza salvata' : 'Da compilare'}</p></main></body></html>`;
    }
    function valuesMatch(body: string, expected: LocalOperationPlan) {
        const values = new URLSearchParams(body);
        return [...values].length === expected.fields.length && expected.fields.every(field => values.getAll(field.name).length === 1 && values.get(field.name) === field.value);
    }
    function submit(actor: 'executor' | 'physician', body: string) {
        if (state.kind !== 'draft' || !valuesMatch(body, state.plan) || planDigest(state.plan) !== planDigest(plan)
            || Object.keys(observed).length || (actor === 'executor' && plan.finalAct !== 'protected')) deny();
        const data: Omit<LocalOperationReceipt, 'evidence'> = { operationId: plan.operationId, patientId: plan.patientId,
            practiceId: plan.practiceId, planDigest: planDigest(plan), receiptId: `demo-receipt-${randomBytes(16).toString('hex')}`,
            serviceState: 'synthetic-confirmed', destination: plan.destinations.find(item => item.purpose === 'act')!,
            parts: plan.parts.map(id => ({ id, state: 'confirmed' })) };
        state = { kind: 'submitted', plan: structuredClone(plan), receipt: { ...data, evidence: sign(data) }, actor };
    }
    const server = createServer(async (request, response) => {
        try {
            if (request.headers.cookie !== `cu_demo=${session}`) { response.writeHead(403).end(); return; }
            const chunks: Buffer[] = []; let size = 0;
            for await (const chunk of request) { size += chunk.length; if (size > 65536) deny(); chunks.push(Buffer.from(chunk)); }
            const body = Buffer.concat(chunks).toString('utf8');
            traffic.push({ method: request.method!, path: request.url!, body });
            response.setHeader('cache-control', 'no-store');
            response.setHeader('content-security-policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
            if (request.method === 'GET' && request.url === '/receipt') {
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify(state.kind === 'submitted' ? state.receipt : null)); return;
            }
            if (request.method === 'POST' && request.url === '/draft') {
                if (state.kind === 'submitted' || !valuesMatch(body, plan) || Object.keys(observed).length) deny();
                state = { kind: 'draft', plan: structuredClone(plan) };
            } else if (request.method === 'POST' && ['/submit', '/physician-submit'].includes(request.url!)) {
                submit(request.url === '/submit' ? 'executor' : 'physician', body);
                if (afterAct) await afterAct();
                if (dropResponse) { request.socket.destroy(); return; }
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify(state.kind === 'submitted' ? state.receipt : null)); return;
            } else if (request.method !== 'GET' || request.url !== '/portal') { response.writeHead(404).end(); return; }
            response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(page());
        } catch { if (!response.headersSent) response.writeHead(409); response.end('Operazione non disponibile'); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return Object.freeze({ origin, traffic, cookie: { name: 'cu_demo', value: session, url: origin },
        configure(value: LocalOperationPlan) { if (value.destinations.some(item => item.origin !== origin)) deny(); plan = structuredClone(value); },
        get state() { return structuredClone(state); },
        setExtraResource() { extraResource = true; },
        setHostileText(value: string) { hostileText = value; }, setExtraField(value: string) { extraField = value; },
        setObserved(value: typeof observed) { observed = value; },
        humanEdit(name: string, value: string) {
            if (state.kind !== 'draft') deny();
            const field = state.plan.fields.find(field => field.name === name); if (!field) deny();
            field.value = value; humanRevision++;
        },
        loseResponse() { dropResponse = true; }, afterAct(callback: () => Promise<void>) { afterAct = callback; },
        verifyReceipt(raw: LocalOperationReceipt) {
            const parsed = receiptSchema.safeParse(raw); if (!parsed.success) return false;
            const { evidence, ...data } = parsed.data, actual = Buffer.from(evidence), expected = Buffer.from(sign(data));
            return actual.length === expected.length && timingSafeEqual(actual, expected);
        },
        async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); key.fill(0); },
    });
}
