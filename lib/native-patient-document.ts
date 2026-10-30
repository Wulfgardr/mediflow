import 'server-only';
import { randomUUID } from 'node:crypto';
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
import type { LocalExtractionFailureDetail } from './domain/documents/anydoc-local-extraction-contract';

const CAPABILITIES = ['network.replica.write-patient-lifecycle', 'network.replica.write-documents'] as const;
const MAX_BYTES = 10 * 1024 * 1024;
const deny = (): never => { throw new Error('Native patient document denied'); };
const sealed = (value: unknown): value is string => typeof value === 'string'
    && /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/u.test(value);
type Source = { host: PatientDocumentCreateHost; viewId: string; release: () => void };
export class NativePatientDocumentExtractionFailed extends Error {
    constructor(readonly detail: LocalExtractionFailureDetail | 'invalid_contract_input') {
        super('Native patient document extraction failed');
    }
}

/** Intake accepts bytes selected by the authenticated native client, never a URL, path or chat attachment ID.
 * The native client seals the same original with its existing master key; no key reaches this service. */
export function createNativePatientDocumentService(database: typeof dbServer, clock: () => number = Date.now) {
    const commands = createPatientDocumentCommandService(database, clock);
    const sources = new Map<string, Source>();
    let preparing = 0;
    async function host(context: NetworkWriteContext): Promise<PatientDocumentCreateHost> {
        if (context.session.authChannel !== 'native' || context.session.role !== 'admin') return deny();
        const guard = await prepareNetworkPatientCommitGuard(context, CAPABILITIES);
        const result: PatientDocumentCreateHost = {
            session: context.session, actorRef: context.session.userId, ambulatoryId: context.scopeAmbulatoryId,
            archiveGeneration: archiveGenerationForSession(context.session) ?? deny(), epoch: 0, surface: 'native',
            assertCurrent: tx => { if (guard(tx)) deny(); },
            confirm: async pin => await confirmNativeChatAccessPin(context.session as PairedNativeSession, pin) === 'confirmed',
            retain(dispose) {
                const port = serverSessions.mintNativeSessionResourcePort(context.session);
                if (!port) return deny();
                const registration = serverSessions.registerNativeSessionPrivateResource(port, dispose);
                if (!registration) { serverSessions.releaseNativeSessionResourcePort(port); return deny(); }
                let released = false;
                return () => {
                    if (released) return;
                    released = true;
                    serverSessions.unregisterNativeSessionPrivateResource(port, registration);
                    serverSessions.releaseNativeSessionResourcePort(port);
                };
            },
        };
        database.transaction(tx => result.assertCurrent(tx), { behavior: 'immediate' });
        return result;
    }
    function owned(owner: PatientDocumentCreateHost, commandId: string) {
        const entry = sources.get(commandId);
        if (entry && (entry.host.session !== owner.session || entry.host.ambulatoryId !== owner.ambulatoryId)) return deny();
        return entry;
    }
    function reread(owner: PatientDocumentCreateHost, commandId: string) {
        return database.transaction(tx => {
            owner.assertCurrent(tx);
            const receipt = commands.receipt(owner, commandId);
            if (receipt.outcome === 'applied') {
                const row = tx.select().from(auditEvents).where(eq(auditEvents.eventId, commandId)).get();
                const journal = parsePatientDocumentCreateJournal(JSON.parse(row?.redactedMetadata ?? '{}').patientDocumentCreate);
                if (!journal?.patientId || !journal.sourceId) return deny();
                const patient = tx.select({ id: patients.id }).from(patients)
                    .where(and(activePatients(), eq(patients.id, journal.patientId))).get();
                const membership = tx.select().from(patientsToAmbulatories).where(and(
                    eq(patientsToAmbulatories.patientId, journal.patientId), eq(patientsToAmbulatories.ambulatoryId, owner.ambulatoryId))).get();
                const source = tx.select({ id: attachments.id }).from(attachments).where(and(
                    eq(attachments.id, journal.sourceId), eq(attachments.patientId, journal.patientId))).get();
                if (!patient || !membership || !source) return deny();
            }
            owner.assertCurrent(tx);
            return receipt;
        }, { behavior: 'immediate' });
    }
    return {
        async stage(context: NetworkWriteContext, value: unknown) {
            const owner = await host(context);
            if (preparing >= 2 || sources.size >= 16 || [...sources.values()].some(entry => entry.host.session === owner.session)) return deny();
            if (!value || typeof value !== 'object' || Array.isArray(value)
                || Object.keys(value).sort().join(',') !== 'data,name,original,path') return deny();
            const input = value as Record<string, unknown>;
            if (!sealed(input.name) || input.name.length > 4096 || !sealed(input.path) || input.path.length > 4096
                || !sealed(input.data) || input.data.length > 20 * 1024 * 1024
                || typeof input.original !== 'string' || input.original.length > Math.ceil(MAX_BYTES / 3) * 4
                || !/^[A-Za-z0-9+/]+={0,2}$/u.test(input.original)) return deny();
            const bytes = Buffer.from(input.original, 'base64');
            if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== input.original
                || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') { bytes.fill(0); return deny(); }
            const sourceId = randomUUID();
            let current = true, commandId: string | undefined;
            let timer: ReturnType<typeof setTimeout> | undefined;
            let releaseOwner = () => {};
            let source: PreparedPatientDocument | null = null;
            const dispose = () => {
                current = false; bytes.fill(0); source = null;
                clearTimeout(timer);
                if (commandId) sources.delete(commandId);
                queueMicrotask(() => releaseOwner());
            };
            const release = () => { dispose(); releaseOwner(); };
            preparing += 1;
            try {
                releaseOwner = owner.retain(dispose);
                timer = setTimeout(release, 300_000); timer.unref();
                const expiresAt = clock() + 300_000, deadline = performance.now() + 300_000;
                const check = () => {
                    if (!current || context.request.signal.aborted || clock() >= expiresAt || performance.now() >= deadline) return deny();
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
                source = Object.freeze({ sourceId, name: input.name, path: input.path, data: input.data,
                    type: 'application/pdf', size: bytes.length, identity: 'ambiguous', quality: 'uncertain', candidates: Object.freeze({}) });
                const port = { session: owner.session, ambulatoryId: owner.ambulatoryId,
                    readCurrent() { check(); return source ?? deny(); } };
                const view = commands.open(owner, port);
                commandId = view.commandId;
                sources.set(commandId, { host: owner, viewId: view.viewId, release });
                check();
                return { ...view, text: extraction.markdown, extraction: extraction.receipt };
            } catch (error) { release(); throw error; }
            finally { preparing -= 1; bytes.fill(0); }
        },
        async preview(context: NetworkWriteContext, commandId: string, viewId: string, review: PatientDocumentCreateReview) {
            const owner = await host(context);
            if (owned(owner, commandId)?.viewId !== viewId) return deny();
            const result = commands.preview(owner, viewId, review);
            if (result.commandId !== commandId) return deny();
            return result;
        },
        async execute(context: NetworkWriteContext, commandId: string, pin: string) {
            const owner = await host(context);
            const entry = owned(owner, commandId);
            try {
                await commands.execute(owner, commandId, pin);
                return reread(owner, commandId);
            } finally { entry?.release(); }
        },
        async receipt(context: NetworkWriteContext, commandId: string) { return reread(await host(context), commandId); },
        async revoke(context: NetworkWriteContext, commandId: string) {
            const owner = await host(context);
            const entry = owned(owner, commandId);
            const result = commands.revoke(owner, commandId);
            const read = reread(owner, commandId);
            if (read.outcome !== result.outcome) return deny();
            if (read.outcome !== 'unknown') entry?.release();
            return read;
        },
    };
}
