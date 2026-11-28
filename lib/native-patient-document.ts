import { erasePatientDocumentFileKey, verifyPatientDocumentFile } from './patient-document-file-verification';
import 'server-only';
import { observeNativeDocumentContext } from './security/native-document-context';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { dbServer } from './db-server';
import type { NetworkWriteContext } from './network-write-context';
import { prepareNetworkPatientCommitGuard } from './network-patient-commit-authority';
import { archiveGenerationForSession } from './security/archive-session-generation';
import { serverSessions } from './security/web-auth-lifecycle-owner-adapter';
import { confirmNativeChatAccessPin } from './security/native-chat-access-confirmation';
import type { PairedNativeSession } from './security/paired-native-session';
import { createPatientDocumentCommandService, type PatientDocumentCreateHost,
    type PatientDocumentCreateReview, type PreparedPatientDocument } from './patient-document-create-command';
import { extractAnyDocLocalBytes } from './domain/documents/anydoc-local-extraction-runner';
import { continueAnyDocImageOrScanWithLocalOcr } from './domain/documents/anydoc-apple-vision-ocr-composition';
import { attachments, auditEvents, patients, patientsToAmbulatories } from './schema';
import { activePatients } from './patient-lifecycle';
import { parsePatientDocumentCreateJournal } from './patient-document-create-journal';
import { createDossierBatchApprovals } from './patient-document-batch-approval';
import { dossierBatchRowDigest, isDossierBatchRow } from './patient-document-batch-contract';
import { birthDateMatchesTaxCode, birthError, identifierError } from './patient-identity';
import { collectDossierTaxCodes } from './domain/documents/dossier-import';
import type { LocalExtractionFailureDetail } from './domain/documents/anydoc-local-extraction-contract';

const CAPABILITIES = ['network.replica.write-patient-lifecycle', 'network.replica.write-documents', 'network.replica.readonly-documents'] as const;
const MAX_BYTES = 10 * 1024 * 1024;
const deny = (): never => { throw new Error('Native patient document denied'); };
const sealed = (value: unknown): value is string => typeof value === 'string'
    && /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/u.test(value);
type Source = { host: PatientDocumentCreateHost; viewId: string; release: () => void };
/** Admission refused for capacity, not authority: the same session already holds a work, or the host is full.
 * The native route keeps answering 403 as before; the Web route tells the physician which case it is. */
export class PatientDocumentIntakeBusy extends Error {
    constructor(readonly reason: 'session' | 'host') { super('Patient document intake busy'); }
}
export class PatientDocumentBatchRowRejected extends Error {
    constructor(readonly reason: 'source-changed' | 'mixed-identity' | 'discordant-identity' | 'missing-name' | 'invalid-tax-code' | 'invalid-birth-date') {
        super('Dossier batch row rejected');
    }
}
export class NativePatientDocumentExtractionFailed extends Error {
    constructor(readonly detail: LocalExtractionFailureDetail | 'invalid_contract_input') {
        super('Native patient document extraction failed');
    }
}

