import { SERVICE_PRESCRIPTION_STATUSES } from './prescription-domain';

/*
 * Passaggi di stato ammessi sul server (WUL-800, decisione delegata a Claude il
 * 1/11/2026). Criterio: avanti si può saltare un passo, perché l'atto può essere
 * avvenuto fuori da MediFlow; indietro si torna di un solo passo, come correzione
 * tracciata in audit; si blocca solo ciò che non ha senso. Non è un parere
 * clinico: se l'uso reale blocca una correzione legittima, si allarga la tabella.
 */

export type ServicePrescriptionStatus = typeof SERVICE_PRESCRIPTION_STATUSES[number];

export const SERVICE_PRESCRIPTION_TRANSITIONS: Readonly<Record<ServicePrescriptionStatus, readonly ServicePrescriptionStatus[]>> = {
    prescribed: ['booked', 'performed', 'report_received', 'cancelled'],
    booked: ['performed', 'report_received', 'cancelled', 'prescribed'],
    performed: ['report_received', 'booked'],
    report_received: ['performed'],
    cancelled: ['prescribed'],
};

const SERVICE_PRESCRIPTION_PROGRESS: Readonly<Record<string, number>> = {
    prescribed: 0,
    booked: 1,
    performed: 2,
    report_received: 3,
};

function isServicePrescriptionStatus(value: string): value is ServicePrescriptionStatus {
    return Object.prototype.hasOwnProperty.call(SERVICE_PRESCRIPTION_TRANSITIONS, value);
}

/**
 * Restare nello stesso stato è sempre ammesso. Una riga salvata con uno stato
 * fuori tabella (dati storici) può essere portata a uno stato valido: la regola
 * vale dalla modifica successiva, senza riscrivere ciò che c'è.
 */
export function isServicePrescriptionTransitionAllowed(from: string, to: string): boolean {
    if (!isServicePrescriptionStatus(to)) return false;
    if (from === to || !isServicePrescriptionStatus(from)) return true;
    return SERVICE_PRESCRIPTION_TRANSITIONS[from].includes(to);
}

/** Passo ammesso che porta avanti il percorso: è ciò che le interfacce offrono come azione. */
export function isServicePrescriptionForwardStep(from: string, to: string): boolean {
    const fromRank = SERVICE_PRESCRIPTION_PROGRESS[from];
    const toRank = SERVICE_PRESCRIPTION_PROGRESS[to];
    if (fromRank === undefined || toRank === undefined) return false;
    return toRank > fromRank && isServicePrescriptionTransitionAllowed(from, to);
}

export type StatusTransitionDenial = {
    status: 409;
    value: { error: string; code: 'status_transition_not_allowed'; entity: string; from: string; to: string };
};

export function statusTransitionDenial(entity: string, from: string, to: string): StatusTransitionDenial {
    return {
        status: 409,
        value: { error: 'Status transition not allowed', code: 'status_transition_not_allowed', entity, from, to },
    };
}
