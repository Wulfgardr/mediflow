import type Database from 'better-sqlite3';
import { PROSTHETIC_TRANSITIONS, SERVICE_PRESCRIPTION_TRANSITIONS, SISS_HANDOFF_TRANSITIONS } from './clinical-status-transitions';
import { parseCheckupStatus, parseTherapyStatus } from './status-normalization';

/*
 * WUL-800, punto 7: conta in sola lettura le righe già salvate che non
 * rispettano le regole di stato. Nessuna riga viene riscritta: la regola vale
 * dalla modifica successiva. Il risultato contiene solo conteggi, mai
 * identificativi o testo clinico.
 */
export type ClinicalStatusIncoherence = Record<string, number>;

type Row = Record<string, unknown>;

function rows(db: Database.Database, sql: string): Row[] {
    return db.prepare(sql).all() as Row[];
}

const known = (table: object, value: unknown) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value);

export function countClinicalStatusIncoherence(db: Database.Database): ClinicalStatusIncoherence {
    const counts: ClinicalStatusIncoherence = {
        servicePrescriptionUnknownStatus: 0,
        servicePrescriptionItemUnknownStatus: 0,
        checkupUnknownStatus: 0,
        therapyUnknownStatus: 0,
        therapyCompletedWithoutEndDate: 0,
        prostheticUnknownStatus: 0,
        prostheticTestedWithoutCollaudoDate: 0,
        prostheticCollaudoOnUntestedStatus: 0,
        sissHandoffUnknownOutcome: 0,
        sissHandoffStartedWithCompletionDate: 0,
        sissHandoffClosedWithoutCompletionDate: 0,
    };
    for (const row of rows(db, 'SELECT status FROM service_prescriptions')) {
        if (!known(SERVICE_PRESCRIPTION_TRANSITIONS, row.status)) counts.servicePrescriptionUnknownStatus++;
    }
    for (const row of rows(db, 'SELECT status FROM service_prescription_items')) {
        if (!known(SERVICE_PRESCRIPTION_TRANSITIONS, row.status)) counts.servicePrescriptionItemUnknownStatus++;
    }
    // Uno stato assente vale come pending, come nel resto del codice; le visite eliminate non contano.
    for (const row of rows(db, 'SELECT status FROM checkups WHERE deleted_at IS NULL AND status IS NOT NULL')) {
        if (!parseCheckupStatus(row.status)) counts.checkupUnknownStatus++;
    }
    for (const row of rows(db, 'SELECT status, end_date AS endDate FROM therapies')) {
        const status = parseTherapyStatus(row.status);
        if (!status) counts.therapyUnknownStatus++;
        else if (status === 'completed' && row.endDate === null) counts.therapyCompletedWithoutEndDate++;
    }
    for (const row of rows(db, 'SELECT status, collaudo_at AS collaudoAt FROM prosthetic_prescriptions')) {
        if (!known(PROSTHETIC_TRANSITIONS, row.status)) counts.prostheticUnknownStatus++;
        else if (row.status === 'tested' && row.collaudoAt === null) counts.prostheticTestedWithoutCollaudoDate++;
        else if (row.status !== 'tested' && row.collaudoAt !== null) counts.prostheticCollaudoOnUntestedStatus++;
    }
    for (const row of rows(db, 'SELECT outcome, completed_at AS completedAt FROM siss_handoff_events')) {
        if (!known(SISS_HANDOFF_TRANSITIONS, row.outcome)) counts.sissHandoffUnknownOutcome++;
        else if (row.outcome === 'started' && row.completedAt !== null) counts.sissHandoffStartedWithCompletionDate++;
        else if (row.outcome !== 'started' && row.completedAt === null) counts.sissHandoffClosedWithoutCompletionDate++;
    }
    return counts;
}
