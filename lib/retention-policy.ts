// ADR 0178: conservazione dei dati sanitari per giurisdizione.
// Modulo puro: profili, categorie, fonti, classificazione e valutazione del
// fascicolo. Nessun accesso al database, nessuna cancellazione.
import { z } from 'zod';
import type { TerritorialPackPreset } from './territorial-pack-contract';
import type { PatientChildTableName } from './patient-cascade';

export const RETENTION_SCHEMA = 'mediflow.retention.v1' as const;
export const RETENTION_WINDOWS_KEY = 'retention.windows';
export const RETENTION_HOLDS_KEY = 'retention.holds';
export const RETENTION_MAX_YEARS = 100;
export const RETENTION_MAX_HOLDS = 1000;

export const RETENTION_PROFILE_IDS = ['none', 'it-national', 'it-lom-rev04'] as const;
export type RetentionProfileId = typeof RETENTION_PROFILE_IDS[number];

export const RETENTION_CATEGORIES = [
    'ambulatory_record',
    'hospital_record',
    'diagnostic_report',
    'lab_report',
    'imaging_iconography',
    'prescription',
    'attached_document',
    'unclassified',
] as const;
export type RetentionCategory = typeof RETENTION_CATEGORIES[number];

export type RetentionSourceId = 'garante-55-2019' | 'circ-61-1986' | 'dm-14-02-1997' | 'lom-rev04';
export type RetentionSource = { id: RetentionSourceId; label: string; href: string };

export const RETENTION_SOURCES: Readonly<Record<RetentionSourceId, RetentionSource>> = Object.freeze({
    'garante-55-2019': {
        id: 'garante-55-2019',
        label: 'Garante privacy, provvedimento n. 55 del 7 marzo 2019, sezione 3',
        href: 'https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/9091942',
    },
    'circ-61-1986': {
        id: 'circ-61-1986',
        label: 'Ministero della Sanità, circolare n. 61 del 19 dicembre 1986',
        href: 'https://siusa-archivi.cultura.gov.it/cgi-bin/siusa/pagina.pl?Chiave=3&RicProgetto=carte&TipoPag=profdocgen',
    },
    'dm-14-02-1997': {
        id: 'dm-14-02-1997',
        label: 'DM Sanità 14 febbraio 1997, art. 4 (GU n. 58 dell\'11 marzo 1997)',
        href: 'https://sa-fvg.cultura.gov.it/fileadmin/normativa/d.m._Sanita_14_feb._1997.pdf',
    },
    'lom-rev04': {
        id: 'lom-rev04',
        label: 'Regione Lombardia, titolario e massimario rev04, decreto n. 15229 del 1 dicembre 2017, titolo 3, classe 4.01',
        href: 'https://www.regione.lombardia.it/sanita/monitoraggio-dei-servizi-sanitari/gestione-della-documentazione-sanitaria',
    },
});

/** Minimo del profilo: anni, illimitato, oppure termine fissato dal titolare. */
export type RetentionTerm = { kind: 'years'; years: number } | { kind: 'unlimited' } | { kind: 'owner' };
/** Finestra impostata dal titolare: può solo allungare il minimo del profilo. */
export type RetentionWindow = { kind: 'years'; years: number } | { kind: 'unlimited' };
export type RetentionWindows = Partial<Record<RetentionCategory, RetentionWindow>>;

/**
 * `source`: termine letto nella fonte per quella classe. `prudence`: estensione
 * prudente di una fonte a un dato che potrebbe rientrarvi. `owner`: nessun termine
 * verificato, lo fissa il titolare.
 */
export type ProfileTerm = { term: RetentionTerm; sourceId: RetentionSourceId | null; basis: 'source' | 'prudence' | 'owner' };
export type RetentionProfile = {
    id: RetentionProfileId;
    label: string;
    terms: Readonly<Record<RetentionCategory, ProfileTerm>>;
};

