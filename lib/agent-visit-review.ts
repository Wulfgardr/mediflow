'use client';

import { db, type Patient } from './db';
import { cassetteItems } from './agent-cassette-contract';
import { agentBytes } from './agent-cassette-crypto';
import { openAgentVisit, type OpenedAgentVisit } from './agent-cassette-client';
import { agentApplicationSchema, agentStructuredKind, type AgentApplicationInput, type AgentCassetteIndexEntry, type IncomingAgentCassette } from './agent-visit-application-contract';
import { collectDossierTaxCodes, evaluateDossierGroupIdentity, excludedProfessionalCode, dossierFactBlockers } from './domain/documents/dossier-import';
import { verifyPreparedFields, preparedTokens } from './domain/documents/dossier-prepared';
import { clinicalFactContext, contextReview, isHistoricalTherapy } from './domain/documents/clinical-context-lexicon';
import { servicePrescriptionCreateSchema } from './api-schemas/prescriptions';
import { isValidItalianTaxCode } from './patient-identity';
import { agentVisitPdfText, type AgentVisitPdf } from './agent-visit-pdf-text';

export type AgentVisitDocument = AgentVisitPdf & { id: string; name: string; hash: string };
export type AgentVisitReview = { visit: Omit<OpenedAgentVisit, 'cassette'> & { cassette: AgentCassetteIndexEntry }; patient: Patient | null;
    documents: AgentVisitDocument[]; appliedItemIds: string[]; currentSummary: Map<string, string>; blockers: string[]; proposalBlockers: string[] };
const proposalLabels: Record<string, string> = { therapy: 'la terapia', service: 'la prestazione', diagnosis: 'la diagnosi', exemption: 'l’esenzione', observation: 'l’osservazione' };
const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const normalized = (value: string) => value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('it-IT');
function locateQuote(source: string, quote: string): RegExpExecArray | null {
    if (quote.length < 12 || quote.length > 600) return null;
    const pattern = quote.split(/\s+/u).map(part => part.replace(/[.*+?^$(){}|[\]\\]/gu, '\\$&')).join('\\s+');
    const start = /^[\p{L}\p{N}]/u.test(quote) ? '(?<![\\p{L}\\p{N}])' : '';
    const end = /[\p{L}\p{N}]$/u.test(quote) ? '(?![\\p{L}\\p{N}])' : '';
    const literal = new RegExp(start + pattern + end, 'giu');
    const match = literal.exec(source);
    return match && !literal.test(source) ? match : null;
}
function sourceHash(item: OpenedAgentVisit['items'][number]): string {
    const source = item.value.source;
    return source && typeof source === 'object' && !Array.isArray(source) ? text((source as Record<string, unknown>).sha256) : '';
}
function values(item: OpenedAgentVisit['items'][number]): Record<string, string> {
    const value = item.value.values;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(field => typeof field !== 'string')) throw new Error('Proposta non leggibile.');
    return value as Record<string, string>;
}

