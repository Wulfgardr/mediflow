'use client';

import { db, type Patient } from './db';
import { isClinicalRichTextHtml, sanitizeClinicalRichTextHtml } from './clinical-rich-text';
import { cassetteItems } from './agent-cassette-contract';
import { agentBytes } from './agent-cassette-crypto';
import { openAgentVisit, type OpenedAgentVisit } from './agent-cassette-client';
import { reviewedAgentApplicationSchema, agentItemDecisionSchema, agentStructuredKind, type ReviewedAgentApplicationInput, type AgentCassetteIndexEntry, type IncomingAgentCassette, type NewAgentPatient,
    type AgentItemDecisionInput } from './agent-visit-application-contract';
import { collectDossierTaxCodes, excludedProfessionalCode } from './domain/documents/dossier-import';
import { reviewAgentFact } from './agent-visit-facts';
import { servicePrescriptionCreateSchema } from './api-schemas/prescriptions';
import { birthDateMatchesTaxCode, isValidItalianTaxCode } from './patient-identity';
import { PreviewError } from '../components/document-viewer-policy';
import { agentVisitPdfText, type AgentVisitPdf } from './agent-visit-pdf-text';

export type AgentVisitDocument = AgentVisitPdf & { id: string; name: string; hash: string };
export type AgentVisitReview = { visit: Omit<OpenedAgentVisit, 'cassette'> & { cassette: AgentCassetteIndexEntry }; patient: Patient | null; newPatient: NewAgentPatient | null;
    documents: AgentVisitDocument[]; appliedItemIds: string[]; discardedItemIds: string[]; correctedItemIds: string[]; currentSummary: Map<string, string>; blockers: string[]; proposalBlockers: string[];
    itemBlockers: Map<string, string[]> };
type ReviewItem = AgentVisitReview['visit']['items'][number];
export const agentItemDecided = (review: Pick<AgentVisitReview, 'appliedItemIds' | 'discardedItemIds'>, itemId: string) =>
    review.appliedItemIds.includes(itemId) || review.discardedItemIds.includes(itemId);
const proposalLabels: Record<string, string> = { therapy: 'la terapia', service: 'la prestazione', diagnosis: 'la diagnosi', exemption: 'l’esenzione', observation: 'l’osservazione' };
const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const normalized = (value: string) => value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('it-IT');
function sourceHash(item: OpenedAgentVisit['items'][number]): string {
    const source = item.value.source;
    return source && typeof source === 'object' && !Array.isArray(source) ? text((source as Record<string, unknown>).sha256) : '';
}
function values(item: OpenedAgentVisit['items'][number]): Record<string, string> {
    const value = item.value.values;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(field => typeof field !== 'string')) throw new Error('Proposta non leggibile.');
    return value as Record<string, string>;
}