export const RETENTION_CATEGORY_LABELS: Readonly<Record<RetentionCategory, string>> = Object.freeze({
    ambulatory_record: 'Fascicolo ambulatoriale e documenti di supporto',
    hospital_record: 'Documentazione di ricovero',
    diagnostic_report: 'Referto diagnostico non specificato',
    lab_report: 'Referto di laboratorio',
    imaging_iconography: 'Iconografia radiologica',
    prescription: 'Prescrizione, proposta o ricetta (copia nella scheda)',
    attached_document: 'Documento allegato non classificato',
    unclassified: 'Voce di tipo non riconosciuto',
});

const years = (value: number): RetentionTerm => ({ kind: 'years', years: value });
const UNLIMITED: RetentionTerm = { kind: 'unlimited' };
const OWNER: RetentionTerm = { kind: 'owner' };
const owner = (): ProfileTerm => ({ term: OWNER, sourceId: 'garante-55-2019', basis: 'owner' });
const fromSource = (term: RetentionTerm, sourceId: RetentionSourceId): ProfileTerm => ({ term, sourceId, basis: 'source' });
const prudent = (term: RetentionTerm, sourceId: RetentionSourceId | null): ProfileTerm => ({ term, sourceId, basis: 'prudence' });
const ownerOnly: ProfileTerm = { term: OWNER, sourceId: null, basis: 'owner' };

export const RETENTION_PROFILES: Readonly<Record<RetentionProfileId, RetentionProfile>> = Object.freeze({
    none: {
        id: 'none',
        label: 'Nessun profilo di giurisdizione',
        terms: {
            ambulatory_record: ownerOnly,
            hospital_record: ownerOnly,
            diagnostic_report: ownerOnly,
            lab_report: ownerOnly,
            imaging_iconography: ownerOnly,
            prescription: ownerOnly,
            attached_document: ownerOnly,
            unclassified: prudent(UNLIMITED, null),
        },
    },
    'it-national': {
        id: 'it-national',
        label: 'Italia, base nazionale',
        terms: {
            ambulatory_record: owner(),
            hospital_record: prudent(UNLIMITED, 'circ-61-1986'),
            diagnostic_report: prudent(UNLIMITED, 'dm-14-02-1997'),
            lab_report: owner(),
            imaging_iconography: fromSource(years(10), 'dm-14-02-1997'),
            prescription: owner(),
            attached_document: prudent(UNLIMITED, 'dm-14-02-1997'),
            unclassified: prudent(UNLIMITED, null),
        },
    },
    'it-lom-rev04': {
        id: 'it-lom-rev04',
        label: 'Lombardia, massimario rev04',
        terms: {
            ambulatory_record: fromSource(years(10), 'lom-rev04'),
            hospital_record: prudent(UNLIMITED, 'circ-61-1986'),
            diagnostic_report: prudent(UNLIMITED, 'lom-rev04'),
            lab_report: fromSource(years(5), 'lom-rev04'),
            imaging_iconography: fromSource(years(10), 'lom-rev04'),
            prescription: fromSource(years(5), 'lom-rev04'),
            attached_document: prudent(UNLIMITED, 'lom-rev04'),
            unclassified: prudent(UNLIMITED, null),
        },
    },
});

/** Il profilo segue il pacchetto territoriale attivo dell'host (ADR 0158), mai una scelta separata. */
export function retentionProfileForPreset(preset: TerritorialPackPreset): RetentionProfileId {
    if (preset === 'core+it+lom') return 'it-lom-rev04';
    if (preset === 'core+it') return 'it-national';
    return 'none';
}

// --- Classificazione: unica fonte per tutte le tabelle figlie del paziente. ---

type ColumnRule = { column: string; map: Readonly<Record<string, RetentionCategory>>; fallback: RetentionCategory };
export type RetentionTableRule = {
    /** Categoria fissa o regola per colonna. */
    category: RetentionCategory | ColumnRule;
    /** Colonne temporali usate per stimare per eccesso la chiusura del fascicolo. */
    timestamps: readonly string[];
};