/** Native host: paired client, native session, ambulatory and paired grants reread on every use. */
function nativeHost(database: typeof dbServer) {
    return async (context: NetworkWriteContext): Promise<PatientDocumentCreateHost> => {
        if (context.session.authChannel !== 'native' || context.session.role !== 'admin') return deny();
        const lifecycle = observeNativeDocumentContext(context.session, context.scopeAmbulatoryId);
        const guard = await prepareNetworkPatientCommitGuard(context, CAPABILITIES);
        const result: PatientDocumentCreateHost = {
            session: context.session, actorRef: context.session.userId, ambulatoryId: context.scopeAmbulatoryId,
            archiveGeneration: archiveGenerationForSession(context.session) ?? deny(), epoch: lifecycle.epoch, surface: 'native', pairedClientId: context.pairedClient.clientId,
            assertCurrent: tx => {
                if (!lifecycle.current() || guard(tx)) {
                    lifecycle.retire();
                    deny();
                }
            },
            confirm: async pin => await confirmNativeChatAccessPin(context.session as PairedNativeSession, pin) === 'confirmed',
            retain(dispose) {
                const port = serverSessions.mintNativeSessionResourcePort(context.session);
                if (!port) return deny();
                let release = () => {};
                const retire = () => { try { dispose(); } finally { queueMicrotask(() => release()); } };
                const registration = serverSessions.registerNativeSessionPrivateResource(port, retire);
                if (!registration) { serverSessions.releaseNativeSessionResourcePort(port); return deny(); }
                let releaseContext: () => void;
                try { releaseContext = lifecycle.retain(retire); }
                catch (error) {
                    serverSessions.unregisterNativeSessionPrivateResource(port, registration);
                    serverSessions.releaseNativeSessionResourcePort(port);
                    throw error;
                }
                let released = false;
                release = () => {
                    if (released) return;
                    released = true;
                    releaseContext();
                    serverSessions.unregisterNativeSessionPrivateResource(port, registration);
                    serverSessions.releaseNativeSessionResourcePort(port);
                };
                return release;
            },
        };
        database.transaction(tx => result.assertCurrent(tx), { behavior: 'immediate' });
        return result;
    };
}

export function createNativePatientDocumentService(database: typeof dbServer, clock: () => number = Date.now) {
    return createPatientDocumentIntake(database, nativeHost(database), clock);
}

/** Intake accepts bytes selected by an authenticated client, never a URL, path or chat attachment ID.
 * The client seals the PDF; stage consumes its file key to verify the original before extraction.
 * The host port decides which session, scope and confirmation own the work: native or local Web. */
