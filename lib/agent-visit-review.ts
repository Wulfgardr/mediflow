'use client';

import { db, type Patient } from './db';
import { isClinicalRichTextBlank, isClinicalRichTextHtml, sanitizeClinicalRichTextHtml } from './clinical-rich-text';
import { cassetteItems } from './agent-cassette-contract';
import { agentBytes } from './agent-cassette-crypto';
import { openAgentVisit, type OpenedAgentVisit } from './agent-cassette-client';
import { newAgentPatientSchema, reviewedAgentApplicationSchema, agentItemDecisionSchema, agentStructuredKind, type ReviewedAgentApplicationInput, type AgentCassetteIndexEntry, type IncomingAgentCassette, type NewAgentPatient,
    type AgentItemDecisionInput, type AgentItemDecision, type AgentCassetteReviewBlock } from './agent-visit-application-contract';
import { collectDossierTaxCodes, excludedProfessionalCode } from './domain/documents/dossier-import';
import { reviewAgentFact } from './agent-visit-facts';
import { servicePrescriptionCreateSchema } from './api-schemas/prescriptions';
import { birthDateMatchesTaxCode, isValidItalianTaxCode } from './patient-identity';
import { PreviewError } from '../components/document-viewer-policy';
import { agentVisitPdfText, type AgentVisitPdf } from './agent-visit-pdf-text';

export type AgentVisitDocument = AgentVisitPdf & { id: string; name: string; hash: string };
export type AgentVisitReview = { visit: Omit<OpenedAgentVisit, 'cassette'> & { cassette: AgentCassetteIndexEntry }; patient: Patient | null; newPatient: NewAgentPatientReview | null;
    documents: AgentVisitDocument[]; appliedItemIds: string[]; discardedItemIds: string[]; correctedItemIds: string[]; currentSummary: Map<string, string>; blockers: string[]; proposalBlockers: string[];
    itemBlockers: Map<string, string[]>; itemNeeds: Map<string, AgentPhysicianField[]>; inRecordItemIds: string[]; reviewBlock?: AgentCassetteReviewBlock };
type PdfIdentity = { name: string; codes: string[] };
export type AgentPatientIdentity = Pick<NewAgentPatient, 'taxCode' | 'firstName' | 'lastName'>;
type NewAgentPatientReview = {
    proposed: AgentPatientIdentity;
    ambulatoryId: string;
    birthDate: string | null;
    physicianTaxCode: string | undefined;
    pdfIdentities: PdfIdentity[];
};

function pdfIdentityBlock({ name, codes }: PdfIdentity, taxCode: string): string | undefined {
    if (codes.length === 1 && codes[0] === taxCode) return;
    return 'Identità da verificare nel PDF ' + name + (codes.length ? ': ' + codes.join(', ') : '.');
}

export function newAgentPatientBlock(review: NewAgentPatientReview, identity: AgentPatientIdentity): string | undefined {
    const taxCode = identity.taxCode.trim().toUpperCase();
    if (taxCode === review.physicianTaxCode || !isValidItalianTaxCode(taxCode)) return 'Controlla il codice fiscale della visita.';
    for (const pdf of review.pdfIdentities) {
        const block = pdfIdentityBlock(pdf, taxCode);
        if (block) return block;
    }
    if (review.birthDate && !birthDateMatchesTaxCode(taxCode, review.birthDate)) return 'Controlla la data di nascita nei PDF.';
    if (!identity.firstName.trim() || !identity.lastName.trim()) return 'Inserisci nome e cognome per creare la scheda.';
}