function documentedBirthDates(text: string): string[] {
    return [...text.matchAll(/\bdata\s+(?:di\s+)?nascita\s*[:.]?\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/giu)]
        .map(([, day, month, year]) => year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0'));
}

export async function inspectAgentVisit(row: IncomingAgentCassette, patients: Patient[], physicianTaxCode: string | null, signal: AbortSignal,
    readPdf = agentVisitPdfText, ambulatoryId?: string): Promise<AgentVisitReview> {
    const visit = await openAgentVisit(row);
    signal.throwIfAborted();
    const cf = text(visit.anchor.fiscalCode);
    const physician = physicianTaxCode?.trim().toUpperCase();
    const blockers: string[] = [], proposalBlockers: string[] = [];
    const validCf = cf === cf.toUpperCase() && cf !== physician && isValidItalianTaxCode(cf);
    const matches = validCf ? patients.filter(patient => !patient.deletedAt && (patient.identifierType ?? 'cf') === 'cf'
        && patient.taxCode.trim().toUpperCase() === cf) : [];
    const patient = matches.length === 1 && !matches[0].isArchived ? matches[0] : null;
    if (!validCf) blockers.push('Controlla il codice fiscale della visita.');
    else if (matches.length > 1) blockers.push('Più schede hanno questo codice fiscale.');
    else if (matches[0]?.isArchived) blockers.push('La scheda con questo codice fiscale è archiviata.');
    else if (!patient && !ambulatoryId) blockers.push('Nessuna scheda attiva con questo codice fiscale nell’ambulatorio selezionato.');
    else if (patient && !patient.version) blockers.push('Aggiorna la scheda prima di applicare la visita.');
    const documents = new Map<string, AgentVisitDocument>();
    const deposited = cassetteItems(row);
    for (const item of visit.items.filter(item => item.kind === 'pdf')) {
        const bytes = agentBytes(text(item.value.base64));
        const name = text(item.value.name);
        try {
            const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
            if (hash !== deposited.find(value => value.id === item.id)?.documentHash) throw new Error('AGENT_PDF_HASH_MISMATCH');
            const read = await readPdf(bytes, signal);
            signal.throwIfAborted();
            documents.set(hash, { ...read, id: item.id, name, hash });
            const codes = collectDossierTaxCodes(read.text);
            const patientCodes = [...new Set(codes.filter(code => code.checksumValid && !excludedProfessionalCode(code)
                && (code.value !== physician || code.role === 'patient_cf')).map(code => code.value))];
            if (patientCodes.length !== 1 || patientCodes[0] !== cf) {
                blockers.push('Identità da verificare nel PDF ' + name + (patientCodes.length ? ': ' + patientCodes.join(', ') : '.'));
            }
        } catch (error) {
            if (signal.aborted) throw error;
            const reason = error instanceof PreviewError ? error.message : error instanceof Error ? ({
                AGENT_PDF_HASH_MISMATCH: 'Il file è cambiato.',
                AGENT_PDF_NO_TEXT: 'Una pagina è disponibile solo come immagine.',
                AGENT_PDF_LIMIT: 'Il file supera i limiti di lettura.',
                AGENT_PDF_PASSWORD: 'Il file è protetto da password.',
            }[error.message]) : undefined;
            blockers.push('PDF non verificabile: ' + name + (reason ? '. ' + reason : ''));
        } finally { bytes.fill(0); }
    }
    if (documents.size === 0 && !visit.items.some(item => item.kind === 'pdf')) blockers.push('Manca un PDF con il codice fiscale del paziente.');
    let newPatient: NewAgentPatient | null = null;
    if (!patient && ambulatoryId && !blockers.length) {
        const dates = [...new Set([...documents.values()].flatMap(doc => documentedBirthDates(doc.text)))];
        if (dates.length > 1 || dates[0] && !birthDateMatchesTaxCode(cf, dates[0])) blockers.push('Controlla la data di nascita nei PDF.');
        else newPatient = { ambulatoryId, taxCode: cf, birthDate: dates[0] ?? null };
    }
    const discardedItemIds = row.discardedItemIds ?? [];
    const itemBlockers = new Map<string, string[]>();
    for (const item of visit.items) {
        if (item.kind === 'note' || item.kind === 'transcription' || item.kind === 'pdf') continue;
        if (row.appliedItemIds.includes(item.id) || discardedItemIds.includes(item.id)) continue;
        const source = documents.get(sourceHash(item));
        const kind = item.kind === 'service' ? 'service_prescription' : item.kind;
        const fact = source && reviewAgentFact(kind, values(item), source.text, text(item.value.quote));
        const found = fact ? fact.blockers : ['Fonte da verificare per ' + (proposalLabels[item.kind] ?? 'questa proposta') + '.'];
        if (fact) item.value.values = fact.values;
        if (found.length) itemBlockers.set(item.id, found);
        proposalBlockers.push(...found);
    }
    const currentSummary = new Map<string, string>();
    if (patient) {
        const [therapies, services, observations] = await Promise.all([
            visit.items.some(item => item.kind === 'therapy') ? db.therapies.query({ patientId: patient.id }).toArray({ signal, rejectAuthUnavailable: true }) : [],
            visit.items.some(item => item.kind === 'service') ? db.servicePrescriptions.query({ patientId: patient.id }).toArray({ signal, rejectAuthUnavailable: true }) : [],
            visit.items.some(item => item.kind === 'observation') ? db.observations.query({ patientId: patient.id }).toArray({ signal, rejectAuthUnavailable: true }) : [],
        ]);
        const status = (value: string) => ({ active: 'in corso', suspended: 'sospesa', completed: 'conclusa', prescribed: 'prescritta', booked: 'prenotata', performed: 'eseguita', report_received: 'referto ricevuto', cancelled: 'annullata' }[value] ?? value);
        for (const item of visit.items.filter(item => agentStructuredKind(item.kind))) {
            const value = values(item);
            let before: string[] = [];
            if (item.kind === 'therapy') before = therapies.filter(stored => !stored.deletedAt && normalized(stored.drugName) === normalized(value.drugName ?? '')).map(stored => stored.drugName + ': ' + stored.dosage + ' (' + status(stored.status) + ')');
            if (item.kind === 'service') before = services.filter(stored => normalized(stored.serviceName) === normalized(value.serviceName ?? '')).map(stored => stored.serviceName + ' (' + status(stored.status) + ')');
            if (item.kind === 'observation') before = observations.filter(stored => !stored.deletedAt && stored.code === value.code).map(stored => stored.display + ': ' + stored.value + ' ' + stored.unitCode);
            if (item.kind === 'diagnosis') before = (patient.diagnoses ?? []).filter(stored => stored.code === value.code && stored.system === value.system).map(stored => stored.code + ' ' + stored.description);
            if (item.kind === 'exemption') before = (patient.exemptions ?? []).filter(code => code === value.code);
            currentSummary.set(item.id, before.join('; ') || 'Non presente');
        }
    }
    return { visit, patient, newPatient, documents: [...documents.values()], appliedItemIds: row.appliedItemIds, discardedItemIds, correctedItemIds: row.correctedItemIds ?? [], currentSummary, blockers, proposalBlockers, itemBlockers };
}
export async function reopenReviewedAgentItems(review: AgentVisitReview, row: IncomingAgentCassette): Promise<AgentVisitReview['visit']['items'] | null> {
    const visit = await openAgentVisit(row);
    const deposited = cassetteItems(row);
    if (visit.items.length !== review.visit.items.length
        || visit.items.some((item, index) => item.id !== review.visit.items[index]!.id || item.kind !== review.visit.items[index]!.kind)) return null;
    for (const item of visit.items.filter(item => item.kind === 'pdf')) {
        const bytes = agentBytes(text(item.value.base64));
        try {
            if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== deposited.find(value => value.id === item.id)?.documentHash) return null;
        } finally { bytes.fill(0); }
    }
    return visit.items.map((item, index) => item.kind === 'pdf' ? item : review.visit.items[index]!);
}
export function agentVisitAwaitsReview(review: AgentVisitReview): boolean {
    return review.visit.cassette.status === 'closed' && Boolean(review.patient?.version || review.newPatient) && !review.blockers.length && !review.proposalBlockers.length
        && review.visit.items.some(item => !agentItemDecided(review, item.id));
}
export function agentItemAwaitsDecision(review: AgentVisitReview, itemId: string): boolean {
    return review.visit.cassette.status === 'closed' && Boolean(review.patient?.version) && !review.newPatient && !review.blockers.length
        && review.visit.items.some(item => item.id === itemId) && !agentItemDecided(review, itemId);
}

