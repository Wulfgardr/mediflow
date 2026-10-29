import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { deny, planDigest, type LocalOperationPlan, type LocalOperationRecord } from '../contract.ts';
import { requireTerritorialPack } from '../../territorial-pack-store.ts';
import { specialistDecisionSchema, specialistDecisionValues } from './prescription.ts';

/** Invoked by the journal inside its IMMEDIATE transaction, on the same archive connection. */
export function recordSpecialistOutcome(db: Database.Database, input: {
    record: LocalOperationRecord; plan: LocalOperationPlan; decision: unknown;
    seal(value: string): string; assertCurrent(): void;
}) {
    input.assertCurrent();
    const { record, plan } = input, receipt = record.receipt, decision = specialistDecisionSchema.parse(input.decision);
    const values = Object.entries(specialistDecisionValues(decision));
    requireTerritorialPack(db, 'lom');
    if (!db.inTransaction || record.state !== 'confirmed' || !receipt || record.planDigest !== planDigest(plan)
        || receipt.planDigest !== record.planDigest || receipt.operationId !== record.operationId
        || decision.patientId !== record.patientId || decision.practiceId !== record.practiceId
        || decision.version !== plan.sourceVersion || decision.decidedBy !== plan.operatorId
        || plan.procedureId !== 'synthetic-specialist-prreg'
        || values.length + 2 !== plan.fields.length || values.some(([name, value]) => !plan.fields.some(field => field.name === name && field.value === value))
        || receipt.patientId !== record.patientId || receipt.practiceId !== record.practiceId
        || receipt.parts.length !== decision.items.length || decision.items.some(item => !receipt.parts.some(part => part.id === item.id && part.state === 'confirmed'))
        || !db.prepare('SELECT 1 FROM patients WHERE id=? AND deleted_at IS NULL AND COALESCE(is_archived,0)=0').get(record.patientId)) deny();
    const source = db.prepare('SELECT patient_id,version,request_reference FROM service_prescriptions WHERE id=?').get(record.operationId) as
        { patient_id: string; version: number; request_reference: string | null } | undefined;
    if (!source || source.patient_id !== record.patientId || String(source.version) !== plan.sourceVersion || source.request_reference !== null) deny();
    const seal = (value: string) => {
        const encrypted = input.seal(value);
        if (!/^ENC:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/.test(encrypted) || encrypted === value) deny();
        return encrypted;
    };
    const at = Math.floor(record.updatedAt / 1000);
    function requiredAudit(eventType: 'service.prescription.updated' | 'service.prescription_item.created',
        subjectType: 'service_prescription' | 'service_prescription_item', subjectRef: string, version: number) {
        const eventId = randomUUID();
        const audit = db.prepare(`INSERT INTO audit_events
            (event_id,schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,redacted_metadata)
            VALUES (?,1,?,?,'success','user',?,?,?,'native',?)`)
            .run(eventId, eventType, at, plan.operatorId, subjectType, subjectRef, JSON.stringify({ resourceVersion: version, flags: ['source:local-operation'] }));
        if (audit.changes !== 1 || !db.prepare('SELECT 1 FROM audit_events WHERE event_id=?').get(eventId)) deny();
    }
    const parent = db.prepare(`UPDATE service_prescriptions SET priority=?,service_name=?,clinical_question=?,request_reference=?,
        document_refs=?,notes=?,version=version+1,updated_at=? WHERE id=? AND patient_id=? AND version=? AND request_reference IS NULL`)
        .run(decision.priority, seal(decision.items.map(item => item.description).join('; ')),
        seal(decision.clinicalQuestion), seal(receipt.receiptId), seal(JSON.stringify(receipt)),
        seal(JSON.stringify({ decision, planDigest: record.planDigest })), at, record.operationId, record.patientId, source.version);
    if (parent.changes !== 1) deny();
    decision.items.forEach((item, index) => {
        const result = db.prepare(`INSERT INTO service_prescription_items
            (id,patient_id,prescription_id,ordinal,status,code_system,service_code,service_name,catalog_display_name,match_status,evidence,notes,version,created_at,updated_at)
            VALUES (?,?,?,?,'prescribed',?,?,?,?,'matched',?,?,1,?,?)`).run(`${record.operationId}:${item.id}`,
            record.patientId, record.operationId, index, 'synthetic-prreg', item.code, seal(item.description), seal(item.description),
            seal(JSON.stringify({ catalogVersion: plan.catalogVersion, receiptId: receipt.receiptId, partId: item.id })),
            seal(JSON.stringify({ quantity: item.quantity, unit: item.unit, exemption: decision.exemption })), at, at);
        if (result.changes !== 1) deny();
        requiredAudit('service.prescription_item.created', 'service_prescription_item', `${record.operationId}:${item.id}`, 1);
    });
    requiredAudit('service.prescription.updated', 'service_prescription', record.operationId, source.version + 1);
}