export const AGENT_THERAPY_STATUSES = ['active', 'suspended', 'completed'] as const;
const AGENT_PHYSICIAN_FIELD_VALUES = { status: AGENT_THERAPY_STATUSES } as const;
export type AgentPhysicianField = keyof typeof AGENT_PHYSICIAN_FIELD_VALUES;
export const AGENT_THERAPY_STATUS_NEEDED = 'Il documento non indica lo stato della terapia.';
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
    const closed = row.status === 'closed';
    if (!closed) blockers.push('Il deposito della visita non è concluso.');
    if (row.reviewBlock === 'agent_revoked') blockers.push('L’accesso dell’agente che ha depositato la visita è stato revocato.');
    if (row.reviewBlock === 'deposit_unverified') blockers.push('Non è stato possibile verificare l’autorizzazione al deposito.');
    const createsPatient = !matches.length && Boolean(ambulatoryId);
    if (!validCf && !createsPatient) blockers.push('Controlla il codice fiscale della visita.');
    else if (matches.length > 1) blockers.push('Più schede hanno questo codice fiscale.');
    else if (matches[0]?.isArchived) blockers.push('La scheda con questo codice fiscale è archiviata.');
    else if (!patient && !ambulatoryId) blockers.push('Nessuna scheda attiva con questo codice fiscale nell’ambulatorio selezionato.');
    else if (patient && !patient.version) blockers.push('Aggiorna la scheda prima di applicare la visita.');
    const documents = new Map<string, AgentVisitDocument>();
    const pdfIdentities: PdfIdentity[] = [];
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
            const identity = { name, codes: patientCodes };
            pdfIdentities.push(identity);
            const block = pdfIdentityBlock(identity, cf);
            if (!createsPatient && block) blockers.push(block);
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
    const discardedItemIds = row.discardedItemIds ?? [];
    if (closed && !visit.items.some(item => item.kind === 'pdf' || item.kind === 'note' || item.kind === 'transcription')) {
        blockers.push('Manca una nota, una trascrizione o un PDF.');
    }
    let newPatient: NewAgentPatientReview | null = null;
    const partlyDecided = row.appliedItemIds.length > 0 || discardedItemIds.length > 0;
    if (closed && createsPatient && partlyDecided) {
        blockers.push('Per completare una visita già decisa in parte, serve la scheda del paziente.');
    }
    if (closed && createsPatient && ambulatoryId && !partlyDecided) {
        const dates = [...new Set([...documents.values()].flatMap(doc => documentedBirthDates(doc.text)))];
        if (dates.length > 1) blockers.push('Controlla la data di nascita nei PDF.');
        newPatient = {
            proposed: { taxCode: cf, firstName: text(visit.anchor.firstName).slice(0, 120), lastName: text(visit.anchor.lastName).slice(0, 120) },
            ambulatoryId, birthDate: dates[0] ?? null, physicianTaxCode: physician, pdfIdentities,
        };
    }
    const itemBlockers = new Map<string, string[]>();
    const itemNeeds = new Map<string, AgentPhysicianField[]>();
    for (const item of visit.items) {
        if (row.appliedItemIds.includes(item.id) || discardedItemIds.includes(item.id) || item.kind === 'pdf') continue;
        if (item.kind === 'note' || item.kind === 'transcription') {
            if (!visitTextContent(item)) {
                const reason = item.kind === 'note' ? 'La nota è vuota.' : 'La trascrizione è vuota.';
                itemBlockers.set(item.id, [reason]);
                proposalBlockers.push(reason);
            }
            continue;
        }
        const source = documents.get(sourceHash(item));
        const kind = item.kind === 'service' ? 'service_prescription' : item.kind;
        const fact = source && reviewAgentFact(kind, values(item), source.text, text(item.value.quote));
        const found = fact ? fact.blockers : ['Fonte da verificare per ' + (proposalLabels[item.kind] ?? 'questa proposta') + '.'];
        if (fact) item.value.values = fact.values;
        if (found.length) itemBlockers.set(item.id, found);
        if (fact && fact.askPhysician.length) {
            itemNeeds.set(item.id, fact.askPhysician.filter((field): field is AgentPhysicianField => field in AGENT_PHYSICIAN_FIELD_VALUES));
            proposalBlockers.push(AGENT_THERAPY_STATUS_NEEDED);
        }
        proposalBlockers.push(...found);
    }
    const currentSummary = new Map<string, string>();
    const inRecordItemIds = patient ? visit.items.filter(item => !row.appliedItemIds.includes(item.id) && !discardedItemIds.includes(item.id)
        && agentItemAlreadyInRecord(patient, item)).map(item => item.id) : [];
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
    return { visit, patient, newPatient, documents: [...documents.values()], appliedItemIds: row.appliedItemIds, discardedItemIds, correctedItemIds: row.correctedItemIds ?? [], currentSummary, blockers, proposalBlockers, itemBlockers, itemNeeds, inRecordItemIds, ...(row.reviewBlock ? { reviewBlock: row.reviewBlock } : {}) };
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
export type DraftAgentItemDecision = { decision: AgentItemDecision; correction?: Record<string, string> };
export type DraftAgentVisitDecisions = Partial<Record<string, DraftAgentItemDecision>>;

export type AgentPhysicianChoices = Partial<Record<string, Record<string, string>>>;

export function agentVisitItemsBlock(review: AgentVisitReview, drafts: DraftAgentVisitDecisions, choices: AgentPhysicianChoices): string | undefined {
    const pendingDrafts = review.newPatient ? drafts : {};
    const retained = review.visit.items.filter(item => !agentItemDecided(review, item.id) && pendingDrafts[item.id]?.decision !== 'discard');
    if (review.newPatient && !retained.some(item => !agentStructuredKind(item.kind))) {
        return 'Tieni una nota, una trascrizione o un PDF per creare la scheda.';
    }
    if (retained.some(item => {
        const draft = pendingDrafts[item.id];
        if (draft?.decision === 'correct') return false;
        return review.itemBlockers.has(item.id)
            || suppliedPhysicianValues(review.itemNeeds.get(item.id) ?? [], draft?.correction ?? choices[item.id] ?? {}) === null;
    })) return 'Decidi prima le voci segnate.';
}