export async function prepareAgentApplication(review: AgentVisitReview, signal: AbortSignal): Promise<ReviewedAgentApplicationInput | null> {
    if (!agentVisitAwaitsReview(review)) return null;
    const patient = review.patient ? await db.patients.get(review.patient.id, { signal }) : null;
    if (review.patient && (!patient || patient.deletedAt || patient.isArchived
        || patient.taxCode.trim().toUpperCase() !== review.visit.anchor.fiscalCode || !patient.version)) return null;
    if (patient && patient.version !== review.patient?.version) throw new Error('La scheda è cambiata. Rileggi le differenze prima di applicare la visita.');
    const selected = review.visit.items.filter(item => !agentItemDecided(review, item.id));
    const profile = withProposedProfile(patient, selected);
    const prepared: unknown[] = [];
    for (const item of selected) {
        signal.throwIfAborted();
        prepared.push(await prepareAgentItem(review, item, profile));
    }
    signal.throwIfAborted();
    return reviewedAgentApplicationSchema.parse({ visitId: review.visit.cassette.id, phase: 'review',
        patientId: patient?.id ?? review.visit.cassette.id, expectedVersion: patient?.version ?? 1,
        ...(review.newPatient ? { newPatient: review.newPatient } : {}),
        cassetteRevision: review.visit.cassette.revision, items: prepared });
}