const AMBULATORY_ENTRY_TYPES = ['visit', 'phone', 'access', 'note', 'remote', 'scale'] as const;

export const RETENTION_PATIENT_ROW_CATEGORY: RetentionCategory = 'ambulatory_record';
export const RETENTION_PATIENT_TIMESTAMPS = ['created_at', 'updated_at'] as const;

export const RETENTION_CLASSIFICATION: Readonly<Record<PatientChildTableName, RetentionTableRule>> = Object.freeze({
    entries: {
        category: {
            column: 'type',
            map: {
                ...Object.fromEntries(AMBULATORY_ENTRY_TYPES.map(type => [type, 'ambulatory_record' as const])),
                exam: 'diagnostic_report',
                hospitalization: 'hospital_record',
            },
            fallback: 'unclassified',
        },
        timestamps: ['date', 'created_at', 'updated_at'],
    },
    attachments: {
        category: { column: 'type', map: { 'application/dicom': 'imaging_iconography' }, fallback: 'attached_document' },
        timestamps: ['created_at', 'ocr_queue_updated_at'],
    },
    observations: { category: 'lab_report', timestamps: ['observed_at', 'created_at', 'updated_at'] },
    therapies: { category: 'prescription', timestamps: ['start_date', 'end_date', 'created_at', 'updated_at'] },
    servicePrescriptions: {
        category: 'prescription',
        timestamps: ['prescribed_at', 'scheduled_at', 'performed_at', 'report_received_at', 'created_at', 'updated_at'],
    },
    servicePrescriptionItems: {
        category: 'prescription',
        timestamps: ['scheduled_at', 'performed_at', 'report_received_at', 'created_at', 'updated_at'],
    },
    prostheticPrescriptions: { category: 'prescription', timestamps: ['prescribed_at', 'collaudo_at', 'created_at', 'updated_at'] },
    sissHandoffEvents: { category: 'prescription', timestamps: ['started_at', 'completed_at', 'created_at', 'updated_at'] },
    checkups: { category: 'ambulatory_record', timestamps: ['date', 'created_at', 'updated_at'] },
    documentDiagnosisProposals: { category: 'ambulatory_record', timestamps: ['decided_at', 'created_at', 'updated_at'] },
    patientsToAmbulatories: { category: 'ambulatory_record', timestamps: ['assigned_at'] },
});

export function classifyRetentionRow(table: PatientChildTableName, columnValue?: string | null): RetentionCategory {
    const rule = RETENTION_CLASSIFICATION[table].category;
    if (typeof rule === 'string') return rule;
    return (columnValue != null && Object.hasOwn(rule.map, columnValue)) ? rule.map[columnValue] : rule.fallback;
}

// --- Finestre del titolare ---

const windowSchema = z.union([
    z.object({ kind: z.literal('years'), years: z.number().int().min(1).max(RETENTION_MAX_YEARS) }).strict(),
    z.object({ kind: z.literal('unlimited') }).strict(),
]);
const windowsSchema = z.object(Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, windowSchema.optional()])) as
    Record<RetentionCategory, z.ZodOptional<typeof windowSchema>>).strict();
export const retentionWindowsDocumentSchema = z.object({
    schemaVersion: z.literal(RETENTION_SCHEMA),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    windows: windowsSchema,
}).strict();
export type RetentionWindowsDocument = z.infer<typeof retentionWindowsDocumentSchema>;

export class RetentionError extends Error {
    constructor(readonly code: 'input_invalid' | 'below_minimum' | 'configuration_error' | 'conflict' | 'not_found'
        | 'not_expired' | 'legal_hold' | 'expiry_changed') {
        super(code);
    }
}

export function parseRetentionWindows(input: unknown): RetentionWindows {
    const parsed = windowsSchema.safeParse(input);
    if (!parsed.success) throw new RetentionError('input_invalid');
    return Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)) as RetentionWindows;
}

