import { createHash } from 'node:crypto';
import { normalizeTherapyCreateInput, normalizeObservationCreateInput } from './api-v1-clinical-write-normalization';
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { patients, auditEvents, therapies, observations, servicePrescriptions, ambulatories, patientsToAmbulatories, patientRetiredIds } from './schema';
import { activePatients } from './patient-lifecycle';
import { hasPatientIdentifierConflict } from './patient-identifier-conflict';
import { birthDateMatchesTaxCode, isValidItalianTaxCode } from './patient-identity';
import { createAgentMandateStore } from './agent-mandate-store';
import { AGENT_CASSETTE_COMPLETE, agentCassetteReviewBlock, readAgentCassette } from './agent-cassette-store';
import { cassetteItems } from './agent-cassette-contract';
import { agentApplicationSchema, agentItemDecisionSchema, reviewedAgentApplicationSchema, type AgentApplication, type AgentApplicationReceipt,
    type AgentItemDecisionReceipt, type AgentVisitDecisionState } from './agent-visit-application-contract';
import type { AgentCassette } from './agent-cassette-contract';
import { createEntryOperationInTransaction } from './entry-write-operation';
import { createTherapyOperationInTransaction } from './therapy-write-operation';
import { createObservationOperationInTransaction } from './observation-write-operation';
import { createWebAttachmentInTransaction } from './attachment-web-create';
import { createHostServicePrescriptionInTransaction, createHostServicePrescriptionItemInTransaction } from './service-prescription-write';
import { updatePatientOperationInTransaction } from './patient-update-operation';
import { PATIENT_PROFILE_UPDATE_OPERATION } from './patient-profile-update-contract';
import { writeAuditEventInTransaction, type RequiredAuditContext } from './security/audit';
import { archiveGenerationForSession, currentArchiveGeneration } from './security/archive-session-generation';
import type { ServerSession } from './security/server-session';
import { confirmationDigest, verifyVisitConfirmationProof, type VisitConfirmationChallenge } from './agent-visit-confirmation-proof';
import type { VisitConfirmationProof } from './agent-visit-confirmation-contract';

const confirmationAuditFlag = 'confirmation:codex-macos';
type Transaction = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
type NativeConfirmation = { challenge: VisitConfirmationChallenge; proof: VisitConfirmationProof; assertLive(): void };

export function agentConfirmationPatientState(patientId: string, expectedVersion: number): string {
    const patient = dbServer.select({ id: patients.id, version: patients.version, archived: patients.isArchived })
        .from(patients).where(and(eq(patients.id, patientId), activePatients())).get();
    if (!patient || patient.archived || patient.version !== expectedVersion) throw new AgentApplicationDenied(409);
    const rows = [
        dbServer.select({ id: therapies.id, version: therapies.version }).from(therapies).where(eq(therapies.patientId, patientId)).orderBy(therapies.id).all(),
        dbServer.select({ id: observations.id, version: observations.version }).from(observations).where(eq(observations.patientId, patientId)).orderBy(observations.id).all(),
        dbServer.select({ id: servicePrescriptions.id, version: servicePrescriptions.version }).from(servicePrescriptions)
            .where(eq(servicePrescriptions.patientId, patientId)).orderBy(servicePrescriptions.id).all(),
    ];
    return confirmationDigest(JSON.stringify([patient, rows]));
}

export function agentConfirmationFiscalCode(patientId: string): string {
    const patient = dbServer.select({ taxCode: patients.taxCode }).from(patients).where(and(eq(patients.id, patientId), activePatients())).get();
    const fiscalCode = patient?.taxCode.trim().toUpperCase();
    if (!fiscalCode || !/^[A-Z0-9]{16}$/u.test(fiscalCode)) throw new AgentApplicationDenied(409);
    return fiscalCode;
}