type ProposedProfile = { diagnoses: NonNullable<Patient['diagnoses']>; exemptions: string[] };
function withProposedProfile(patient: Patient | null | undefined, items: ReviewItem[]): ProposedProfile {
    const diagnoses = [...(patient?.diagnoses ?? [])], exemptions = [...(patient?.exemptions ?? [])];
    for (const item of items) {
        if (item.kind === 'diagnosis') {
            const value = values(item);
            const code = value.code ?? '', system = value.system ?? '';
            if (!diagnoses.some(stored => code ? stored.code === code && stored.system === system
                : !stored.code && normalized(stored.description) === normalized(value.description))) {
                diagnoses.push({ code, system, description: value.description, date: new Date(value.date) });
            }
        }
        if (item.kind === 'exemption') { const value = values(item); if (!exemptions.includes(value.code)) exemptions.push(value.code); }
    }
    return { diagnoses, exemptions };
}

async function prepareAgentItem(review: AgentVisitReview, item: ReviewItem, profile: ProposedProfile, corrected = false): Promise<unknown> {
    const provenance = { visitId: review.visit.cassette.id, source: item.value.source, quote: item.value.quote, ...(corrected ? { corrected: true } : {}) };
    const base = { id: item.id, kind: item.kind };
    switch (item.kind) {
        case 'note': case 'transcription': {
            const original = typeof item.value.text === 'string' ? item.value.text : '';
            const content = isClinicalRichTextHtml(original) ? sanitizeClinicalRichTextHtml(original) : original;
            if (!content.trim()) throw new Error('Nota vuota.');
            const title = item.kind === 'note' ? 'Visita' : 'Trascrizione della visita';
            const metadata = { sourceLabel: 'Cassetta della visita', provenance };
            return { ...base, values: {
                title: await db.sealLocalDraft(title), content: await db.sealLocalDraft(content),
                metadata: await db.sealLocalDraft(metadata), date: text(item.value.date) || new Date(review.visit.cassette.depositedAt).toISOString(),
            } };
        }
        case 'pdf': {
            const bytes = agentBytes(text(item.value.base64));
            try {
                const sealed = await db.sealPatientDocumentSource(bytes, text(item.value.name));
                sealed.fileKey.fill(0);
                return { ...base, values: { name: sealed.name, data: sealed.data, size: bytes.length } };
            } finally { bytes.fill(0); }
        }
        case 'therapy': {
            const value = values(item);
            const status = value.status;
            if (status !== 'active' && status !== 'suspended' && status !== 'completed') throw new Error('Stato della terapia da verificare.');
            const data = await db.therapies.prepareWritePayload({ drugName: value.drugName, activePrinciple: value.activePrinciple || undefined,
                aic: value.aic || undefined, atc: value.atc || undefined, dosage: value.dosage, status, startDate: new Date(value.startDate),
                endDate: value.endDate ? new Date(value.endDate) : null, motivation: JSON.stringify(provenance) });
            return { ...base, values: data };
        }
        case 'service': {
            const value = values(item);
            const data = await db.servicePrescriptions.prepareWritePayload({ serviceName: value.serviceName, prescribedAt: new Date(value.prescribedAt),
                category: servicePrescriptionCreateSchema.shape.category.parse(value.category), priority: servicePrescriptionCreateSchema.shape.priority.parse(value.priority || undefined),
                clinicalQuestion: value.clinicalQuestion || undefined, requestReference: value.requestReference || undefined,
                source: 'document_review', documentRefs: JSON.stringify(provenance) });
            const lineItems = await Promise.all((value.items ?? '').split('\n').map(line => line.trim()).filter(Boolean).map(async serviceName => ({ serviceName: await db.sealLocalDraft(serviceName) })));
            return { ...base, values: { ...data, lineItems } };
        }
        case 'diagnosis': return { ...base, values: { diagnoses: await db.sealLocalDraft(profile.diagnoses) } };
        case 'exemption': return { ...base, values: { exemptions: await db.sealLocalDraft(profile.exemptions) } };
        case 'observation': {
            const value = values(item);
            return { ...base, values: { codeSystem: 'LOINC', code: value.code, display: value.display, value: value.value,
                unitSystem: 'UCUM', unitCode: value.unitCode, observedAt: value.observedAt, refLow: value.refLow || null, refHigh: value.refHigh || null, refText: value.refText || null, notes: await db.sealLocalDraft(provenance) } };
        }
    }
    throw new Error('Proposta non leggibile.');
}