export async function inspectAgentVisit(row: IncomingAgentCassette, patients: Patient[], physicianTaxCode: string | null, signal: AbortSignal,
    readPdf = agentVisitPdfText, exemptionCodes: ReadonlySet<string> = new Set()): Promise<AgentVisitReview> {
    const visit = await openAgentVisit(row);
    signal.throwIfAborted();
    const cf = text(visit.anchor.fiscalCode);
    const matches = isValidItalianTaxCode(cf) ? patients.filter(patient => !patient.deletedAt && !patient.isArchived && patient.taxCode === cf) : [];
    const patient = matches.length === 1 ? matches[0] : null;
    const blockers: string[] = [], proposalBlockers: string[] = [];
    if (!patient) blockers.push(matches.length > 1 ? 'Più schede hanno questo codice fiscale.' : 'Codice fiscale non confermato in una scheda esistente.');
    const documents = new Map<string, AgentVisitDocument>();
    const deposited = cassetteItems(row);
    for (const item of visit.items.filter(item => item.kind === 'pdf')) {
        const bytes = agentBytes(text(item.value.base64));
        try {
            const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
            if (hash !== deposited.find(value => value.id === item.id)?.documentHash) throw new Error('Hash del PDF discordante.');
            const read = await readPdf(bytes, signal), codes = collectDossierTaxCodes(read.text);
            signal.throwIfAborted();
            documents.set(hash, { ...read, id: item.id, name: text(item.value.name), hash });
            const identity = evaluateDossierGroupIdentity([{ taxCodes: codes }], patient ? [patient] : [], patient?.id, physicianTaxCode);
            const foreign = codes.filter(code => code.checksumValid && code.value !== physicianTaxCode
                && !excludedProfessionalCode(code));
            if (identity.status !== 'matched' || identity.blocking || foreign.length === 0
                || foreign.some(code => code.value !== cf || code.role !== 'patient_cf')) {
                blockers.push(identity.missingPhysicianTaxCode ? identity.message + ' PDF: ' + text(item.value.name) : 'Identità da verificare nel PDF ' + text(item.value.name) + ': ' + identity.documentPatientCodes.join(', '));
            }
        } catch (error) {
            if (signal.aborted) throw error;
            blockers.push('PDF non verificabile: ' + text(item.value.name));
        } finally { bytes.fill(0); }
    }
    if (documents.size === 0) blockers.push('Manca un PDF con il codice fiscale del paziente.');
    for (const item of visit.items.filter(item => agentStructuredKind(item.kind))) {
        const source = documents.get(sourceHash(item));
        const quote = text(item.value.quote);
        const match = source ? locateQuote(source.text, quote) : null;
        if (!source || !match) {
            proposalBlockers.push('Fonte da verificare per ' + (proposalLabels[item.kind] ?? 'questa proposta') + '.'); continue;
        }
        const fields = values(item);
        const kind = item.kind === 'service' ? 'service_prescription' : item.kind;
        if (kind !== 'note' && kind !== 'transcription' && kind !== 'pdf') {
            const verified = verifyPreparedFields(kind, fields, preparedTokens(match[0]).map(token => token.text));
            const context = clinicalFactContext(kind, fields, source.text, match.index, match.index + match[0].length);
            const contextualFields = { ...fields, contextReview: contextReview(context, kind === 'therapy' && isHistoricalTherapy(fields.status)) };
            proposalBlockers.push(...dossierFactBlockers({ factId: item.id, kind, values: contextualFields, negated: context.negated, origin: 'prepared', evidence: null, decision: 'pending' }, { exemptionCodes }));
            if (verified.check !== 'ok' || verified.drop.length || fields.subject && fields.subject !== 'paziente') proposalBlockers.push('Valori o soggetto della proposta da verificare sulla fonte.');
        }
        if (item.kind === 'service' && (fields.items ?? '').split('\n').map(line => line.trim()).filter(Boolean).some(line => !normalized(quote).includes(normalized(line)))) proposalBlockers.push('Voci della prestazione da verificare sulla fonte.');
        if (item.kind === 'observation' && [fields.refLow, fields.refHigh, fields.refText].some(value => value && !normalized(quote).includes(normalized(value)))) proposalBlockers.push('Intervallo di riferimento da verificare sulla fonte.');
        if (item.kind === 'diagnosis' && (!fields.code || !fields.system || !normalized(quote).includes(normalized(fields.code)))) proposalBlockers.push('Codice della diagnosi da verificare sulla fonte.');
        if (item.kind === 'observation' && (!fields.code || !normalized(quote).includes(normalized(fields.code)))) proposalBlockers.push('Codice dell’osservazione da verificare sulla fonte.');
        if (item.kind === 'exemption' && (!fields.code || !normalized(quote).includes(normalized(fields.code)))) proposalBlockers.push('Codice di esenzione da verificare sulla fonte.');
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
    return { visit, patient, documents: [...documents.values()], appliedItemIds: row.appliedItemIds, currentSummary, blockers, proposalBlockers };
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
    return visit.items;
}
export function agentVisitAwaitsReview(review: AgentVisitReview): boolean {
    return review.visit.cassette.status === 'closed' && !review.blockers.length && !review.proposalBlockers.length
        && review.visit.items.some(item => !review.appliedItemIds.includes(item.id));
}

export async function prepareAgentApplication(review: AgentVisitReview, signal: AbortSignal): Promise<AgentApplicationInput | null> {
    if (!review.patient || review.blockers.length || review.proposalBlockers.length || review.visit.cassette.status !== 'closed') return null;
    const patient = await db.patients.get(review.patient.id, { signal });
    if (!patient || patient.deletedAt || patient.isArchived || patient.taxCode !== review.visit.anchor.fiscalCode || !patient.version) return null;
    if (patient.version !== review.patient.version) throw new Error('La scheda è cambiata. Rileggi le differenze prima di applicare la visita.');
    const selected = review.visit.items.filter(item => !review.appliedItemIds.includes(item.id));
    if (!selected.length) return null;
    const diagnoses = [...(patient.diagnoses ?? [])], exemptions = [...(patient.exemptions ?? [])];
    for (const item of selected) {
        if (item.kind === 'diagnosis') {
            const value = values(item);
            if (!diagnoses.some(stored => stored.code === value.code && stored.system === value.system)) diagnoses.push({ code: value.code, system: value.system, description: value.description, date: new Date(value.date || review.visit.cassette.depositedAt) });
        }
        if (item.kind === 'exemption') { const value = values(item); if (!exemptions.includes(value.code)) exemptions.push(value.code); }
    }
    const prepared: unknown[] = [];
    for (const item of selected) {
        signal.throwIfAborted();
        const provenance = { visitId: review.visit.cassette.id, source: item.value.source, quote: item.value.quote };
        const base = { id: item.id, kind: item.kind };
        switch (item.kind) {
            case 'note': case 'transcription': {
                if (!text(item.value.text)) throw new Error('Nota vuota.');
                const title = item.kind === 'note' ? 'Visita' : 'Trascrizione della visita';
                const metadata = { sourceLabel: 'Cassetta della visita', provenance };
                prepared.push({ ...base, values: {
                    title: await db.sealLocalDraft(title), content: await db.sealLocalDraft(item.value.text),
                    metadata: await db.sealLocalDraft(metadata), date: text(item.value.date) || new Date(review.visit.cassette.depositedAt).toISOString(),
                } });
                break;
            }
            case 'pdf': {
                const bytes = agentBytes(text(item.value.base64));
                try {
                    const sealed = await db.sealPatientDocumentSource(bytes, text(item.value.name));
                    sealed.fileKey.fill(0);
                    prepared.push({ ...base, values: { name: sealed.name, data: sealed.data, size: bytes.length } });
                } finally { bytes.fill(0); }
                break;
            }
            case 'therapy': {
                const value = values(item);
                const status = value.status;
                if (status !== 'active' && status !== 'suspended' && status !== 'completed') throw new Error('Stato della terapia da verificare.');
                const data = await db.therapies.prepareWritePayload({ drugName: value.drugName, activePrinciple: value.activePrinciple || undefined,
                    aic: value.aic || undefined, atc: value.atc || undefined, dosage: value.dosage, status, startDate: new Date(value.startDate),
                    endDate: value.endDate ? new Date(value.endDate) : null, motivation: JSON.stringify(provenance) });
                prepared.push({ ...base, values: data }); break;
            }
            case 'service': {
                const value = values(item);
                const data = await db.servicePrescriptions.prepareWritePayload({ serviceName: value.serviceName, prescribedAt: new Date(value.prescribedAt),
                    category: servicePrescriptionCreateSchema.shape.category.parse(value.category), priority: servicePrescriptionCreateSchema.shape.priority.parse(value.priority || undefined),
                    clinicalQuestion: value.clinicalQuestion || undefined, requestReference: value.requestReference || undefined,
                    source: 'document_review', documentRefs: JSON.stringify(provenance) });
                const lineItems = await Promise.all((value.items ?? '').split('\n').map(line => line.trim()).filter(Boolean).map(async serviceName => ({ serviceName: await db.sealLocalDraft(serviceName) })));
                prepared.push({ ...base, values: { ...data, lineItems } }); break;
            }
            case 'diagnosis': prepared.push({ ...base, values: { diagnoses: await db.sealLocalDraft(diagnoses) } }); break;
            case 'exemption': prepared.push({ ...base, values: { exemptions: await db.sealLocalDraft(exemptions) } }); break;
            case 'observation': {
                const value = values(item);
                prepared.push({ ...base, values: { codeSystem: 'LOINC', code: value.code, display: value.display, value: value.value,
                    unitSystem: 'UCUM', unitCode: value.unitCode, observedAt: value.observedAt, refLow: value.refLow || null, refHigh: value.refHigh || null, refText: value.refText || null, notes: await db.sealLocalDraft(provenance) } }); break;
            }
        }
    }
    signal.throwIfAborted();
    return agentApplicationSchema.parse({ visitId: review.visit.cassette.id, phase: 'review', patientId: patient.id, expectedVersion: patient.version,
        cassetteRevision: review.visit.cassette.revision, items: prepared });
}