export class AgentApplicationDenied extends Error {
    constructor(readonly status: 403 | 404 | 409) { super('AGENT_APPLICATION_DENIED'); }
}
function itemEventIds(eventType: 'agent.item.applied' | 'agent.item.discarded', visitId: string): string[] {
    return [...new Set(dbServer.select({ id: auditEvents.subjectRef }).from(auditEvents).where(and(eq(auditEvents.eventType, eventType),
        eq(auditEvents.requestId, visitId), eq(auditEvents.outcome, 'success'), eq(auditEvents.sourceSurface, 'agent'))).all().flatMap(row => row.id ? [row.id] : []))];
}
export function agentAppliedItemIds(visitId: string): string[] {
    return itemEventIds('agent.item.applied', visitId);
}
export function agentDiscardedItemIds(visitId: string): string[] {
    return itemEventIds('agent.item.discarded', visitId);
}
export function agentCorrectedItemIds(visitId: string): string[] {
    return [...new Set(dbServer.select({ id: auditEvents.subjectRef, metadata: auditEvents.redactedMetadata }).from(auditEvents).where(and(eq(auditEvents.eventType, 'agent.item.applied'),
        eq(auditEvents.requestId, visitId), eq(auditEvents.outcome, 'success'), eq(auditEvents.sourceSurface, 'agent'))).all()
        .flatMap(row => row.id && row.metadata && (JSON.parse(row.metadata).flags ?? []).includes('corrected') ? [row.id] : []))];
}
function visitRecipients(visitId: string): string[] {
    return [...new Set(dbServer.select({ id: auditEvents.subjectRef }).from(auditEvents).where(and(eq(auditEvents.eventType, 'patient.updated'),
        eq(auditEvents.subjectType, 'patient'), eq(auditEvents.requestId, visitId), eq(auditEvents.outcome, 'success'))).all().flatMap(row => row.id ? [row.id] : []))];
}
function admittedCassette(session: ServerSession, visitId: string, revision: number) {
    if (session.role !== 'admin' || session.authChannel !== 'web' || session.expiresAt <= Date.now()) throw new AgentApplicationDenied(403);
    const generation = archiveGenerationForSession(session);
    if (!generation || generation !== currentArchiveGeneration()) throw new AgentApplicationDenied(403);
    const cassette = readAgentCassette(dbServer.$client, visitId, session.userId);
    if (!cassette || cassette.status !== 'closed' || cassette.revision !== revision) throw new AgentApplicationDenied(409);
    if (generation !== cassette.archiveGeneration || agentCassetteReviewBlock(dbServer.$client, cassette)) throw new AgentApplicationDenied(403);
    return { cassette, generation };
}
type AgentItemWrite = { request: Request; session: ServerSession; patientId: string; audit: RequiredAuditContext;
    provenance: NonNullable<RequiredAuditContext['agentProvenance']> };
