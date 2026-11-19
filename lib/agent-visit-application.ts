import { createHash } from 'node:crypto';
import { normalizeTherapyCreateInput, normalizeObservationCreateInput } from './api-v1-clinical-write-normalization';
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { patients, auditEvents, therapies, observations, servicePrescriptions } from './schema';
import { activePatients } from './patient-lifecycle';
import { createAgentRegistrationStore } from './agent-registration-store';
import { createAgentMandateStore } from './agent-mandate-store';
import { AGENT_CASSETTE_COMPLETE, readAgentCassette } from './agent-cassette-store';
import { AGENT_ITEM_OPERATION, cassetteItems } from './agent-cassette-contract';
import { agentApplicationSchema, agentCassetteAppliesAutomatically, agentKindOnlyAutomatic, agentKindPhases, type AgentApplication, type AgentApplicationReceipt } from './agent-visit-application-contract';
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

export class AgentApplicationDenied extends Error {
    constructor(readonly status: 403 | 404 | 409) { super('AGENT_APPLICATION_DENIED'); }
}
export function agentAppliedItemIds(visitId: string): string[] {
    return [...new Set(dbServer.select({ id: auditEvents.subjectRef }).from(auditEvents).where(and(eq(auditEvents.eventType, 'agent.item.applied'),
        eq(auditEvents.requestId, visitId), eq(auditEvents.outcome, 'success'), eq(auditEvents.sourceSurface, 'agent'))).all().flatMap(row => row.id ? [row.id] : []))];
}
export function applyAgentVisit(request: Request, session: ServerSession, value: unknown): AgentApplicationReceipt {
    return commitAgentVisit(request, session, value);
}

export function applyConfirmedAgentVisit(request: Request, session: ServerSession, value: unknown, confirmation: NativeConfirmation): AgentApplicationReceipt {
    return commitAgentVisit(request, session, value, confirmation);
}