/** Rifiuta ogni finestra che accorcerebbe il minimo del profilo attivo o che riguarda una categoria illimitata. */
export function assertWindowsRespectProfile(profileId: RetentionProfileId, windows: RetentionWindows): void {
    for (const [category, window] of Object.entries(windows) as [RetentionCategory, RetentionWindow][]) {
        const minimum = RETENTION_PROFILES[profileId].terms[category].term;
        if (minimum.kind === 'unlimited' && window.kind !== 'unlimited') throw new RetentionError('below_minimum');
        if (minimum.kind === 'years' && window.kind === 'years' && window.years < minimum.years) throw new RetentionError('below_minimum');
    }
}

/**
 * Finestre da inviare al salvataggio. Le categorie illimitate del profilo non sono modificabili.
 * Una finestra ereditata da un profilo precedente, rimasta com'era e non più lunga del minimo attuale,
 * non cambia nulla e resta fuori, così non blocca il salvataggio delle altre. Una finestra cambiata dal
 * titolare arriva sempre al server, che la rifiuta se è sotto il minimo.
 */
export function windowsForSave(profileId: RetentionProfileId, edited: RetentionWindows,
    stored: RetentionWindows): RetentionWindows {
    return Object.fromEntries((Object.entries(edited) as [RetentionCategory, RetentionWindow][]).filter(([category, window]) => {
        const minimum = RETENTION_PROFILES[profileId].terms[category].term;
        if (minimum.kind === 'unlimited') return false;
        const previous = stored[category];
        const unchanged = previous !== undefined && previous.kind === window.kind
            && (window.kind !== 'years' || (previous.kind === 'years' && previous.years === window.years));
        const noLongerThanMinimum = minimum.kind === 'years' && window.kind === 'years' && window.years <= minimum.years;
        return !(unchanged && noLongerThanMinimum);
    })) as RetentionWindows;
}

export type EffectiveTerm =
    | { kind: 'years'; years: number; origin: 'profile' | 'owner' }
    | { kind: 'unlimited'; origin: 'profile' | 'owner' }
    | { kind: 'unset' };

/**
 * Termine applicato: il massimo fra minimo del profilo e finestra del titolare.
 * Una finestra salvata sotto un profilo precedente non scende mai sotto il minimo attuale.
 */
export function effectiveRetentionTerm(profileId: RetentionProfileId, category: RetentionCategory,
    window: RetentionWindow | undefined): EffectiveTerm {
    const minimum = RETENTION_PROFILES[profileId].terms[category].term;
    if (minimum.kind === 'unlimited') return { kind: 'unlimited', origin: 'profile' };
    if (window?.kind === 'unlimited') return { kind: 'unlimited', origin: 'owner' };
    if (minimum.kind === 'years') {
        return window && window.years > minimum.years
            ? { kind: 'years', years: window.years, origin: 'owner' }
            : { kind: 'years', years: minimum.years, origin: 'profile' };
    }
    return window ? { kind: 'years', years: window.years, origin: 'owner' } : { kind: 'unset' };
}

// --- Blocchi per contenzioso o richiesta ---

export const RETENTION_HOLD_REASONS = ['litigation', 'access_request', 'inspection', 'other'] as const;
export type RetentionHoldReason = typeof RETENTION_HOLD_REASONS[number];
const holdSchema = z.object({
    id: z.string().uuid(),
    scope: z.enum(['patient', 'document']),
    patientId: z.string().min(1).max(200),
    attachmentId: z.string().min(1).max(200).nullable(),
    reason: z.enum(RETENTION_HOLD_REASONS),
    placedAt: z.number().int().positive(),
    placedBy: z.string().min(1).max(200),
}).strict().refine(hold => (hold.scope === 'document') === (hold.attachmentId !== null));
export type RetentionHold = z.infer<typeof holdSchema>;
export const retentionHoldsDocumentSchema = z.object({
    schemaVersion: z.literal(RETENTION_SCHEMA),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    holds: z.array(holdSchema).max(RETENTION_MAX_HOLDS),
}).strict();
export type RetentionHoldsDocument = z.infer<typeof retentionHoldsDocumentSchema>;