function normalizedValues<T>(result: { ok: true; values: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new AgentApplicationDenied(409);
    return result.values;
}
function writeAgentItem(tx: Transaction, write: AgentItemWrite, item: AgentApplication['items'][number], version: number): number {
    const { request, session, audit, provenance } = write;
    const base = { id: item.id, patientId: write.patientId };
    let result: { status: number };
    switch (item.kind) {
        case 'note': case 'transcription':
            result = createEntryOperationInTransaction(tx, { ...base, values: { ...base, ...item.values, date: new Date(item.values.date), type: 'visit' },
                changedFields: ['title', 'content'], mode: 'web', audit }); break;
        case 'pdf':
            result = createWebAttachmentInTransaction(tx, request, session, { ...base, ...item.values, type: 'application/pdf' }, provenance); break;
        case 'therapy':
            result = createTherapyOperationInTransaction(tx, { patientId: base.patientId, therapyId: item.id, values: normalizedValues(normalizeTherapyCreateInput(item.values, base)),
                changedFields: Object.keys(item.values), mode: 'web', audit }); break;
        case 'service': {
            const { lineItems, ...values } = item.values;
            const context = { request, session, agentProvenance: provenance };
            result = createHostServicePrescriptionInTransaction(tx, context, { ...base, ...values });
            if (result.status !== 201) throw new AgentApplicationDenied(409);
            for (const [index, line] of lineItems.entries()) {
                const created = createHostServicePrescriptionItemInTransaction(tx, context, { id: item.id + '-item-' + (index + 1),
                    prescriptionId: item.id, ordinal: index + 1, ...line });
                if (created.status !== 201) throw new AgentApplicationDenied(409);
            }
            break;
        }
        case 'observation':
            result = createObservationOperationInTransaction(tx, { patientId: base.patientId, observationId: item.id, values: normalizedValues(normalizeObservationCreateInput(item.values, base)),
                changedFields: Object.keys(item.values), mode: 'web', audit }); break;
        case 'diagnosis': case 'exemption':
            result = updatePatientOperationInTransaction(tx, { operationId: PATIENT_PROFILE_UPDATE_OPERATION.id, contractVersion: PATIENT_PROFILE_UPDATE_OPERATION.version,
                patientId: base.patientId, expectedVersion: version++, values: item.values, setPrimaryAmbulatory: false, audit }); break;
    }
    if (result.status !== 200 && result.status !== 201) throw new AgentApplicationDenied(409);
    return version;
}
function touchPatient(tx: Transaction, patientId: string, version: number, audit: RequiredAuditContext): number {
    const result = updatePatientOperationInTransaction(tx, { operationId: PATIENT_PROFILE_UPDATE_OPERATION.id, contractVersion: PATIENT_PROFILE_UPDATE_OPERATION.version,
        patientId, expectedVersion: version, values: {}, setPrimaryAmbulatory: false, audit });
    if (result.status !== 200) throw new AgentApplicationDenied(409);
    return version + 1;
}
export function applyAgentVisit(request: Request, session: ServerSession, value: unknown, selectedAmbulatoryId?: string | null): AgentApplicationReceipt {
    return commitAgentVisit(request, session, value, undefined, selectedAmbulatoryId);
}

export function applyConfirmedAgentVisit(request: Request, session: ServerSession, value: unknown, confirmation: NativeConfirmation): AgentApplicationReceipt {
    return commitAgentVisit(request, session, value, confirmation);
}

function commitAgentVisit(request: Request, session: ServerSession, value: unknown, confirmation?: NativeConfirmation, selectedAmbulatoryId?: string | null): AgentApplicationReceipt {
    const parsed = reviewedAgentApplicationSchema.safeParse(value);
    if (!parsed.success) throw new AgentApplicationDenied(409);
    const input = parsed.data;
    if (confirmation && !agentApplicationSchema.safeParse(value).success) throw new AgentApplicationDenied(409);
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return dbServer.transaction(tx => {
        const { cassette, generation } = admittedCassette(session, input.visitId, input.cassetteRevision);
        const confirmationFlags: string[] = [];
        let receiptRequestId = input.phase + ':' + input.patientId;
        if (confirmation) {
            confirmation.assertLive();
            createAgentMandateStore(dbServer.$client).admit(cassette.mandateRef, 'visita.chiudi');
            const { challenge, proof } = confirmation;
            const binding = challenge.binding;
            const policy = verifyVisitConfirmationProof(challenge, proof, input, Date.now());
            if (!policy || generation !== binding.archiveGeneration
                || session.userId !== binding.actorRef || session.id !== binding.sessionId
                || cassette.agentRef !== binding.agentRef || cassette.mandateRef !== binding.mandateRef
                || agentConfirmationPatientState(input.patientId, input.expectedVersion) !== binding.patientState) throw new AgentApplicationDenied(403);
            receiptRequestId = binding.reference;
            confirmationFlags.push(confirmationAuditFlag, 'device:' + challenge.deviceRef, 'policy:' + policy,
                'revision:' + input.cassetteRevision, 'archive:' + confirmationDigest(generation), 'egress:' + (cassette.allowsClinicalEgress ? 'declared' : 'denied'));
        }
        const deposited = cassetteItems(cassette);
        const prior = tx.select().from(auditEvents).where(and(eq(auditEvents.eventType, 'agent.visit.applied'),
            eq(auditEvents.subjectRef, cassette.id), eq(auditEvents.requestId, receiptRequestId), eq(auditEvents.outcome, 'success'), eq(auditEvents.sourceSurface, 'agent'))).all();
        const replay = prior.find(row => row.actorRef === session.userId && row.mandateRef === cassette.mandateRef && row.proposerRef === cassette.agentRef);
        const appliedIds = agentAppliedItemIds(cassette.id);
        const discardedIds = agentDiscardedItemIds(cassette.id);
        const pending = deposited.filter(item => !appliedIds.includes(item.id) && !discardedIds.includes(item.id));
        const selected = (replay ? deposited : pending).filter(item => input.items.some(prepared => prepared.id === item.id));
        if (selected.length !== input.items.length || selected.some(item => !input.items.some(prepared => prepared.id === item.id && prepared.kind === item.kind))
            || !replay && pending.some(item => !selected.includes(item))) throw new AgentApplicationDenied(409);
        const provenance = { proposerRef: cassette.agentRef, mandateRef: cassette.mandateRef, modelProvider: cassette.modelProvider };
        if (replay) {
            if (confirmation) throw new AgentApplicationDenied(409);
            if (!selected.every(item => appliedIds.includes(item.id))) throw new AgentApplicationDenied(409);
            const metadata = JSON.parse(replay.redactedMetadata!);
            if (metadata.reasonCode !== fingerprint || metadata.counts !== selected.length || !Number.isSafeInteger(metadata.resourceVersion) || metadata.resourceVersion < 1) throw new AgentApplicationDenied(409);
            return { visitId: cassette.id, phase: input.phase, status: 'applied', eventId: replay.eventId, itemCount: selected.length,
                patientVersion: metadata.resourceVersion, modelProvider: cassette.modelProvider, allowsClinicalEgress: Boolean(cassette.allowsClinicalEgress) };
        }
        if (visitRecipients(cassette.id).some(recipient => recipient !== input.patientId)) throw new AgentApplicationDenied(409);
        const audit: RequiredAuditContext = { actorType: 'user', actorRef: session.userId, sourceSurface: 'agent', archiveGeneration: generation,
            agentProvenance: provenance, requestId: cassette.id, flags: [input.phase, ...confirmationFlags] };
        if (input.newPatient) {
            const { taxCode, firstName, lastName, birthDate, ambulatoryId } = input.newPatient;
            const target = selectedAmbulatoryId
                ? tx.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.id, selectedAmbulatoryId)).get()
                : tx.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.isDefault, true)).get();
            const id = input.patientId;
            if (selectedAmbulatoryId === undefined || target?.id !== ambulatoryId || id !== cassette.id || input.expectedVersion !== 1
                || appliedIds.length || discardedIds.length || !selected.some(item => item.kind === 'pdf' || item.kind === 'note' || item.kind === 'transcription') || !isValidItalianTaxCode(taxCode)
                || (birthDate && !birthDateMatchesTaxCode(taxCode, birthDate))
                || tx.select({ id: patientRetiredIds.id }).from(patientRetiredIds).where(eq(patientRetiredIds.id, id)).get()
                || tx.select({ id: patients.id }).from(patients).where(eq(patients.id, id)).get()
                || hasPatientIdentifierConflict(tx, { id, ambulatoryId, taxCode, identifierType: 'cf' })) throw new AgentApplicationDenied(409);
            tx.insert(patients).values({ id, firstName, lastName, taxCode, identifierType: 'cf', ambulatoryId,
                birthDate: birthDate ? new Date(birthDate) : null, birthDatePrecision: birthDate ? 'exact' : 'unknown' }).run();
            tx.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId }).run();
            writeAuditEventInTransaction(tx, { ...audit, eventType: 'patient.created', outcome: 'success', subjectType: 'patient', subjectRef: id,
                redactedMetadata: { flags: audit.flags, resourceVersion: 1 } });
        }
        const patient = tx.select().from(patients).where(and(eq(patients.id, input.patientId), activePatients())).get();
        if (!patient || patient.isArchived) throw new AgentApplicationDenied(404);
        if (patient.version !== input.expectedVersion) throw new AgentApplicationDenied(409);
        let version = input.expectedVersion;
        const write = { request, session, patientId: input.patientId, audit, provenance };
        for (const item of input.items) {
            version = writeAgentItem(tx, write, item, version);
            writeAuditEventInTransaction(tx, { eventType: 'agent.item.applied', outcome: 'success', actorType: 'user', actorRef: session.userId,
                sourceSurface: 'agent', archiveGeneration: generation, agentProvenance: provenance, subjectType: 'agent_operation', subjectRef: item.id,
                requestId: cassette.id, redactedMetadata: { flags: [input.phase, ...confirmationFlags] } });
        }
        if (version === input.expectedVersion) version = touchPatient(tx, input.patientId, version, audit);
        const applied = new Set([...appliedIds, ...selected.map(item => item.id)]);
        const flags = [input.phase, ...confirmationFlags];
        if (deposited.every(item => applied.has(item.id))) flags.push(AGENT_CASSETTE_COMPLETE);
        confirmation?.assertLive();
        const eventId = writeAuditEventInTransaction(tx, { eventType: 'agent.visit.applied', outcome: 'success', actorType: 'user', actorRef: session.userId,
            sourceSurface: 'agent', archiveGeneration: generation, agentProvenance: provenance, subjectType: 'agent_operation', subjectRef: cassette.id,
            requestId: receiptRequestId, redactedMetadata: { reasonCode: fingerprint, resourceVersion: version, counts: input.items.length, flags } });
        if (discardedIds.length) closeDecidedVisit(tx, cassette, session, generation, provenance);
        return { visitId: cassette.id, phase: input.phase, status: 'applied', eventId, itemCount: input.items.length,
            patientVersion: version, modelProvider: cassette.modelProvider, allowsClinicalEgress: Boolean(cassette.allowsClinicalEgress) };
    }, { behavior: 'immediate' });
}

