import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { initializeTerritorialPacks, readTerritorialPacks, commitTerritorialPackTransition } from '../../territorial-pack-store.ts';
import { initializeSqliteSchema } from '../../sqlite-schema.ts';
import { createLocalOperationHost } from '../host.ts';
import { deny, type LiveContext, type LocalOperationPlan } from '../contract.ts';
import { specialistPlan, type SpecialistDecision } from './prescription.ts';
import { createSyntheticSpecialistPortal } from './synthetic-portal.ts';
import { createSyntheticSpecialistBrowser } from './browser-adapter.ts';
import type { SpecialistNativeSurface } from './native-surface.ts';
import { readSpecialistSources } from './source-service.ts';
import { recordSpecialistOutcome } from './outcome-service.ts';

export const SYNTHETIC_DECISION = {
    schema: 'mediflow.synthetic-specialist.v1', version: '1', patientId: 'demo-patient', practiceId: 'demo-practice',
    decidedBy: 'demo-physician', clinicalQuestion: 'QUESITO_SENTINEL_91: controllo inventato', diagnosis: 'DIAGNOSI_SENTINEL_47',
    priority: 'D', access: 'first', regime: 'ssr', decidedAt: 1_000_000,
    exemption: { kind: 'verified', code: 'ESENZIONE_SENTINEL_81', patientId: 'demo-patient', source: 'demo-title',
        version: '1', validFrom: 900_000, validUntil: 2_000_000, applicableCodes: ['DEMO.01'] },
    items: [{ id: 'demo-line', code: 'DEMO.01', description: 'PRESTAZIONE_SENTINEL_72', quantity: 2, unit: 'prestazione' }],
} satisfies SpecialistDecision;
export const SYNTHETIC_CATALOG = { version: 'demo-catalog-1', validFrom: 900_000, validUntil: 2_000_000,
    entries: [{ code: 'DEMO.01', description: 'PRESTAZIONE_SENTINEL_72', unit: 'prestazione' }] };
export const SPECIALIST_SENTINELS = ['PAZIENTE_SENTINEL_18', 'IDENTITA_SENTINEL_29', 'QUESITO_SENTINEL_91',
    'DIAGNOSI_SENTINEL_47', 'ESENZIONE_SENTINEL_81', 'PRESTAZIONE_SENTINEL_72', 'HOSTILE_SENTINEL_35', 'NEW_FIELD_SENTINEL_51'];

