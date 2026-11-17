import { createHash } from 'node:crypto';
import { normalizeTherapyCreateInput, normalizeObservationCreateInput } from './api-v1-clinical-write-normalization';
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { patients, auditEvents } from './schema';
import { activePatients } from './patient-lifecycle';
import { createAgentMandateStore } from './agent-mandate-store';
import { AGENT_CASSETTE_COMPLETE, readAgentCassette } from './agent-cassette-store';
import { AGENT_ITEM_OPERATION, cassetteItems } from './agent-cassette-contract';
import { agentApplicationSchema, automaticAgentKind, type AgentApplication, type AgentApplicationReceipt } from './agent-visit-application-contract';
import { createEntryOperationInTransaction } from './entry-write-operation';
import { createTherapyOperationInTransaction } from './therapy-write-operation';
import { createObservationOperationInTransaction } from './observation-write-operation';
import { createWebAttachmentInTransaction } from './attachment-web-create';
import { createHostServicePrescriptionInTransaction, createHostServicePrescriptionItemInTransaction } from './service-prescription-write';
import { updatePatientOperationInTransaction } from './patient-update-operation';
import { PATIENT_PROFILE_UPDATE_OPERATION } from './patient-profile-update-contract';
import { writeAuditEventInTransaction, type RequiredAuditContext } from './security/audit';
import { archiveGenerationForSession } from './security/archive-session-generation';
import type { ServerSession } from './security/server-session';

export class AgentApplicationDenied extends Error {
    constructor(readonly status: 403 | 404 | 409) { super('AGENT_APPLICATION_DENIED'); }
}
export function agentAppliedItemIds(visitId: string): string[] {
    return [...new Set(dbServer.select({ id: auditEvents.subjectRef }).from(auditEvents).where(and(eq(auditEvents.eventType, 'agent.item.applied'),
        eq(auditEvents.requestId, visitId), eq(auditEvents.outcome, 'success'), eq(auditEvents.sourceSurface, 'agent'))).all().flatMap(row => row.id ? [row.id] : []))];
}
export function applyAgentVisit(request: Request, session: ServerSession, value: unknown): AgentApplicationReceipt {
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
        const mandateStore = createAgentMandateStore(dbServer.$client);
        const mandate = mandateStore.admit(cassette.mandateRef, 'visita.chiudi');
        if (mandate.actorRef !== session.userId) throw new AgentApplicationDenied(403);
        const client = dbServer.$client.prepare('SELECT revoked_at,expires_at,operations FROM agent_clients WHERE id=? AND mandate_ref=?')
            .get(cassette.agentRef, cassette.mandateRef) as { revoked_at: number | null; expires_at: number; operations: string } | undefined;
        if (!client || client.revoked_at !== null || client.expires_at <= Date.now()) throw new AgentApplicationDenied(403);
        const deposited = cassetteItems(cassette);
        const selected = deposited.filter(item => automaticAgentKind(item.kind) === (input.phase === 'automatic'));
        if (selected.length !== input.items.length || selected.some(item => !input.items.some(prepared => prepared.id === item.id && prepared.kind === item.kind))) throw new AgentApplicationDenied(409);
        const operations: unknown = JSON.parse(client.operations);
        for (const item of selected) {
            mandateStore.admit(cassette.mandateRef, AGENT_ITEM_OPERATION[item.kind]);
            if (!Array.isArray(operations) || !operations.includes(AGENT_ITEM_OPERATION[item.kind])) throw new AgentApplicationDenied(403);
        }
        const provenance = { proposerRef: cassette.agentRef, mandateRef: cassette.mandateRef, modelProvider: cassette.modelProvider };
        const prior = tx.select().from(auditEvents).where(and(eq(auditEvents.eventType, 'agent.visit.applied'),
            eq(auditEvents.subjectRef, cassette.id), eq(auditEvents.requestId, input.phase + ':' + input.patientId), eq(auditEvents.outcome, 'success'), eq(auditEvents.sourceSurface, 'agent'))).all();
        const appliedIds = agentAppliedItemIds(cassette.id);
        if (input.phase === 'review' && deposited.some(item => automaticAgentKind(item.kind) && !appliedIds.includes(item.id))) throw new AgentApplicationDenied(409);
        const replay = prior.find(row => row.actorRef === session.userId && row.mandateRef === cassette.mandateRef && row.proposerRef === cassette.agentRef);
        if (replay) {
            if (!selected.every(item => appliedIds.includes(item.id))) throw new AgentApplicationDenied(409);
            const metadata = JSON.parse(replay.redactedMetadata!);
            if (metadata.reasonCode !== fingerprint || metadata.counts !== selected.length || !Number.isSafeInteger(metadata.resourceVersion) || metadata.resourceVersion < 1) throw new AgentApplicationDenied(409);
            return { visitId: cassette.id, phase: input.phase, status: 'applied', eventId: replay.eventId, itemCount: selected.length,
                patientVersion: metadata.resourceVersion, modelProvider: cassette.modelProvider, allowsClinicalEgress: Boolean(cassette.allowsClinicalEgress) };
        }
        if (selected.some(item => appliedIds.includes(item.id))) throw new AgentApplicationDenied(409);
        const patient = tx.select().from(patients).where(and(eq(patients.id, input.patientId), activePatients())).get();
        if (!patient || patient.isArchived) throw new AgentApplicationDenied(404);
        if (patient.version !== input.expectedVersion) throw new AgentApplicationDenied(409);
        const audit: RequiredAuditContext = { actorType: 'user', actorRef: session.userId, sourceSurface: 'agent', archiveGeneration: generation,
            agentProvenance: provenance, requestId: cassette.id, flags: [input.phase] };
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
                requestId: cassette.id, redactedMetadata: { flags: [input.phase] } });
        }
        if (version === input.expectedVersion) {
            const result = updatePatientOperationInTransaction(tx, { operationId: PATIENT_PROFILE_UPDATE_OPERATION.id, contractVersion: PATIENT_PROFILE_UPDATE_OPERATION.version,
                patientId: input.patientId, expectedVersion: version++, values: {}, setPrimaryAmbulatory: false, audit });
            if (result.status !== 200) throw new AgentApplicationDenied(409);
        }
        const applied = new Set([...appliedIds, ...selected.map(item => item.id)]);
        const flags = deposited.every(item => applied.has(item.id)) ? [input.phase, AGENT_CASSETTE_COMPLETE] : [input.phase];
        const eventId = writeAuditEventInTransaction(tx, { eventType: 'agent.visit.applied', outcome: 'success', actorType: 'user', actorRef: session.userId,
            sourceSurface: 'agent', archiveGeneration: generation, agentProvenance: provenance, subjectType: 'agent_operation', subjectRef: cassette.id,
            requestId: input.phase + ':' + input.patientId, redactedMetadata: { reasonCode: fingerprint, resourceVersion: version, counts: input.items.length, flags } });
        return { visitId: cassette.id, phase: input.phase, status: 'applied', eventId, itemCount: input.items.length,
            patientVersion: version, modelProvider: cassette.modelProvider, allowsClinicalEgress: Boolean(cassette.allowsClinicalEgress) };
    }, { behavior: 'immediate' });
}