function visitDecisionState(cassette: AgentCassette): AgentVisitDecisionState {
    const applied = agentAppliedItemIds(cassette.id), discarded = agentDiscardedItemIds(cassette.id);
    if (cassetteItems(cassette).some(item => !applied.includes(item.id) && !discarded.includes(item.id))) return applied.length + discarded.length ? 'partial' : 'pending';
    return discarded.length ? 'decided' : 'applied';
}

function closeDecidedVisit(tx: Transaction, cassette: AgentCassette, session: ServerSession, generation: string,
    provenance: NonNullable<RequiredAuditContext['agentProvenance']>): AgentVisitDecisionState {
    const state = visitDecisionState(cassette);
    if (state === 'pending' || state === 'partial') return state;
    const [recipient, ...others] = visitRecipients(cassette.id);
    if (state === 'applied' && (!recipient || others.length)) throw new AgentApplicationDenied(409);
    writeAuditEventInTransaction(tx, { eventType: state === 'applied' ? 'agent.visit.applied' : 'agent.visit.decided', outcome: 'success', actorType: 'user',
        actorRef: session.userId, sourceSurface: 'agent', archiveGeneration: generation, agentProvenance: provenance, subjectType: 'agent_operation',
        subjectRef: cassette.id, requestId: state === 'applied' ? 'item:' + recipient : 'item:decided',
        redactedMetadata: { counts: cassetteItems(cassette).length, flags: state === 'applied' ? ['item', AGENT_CASSETTE_COMPLETE] : ['item', 'discarded'] } });
    return state;
}