export function agentVisitAwaitsReview(review: AgentVisitReview, identity?: AgentPatientIdentity, drafts: DraftAgentVisitDecisions = {},
    choices: AgentPhysicianChoices = {}): boolean {
    const patientReady = review.newPatient ? identity && !newAgentPatientBlock(review.newPatient, identity) : !identity && review.patient?.version;
    return review.visit.cassette.status === 'closed' && Boolean(patientReady) && !review.blockers.length
        && !agentVisitItemsBlock(review, drafts, choices) && review.visit.items.some(item => !agentItemDecided(review, item.id));
}

export function agentItemAwaitsDecision(review: AgentVisitReview, itemId: string): boolean {
    return review.visit.cassette.status === 'closed' && review.visit.items.some(item => item.id === itemId) && !agentItemDecided(review, itemId);
}

export function agentItemCanWrite(review: AgentVisitReview): boolean {
    return !review.blockers.length && Boolean(review.newPatient || review.patient?.version);
}

export function agentItemDiscardAdmitted(review: AgentVisitReview): boolean {
    return !review.reviewBlock && Boolean(review.newPatient || review.patient);
}

export async function prepareAgentApplication(review: AgentVisitReview, signal: AbortSignal, identity?: AgentPatientIdentity,
    drafts: DraftAgentVisitDecisions = {}, choices: AgentPhysicianChoices = {}): Promise<ReviewedAgentApplicationInput | null> {
    if (!agentVisitAwaitsReview(review, identity, drafts, choices)) return null;
    const newPatient = identity && review.newPatient && newAgentPatientSchema.parse({
        ...identity, ambulatoryId: review.newPatient.ambulatoryId, birthDate: review.newPatient.birthDate,
    });
    const patient = review.patient ? await db.patients.get(review.patient.id, { signal }) : null;
    if (review.patient && (!patient || patient.deletedAt || patient.isArchived
        || patient.taxCode.trim().toUpperCase() !== review.visit.anchor.fiscalCode || !patient.version)) return null;
    if (patient && patient.version !== review.patient?.version) throw new Error('La scheda è cambiata. Rileggi le differenze prima di applicare la visita.');
    const selected: Array<{ item: ReviewItem; corrected: boolean; needs: readonly AgentPhysicianField[] }> = [];
    const decisions: Array<{ itemId: string; decision: AgentItemDecision }> = [];
    for (const item of review.visit.items.filter(item => !agentItemDecided(review, item.id))) {
        const draft = newPatient ? drafts[item.id] : undefined;
        if (draft) decisions.push({ itemId: item.id, decision: draft.decision });
        if (draft?.decision === 'discard') continue;
        const planned = agentItemForDecision(review, item, draft?.decision ?? 'keep', draft?.correction ?? choices[item.id] ?? {});
        if (!planned) return null;
        selected.push(planned);
    }
    const profile = withProposedProfile(patient, selected.map(({ item }) => item));
    const prepared: unknown[] = [];
    for (const { item, corrected, needs } of selected) {
        signal.throwIfAborted();
        prepared.push(await prepareAgentItem(review, item, profile, corrected, needs));
    }
    signal.throwIfAborted();
    return reviewedAgentApplicationSchema.parse({ visitId: review.visit.cassette.id, phase: 'review',
        patientId: patient?.id ?? review.visit.cassette.id, expectedVersion: patient?.version ?? 1,
        ...(newPatient ? { newPatient } : {}),
        ...(decisions.length ? { decisions } : {}),
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

function visitTextContent(item: ReviewItem): string {
    const original = typeof item.value.text === 'string' ? item.value.text : '';
    const content = isClinicalRichTextHtml(original) ? sanitizeClinicalRichTextHtml(original) : original;
    return isClinicalRichTextBlank(content) ? '' : content;
}

async function prepareAgentItem(review: AgentVisitReview, item: ReviewItem, profile: ProposedProfile, corrected = false, physicianFields: readonly AgentPhysicianField[] = []): Promise<unknown> {
    const provenance = { visitId: review.visit.cassette.id, source: item.value.source, quote: item.value.quote, ...(corrected ? { corrected: true } : {}),
        ...(physicianFields.length ? { physicianFields } : {}) };
    const base = { id: item.id, kind: item.kind };
    switch (item.kind) {
        case 'note': case 'transcription': {
            const content = visitTextContent(item);
            if (!content) throw new Error('Nota vuota.');
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

const DRUG_IDENTITY_FIELDS = ['drugName', 'activePrinciple'] as const;
const DRUG_CODE_FIELDS = ['aic', 'atc'] as const;
export function agentCorrectionDropsDrugCodes(item: ReviewItem, correction: Record<string, string>): boolean {
    if (item.kind !== 'therapy') return false;
    const deposited = values(item);
    return DRUG_CODE_FIELDS.some(field => deposited[field])
        && DRUG_IDENTITY_FIELDS.some(field => field in correction && normalized(correction[field] ?? '') !== normalized(deposited[field] ?? ''));
}
function correctedValues(item: ReviewItem, correction: Record<string, string>): Record<string, string> {
    const corrected = { ...values(item), ...correction };
    if (agentCorrectionDropsDrugCodes(item, correction)) for (const field of DRUG_CODE_FIELDS) delete corrected[field];
    return corrected;
}
export function agentItemAlreadyInRecord(patient: Pick<Patient, 'diagnoses' | 'exemptions'>, item: ReviewItem): boolean {
    if (item.kind !== 'diagnosis' && item.kind !== 'exemption') return false;
    const proposed = withProposedProfile(patient as Patient, [item]);
    return proposed.diagnoses.length === (patient.diagnoses ?? []).length && proposed.exemptions.length === (patient.exemptions ?? []).length;
}
function suppliedPhysicianValues(needs: readonly AgentPhysicianField[], correction: Record<string, string>): Record<string, string> | null {
    const supplied: Record<string, string> = {};
    for (const field of needs) {
        const value = (correction[field] ?? '').trim();
        if (!(AGENT_PHYSICIAN_FIELD_VALUES[field] as readonly string[]).includes(value)) return null;
        supplied[field] = value;
    }
    return supplied;
}
export const AGENT_ITEM_IN_RECORD = 'Questa voce è già in scheda: scarta la proposta o modifica la voce dalla scheda.';

function agentItemForDecision(review: AgentVisitReview, original: ReviewItem, decision: 'keep' | 'correct', correction: Record<string, string>) {
    if (decision === 'keep' && review.itemBlockers.get(original.id)?.length) return null;
    const fields = agentItemCorrectable(original.kind) ? AGENT_CORRECTABLE_FIELDS[original.kind] : undefined;
    if (decision === 'correct' && !fields) return null;
    const allowed: readonly string[] = fields ?? [];
    const changed = Object.fromEntries(Object.entries(correction).filter(([field]) => allowed.includes(field)).map(([field, value]) => [field, value.trim()]));
    const needs = review.itemNeeds.get(original.id) ?? [];
    const supplied = suppliedPhysicianValues(needs, correction);
    if (!supplied) return null;
    const item = decision === 'correct' ? { ...original, value: { ...original.value, values: correctedValues(original, changed) } }
        : needs.length ? { ...original, value: { ...original.value, values: { ...values(original), ...supplied } } } : original;
    return { item, corrected: decision === 'correct', needs };
}

export async function prepareAgentItemDecision(review: AgentVisitReview, itemId: string, decision: AgentItemDecision,
    signal: AbortSignal, correction: Record<string, string> = {}): Promise<AgentItemDecisionInput | null> {
    const original = review.visit.items.find(item => item.id === itemId);
    if (!original || !agentItemAwaitsDecision(review, itemId) || !review.patient) return null;
    const target = { visitId: review.visit.cassette.id, cassetteRevision: review.visit.cassette.revision };
    if (decision === 'discard') return agentItemDecisionSchema.parse({ ...target, decision, itemId, kind: original.kind });
    if (!agentItemCanWrite(review)) return null;
    const planned = agentItemForDecision(review, original, decision, correction);
    if (!planned) return null;
    const { item, corrected, needs } = planned;
    const patient = await db.patients.get(review.patient.id, { signal });
    if (!patient || patient.deletedAt || patient.isArchived || patient.taxCode.trim().toUpperCase() !== review.visit.anchor.fiscalCode || !patient.version) return null;
    if (patient.version !== review.patient.version) throw new Error('La scheda è cambiata. Rileggi la voce prima di decidere.');
    if (agentItemAlreadyInRecord(patient, item)) throw new Error(AGENT_ITEM_IN_RECORD);
    const profile = withProposedProfile(patient, [item]);
    const prepared = await prepareAgentItem(review, item, profile, corrected, needs);
    signal.throwIfAborted();
    return agentItemDecisionSchema.parse({ ...target, decision, patientId: patient.id, expectedVersion: patient.version, item: prepared });
}