export function createPatientDocumentIntake<Context extends { request: Request }>(database: typeof dbServer,
    host: (context: Context) => Promise<PatientDocumentCreateHost>, clock: () => number = Date.now) {
    const commands = createPatientDocumentCommandService(database, clock);
    const batches = createDossierBatchApprovals(clock);
    const sources = new Map<string, Source>();
    let preparing = 0;
    const reservations = new Map<object, () => void>();
    function owned(owner: PatientDocumentCreateHost, commandId: string) {
        const entry = sources.get(commandId);
        if (entry && entry.host.session !== owner.session) return deny();
        if (entry && (entry.host.ambulatoryId !== owner.ambulatoryId || entry.host.epoch !== owner.epoch)) { entry.release(); return deny(); }
        return entry;
    }
    function reread(owner: PatientDocumentCreateHost, commandId: string) {
        return database.transaction(tx => {
            owner.assertCurrent(tx);
            const receipt = commands.receipt(owner, commandId);
            let references: { patientId: string; attachmentId: string } | undefined;
            if (receipt.outcome === 'applied') {
                const row = tx.select().from(auditEvents).where(eq(auditEvents.eventId, commandId)).get();
                const journal = parsePatientDocumentCreateJournal(JSON.parse(row?.redactedMetadata ?? '{}').patientDocumentCreate);
                if (!journal?.patientId || !journal.sourceId || journal.pairedClientId !== owner.pairedClientId) return deny();
                references = { patientId: journal.patientId, attachmentId: journal.sourceId };
                const patient = tx.select({ id: patients.id }).from(patients)
                    .where(and(activePatients(), eq(patients.id, journal.patientId))).get();
                const membership = tx.select().from(patientsToAmbulatories).where(and(
                    eq(patientsToAmbulatories.patientId, journal.patientId), eq(patientsToAmbulatories.ambulatoryId, owner.ambulatoryId))).get();
                const source = tx.select({ id: attachments.id }).from(attachments).where(and(
                    eq(attachments.id, journal.sourceId), eq(attachments.patientId, journal.patientId))).get();
                if (!patient || !membership || !source) return deny();
            }
            owner.assertCurrent(tx);
            return receipt.outcome === 'applied' ? { ...receipt, ...references, attachmentReadback: 'client-verification-required' as const } : receipt;
        }, { behavior: 'immediate' });
    }
    async function stage(context: Context, owner: PatientDocumentCreateHost, value: unknown,
        batch?: { sourceDigest: string; taxCode: string; assertCurrent: () => void }) {
        const reservation = batch ?? owner.session;
        if (reservations.has(reservation)) throw new PatientDocumentIntakeBusy('session');
        if (preparing >= 2 || reservations.size >= 16) throw new PatientDocumentIntakeBusy('host');
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.keys(value).sort().join(',') !== 'data,fileKey,name,original,path') return deny();
        const input = value as Record<string, unknown>;
        if (!sealed(input.name) || input.name.length > 4096 || !sealed(input.path) || input.path.length > 4096
            || typeof input.data !== 'string' || !input.data.startsWith('ENC2:') || input.data.length > 20 * 1024 * 1024
            || typeof input.original !== 'string' || input.original.length > Math.ceil(MAX_BYTES / 3) * 4
            || !/^[A-Za-z0-9+/]+={0,2}$/u.test(input.original)) return deny();
        const bytes = Buffer.from(input.original, 'base64');
        if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== input.original
            || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') { bytes.fill(0); return deny(); }
        if (batch && createHash('sha256').update(bytes).digest('hex') !== batch.sourceDigest) {
            bytes.fill(0);
            throw new PatientDocumentBatchRowRejected('source-changed');
        }
        const sealedFile = { name: input.name, path: input.path, data: input.data };
        try { verifyPatientDocumentFile({ data: sealedFile.data, fileKey: input.fileKey }, bytes); } catch (error) { bytes.fill(0); throw error; }
        const sourceId = randomUUID();
        let current = true, commandId: string | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let releaseOwner = () => {};
        let source: PreparedPatientDocument | null = null;
        const dispose = () => {
            current = false; bytes.fill(0); source = null;
            if (reservations.get(reservation) === release) reservations.delete(reservation);
            clearTimeout(timer);
            if (commandId) sources.delete(commandId);
            queueMicrotask(() => releaseOwner());
        };
        const release = () => { dispose(); releaseOwner(); };
        reservations.set(reservation, release);
        preparing += 1;
        try {
            releaseOwner = owner.retain(dispose);
            timer = setTimeout(release, 300_000); timer.unref();
            const expiresAt = clock() + 300_000, deadline = performance.now() + 300_000;
            const check = () => {
                if (!current || context.request.signal.aborted || clock() >= expiresAt || performance.now() >= deadline) return deny();
                batch?.assertCurrent();
                database.transaction(tx => owner.assertCurrent(tx), { behavior: 'immediate' });
            };
            check();
            let extraction = await extractAnyDocLocalBytes(sourceId, bytes);
            check();
            if (extraction.status === 'review_required' && extraction.detail === 'image_or_scan') {
                extraction = await continueAnyDocImageOrScanWithLocalOcr(sourceId, bytes, extraction);
                check();
            }
            if (extraction.status !== 'extracted') throw new NativePatientDocumentExtractionFailed(
                extraction.status === 'review_required' ? extraction.detail : 'invalid_contract_input');
            if (batch) {
                const codes = new Set(collectDossierTaxCodes(extraction.markdown)
                    .filter(code => code.role === 'patient_cf' && code.checksumValid).map(code => code.value));
                if (codes.size > 1) throw new PatientDocumentBatchRowRejected('mixed-identity');
                if (codes.size && !codes.has(batch.taxCode)) throw new PatientDocumentBatchRowRejected('discordant-identity');
            }
            source = Object.freeze({ sourceId, ...sealedFile,
                type: 'application/pdf', size: bytes.length, identity: 'ambiguous', quality: 'uncertain', candidates: Object.freeze({}) });
            const port = { session: owner.session, ambulatoryId: owner.ambulatoryId,
                readCurrent() { check(); return source ?? deny(); } };
            const view = commands.open(owner, port, Boolean(batch));
            commandId = view.commandId;
            sources.set(commandId, { host: owner, viewId: view.viewId, release });
            check();
            return { ...view, text: extraction.markdown, extraction: extraction.receipt };
        } catch (error) { release(); throw error; }
        finally { preparing -= 1; bytes.fill(0); }
    }

    return {
        async stage(context: Context, value: unknown) {
            try { return await stage(context, await host(context), value); }
            finally { erasePatientDocumentFileKey(value); }
        },
        async batchReview(context: Context, rows: unknown) {
            return batches.review(await host(context), rows);
        },
        async batchConfirm(context: Context, batchId: string, fingerprint: unknown, pin: string) {
            return batches.confirm(await host(context), batchId, fingerprint, pin);
        },
        async batchStage(context: Context, batchId: string, row: unknown, source: unknown) {
            try {
                const owner = await host(context);
                if (!isDossierBatchRow(row)) return deny();
                const claim = batches.claimRow(owner, batchId, await dossierBatchRowDigest(row));
                const { firstName, lastName, taxCode, birthDate } = row.identity;
                if (!firstName.trim() || !lastName.trim()) throw new PatientDocumentBatchRowRejected('missing-name');
                if (identifierError('cf', taxCode)) throw new PatientDocumentBatchRowRejected('invalid-tax-code');
                if (birthError({ identifierType: 'cf', birthDate, birthDatePrecision: 'exact' }) || !birthDateMatchesTaxCode(taxCode, birthDate)) {
                    throw new PatientDocumentBatchRowRejected('invalid-birth-date');
                }
                const view = await stage(context, owner, source, { sourceDigest: row.sourceDigest, taxCode: taxCode.trim().toUpperCase(), assertCurrent: claim.assertCurrent });
                try {
                    const field = (value: string) => ({ action: 'correct' as const, value });
                    commands.preview(owner, view.viewId, {
                        firstName: field(firstName), lastName: field(lastName), taxCode: field(taxCode), birthDate: field(birthDate),
                        duplicate: 'none', identifierType: 'cf',
                    });
                    claim.prepared(view.commandId);
                    return { commandId: view.commandId, status: 'preview' as const };
                } catch (error) {
                    try { commands.revoke(owner, view.commandId); }
                    finally { sources.get(view.commandId)?.release(); }
                    throw error;
                }
            } finally { erasePatientDocumentFileKey(source); }
        },
        async batchExecute(context: Context, batchId: string, commandId: string) {
            const owner = await host(context);
            const batchIsCurrent = batches.claimCommand(owner, batchId, commandId);
            const entry = owned(owner, commandId);
            if (!entry) return deny();
            try {
                await commands.execute(owner, commandId, { batchIsCurrent });
                return reread(owner, commandId);
            } finally { entry.release(); }
        },
        async batchClose(context: Context, batchId: string) {
            batches.close(await host(context), batchId);
            return { status: 'closed' };
        },
        async batchRevoke(context: Context, commandId: string) {
            const owner = await host(context);
            const result = commands.revoke(owner, commandId, true);
            if (result.outcome !== 'unknown') sources.get(commandId)?.release();
            return result.outcome === 'applied' ? reread(owner, commandId) : result;
        },
        async preview(context: Context, commandId: string, viewId: string, review: PatientDocumentCreateReview) {
            const owner = await host(context);
            if (owned(owner, commandId)?.viewId !== viewId) return deny();
            const result = commands.preview(owner, viewId, review);
            if (result.commandId !== commandId) return deny();
            return result;
        },
        async execute(context: Context, commandId: string, pin: string) {
            const owner = await host(context);
            const entry = owned(owner, commandId);
            if (!entry) return deny();
            try {
                await commands.execute(owner, commandId, pin);
                return reread(owner, commandId);
            } finally { entry?.release(); }
        },
        async receipt(context: Context, commandId: string) { return reread(await host(context), commandId); },
        async revoke(context: Context, commandId: string) {
            const owner = await host(context);
            const entry = sources.get(commandId);
            const result = commands.revoke(owner, commandId);
            if (result.outcome === 'unknown') return result;
            const read = reread(owner, commandId);
            if (read.outcome !== result.outcome) return deny();
            entry?.release();
            return read;
        },
    };
}