// --- Valutazione del fascicolo ---

export type FascicoloFacts = {
    patientId: string;
    version: number;
    archived: boolean;
    deleted: boolean;
    /** Stima per eccesso della chiusura (secondi unix); null se non ricavabile. */
    closureEstimate: number | null;
    categories: readonly RetentionCategory[];
};

export type FascicoloStatus = 'deleted' | 'open' | 'held' | 'closure_unknown' | 'unlimited' | 'unset' | 'in_retention' | 'expired';
export type FascicoloEvaluation = {
    patientId: string;
    version: number;
    status: FascicoloStatus;
    /** Scadenza in secondi unix, quando il termine è finito. */
    expiresAt: number | null;
    closureEstimate: number | null;
    /** Categoria che determina il termine (il più lungo o quello che impedisce lo scarto). */
    governing: { category: RetentionCategory; term: EffectiveTerm; sourceId: RetentionSourceId | null } | null;
    holdIds: string[];
};

export function addCalendarYears(unixSeconds: number, count: number): number {
    const date = new Date(unixSeconds * 1000);
    date.setUTCFullYear(date.getUTCFullYear() + count);
    return Math.floor(date.getTime() / 1000);
}

/**
 * Il termine decorre dalla chiusura del fascicolo per tutte le categorie: è l'evento
 * indicato dal massimario per il fascicolo ambulatoriale ed è la scelta più
 * conservativa dove la fonte non indica l'evento. Una sola categoria illimitata,
 * o senza finestra, rende il fascicolo non scartabile.
 */
export function evaluateFascicolo(facts: FascicoloFacts, profileId: RetentionProfileId, windows: RetentionWindows,
    holds: readonly RetentionHold[], nowSeconds: number): FascicoloEvaluation {
    const base = { patientId: facts.patientId, version: facts.version, closureEstimate: facts.closureEstimate };
    const holdIds = holds.filter(hold => hold.patientId === facts.patientId).map(hold => hold.id);
    const result = (status: FascicoloStatus, expiresAt: number | null = null,
        governing: FascicoloEvaluation['governing'] = null): FascicoloEvaluation => ({ ...base, status, expiresAt, governing, holdIds });
    if (facts.deleted) return result('deleted');
    if (!facts.archived) return result('open');

    const categories = [...new Set<RetentionCategory>([RETENTION_PATIENT_ROW_CATEGORY, ...facts.categories])];
    let governing: NonNullable<FascicoloEvaluation['governing']> | null = null;
    let blocking: NonNullable<FascicoloEvaluation['governing']> | null = null;
    for (const category of categories) {
        const term = effectiveRetentionTerm(profileId, category, windows[category]);
        const entry = { category, term, sourceId: RETENTION_PROFILES[profileId].terms[category].sourceId };
        if (term.kind === 'unlimited') { blocking = entry; break; }
        if (term.kind === 'unset') { blocking ??= entry; continue; }
        if (!governing || (governing.term.kind === 'years' && term.years > governing.term.years)) governing = entry;
    }
    const expiresAt = !blocking && governing?.term.kind === 'years' && facts.closureEstimate !== null
        ? addCalendarYears(facts.closureEstimate, governing.term.years) : null;
    const shown = blocking ?? governing;
    if (holdIds.length > 0) return result('held', expiresAt, shown);
    if (blocking) return result(blocking.term.kind === 'unlimited' ? 'unlimited' : 'unset', null, blocking);
    if (facts.closureEstimate === null || expiresAt === null) return result('closure_unknown', null, governing);
    return result(nowSeconds >= expiresAt ? 'expired' : 'in_retention', expiresAt, governing);
}

/** Etichetta compatta del termine per l'audit, es. `P10Y`, `unlimited`, `unset`. */
export function retentionTermToken(term: EffectiveTerm): string {
    return term.kind === 'years' ? `P${term.years}Y` : term.kind;
}
