/**
 * Proiezione pura per la sezione "Contesto prescrittivo" del pannello SISS
 * (S2, PRREG D2). Nessun accesso a DB o rete qui dentro: solo selezione,
 * ordinamento e mapping dei valori copiabili a partire dai record che il
 * pannello ha gia' letto (Dexie via useLiveQuery). Il pannello resta una
 * vista read-only: questo modulo non scrive nulla e non chiama API.
 */

import type { Diagnosis, ServicePrescription, Therapy } from '@/lib/db';
import { parsePatientDatedRecords } from '@/lib/patient-structured-fields';

/* Stesso limite di lib/ai-context.ts MAX_DIAGNOSES: le diagnosi principali
   mostrate nel contesto prescrittivo restano allineate a quelle usate altrove. */
const MAX_PRINCIPAL_DIAGNOSES = 5;
const DEFAULT_RECENT_PRESCRIPTIONS_MAX = 5;

export interface PrescriptiveCopyField {
    key: string;
    label: string;
    value: string;
}

export interface PrescriptiveTherapiesProjection {
    active: Therapy[];
    inactiveCount: number;
}

function toTime(value: Date | string | number | null | undefined): number {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
}

/**
 * Terapie attive (non cancellate) in evidenza, piu recenti prima; le altre
 * (sospese, concluse) restano fuori dall'elenco in evidenza e sono solo
 * conteggiate, cosi la UI puo' collassarle o mostrarne il numero.
 */
export function projectPrescriptiveTherapies(
    therapies: Therapy[] | undefined | null,
): PrescriptiveTherapiesProjection {
    const list = Array.isArray(therapies) ? therapies : [];
    const visible = list.filter((therapy) => !therapy.deletedAt);
    const active = visible
        .filter((therapy) => therapy.status === 'active')
        .sort((left, right) => toTime(right.startDate) - toTime(left.startDate));

    return { active, inactiveCount: visible.length - active.length };
}

/**
 * Prescrizioni specialistiche recenti, piu recenti prima (per data di
 * prescrizione, con fallback sulla data di creazione), limitate a max.
 */
export function selectRecentServicePrescriptions(
    prescriptions: ServicePrescription[] | undefined | null,
    options: { max?: number } = {},
): ServicePrescription[] {
    const list = Array.isArray(prescriptions) ? prescriptions : [];
    const max = options.max ?? DEFAULT_RECENT_PRESCRIPTIONS_MAX;

    return [...list]
        .sort((left, right) => (
            toTime(right.prescribedAt ?? right.createdAt) - toTime(left.prescribedAt ?? left.createdAt)
        ))
        .slice(0, Math.max(0, max));
}

/**
 * Diagnosi principali: riusa il parser esistente dei record datati
 * (lib/patient-structured-fields, stesso pattern di ai-context.ts e
 * document-insights-panel.tsx) cosi funziona sia che patient.diagnoses sia
 * gia' stato revivificato dal layer DB, sia che arrivi come stringa JSON.
 */
export function selectPrincipalDiagnoses(
    diagnoses: unknown,
    options: { max?: number } = {},
): Array<Diagnosis & { date: Date }> {
    const max = options.max ?? MAX_PRINCIPAL_DIAGNOSES;

    return parsePatientDatedRecords<Diagnosis>(diagnoses)
        .sort((left, right) => toTime(right.date) - toTime(left.date))
        .slice(0, Math.max(0, max));
}

/**
 * Codici esenzione normalizzati: trim, maiuscolo, deduplicati, non vuoti.
 * Stesso pattern gia' inline in app/patients/[id]/modules/page.tsx.
 */
export function normalizeExemptionCodes(exemptions: unknown): string[] {
    const list = Array.isArray(exemptions) ? exemptions : [];
    const normalized = list
        .filter((code): code is string => typeof code === 'string')
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean);

    return [...new Set(normalized)];
}

/** Valori copiabili per una terapia: farmaco e, se presenti, AIC e ATC. */
export function buildTherapyCopyFields(therapy: Therapy): PrescriptiveCopyField[] {
    const fields: PrescriptiveCopyField[] = [];

    const drugName = therapy.drugName?.trim();
    if (drugName) {
        fields.push({ key: `${therapy.id}:drugName`, label: 'Farmaco', value: drugName });
    }

    const aic = therapy.aic?.trim();
    if (aic) {
        fields.push({ key: `${therapy.id}:aic`, label: 'AIC', value: aic });
    }

    const atc = therapy.atc?.trim();
    if (atc) {
        fields.push({ key: `${therapy.id}:atc`, label: 'ATC', value: atc });
    }

    return fields;
}

/** Valore copiabile per una prescrizione specialistica: la descrizione della prestazione. */
export function buildServicePrescriptionCopyFields(prescription: ServicePrescription): PrescriptiveCopyField[] {
    const serviceName = prescription.serviceName?.trim();
    if (!serviceName) return [];

    return [{ key: `${prescription.id}:serviceName`, label: 'Prestazione', value: serviceName }];
}

/** Valore copiabile per un'esenzione: il codice normalizzato. */
export function buildExemptionCopyFields(code: string): PrescriptiveCopyField[] {
    const trimmed = code.trim();
    if (!trimmed) return [];

    return [{ key: `exemption:${trimmed}`, label: 'Esenzione', value: trimmed }];
}
