import { SERVICE_PRESCRIPTION_STATUSES } from './prescription-domain';

/*
 * Passaggi di stato ammessi sul server (WUL-800, decisione delegata a Claude il
 * 1/11/2026). Criterio: avanti si può saltare un passo, perché l'atto può essere
 * avvenuto fuori da MediFlow; indietro si torna di un solo passo, come correzione
 * tracciata in audit; si blocca solo ciò che non ha senso. Non è un parere
 * clinico: se l'uso reale blocca una correzione legittima, si allarga la tabella.
 * La decisione è scritta in docs/domain/clinical-status-transitions.json e i
 * test di server e client Swift confrontano le loro tabelle con quel file.
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

export type CheckupStatus = 'pending' | 'completed' | 'cancelled';

/* Mai direttamente fra completata e annullata: si torna prima da fare. */
export const CHECKUP_TRANSITIONS: Readonly<Record<CheckupStatus, readonly CheckupStatus[]>> = {
    pending: ['completed', 'cancelled'],
    completed: ['pending'],
    cancelled: ['pending'],
};

export function isCheckupTransitionAllowed(from: string, to: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(CHECKUP_TRANSITIONS, to)) return false;
    if (from === to || !Object.prototype.hasOwnProperty.call(CHECKUP_TRANSITIONS, from)) return true;
    return CHECKUP_TRANSITIONS[from as CheckupStatus].includes(to as CheckupStatus);
}

export type TherapyStatus = 'active' | 'suspended' | 'completed';

/* Mai da conclusa a sospesa: una terapia conclusa si riattiva. */
export const THERAPY_TRANSITIONS: Readonly<Record<TherapyStatus, readonly TherapyStatus[]>> = {
    active: ['suspended', 'completed'],
    suspended: ['active', 'completed'],
    completed: ['active'],
};

export function isTherapyTransitionAllowed(from: string, to: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(THERAPY_TRANSITIONS, to)) return false;
    if (from === to || !Object.prototype.hasOwnProperty.call(THERAPY_TRANSITIONS, from)) return true;
    return THERAPY_TRANSITIONS[from as TherapyStatus].includes(to as TherapyStatus);
}

/**
 * Stato e data di fine di una terapia non si contraddicono (WUL-800). Passando
 * a completed resta la data indicata o già salvata, altrimenti quella del
 * passaggio, anche se la richiesta la manda vuota. A una terapia completed non
 * si può togliere la data che ha. Passando ad active la data si svuota se la
 * richiesta non ne indica una (una fine programmata resta possibile).
 * suspended non tocca la data.
 */
export function planTherapyStatusChange(
    saved: { status: string; endDate: Date | null },
    requested: { status?: string; endDate?: Date | null },
    now: Date,
): { ok: true; endDate?: Date | null } | { ok: false; denial: StatusTransitionDenial | EndDateRequiredDenial } {
    const to = requested.status;
    if (to !== undefined && !isTherapyTransitionAllowed(saved.status, to)) {
        return { ok: false, denial: statusTransitionDenial('therapy', saved.status, to) };
    }
    if (to === undefined || to === saved.status) {
        // Senza passaggio si rifiuta solo la rimozione di una data che c'era; una riga storica resta com'è.
        const removesEnd = saved.status === 'completed' && requested.endDate === null && saved.endDate !== null;
        return removesEnd ? { ok: false, denial: endDateRequiredDenial() } : { ok: true };
    }
    if (to === 'completed' && !requested.endDate) return { ok: true, endDate: saved.endDate ?? now };
    if (to === 'active' && requested.endDate === undefined) return { ok: true, endDate: null };
    return { ok: true };
}

export type EndDateRequiredDenial = {
    status: 409;
    value: { error: string; code: 'therapy_end_date_required' };
};

function endDateRequiredDenial(): EndDateRequiredDenial {
    return { status: 409, value: { error: 'A completed therapy needs an end date', code: 'therapy_end_date_required' } };
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
