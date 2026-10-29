import Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createSqliteLocalOperationJournal } from './sqlite-journal.ts';
import { createLocalOperationService } from './service.ts';
import { deny, planDigest, type LocalOperationAdapter, type LocalOperationPlan, type LocalOperationReceipt,
    type LiveContext, type AdapterContext, type Destination } from './contract.ts';
import type { TerritorialPackCapability } from '../territorial-pack-contract.ts';

export const SENTINELS = ['SYNTHETIC_PERSON_98CE', 'SYNTHETIC_TAX_71B2', 'SYNTHETIC_DIAGNOSIS_5A19', 'SYNTHETIC_EXEMPTION_901C'];

export async function syntheticFixture() {
    if (!process.env.MEDIFLOW_DATA_DIR) throw new Error('synthetic_data_dir_required');
    const directory = mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR, 'cu1a-'));
    const databaseFile = path.join(directory, 'synthetic.db');
    let db = new Database(databaseFile);
    db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL');
    db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE audit_events(event_id TEXT PRIMARY KEY, schema_version INTEGER, event_type TEXT, occurred_at INTEGER,
        outcome TEXT, actor_type TEXT, actor_ref TEXT, subject_type TEXT, subject_ref TEXT, source_surface TEXT, redacted_metadata TEXT);`);
    let now = 1_000_000;
    let context: LiveContext = { installationId: 'synthetic-installation', archiveGeneration: 'synthetic-archive',
        sessionId: 'synthetic-session', clientId: 'synthetic-client', operatorId: 'synthetic-physician',
        patientId: 'synthetic-patient', practiceId: 'synthetic-practice', portalAccountId: 'synthetic-account',
        role: 'physician', expiresAt: 9_000_000, revocationEpoch: 1, humanRevision: 1 };
    let territory: TerritorialPackCapability = { schemaVersion: 'mediflow.territorial-packs.v1', status: 'ready', revision: 1, preset: 'core+it+lom' };
    db.prepare('INSERT INTO settings VALUES (?,?)').run('territorial.packs.initialization', JSON.stringify({ schemaVersion: 'mediflow.territorial-packs.initialization.v1', origin: 'existing' }));
    function storeTerritory() { db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('territorial.packs', JSON.stringify({ schemaVersion: territory.schemaVersion, revision: territory.revision, preset: territory.preset })); }
    storeTerritory();
    const traffic: { method: string; path: string; body: string }[] = [];
    const server = createServer(async (request, response) => {
        const body: Buffer[] = []; for await (const chunk of request) body.push(Buffer.from(chunk));
        traffic.push({ method: request.method!, path: request.url!, body: Buffer.concat(body).toString('utf8') });
        response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    let plan: LocalOperationPlan = { operationId: 'synthetic-operation', patientId: context.patientId, practiceId: context.practiceId,
        installationId: context.installationId, archiveGeneration: context.archiveGeneration, procedureId: 'synthetic-procedure',
        contractVersion: '1', adapterVersion: 'synthetic-1', uiVersion: 'synthetic-ui-1', catalogVersion: 'synthetic-catalog-1',
        sourceVersion: '1', portalAccountId: context.portalAccountId, operatorId: context.operatorId, territory: 'lom', finalAct: 'protected',
        sources: [{ ref: 'physician-decision', version: '1', verifiedAt: now }],
        fields: SENTINELS.map((value, index) => ({ name: `field-${index}`, classification: index < 2 ? 'identity' : 'clinical',
            value, sourceRef: 'physician-decision', sourceVersion: '1', transformation: 'none', required: true })),
        destinations: (['observe', 'prepare', 'act', 'reconcile'] as const).map(purpose => ({ origin, path: `/${purpose}`, method: purpose === 'observe' || purpose === 'reconcile' ? 'GET' : 'POST', purpose })),
        parts: ['synthetic-part-1', 'synthetic-part-2'],
    };
    const key = randomBytes(32), receiptKey = randomBytes(32);
    const listeners = new Set<() => void>();
    let filled: string | null = null, actCount = 0, receipt: LocalOperationReceipt | null = null;
    let wrongObservation: Record<string, unknown> = {}, dropReceipt = false, stopped = 0;
    let afterAct: (() => Promise<void>) | null = null;
    let confirmation: () => Promise<boolean> = async () => true;
    let extraRequest: Destination | null = null;
    let backgroundContext: AdapterContext | null = null;
    const signature = (item: Omit<LocalOperationReceipt, 'evidence'>) => createHmac('sha256', receiptKey).update(JSON.stringify(item)).digest('hex');
    function issueReceipt() {
        const item: Omit<LocalOperationReceipt, 'evidence'> = { operationId: plan.operationId, patientId: plan.patientId, practiceId: plan.practiceId,
            planDigest: planDigest(plan), receiptId: 'synthetic-receipt', serviceState: 'synthetic-confirmed',
            destination: plan.destinations.find(destination => destination.purpose === 'act')!, parts: plan.parts.map(id => ({ id, state: 'confirmed' })) };
        receipt = { ...item, evidence: signature(item) }; return receipt;
    }
    async function request(ctx: AdapterContext, purpose: Destination['purpose'], values?: unknown) {
        const destination = plan.destinations.find(item => item.purpose === purpose)!;
        ctx.authorizeRequest(destination);
        await fetch(`${destination.origin}${destination.path}`, { method: destination.method,
            ...(values ? { body: JSON.stringify(values) } : {}), signal: ctx.signal });
        if (extraRequest) ctx.authorizeRequest(extraRequest);
    }
    const adapter: LocalOperationAdapter = {
        version: 'synthetic-1', protectedFinalAct: true,
        async observe(ctx) {
            backgroundContext = ctx;
            await request(ctx, 'observe');
            return { patientId: plan.patientId, practiceId: plan.practiceId, portalAccountId: plan.portalAccountId,
                uiVersion: plan.uiVersion, operatorId: plan.operatorId, humanRevision: context.humanRevision, planDigest: filled, census: 'complete', unclassifiedFields: [], ...wrongObservation };
        },
        async prepare(ctx, values) { await request(ctx, 'prepare', values); filled = planDigest(values); },
        async act(ctx, values) {
            ctx.assertCurrent();
            if (filled !== planDigest(values)) throw new Error('synthetic_content_changed');
            await request(ctx, 'act', values); actCount++; issueReceipt();
            if (afterAct) await afterAct();
            if (dropReceipt) throw new Error(SENTINELS.join('|'));
            return receipt;
        },
        async reconcile(ctx) { await request(ctx, 'reconcile'); return receipt; },
        async verifyReceipt(ctx, item) {
            ctx.assertCurrent();
            const { evidence, ...values } = item;
            const expected = Buffer.from(signature(values)); const actual = Buffer.from(evidence);
            return expected.length === actual.length && timingSafeEqual(expected, actual);
        },
        stop() { stopped++; },
    };
    const makeJournal = () => createSqliteLocalOperationJournal(db, {
        actor: () => ({ operatorId: context.operatorId, sourceSurface: 'native' }),
        seal(plaintext) {
            const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
            const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
        },
        open(ciphertext) {
            const bytes = Buffer.from(ciphertext, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
            decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
        },
    });
    let journal = makeJournal();
    const ports = { journal, adapter,
        captureArchive() {
            const connection = db, installation = context.installationId, generation = context.archiveGeneration;
            return { assertCurrent() {
                if (connection !== db || installation !== context.installationId || generation !== context.archiveGeneration) deny();
            } };
        }, currentContext: () => context, currentTerritory: () => territory,
        resolvePlan: () => plan, confirmExactPlan: () => confirmation(), now: () => now,
        subscribeInvalidation(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    let service = createLocalOperationService(ports);
    return {
        get service() { return service; }, ports, get journal() { return journal; }, get db() { return db; }, adapter, traffic, directory,
        get plan() { return plan; }, get context() { return context; }, get actCount() { return actCount; }, get stopped() { return stopped; },
        now: () => now, advance(milliseconds: number) { now += milliseconds; },
        setContext(changes: Partial<LiveContext>, notify = false) { context = { ...context, ...changes }; if (notify) for (const listener of listeners) listener(); },
        setPlan(changes: Partial<LocalOperationPlan>) { plan = { ...plan, ...changes }; },
        setTerritory(preset: TerritorialPackCapability['preset'], notify = true) {
            territory = { ...territory, preset, revision: territory.revision! + 1 }; storeTerritory(); if (notify) for (const listener of listeners) listener();
        },
        setWrongObservation(value: Record<string, unknown>) { wrongObservation = value; },
        setExtraRequest(value: Destination | null) { extraRequest = value; },
        loseResponse() { dropReceipt = true; },
        setAfterAct(callback: () => Promise<void>) { afterAct = callback; },
        setConfirmation(callback: () => Promise<boolean>) { confirmation = callback; },
        setReceipt(value: LocalOperationReceipt | null) { receipt = value; },
        manualAct() { actCount++; filled = planDigest(plan); return issueReceipt(); },
        get receipt() { return receipt; },
        async backgroundProbe() { if (!backgroundContext) throw new Error('missing'); await request(backgroundContext, 'observe'); },
        reopen() {
            service.close(); db.close(); db = new Database(databaseFile); db.pragma('synchronous = FULL');
            journal = makeJournal(); ports.journal = journal;
            service = createLocalOperationService(ports); return service;
        },
        async close() { service.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); rmSync(directory, { recursive: true, force: true }); },
    };
}
