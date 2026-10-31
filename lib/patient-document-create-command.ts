import { isSealedAttachmentData } from './attachment-payload';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { dbServer } from './db-server';
import { ambulatories, attachments, auditEvents, patients, patientsToAmbulatories, users } from './schema';
import { activePatients } from './patient-lifecycle';
import { assertArchiveGeneration } from './archive-generation';
import { createHostAttachmentCurrentness } from './attachment-currentness-host';
import { createNativeChatWriteApprovals, NativeChatWriteDenied } from './native-chat-write-approval';
import { normalizePatientCreateInput } from './patient-write-normalization';
import { writeAuditEventInTransaction } from './security/audit';
import { COMMAND_UUID } from './therapy-status-command-contract';
import { parsePatientDocumentCreateJournal } from './patient-document-create-journal';

type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
export type PatientDocumentCreateHost = Readonly<{
    session: object; actorRef: string; archiveGeneration: string; ambulatoryId: string; epoch: number;
    surface: 'native' | 'web'; pairedClientId?: string;
    assertCurrent: (tx: Tx) => void;
    confirm: (pin: string) => Promise<boolean>;
    retain: (dispose: () => void) => (() => void);
}>;
type PatientDocumentOwner = Pick<PatientDocumentCreateHost, 'actorRef' | 'archiveGeneration' | 'ambulatoryId' | 'pairedClientId'>;
function sameOwner(left: PatientDocumentOwner, right: PatientDocumentOwner) {
    return left.actorRef === right.actorRef && left.archiveGeneration === right.archiveGeneration
        && left.ambulatoryId === right.ambulatoryId && left.pairedClientId === right.pairedClientId;
}
export type PreparedPatientDocument = Readonly<{
    sourceId: string; name: string; path: string; data: string; type: 'application/pdf'; size: number;
    identity: 'labelled' | 'ambiguous'; quality: 'ready' | 'uncertain' | 'ocr_error';
    candidates: Readonly<Partial<Record<'firstName' | 'lastName' | 'taxCode' | 'birthDate', string>>>;
}>;
/** Host capability, never decoded from request JSON. Rechecks the original source on every use. */
export type PatientDocumentSourcePort = Readonly<{
    session: object; ambulatoryId: string; readCurrent: (tx: Tx) => PreparedPatientDocument;
}>;
type Field = Readonly<{ action: 'approve' | 'correct'; value: string }>;
export type PatientDocumentCreateReview = Readonly<{
    firstName: Field; lastName: Field; taxCode: Field; birthDate?: Field;
    duplicate: 'none' | 'create-separate';
}>;
type Command = Readonly<{
    commandId: string; patientId: string; source: PreparedPatientDocument;
    values: typeof patients.$inferInsert; duplicates: string; port: PatientDocumentSourcePort;
}>;
export class PatientDocumentDuplicateReviewRequired extends Error {
    constructor() { super('Possible duplicate: review the separate creation choice'); }
}
class PatientDocumentCreateDenied extends Error {}
const deny = (): never => { throw new PatientDocumentCreateDenied('Patient document create denied'); };
const sealed = (value: unknown): value is string => typeof value === 'string' && /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/u.test(value);
function snapshot(port: PatientDocumentSourcePort, tx: Tx, host: PatientDocumentCreateHost): PreparedPatientDocument {
    if (port.session !== host.session || port.ambulatoryId !== host.ambulatoryId) return deny();
    const source = port.readCurrent(tx);
    if (!source || !COMMAND_UUID.test(source.sourceId) || source.type !== 'application/pdf'
        || !isSealedAttachmentData(source.data) || !sealed(source.name) || !sealed(source.path)
        || !Number.isSafeInteger(source.size) || source.size < 1 || source.size > 20 * 1024 * 1024
        || source.data.length > 28 * 1024 * 1024
        || !['labelled', 'ambiguous'].includes(source.identity) || !['ready', 'uncertain', 'ocr_error'].includes(source.quality)) return deny();
    const candidates: Record<string, string> = {};
    for (const key of ['firstName', 'lastName', 'taxCode', 'birthDate'] as const) {
        const value = source.candidates[key];
        if (value !== undefined) {
            if (typeof value !== 'string' || value.length > 256) return deny();
            candidates[key] = value;
        }
    }
    return Object.freeze({ sourceId: source.sourceId, name: source.name, path: source.path, data: source.data,
        type: source.type, size: source.size, identity: source.identity, quality: source.quality,
        candidates: Object.freeze(candidates) });
}
function reviewed(source: PreparedPatientDocument, value: PatientDocumentCreateReview, id: string) {
    if (!value || Object.keys(value).some(key => !['firstName', 'lastName', 'taxCode', 'birthDate', 'duplicate'].includes(key))
        || !['none', 'create-separate'].includes(value.duplicate) || source.quality === 'ocr_error') return deny();
    const body: Record<string, string> = {};
    for (const key of ['firstName', 'lastName', 'taxCode', 'birthDate'] as const) {
        const field = value[key];
        if (field === undefined && key === 'birthDate') continue;
        if (!field || Object.keys(field).sort().join(',') !== 'action,value' || !['approve', 'correct'].includes(field.action)
            || typeof field.value !== 'string' || !field.value.trim() || field.value.length > 256
            || field.value !== field.value.trim() || /[\u0000-\u001f]/u.test(field.value)
            || (field.action === 'approve' && field.value !== source.candidates[key])
            || (source.identity === 'ambiguous' && ['firstName', 'lastName'].includes(key) && field.action !== 'correct')
            || (source.quality === 'uncertain' && field.action !== 'correct')) return deny();
        body[key] = field.value;
    }
    if (body.birthDate && (!/^\d{4}-\d{2}-\d{2}$/u.test(body.birthDate)
        || !Number.isFinite(Date.parse(body.birthDate)) || new Date(body.birthDate).toISOString().slice(0, 10) !== body.birthDate)) return deny();
    const normalized = normalizePatientCreateInput(body, { id: () => id });
    if (!normalized.ok) return deny();
    return Object.freeze(normalized.values);
}
function duplicateSet(tx: Tx, values: typeof patients.$inferInsert): string {
    const name = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('it-IT');
    const taxCode = values.taxCode.trim().toUpperCase();
    return tx.select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, taxCode: patients.taxCode }).from(patients).where(activePatients()).all()
        .filter(row => row.taxCode.trim().toUpperCase() === taxCode
            || (name(row.firstName) === name(values.firstName) && name(row.lastName) === name(values.lastName)))
        .map(row => row.id).sort().join(',');
}