export async function createSyntheticSpecialistDemo(finalAct: 'protected' | 'manual' = 'protected', native?: SpecialistNativeSurface) {
    if (!process.env.MEDIFLOW_DATA_DIR) deny();
    const directory = mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'cu-specialist-'));
    const file = path.join(directory, 'synthetic.db'), key = randomBytes(32);
    let db = new Database(file); initializeSqliteSchema(db);
    db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL');
    const generation = db.prepare('SELECT generation FROM archive_generation').pluck().get() as string;
    db.transaction(() => initializeTerritorialPacks(db, 'new')).immediate();
    function storePack(preset: 'core' | 'core+it+lom') {
        commitTerritorialPackTransition(db, { schemaVersion: 'mediflow.territorial-packs.v1',
            expectedRevision: readTerritorialPacks(db).revision, preset, confirmed: true },
        { actorType: 'system', actorRef: 'host-territorial-pack-manager', sourceSurface: 'job' },
        () => { if (db.prepare('SELECT generation FROM archive_generation').pluck().get() !== generation) deny(); });
    }
    storePack('core+it+lom');
    let now = 1_000_000, context: LiveContext = { installationId: 'demo-installation', archiveGeneration: generation,
        sessionId: 'demo-session', clientId: 'demo-client', operatorId: 'demo-physician', patientId: 'demo-patient',
        practiceId: 'demo-practice', portalAccountId: 'demo-account', role: 'physician', expiresAt: 9_000_000, revocationEpoch: 1, humanRevision: 1 };
    let decision: SpecialistDecision = structuredClone(SYNTHETIC_DECISION);
    const portal = await createSyntheticSpecialistPortal();
    let plan: LocalOperationPlan;
    function resolvePlan() { const sources = readSpecialistSources(db, 'demo-operation', context.patientId, cipher.open); decision = sources.decision; return specialistPlan({ operationId: 'demo-operation', context, ...sources,
        catalog: SYNTHETIC_CATALOG, origin: portal.origin, finalAct, now }); }
    const cipher = {
        seal(value: string) {
            const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
            const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
            return `ENC:${iv.toString('base64')}:${bytes.toString('base64')}`;
        },
        open(value: string) {
            const [, iv, data] = value.split(':'), bytes = Buffer.from(data!, 'base64');
            const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv!, 'base64'));
            decipher.setAuthTag(bytes.subarray(-16));
            return Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString('utf8');
        },
    };
    db.prepare('INSERT INTO patients(id,first_name,last_name,tax_code,version,created_at) VALUES (?,?,?,?,1,?)').run('demo-patient', 'PAZIENTE_SENTINEL_18', 'Inventato', 'IDENTITA_SENTINEL_29', now / 1000);
    db.prepare("INSERT INTO service_prescriptions(id,patient_id,prescribed_at,service_name,clinical_question,notes,version) VALUES (?,?,?,?,?,?,1)")
        .run('demo-operation', 'demo-patient', now / 1000, cipher.seal('Prestazioni inventate'), cipher.seal(decision.clinicalQuestion), cipher.seal(JSON.stringify({ decision })));
    plan = resolvePlan(); portal.configure(plan);
    const browser = await createSyntheticSpecialistBrowser({ plan: () => plan, cookie: portal.cookie,
        verifyReceipt: async (ctx, receipt) => { ctx.assertCurrent(); return portal.verifyReceipt(receipt); } });
    browser.context.setDefaultTimeout(2500); browser.context.setDefaultNavigationTimeout(2500);
    const listeners = new Set<() => void>(), reviews: LocalOperationPlan[] = [];
    let confirm: (plan: Readonly<LocalOperationPlan>) => Promise<boolean> = async plan => { reviews.push(structuredClone(plan)); return native ? native.confirm(plan) : true; };
    function makeHost() {
        return createLocalOperationHost({ adapter: browser.adapter, database: () => db, currentContext: () => context,
            currentArchiveKey: () => key, sourceSurface: 'native', now: () => now,
            resolvePlan: () => { plan = resolvePlan(); return plan; }, confirmExactPlan: plan => confirm(plan),
            subscribeInvalidation(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
            requestOpen: async () => { if (native) await native.select(resolvePlan()); }, requestResume: async () => { if (native) await native.select(resolvePlan()); },
            recordConfirmed(record) {
                recordSpecialistOutcome(db, { record, plan: resolvePlan(), decision, seal: cipher.seal,
                    assertCurrent() { if (context.archiveGeneration !== generation || context.expiresAt <= now) deny(); } });
            },
        });
    }
    let host = makeHost();
    return {
        get host() { return host; }, get service() { return host.trusted; }, get plan() { return plan; }, get db() { return db; },
        get context() { return context; }, portal, browser, reviews, cipher, now: () => now,
        async selectLocal() { if (native && await native.select(plan) !== 'selected') deny(); return host.trusted.create('demo-operation'); },
        setDecision(value: SpecialistDecision) { decision = value; db.prepare('UPDATE service_prescriptions SET notes=?,version=version+1 WHERE id=?').run(cipher.seal(JSON.stringify({ decision })), 'demo-operation'); },
        setConfirmation(value: typeof confirm) { confirm = value; },
        setContext(value: Partial<LiveContext>, notify = true) { context = { ...context, ...value }; if (notify) for (const listener of listeners) listener(); },
        setPack(preset: 'core' | 'core+it+lom') { storePack(preset); for (const listener of listeners) listener(); },
        advance(value: number) { now += value; },
        reopen() { host.close(); db.close(); db = new Database(file); db.pragma('synchronous=FULL'); host = makeHost(); },
        async close() { host.close(); await browser.close(); await portal.close(); db.close(); key.fill(0); rmSync(directory, { recursive: true, force: true }); },
    };
}