function commitAgentVisit(request: Request, session: ServerSession, value: unknown, confirmation?: NativeConfirmation): AgentApplicationReceipt {
    const parsed = agentApplicationSchema.safeParse(value);
    if (!parsed.success) throw new AgentApplicationDenied(409);
    const input: AgentApplication = parsed.data;
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const normalizedValues = <T,>(result: { ok: true; values: T } | { ok: false; error: string }): T => {
        if (!result.ok) throw new AgentApplicationDenied(409);
        return result.values;
    };
    return dbServer.transaction(tx => {
        const cassette = readAgentCassette(dbServer.$client, input.visitId, session.userId);
        if (!cassette || cassette.status !== 'closed' || cassette.revision !== input.cassetteRevision) throw new AgentApplicationDenied(409);
        const generation = archiveGenerationForSession(session);
        if (!generation || generation !== cassette.archiveGeneration) throw new AgentApplicationDenied(403);
        const confirmationFlags: string[] = [];
        let receiptRequestId = input.phase + ':' + input.patientId;
        if (confirmation) {
            confirmation.assertLive();
            const { challenge, proof } = confirmation;
            const binding = challenge.binding;
            const policy = verifyVisitConfirmationProof(challenge, proof, input, Date.now());
            if (!policy || generation !== currentArchiveGeneration() || generation !== binding.archiveGeneration
                || session.role !== 'admin' || session.authChannel !== 'web' || session.expiresAt <= Date.now()
                || session.userId !== binding.actorRef || session.id !== binding.sessionId
                || cassette.agentRef !== binding.agentRef || cassette.mandateRef !== binding.mandateRef
                || agentConfirmationPatientState(input.patientId, input.expectedVersion) !== binding.patientState) throw new AgentApplicationDenied(403);
            receiptRequestId = binding.reference;
            confirmationFlags.push(confirmationAuditFlag, 'device:' + challenge.deviceRef, 'policy:' + policy,
                'revision:' + input.cassetteRevision, 'archive:' + confirmationDigest(generation), 'egress:' + (cassette.allowsClinicalEgress ? 'declared' : 'denied'));
        }
        const mandateStore = createAgentMandateStore(dbServer.$client);
        const mandate = mandateStore.admit(cassette.mandateRef, 'visita.chiudi');
        if (mandate.actorRef !== session.userId) throw new AgentApplicationDenied(403);
        const client = dbServer.$client.prepare('SELECT revoked_at,expires_at,operations FROM agent_clients WHERE id=? AND mandate_ref=?')
            .get(cassette.agentRef, cassette.mandateRef) as { revoked_at: number | null; expires_at: number; operations: string } | undefined;
        const clientOperations = client
            ? (client.revoked_at === null && client.expires_at > Date.now() ? client.operations : undefined)
            : createAgentRegistrationStore(dbServer.$client).operationsForCassette(cassette.agentRef, cassette.mandateRef);
        if (!clientOperations) throw new AgentApplicationDenied(403);
        const appliesAutomatically = agentCassetteAppliesAutomatically(cassette);
        if (input.phase === 'automatic' && !appliesAutomatically) throw new AgentApplicationDenied(409);
        const deposited = cassetteItems(cassette);
        const prior = tx.select().from(auditEvents).where(and(eq(auditEvents.eventType, 'agent.visit.applied'),
            eq(auditEvents.subjectRef, cassette.id), eq(auditEvents.requestId, receiptRequestId), eq(auditEvents.outcome, 'success'), eq(auditEvents.sourceSurface, 'agent'))).all();
        const replay = prior.find(row => row.actorRef === session.userId && row.mandateRef === cassette.mandateRef && row.proposerRef === cassette.agentRef);
        const appliedIds = agentAppliedItemIds(cassette.id);
        const pending = deposited.filter(item => !appliedIds.includes(item.id));
        const selected = (replay ? deposited : pending).filter(item => input.items.some(prepared => prepared.id === item.id));
        const required = input.phase === 'review' ? pending : pending.filter(item => agentKindOnlyAutomatic(appliesAutomatically, item.kind));
        if (selected.length !== input.items.length || selected.some(item => !input.items.some(prepared => prepared.id === item.id && prepared.kind === item.kind))
            || selected.some(item => !agentKindPhases(appliesAutomatically, item.kind).includes(input.phase))
            || !replay && required.some(item => !selected.includes(item))) throw new AgentApplicationDenied(409);
        const operations: unknown = JSON.parse(clientOperations);
        for (const item of selected) {
            mandateStore.admit(cassette.mandateRef, AGENT_ITEM_OPERATION[item.kind]);
            if (!Array.isArray(operations) || !operations.includes(AGENT_ITEM_OPERATION[item.kind])) throw new AgentApplicationDenied(403);
        }
        const provenance = { proposerRef: cassette.agentRef, mandateRef: cassette.mandateRef, modelProvider: cassette.modelProvider };
        if (input.phase === 'review' && pending.some(item => agentKindOnlyAutomatic(appliesAutomatically, item.kind))) throw new AgentApplicationDenied(409);
        if (replay) {
            if (confirmation) throw new AgentApplicationDenied(409);
            if (!selected.every(item => appliedIds.includes(item.id))) throw new AgentApplicationDenied(409);
            const metadata = JSON.parse(replay.redactedMetadata!);
            if (metadata.reasonCode !== fingerprint || metadata.counts !== selected.length || !Number.isSafeInteger(metadata.resourceVersion) || metadata.resourceVersion < 1) throw new AgentApplicationDenied(409);
            return { visitId: cassette.id, phase: input.phase, status: 'applied', eventId: replay.eventId, itemCount: selected.length,
                patientVersion: metadata.resourceVersion, modelProvider: cassette.modelProvider, allowsClinicalEgress: Boolean(cassette.allowsClinicalEgress) };
        }
        const patient = tx.select().from(patients).where(and(eq(patients.id, input.patientId), activePatients())).get();
        if (!patient || patient.isArchived) throw new AgentApplicationDenied(404);
        if (patient.version !== input.expectedVersion) throw new AgentApplicationDenied(409);
        const audit: RequiredAuditContext = { actorType: 'user', actorRef: session.userId, sourceSurface: 'agent', archiveGeneration: generation,
            agentProvenance: provenance, requestId: cassette.id, flags: [input.phase, ...confirmationFlags] };
        let version = input.expectedVersion;
        for (const item of input.items) {
            const base = { id: item.id, patientId: input.patientId };
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
            writeAuditEventInTransaction(tx, { eventType: 'agent.item.applied', outcome: 'success', actorType: 'user', actorRef: session.userId,
                sourceSurface: 'agent', archiveGeneration: generation, agentProvenance: provenance, subjectType: 'agent_operation', subjectRef: item.id,
                requestId: cassette.id, redactedMetadata: { flags: [input.phase, ...confirmationFlags] } });
        }
        if (version === input.expectedVersion) {
            const result = updatePatientOperationInTransaction(tx, { operationId: PATIENT_PROFILE_UPDATE_OPERATION.id, contractVersion: PATIENT_PROFILE_UPDATE_OPERATION.version,
                patientId: input.patientId, expectedVersion: version++, values: {}, setPrimaryAmbulatory: false, audit });
            if (result.status !== 200) throw new AgentApplicationDenied(409);
        }
        const applied = new Set([...appliedIds, ...selected.map(item => item.id)]);
        const flags = [input.phase, ...confirmationFlags];
        if (deposited.every(item => applied.has(item.id))) flags.push(AGENT_CASSETTE_COMPLETE);
        confirmation?.assertLive();
        const eventId = writeAuditEventInTransaction(tx, { eventType: 'agent.visit.applied', outcome: 'success', actorType: 'user', actorRef: session.userId,
            sourceSurface: 'agent', archiveGeneration: generation, agentProvenance: provenance, subjectType: 'agent_operation', subjectRef: cassette.id,
            requestId: receiptRequestId, redactedMetadata: { reasonCode: fingerprint, resourceVersion: version, counts: input.items.length, flags } });
        return { visitId: cassette.id, phase: input.phase, status: 'applied', eventId, itemCount: input.items.length,
            patientVersion: version, modelProvider: cassette.modelProvider, allowsClinicalEgress: Boolean(cassette.allowsClinicalEgress) };
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
