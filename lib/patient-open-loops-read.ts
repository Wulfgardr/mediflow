import { createHash } from 'node:crypto';
import { deriveOpenLoopProjection, type OpenLoop, type OpenLoopObservation,
    type OpenLoopServicePrescription, type OpenLoopServicePrescriptionItem } from './patient-open-loops';

export function readPatientOpenLoopProjection(input: {
    patientId: string;
    ambulatoryId: string;
    prescriptions: OpenLoopServicePrescription[];
    items: OpenLoopServicePrescriptionItem[];
    observations: OpenLoopObservation[];
    now: Date;
}) {
    if (input.items.some(row => row.patientId !== input.patientId)
        || input.observations.some(row => row.patientId !== input.patientId)) {
        throw new Error('Patient scope mismatch');
    }
    const projection = deriveOpenLoopProjection(input);
    const row = (loop: OpenLoop) => ({
        kind: loop.kind,
        label: loop.label,
        sinceDate: loop.status.sinceDate.toISOString(),
        elapsedDays: loop.status.elapsedDays,
        typicalIntervalDays: loop.status.typicalIntervalDays ?? null,
        source: loop.kind === 'results_pending'
            ? { type: 'service_prescription_item' as const, id: loop.sourceRef.id, prescriptionId: loop.sourceRef.prescriptionId }
            : { type: 'observation_series' as const, codeSystem: loop.sourceRef.codeSystem, code: loop.sourceRef.code },
    });
    const groups = projection.groups.map(group => ({
        prescriptionId: group.prescriptionId,
        prescribedAt: group.prescribedAt.toISOString(),
        loops: group.loops.map(row),
    }));
    const standaloneLoops = projection.standaloneLoops.map(row);
    const itemCount = groups.reduce((sum, group) => sum + group.loops.length, standaloneLoops.length);
    const snapshot = { contractVersion: 1 as const, patientId: input.patientId,
        ambulatoryId: input.ambulatoryId, groups, standaloneLoops };
    return { ...snapshot, receipt: {
        operation: 'patient-open-loops.read.v1' as const,
        outcome: 'read' as const,
        readAt: input.now.toISOString(),
        itemCount,
        snapshotHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    } };
}