export const AGENT_CORRECTABLE_FIELDS = {
    therapy: ['drugName', 'activePrinciple', 'dosage', 'status', 'startDate', 'endDate'],
    observation: ['value', 'unitCode', 'observedAt', 'refText'],
    diagnosis: ['description', 'code', 'system', 'date'],
} as const satisfies Partial<Record<ReviewItem['kind'], readonly string[]>>;
export type AgentCorrectableKind = keyof typeof AGENT_CORRECTABLE_FIELDS;
export const agentItemCorrectable = (kind: string): kind is AgentCorrectableKind => kind in AGENT_CORRECTABLE_FIELDS;

export async function prepareAgentItemDecision(review: AgentVisitReview, itemId: string, decision: 'keep' | 'correct' | 'discard',
    signal: AbortSignal, correction: Record<string, string> = {}): Promise<AgentItemDecisionInput | null> {
    if (!agentItemAwaitsDecision(review, itemId)) return null;
    const original = review.visit.items.find(item => item.id === itemId);
    if (!original) return null;
    const target = { visitId: review.visit.cassette.id, cassetteRevision: review.visit.cassette.revision };
    if (decision === 'discard') return agentItemDecisionSchema.parse({ ...target, decision, itemId, kind: original.kind });
    if (decision === 'keep' && review.itemBlockers.get(itemId)?.length) return null;
    if (decision === 'correct' && !agentItemCorrectable(original.kind)) return null;
    const patient = await db.patients.get(review.patient!.id, { signal });
    if (!patient || patient.deletedAt || patient.isArchived || patient.taxCode.trim().toUpperCase() !== review.visit.anchor.fiscalCode || !patient.version) return null;
    if (patient.version !== review.patient!.version) throw new Error('La scheda è cambiata. Rileggi la voce prima di decidere.');
    const allowed: readonly string[] = agentItemCorrectable(original.kind) ? AGENT_CORRECTABLE_FIELDS[original.kind] : [];
    const changed = Object.fromEntries(Object.entries(correction).filter(([field]) => allowed.includes(field)).map(([field, value]) => [field, value.trim()]));
    const item = decision === 'correct' ? { ...original, value: { ...original.value, values: { ...values(original), ...changed } } } : original;
    const profile = withProposedProfile(patient, [item]);
    const prepared = await prepareAgentItem(review, item, profile, decision === 'correct');
    signal.throwIfAborted();
    return agentItemDecisionSchema.parse({ ...target, decision, patientId: patient.id, expectedVersion: patient.version, item: prepared });
}