export function decideAgentVisitItem(request: Request, session: ServerSession, value: unknown): AgentItemDecisionReceipt {
    const parsed = agentItemDecisionSchema.safeParse(value);
    if (!parsed.success) throw new AgentApplicationDenied(409);
    const input = parsed.data;
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const itemId = input.decision === 'discard' ? input.itemId : input.item.id;
    const kind = input.decision === 'discard' ? input.kind : input.item.kind;
    return dbServer.transaction(tx => {
        const { cassette, generation } = admittedCassette(session, input.visitId, input.cassetteRevision);
        const deposited = cassetteItems(cassette).find(item => item.id === itemId);
        if (!deposited || deposited.kind !== kind) throw new AgentApplicationDenied(409);
        const provenance = { proposerRef: cassette.agentRef, mandateRef: cassette.mandateRef, modelProvider: cassette.modelProvider };
        const decided = tx.select().from(auditEvents).where(and(eq(auditEvents.subjectRef, itemId), eq(auditEvents.requestId, cassette.id),
            eq(auditEvents.subjectType, 'agent_operation'), eq(auditEvents.outcome, 'success'), eq(auditEvents.sourceSurface, 'agent'))).all()
            .filter(row => row.eventType === 'agent.item.applied' || row.eventType === 'agent.item.discarded');
        if (decided.length) {
            const [prior] = decided;
            const metadata = decided.length === 1 && prior!.actorRef === session.userId && prior!.redactedMetadata ? JSON.parse(prior!.redactedMetadata) : null;
            if (metadata?.reasonCode !== fingerprint) throw new AgentApplicationDenied(409);
            return { visitId: cassette.id, itemId, decision: input.decision, status: 'decided', eventId: prior!.eventId,
                patientVersion: Number.isSafeInteger(metadata.resourceVersion) ? metadata.resourceVersion : null, visitState: visitDecisionState(cassette) };
        }
        const flags = ['item', input.decision === 'correct' ? 'corrected' : input.decision === 'keep' ? 'kept' : 'discarded'];
        let eventId: string, patientVersion: number | null = null;
        if (input.decision === 'discard') {
            eventId = writeAuditEventInTransaction(tx, { eventType: 'agent.item.discarded', outcome: 'success', actorType: 'user', actorRef: session.userId,
                sourceSurface: 'agent', archiveGeneration: generation, agentProvenance: provenance, subjectType: 'agent_operation', subjectRef: itemId,
                requestId: cassette.id, redactedMetadata: { reasonCode: fingerprint, flags } });
        } else {
            if (visitRecipients(cassette.id).some(recipient => recipient !== input.patientId)) throw new AgentApplicationDenied(409);
            const patient = tx.select().from(patients).where(and(eq(patients.id, input.patientId), activePatients())).get();
            if (!patient || patient.isArchived) throw new AgentApplicationDenied(404);
            if (patient.version !== input.expectedVersion) throw new AgentApplicationDenied(409);
            const audit: RequiredAuditContext = { actorType: 'user', actorRef: session.userId, sourceSurface: 'agent', archiveGeneration: generation,
                agentProvenance: provenance, requestId: cassette.id, flags };
            let version = writeAgentItem(tx, { request, session, patientId: input.patientId, audit, provenance }, input.item, input.expectedVersion);
            if (version === input.expectedVersion) version = touchPatient(tx, input.patientId, version, audit);
            patientVersion = version;
            eventId = writeAuditEventInTransaction(tx, { eventType: 'agent.item.applied', outcome: 'success', actorType: 'user', actorRef: session.userId,
                sourceSurface: 'agent', archiveGeneration: generation, agentProvenance: provenance, subjectType: 'agent_operation', subjectRef: itemId,
                requestId: cassette.id, redactedMetadata: { reasonCode: fingerprint, resourceVersion: version, flags } });
        }
        const visitState = closeDecidedVisit(tx, cassette, session, generation, provenance);
        return { visitId: cassette.id, itemId, decision: input.decision, status: 'decided', eventId, patientVersion, visitState };
    }, { behavior: 'immediate' });
}

