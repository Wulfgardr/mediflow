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
 * a completed resta la data indicata, o quella già salvata se non è futura,
 * altrimenti quella del passaggio, anche se la richiesta la manda vuota: una
 * fine programmata e poi anticipata si conclude oggi, come dal comando di stato.
 * A una terapia completed non si può togliere la data che ha. Riattivando una
 * terapia completed la data di conclusione si svuota; resta solo una nuova fine
 * programmata, cioè una data futura. suspended e il ritorno da suspended ad
 * active non toccano la data.
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
    if (to === 'completed' && !requested.endDate) {
        return { ok: true, endDate: saved.endDate && saved.endDate.getTime() <= now.getTime() ? saved.endDate : now };
    }
    // Apple manda sempre la data in modifica: quella vecchia di conclusione non diventa una fine programmata.
    if (to === 'active' && saved.status === 'completed' && !(requested.endDate && requested.endDate.getTime() > now.getTime())) {
        return { ok: true, endDate: null };
    }
    return { ok: true };
}

export type EndDateRequiredDenial = {
    status: 409;
    value: { error: string; code: 'therapy_end_date_required' };
};

function endDateRequiredDenial(): EndDateRequiredDenial {
    return { status: 409, value: { error: 'A completed therapy needs an end date', code: 'therapy_end_date_required' } };
}

export type ProstheticStatus = 'draft' | 'prescribed' | 'submitted' | 'authorized' | 'delivered' | 'tested' | 'cancelled';

/*
 * Avanti lungo il percorso, anche saltando passi, ma il collaudo solo da
 * prescritta in poi. Annullabile da ogni stato tranne collaudata. Indietro di
 * un passo. Un'annullata riparte da bozza o da prescritta.
 */
export const PROSTHETIC_TRANSITIONS: Readonly<Record<ProstheticStatus, readonly ProstheticStatus[]>> = {
    draft: ['prescribed', 'submitted', 'authorized', 'delivered', 'cancelled'],
    prescribed: ['submitted', 'authorized', 'delivered', 'tested', 'cancelled', 'draft'],
    submitted: ['authorized', 'delivered', 'tested', 'cancelled', 'prescribed'],
    authorized: ['delivered', 'tested', 'cancelled', 'submitted'],
    delivered: ['tested', 'cancelled', 'authorized'],
    tested: ['delivered'],
    cancelled: ['draft', 'prescribed'],
};

export function isProstheticTransitionAllowed(from: string, to: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(PROSTHETIC_TRANSITIONS, to)) return false;
    if (from === to || !Object.prototype.hasOwnProperty.call(PROSTHETIC_TRANSITIONS, from)) return true;
    return PROSTHETIC_TRANSITIONS[from as ProstheticStatus].includes(to as ProstheticStatus);
}

export type CollaudoDateRequiredDenial = {
    status: 409;
    value: { error: string; code: 'prosthetic_collaudo_date_required' };
};

/**
 * Stato e collaudo di una prescrizione protesica non si contraddicono (WUL-800).
 * Passando a tested resta la data indicata, o quella già salvata se non è
 * futura, altrimenti quella del passaggio; l'esito non viene mai inventato.
 * Tornando indietro da tested la data si svuota; l'esito scritto dal medico
 * resta, perché l'audit è redatto e non lo conserverebbe. A una prescrizione
 * collaudata non si toglie la data che ha.
 */
export function planProstheticStatusChange(
    saved: { status: string; collaudoAt: Date | null },
    requested: { status?: string; collaudoAt?: Date | null },
    now: Date,
): { ok: true; collaudo?: { collaudoAt: Date | null } }
    | { ok: false; denial: StatusTransitionDenial | CollaudoDateRequiredDenial } {
    const to = requested.status;
    if (to !== undefined && !isProstheticTransitionAllowed(saved.status, to)) {
        return { ok: false, denial: statusTransitionDenial('prosthetic_prescription', saved.status, to) };
    }
    if (to === undefined || to === saved.status) {
        const removesDate = saved.status === 'tested' && requested.collaudoAt === null && saved.collaudoAt !== null;
        return removesDate
            ? { ok: false, denial: { status: 409, value: { error: 'A tested prosthetic prescription needs a collaudo date', code: 'prosthetic_collaudo_date_required' } } }
            : { ok: true };
    }
    if (to === 'tested') {
        const savedDate = saved.collaudoAt && saved.collaudoAt.getTime() <= now.getTime() ? saved.collaudoAt : null;
        return { ok: true, collaudo: { collaudoAt: requested.collaudoAt ?? savedDate ?? now } };
    }
    if (saved.status === 'tested') return { ok: true, collaudo: { collaudoAt: null } };
    return { ok: true };
}

export type SissHandoffOutcome = 'started' | 'completed' | 'blocked' | 'cancelled';

/* Un passaggio aperto si chiude, si blocca o si annulla; un bloccato riparte o si chiude; un chiuso si riapre. */
export const SISS_HANDOFF_TRANSITIONS: Readonly<Record<SissHandoffOutcome, readonly SissHandoffOutcome[]>> = {
    started: ['completed', 'blocked', 'cancelled'],
    blocked: ['started', 'completed', 'cancelled'],
    completed: ['started'],
    cancelled: ['started'],
};

export function isSissHandoffTransitionAllowed(from: string, to: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(SISS_HANDOFF_TRANSITIONS, to)) return false;
    if (from === to || !Object.prototype.hasOwnProperty.call(SISS_HANDOFF_TRANSITIONS, from)) return true;
    return SISS_HANDOFF_TRANSITIONS[from as SissHandoffOutcome].includes(to as SissHandoffOutcome);
}

export type CompletedAtMismatchDenial = {
    status: 409;
    value: { error: string; code: 'siss_handoff_completed_at_mismatch' };
};

/**
 * Esito e chiusura di un passaggio SISS non si contraddicono (WUL-800): un
 * passaggio avviato non ha data di chiusura, uno con un altro esito ce l'ha.
 * Cambiando esito verso uno diverso da started vale la data indicata, altrimenti
 * quella del passaggio (orologio del server): un bloccato poi completato non
 * eredita la data del blocco. Tornando a started la data si svuota. Senza cambio di esito si
 * rifiuta solo una richiesta che porterebbe la riga in contraddizione; una riga
 * storica incoerente resta com'è finché non cambia esito.
 */
export function planSissHandoffOutcomeChange(
    saved: { outcome: string; completedAt: Date | null },
    requested: { outcome?: string; completedAt?: Date | null },
    now: Date,
): { ok: true; completedAt?: Date | null } | { ok: false; denial: StatusTransitionDenial | CompletedAtMismatchDenial } {
    const to = requested.outcome;
    if (to !== undefined && !isSissHandoffTransitionAllowed(saved.outcome, to)) {
        return { ok: false, denial: statusTransitionDenial('siss_handoff', saved.outcome, to) };
    }
    if (to === undefined || to === saved.outcome) {
        const contradicts = saved.outcome === 'started' ? requested.completedAt instanceof Date
            : requested.completedAt === null && saved.completedAt !== null;
        return contradicts
            ? { ok: false, denial: { status: 409, value: { error: 'Outcome and completion date of a SISS handoff must agree', code: 'siss_handoff_completed_at_mismatch' } } }
            : { ok: true };
    }
    if (to === 'started') return { ok: true, completedAt: null };
    return { ok: true, completedAt: requested.completedAt ?? now };
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