type PendingCommand = { owner: PatientDocumentCreateHost; release: () => void };
const liveCommands = new WeakMap<typeof dbServer, {
    pending: Map<string, PendingCommand>; executing: Map<string, PatientDocumentCreateHost>;
}>();

/** The host supplies its current session/scope and source owners, never capabilities decoded from JSON. */
export function createPatientDocumentCommandService(database: typeof dbServer, clock: () => number = Date.now) {
    const approvals = createNativeChatWriteApprovals<Command>(clock);
    const views = new Map<string, { commandId: string; source: PreparedPatientDocument; port: PatientDocumentSourcePort; at: number }>();
    let live = liveCommands.get(database);
    if (!live) {
        live = { pending: new Map(), executing: new Map() };
        liveCommands.set(database, live);
    }
    const { pending, executing } = live;
    const binding = (host: PatientDocumentCreateHost, sourceId: string) => ({ session: host.session, scope: host.ambulatoryId, selection: host.epoch, resource: sourceId });
    function admit(tx: Tx, host: PatientDocumentCreateHost) {
        host.assertCurrent(tx);
        if (!COMMAND_UUID.test(host.archiveGeneration) || typeof host.ambulatoryId !== 'string'
            || host.ambulatoryId.length < 1 || host.ambulatoryId.length > 128 || /[\u0000-\u0020\u007f]/u.test(host.ambulatoryId)
            || !Number.isSafeInteger(host.epoch) || host.epoch < 0) return deny();
        assertArchiveGeneration(tx, host.archiveGeneration);
        if (tx.select().from(users).where(eq(users.id, host.actorRef)).get()?.role !== 'admin'
            || !tx.select().from(ambulatories).where(eq(ambulatories.id, host.ambulatoryId)).get()) return deny();
    }
    function receipt(tx: Tx, host: PatientDocumentCreateHost, commandId: string) {
        if (!COMMAND_UUID.test(commandId)) return deny();
        const row = tx.select().from(auditEvents).where(eq(auditEvents.eventId, commandId)).get();
        if (!row) return { outcome: 'unknown' as const };
        const journal = parsePatientDocumentCreateJournal(JSON.parse(row.redactedMetadata ?? '{}').patientDocumentCreate);
        if (!journal || journal.commandId !== commandId || !sameOwner(host, { ...journal, actorRef: row.actorRef ?? '' }) || row.outcome !== 'success'
            || (journal.patientId === null ? row.eventType !== 'patient.create.retired' : row.eventType !== 'patient.created' || row.subjectRef !== journal.patientId)) return deny();
        return journal.patientId === null ? { outcome: 'retired' as const } : { outcome: 'applied' as const };
    }
    function audit(tx: Tx, host: PatientDocumentCreateHost, commandId: string, command?: Command) {
        return writeAuditEventInTransaction(tx, {
            archiveGeneration: host.archiveGeneration, eventType: command ? 'patient.created' : 'patient.create.retired',
            outcome: 'success', actorType: 'user', actorRef: host.actorRef, sourceSurface: host.surface,
            subjectType: command ? 'patient' : 'agent_operation', subjectRef: command?.patientId ?? null, requestId: commandId,
            redactedMetadata: { patientDocumentCreate: { commandId, archiveGeneration: host.archiveGeneration,
                ambulatoryId: host.ambulatoryId, patientId: command?.patientId ?? null, sourceId: command?.source.sourceId ?? null,
                ...(host.pairedClientId ? { pairedClientId: host.pairedClientId } : {}) },
            changedFields: command ? ['firstName', 'lastName', 'taxCode', ...(command.values.birthDate ? ['birthDate'] : [])] : undefined },
        });
    }
    return {
        open(host: PatientDocumentCreateHost, port: PatientDocumentSourcePort) {
            const source = database.transaction(tx => { admit(tx, host); const result = snapshot(port, tx, host); admit(tx, host); return result; }, { behavior: 'immediate' });
            for (const view of views.values()) if (clock() - view.at >= 300_000) pending.get(view.commandId)?.release();
            if (views.size >= 128) return deny();
            const viewId = approvals.open(binding(host, source.sourceId)), commandId = randomUUID();
            let disposed = false;
            const dispose = () => {
                disposed = true;
                clearTimeout(timer);
                views.delete(viewId);
                approvals.revoke(commandId, { session: host.session, scope: host.ambulatoryId });
                pending.delete(commandId);
            };
            const timer = setTimeout(() => { dispose(); releaseOwner(); }, 300_000);
            let releaseOwner: () => void;
            try { releaseOwner = host.retain(dispose); }
            catch (error) { dispose(); throw error; }
            if (disposed) { releaseOwner(); return deny(); }
            timer.unref();
            pending.set(commandId, { owner: host,
                release: () => { clearTimeout(timer); dispose(); releaseOwner(); } });
            views.set(viewId, { commandId, source, port, at: clock() });
            return { viewId, commandId, identity: source.identity, quality: source.quality, candidates: source.candidates };
        },
        preview(host: PatientDocumentCreateHost, viewId: string, review: PatientDocumentCreateReview) {
            const view = views.get(viewId);
            if (!view) return deny();
            const patientId = randomUUID(), values = reviewed(view.source, review, patientId);
            const command = database.transaction(tx => {
                admit(tx, host);
                if (receipt(tx, host, view.commandId).outcome !== 'unknown' || JSON.stringify(snapshot(view.port, tx, host)) !== JSON.stringify(view.source)) return deny();
                const duplicates = duplicateSet(tx, values);
                if (Boolean(duplicates) !== (review.duplicate === 'create-separate')) throw new PatientDocumentDuplicateReviewRequired();
                admit(tx, host);
                return Object.freeze({ commandId: view.commandId, patientId, source: view.source, values, duplicates, port: view.port });
            }, { behavior: 'immediate' });
            approvals.preview(viewId, binding(host, view.source.sourceId), view.commandId, command, () => {});
            views.delete(viewId);
            return { commandId: command.commandId, status: 'preview' as const };
        },
        async execute(host: PatientDocumentCreateHost, commandId: string, pin: string) {
            const known = database.transaction(tx => { admit(tx, host); return receipt(tx, host, commandId); }, { behavior: 'immediate' });
            if (known.outcome !== 'unknown') return known;
            const preview = approvals.consume(commandId, { session: host.session, scope: host.ambulatoryId });
            executing.set(commandId, host);
            let terminal = false;
            try {
                approvals.check(preview);
                if (!await host.confirm(pin)) return deny();
                const result = database.transaction(tx => {
                    admit(tx, host);
                    const known = receipt(tx, host, commandId);
                    if (known.outcome !== 'unknown') return known;
                    approvals.check(preview);
                    const command = preview.command;
                    if (preview.selection !== host.epoch || JSON.stringify(snapshot(command.port, tx, host)) !== JSON.stringify(command.source)
                        || duplicateSet(tx, command.values) !== command.duplicates) return deny();
                    const used = tx.select({ id: auditEvents.eventId }).from(auditEvents).where(sql`json_extract(${auditEvents.redactedMetadata}, '$.patientDocumentCreate.sourceId') = ${command.source.sourceId}`).get();
                    if (used) return deny();
                    if (tx.insert(patients).values({ ...command.values, ambulatoryId: host.ambulatoryId }).run().changes !== 1) return deny();
                    if (tx.insert(patientsToAmbulatories).values({ patientId: command.patientId, ambulatoryId: host.ambulatoryId }).run().changes !== 1) return deny();
                    const currentness = createHostAttachmentCurrentness();
                    if (tx.insert(attachments).values({ id: command.source.sourceId, patientId: command.patientId,
                        name: command.source.name, path: command.source.path, type: command.source.type, size: command.source.size,
                        data: command.source.data, documentSourceRef: currentness.sourceRef, documentRevision: currentness.revision,
                        documentFreshnessEpoch: currentness.freshnessEpoch, createdAt: new Date() }).run().changes !== 1) return deny();
                    writeAuditEventInTransaction(tx, { archiveGeneration: host.archiveGeneration, actorType: 'user', actorRef: host.actorRef,
                        sourceSurface: host.surface, requestId: commandId, eventType: 'attachment.created', outcome: 'success', subjectType: 'attachment', subjectRef: command.source.sourceId });
                    audit(tx, host, commandId, command);
                    const savedPatient = tx.select().from(patients).where(and(activePatients(), eq(patients.id, command.patientId))).get();
                    const expectedPatient = { ...command.values, ambulatoryId: host.ambulatoryId };
                    if (!savedPatient || Object.entries(expectedPatient).some(([key, expected]) => {
                        const actual = savedPatient[key as keyof typeof savedPatient];
                        return expected instanceof Date ? !(actual instanceof Date) || Math.floor(expected.getTime() / 1000) !== actual.getTime() / 1000 : expected !== actual;
                    })) return deny();
                    const savedSource = tx.select().from(attachments).where(and(eq(attachments.id, command.source.sourceId), eq(attachments.patientId, command.patientId))).get();
                    if (!savedSource || ['name', 'path', 'data', 'type', 'size'].some(key => savedSource[key as keyof typeof savedSource] !== command.source[key as keyof PreparedPatientDocument])
                        || savedSource.documentSourceRef !== currentness.sourceRef || savedSource.documentRevision !== currentness.revision
                        || savedSource.documentFreshnessEpoch !== currentness.freshnessEpoch
                        || !tx.select().from(patientsToAmbulatories).where(and(eq(patientsToAmbulatories.patientId, command.patientId), eq(patientsToAmbulatories.ambulatoryId, host.ambulatoryId))).get()
                        || receipt(tx, host, commandId).outcome !== 'applied') return deny();
                    admit(tx, host);
                    approvals.check(preview);
                    return { outcome: 'applied' as const };
                }, { behavior: 'immediate' });
                terminal = true;
                return result;
            } catch (error) {
                if (error instanceof PatientDocumentCreateDenied || error instanceof NativeChatWriteDenied) {
                    try {
                        database.transaction(tx => {
                            admit(tx, host);
                            if (receipt(tx, host, commandId).outcome === 'unknown') audit(tx, host, commandId);
                            admit(tx, host);
                        }, { behavior: 'immediate' });
                        terminal = true;
                    } catch { /* A failed terminal write must remain recoverable through revoke. */ }
                }
                throw error;
            } finally {
                executing.delete(commandId);
                approvals.finish(commandId);
                if (terminal) pending.get(commandId)?.release();
            }
        },
        revoke(host: PatientDocumentCreateHost, commandId: string) {
            return database.transaction(tx => {
                admit(tx, host);
                const known = receipt(tx, host, commandId);
                if (known.outcome !== 'unknown') return known;
                const active = pending.get(commandId);
                const owner = active?.owner ?? executing.get(commandId);
                if (owner && (!sameOwner(owner, host) || (owner.session !== host.session
                    && (host.surface !== 'native' || owner.surface !== 'native' || !host.pairedClientId)))) return deny();
                if (!owner) {
                    if (host.surface !== 'native' || !host.pairedClientId) return { outcome: 'unknown' as const };
                    const recent = tx.select({ count: sql<number>`count(*)` }).from(auditEvents).where(and(
                        eq(auditEvents.eventType, 'patient.create.retired'), eq(auditEvents.actorRef, host.actorRef),
                        gte(auditEvents.occurredAt, new Date(Date.now() - 3_600_000)),
                    )).get();
                    if (!recent || recent.count >= 128) return deny();
                }
                if (active) approvals.revoke(commandId, { session: active.owner.session, scope: active.owner.ambulatoryId });
                audit(tx, host, commandId);
                admit(tx, host);
                active?.release();
                return { outcome: 'retired' as const };
            }, { behavior: 'immediate' });
        },
        receipt(host: PatientDocumentCreateHost, commandId: string) {
            return database.transaction(tx => { admit(tx, host); const result = receipt(tx, host, commandId); admit(tx, host); return result; }, { behavior: 'immediate' });
        },
    };
}