export function hasAgentVisitConfirmationReceipt(reference: string, principal: { actorRef: string; archiveGeneration: string; agentRef: string; mandateRef: string }): boolean {
    const row = dbServer.select({ metadata: auditEvents.redactedMetadata }).from(auditEvents).where(and(
        eq(auditEvents.eventType, 'agent.visit.applied'), eq(auditEvents.outcome, 'success'), eq(auditEvents.sourceSurface, 'agent'),
        eq(auditEvents.requestId, reference), eq(auditEvents.actorRef, principal.actorRef),
        eq(auditEvents.proposerRef, principal.agentRef),
        eq(auditEvents.mandateRef, principal.mandateRef),
    )).get();
    if (!row?.metadata) return false;
    const flags: string[] | undefined = JSON.parse(row.metadata).flags;
    return Boolean(flags?.includes(confirmationAuditFlag) && flags.includes('archive:' + confirmationDigest(principal.archiveGeneration)));
}


export function recordDeniedAgentVisitConfirmation(input: { reference: string; visitId: string; revision: number;
    actorRef: string; agentRef: string; mandateRef: string; archiveGeneration: string; modelProvider: NonNullable<RequiredAuditContext['agentProvenance']>['modelProvider'] }, reasonCode: string): void {
    dbServer.transaction(tx => {
        if (currentArchiveGeneration() !== input.archiveGeneration) return;
        writeAuditEventInTransaction(tx, { eventType: 'agent.visit.confirmation.denied', outcome: 'denied', actorType: 'user',
            actorRef: input.actorRef, sourceSurface: 'agent', archiveGeneration: input.archiveGeneration,
            agentProvenance: { proposerRef: input.agentRef, mandateRef: input.mandateRef, modelProvider: input.modelProvider },
            subjectType: 'agent_operation', subjectRef: input.visitId, requestId: input.reference,
            redactedMetadata: { reasonCode, flags: ['review', confirmationAuditFlag, 'revision:' + input.revision] } });
    }, { behavior: 'immediate' });
}
