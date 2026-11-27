'use client';

import { clientArchiveGeneration } from './security/client-auth-api';
import { db } from './db';
import { notifyDbChange } from './live-query';
import { openAgentVisit } from './agent-cassette-client';
import { agentItemAwaitsDecision, agentItemCanWrite, agentItemDecided, agentVisitAwaitsReview, inspectAgentVisit, prepareAgentApplication, prepareAgentItemDecision, reopenReviewedAgentItems, type AgentPatientIdentity, type AgentPhysicianChoices, type AgentVisitReview, type DraftAgentItemDecision, type DraftAgentVisitDecisions } from './agent-visit-review';
import { agentVisitPresentation, sealVisitConfirmationPresentation } from './agent-visit-confirmation-browser';
import type { VisitConfirmationTicket } from './agent-visit-confirmation-contract';
import type { AgentApplicationReceipt, AgentCassetteIndexEntry, AgentCassetteIndexPage, AgentItemDecision, AgentItemDecisionReceipt, AgentVisitDiscardReceipt, IncomingAgentCassette } from './agent-visit-application-contract';
import { publishAgentIncomingCount } from './agent-incoming-count';

type BatchResult = {
    applied: number;
    remaining: number;
    reasons: Array<{ message: string; count: number }>;
};
type BatchApplication = { processed: number; total: number; result?: never } | { result: BatchResult };
type VisitDraft = { revision: number; decisions: DraftAgentVisitDecisions };

const empty = {
    visits: [] as AgentVisitReview[],
    unreadableVisits: [] as AgentCassetteIndexEntry[],
    busy: false,
    batch: null as BatchApplication | null,
    drafts: {} as Partial<Record<string, VisitDraft>>,
    error: null as string | null,
    applicationError: null as { visitId: string | null; itemId?: string; message: string } | null,
};
let snapshot = empty;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
export const agentIncomingSnapshot = () => snapshot;
export const agentIncomingServerSnapshot = () => empty;
export function subscribeAgentIncoming(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(value: typeof empty) { snapshot = value; publishAgentIncomingCount(value.visits.length + value.unreadableVisits.length); for (const listener of listeners) listener(); }
const inbox = '/api/agent-mandates/incoming';

async function fetchIncoming<T>(query: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(inbox + query, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Cassetta non disponibile. Riprova.');
    return response.json();
}

export async function readIncomingAgentPdf(visitId: string, revision: number, itemId: string) {
    const signal = db.getSessionReadSignal();
    const row = await fetchIncoming<IncomingAgentCassette>('?visit=' + encodeURIComponent(visitId), signal);
    if (row.id !== visitId || row.revision !== revision) throw new Error('La cassetta è cambiata. Rileggila prima di aprire il PDF.');
    const visit = await openAgentVisit(row);
    signal.throwIfAborted();
    const item = visit.items.find(value => value.id === itemId && value.kind === 'pdf');
    if (typeof item?.value.name !== 'string' || typeof item.value.base64 !== 'string') throw new Error('PDF non disponibile.');
    return { name: item.value.name, base64: item.value.base64 };
}

const notApplied = 'La visita non è stata applicata. Rileggi la cassetta.';
async function reopenForApplication(review: AgentVisitReview, signal: AbortSignal): Promise<AgentVisitReview> {
    const { id, revision } = review.visit.cassette;
    const row = await fetchIncoming<IncomingAgentCassette>('?visit=' + encodeURIComponent(id), signal);
    if (row.id !== id || row.revision !== revision || row.status !== 'closed' || row.reviewBlock || row.archiveGeneration !== clientArchiveGeneration()) throw new Error(notApplied);
    const items = await reopenReviewedAgentItems(review, row);
    signal.throwIfAborted();
    if (!items) throw new Error(notApplied);
    return { ...review, appliedItemIds: row.appliedItemIds, discardedItemIds: row.discardedItemIds ?? [], correctedItemIds: row.correctedItemIds ?? [], visit: { ...review.visit, items } };
}
async function apply(review: AgentVisitReview, signal: AbortSignal, identity?: AgentPatientIdentity, drafts?: DraftAgentVisitDecisions,
    choices?: AgentPhysicianChoices) {
    const input = await prepareAgentApplication(review, signal, identity, drafts, choices);
    if (!input) throw new Error(notApplied);
    signal.throwIfAborted();
    const response = await fetch(inbox, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input), signal });
    if (!response.ok) throw new Error(notApplied);
    const receipt: AgentApplicationReceipt = await response.json();
    signal.throwIfAborted();
    const discarded = input.decisions?.filter(item => item.decision === 'discard') ?? [];
    if (receipt.status !== 'applied' || receipt.visitId !== input.visitId || receipt.phase !== input.phase
        || receipt.itemCount !== input.items.length || (receipt.discardedItemCount ?? 0) !== discarded.length) {
        throw new Error('Ricevuta non verificabile. Rileggi la cassetta.');
    }
    notifyDbChange();
    return receipt;
}
export async function attemptNativeConfirmation(signal: AbortSignal, readPdf?: Parameters<typeof inspectAgentVisit>[4]) {
    const endpoint = '/api/agent-mandates/confirmation';
    const offer = await fetch(endpoint, { cache: 'no-store', signal });
    if (!offer.ok) return;
    const ticket: VisitConfirmationTicket | null = await offer.json();
    if (!ticket) return;
    const existing = snapshot.visits.find(review => review.visit.cassette.id === ticket.visitId && review.visit.cassette.revision === ticket.revision);
    if (!existing?.patient?.version || existing.blockers.length || existing.proposalBlockers.length || existing.itemNeeds.size
        || existing.visit.items.some(item => agentItemDecided(existing, item.id))) return;
    const send = (input: unknown) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal, body: JSON.stringify(input) });
    const reference = ticket.reference;
    const prepare = await send({ action: 'prepare', reference, patientId: existing.patient.id, patientVersion: existing.patient.version });
    if (!prepare.ok) return;
    try {
        const { agreementPublicKey } = await prepare.json();
        const [row, patients, profile] = await Promise.all([
            fetchIncoming<IncomingAgentCassette>('?visit=' + ticket.visitId, signal),
            db.patients.toArray({ signal, rejectAuthUnavailable: true }),
            fetch('/api/auth/profile', { cache: 'no-store', signal }),
        ]);
        if (!profile.ok || row.id !== ticket.visitId || row.revision !== ticket.revision || row.archiveGeneration !== clientArchiveGeneration()
            || row.status !== 'closed') return;
        const { doctorTaxCode } = await profile.json();
        const review = await inspectAgentVisit(row, patients, doctorTaxCode ?? null, signal, readPdf);
        const plan = await prepareAgentApplication(review, signal);
        if (!plan || plan.patientId !== existing.patient.id || plan.expectedVersion !== existing.patient.version) return;
        const presentation = await sealVisitConfirmationPresentation(reference, agreementPublicKey, await agentVisitPresentation(review, plan));
        signal.throwIfAborted();
        const shown = await send({ action: 'show', reference, plan, presentation });
        if (shown.ok) notifyDbChange();
    } finally {
        if (!signal.aborted) await send({ action: 'dismiss', reference }).catch(() => undefined);
    }
}

export async function refreshAgentIncoming(signal = db.getSessionReadSignal(), readPdf?: Parameters<typeof inspectAgentVisit>[4]): Promise<void> {
    if (inFlight) return inFlight;
    const task = (async () => {
        publish({ ...snapshot, busy: true, error: null });
        try {
            signal.throwIfAborted();
            let page = await fetchIncoming<AgentCassetteIndexPage>('', signal);
            if (!page.visits.length) {
                signal.throwIfAborted();
                publish({ ...empty, applicationError: snapshot.applicationError, batch: snapshot.batch });
                return;
            }
            const [patients, profileResponse, contextResponse] = await Promise.all([db.patients.toArray({ signal, rejectAuthUnavailable: true }),
                fetch('/api/auth/profile', { cache: 'no-store', signal }), fetch('/api/context', { cache: 'no-store', signal })]);
            if (!profileResponse.ok) throw new Error('Profilo medico non disponibile.');
            const profile: { doctorTaxCode?: string } = await profileResponse.json();
            const context: { ambulatoryId?: string } = contextResponse.ok ? await contextResponse.json() : {};
            const ambulatoryId = contextResponse.ok ? context.ambulatoryId
                ?? (await db.ambulatories.toArray({ signal, rejectAuthUnavailable: true })).find(value => value.isDefault)?.id : undefined;
            const visits: AgentVisitReview[] = [];
            const unreadableVisits: AgentCassetteIndexEntry[] = [];
            for (;;) {
                for (const summary of page.visits) {
                    signal.throwIfAborted();
                    let review: AgentVisitReview;
                    try {
                        const row = await fetchIncoming<IncomingAgentCassette>('?visit=' + summary.id, signal);
                        review = await inspectAgentVisit(row, patients, profile.doctorTaxCode ?? null, signal, readPdf, ambulatoryId);
                    } catch (error) {
                        if (signal.aborted) throw error;
                        unreadableVisits.push(summary);
                        continue;
                    }
                    const { id, archiveGeneration, status, revision, depositedAt } = review.visit.cassette;
                    if (archiveGeneration !== clientArchiveGeneration()) review = { ...review, blockers: [...review.blockers, 'Visita da un archivio precedente. Apri i PDF per recuperarla nella scheda.'] };
                    if (status === 'closed' && review.visit.items.length && review.visit.items.every(item => agentItemDecided(review, item.id))) continue;
                    visits.push({ ...review, documents: [], visit: { ...review.visit, cassette: { id, archiveGeneration, status, revision, depositedAt },
                        items: review.visit.items.map(item => item.kind === 'pdf' ? { ...item, value: { name: item.value.name } } : item) } });
                }
                if (!page.next) break;
                page = await fetchIncoming<AgentCassetteIndexPage>('?after=' + page.next, signal);
            }
            signal.throwIfAborted();
            const drafts = Object.fromEntries(visits.flatMap(({ visit, newPatient }) => {
                const draft = snapshot.drafts[visit.cassette.id];
                return newPatient && draft?.revision === visit.cassette.revision ? [[visit.cassette.id, draft]] : [];
            }));
            publish({ ...snapshot, visits, unreadableVisits, drafts, busy: false, error: null });
        } catch (error) {
            if (!signal.aborted) publish({ ...snapshot, busy: false, error: error instanceof Error ? error.message : 'Cassetta non disponibile. Riprova.' });
        }
    })();
    inFlight = task;
    try { await task; } finally { if (inFlight === task) inFlight = null; }
}
export function startAgentIncoming(): () => void {
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, db.getSessionReadSignal()]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
        if (signal.aborted) return;
        await refreshAgentIncoming(signal);
        if (!signal.aborted) await attemptNativeConfirmation(signal).catch(() => undefined);
        if (!signal.aborted) timer = setTimeout(() => { void run(); }, 5000);
    };
    void run();
    return () => { controller.abort(); clearTimeout(timer); publish(empty); };
}
type ConfirmedAgentPatient = { visitId: string; revision: number; identity: AgentPatientIdentity };
export function applyReviewedAgentVisitAndCreatePatient(confirmation: ConfirmedAgentPatient, choices?: AgentPhysicianChoices): Promise<void> {
    return applyReviews([confirmation.visitId], { confirmation, choices });
}
export function applyReviewedAgentVisits(ids: string[], choices?: AgentPhysicianChoices): Promise<void> {
    return applyReviews(ids, { choices });
}

export function applyAllReadyAgentVisits(): Promise<void> {
    return applyReviews(snapshot.visits.filter(visit => agentVisitAwaitsReview(visit)).map(visit => visit.visit.cassette.id), { batch: true });
}

function summarizeAgentBatch(applied: number, failures: Map<string, string>): BatchResult {
    const reasons = new Map<string, number>();
    const add = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    for (const review of snapshot.visits) {
        const failure = failures.get(review.visit.cassette.id);
        if (failure) add(failure);
        else if (review.blockers.length) add([...new Set(review.blockers)].join(' '));
        else if (review.newPatient) add('Scheda da creare');
        else if (review.proposalBlockers.length) add('Voci da decidere');
        else add('Pronte da applicare');
    }
    for (const visit of snapshot.unreadableVisits) add(failures.get(visit.id) ?? 'Visita non leggibile');
    return { applied, remaining: snapshot.visits.length + snapshot.unreadableVisits.length,
        reasons: [...reasons].map(([message, count]) => ({ message, count })) };
}

async function applyReviews(ids: string[], { confirmation, batch = false, choices }: {
    confirmation?: ConfirmedAgentPatient; batch?: boolean; choices?: AgentPhysicianChoices;
}): Promise<void> {
    const signal = db.getSessionReadSignal();
    while (inFlight) await inFlight;
    if (signal.aborted) return;
    const failures = new Map<string, string>();
    let appliedCount = 0;
    const task = (async () => {
        publish({ ...snapshot, busy: true, applicationError: null,
            batch: batch ? { processed: 0, total: ids.length } : snapshot.batch });
        const versions = new Map<string, { reviewed: number; committed: number }>();
        for (const [index, id] of ids.entries()) {
            if (signal.aborted) return;
            const review = snapshot.visits.find(value => value.visit.cassette.id === id);
            if (review) {
                const patient = review.patient;
                const identity = confirmation?.visitId === id && confirmation.revision === review.visit.cassette.revision
                    ? confirmation.identity : undefined;
                const draft = snapshot.drafts[id];
                const decisions = draft?.revision === review.visit.cassette.revision ? draft.decisions : undefined;
                try {
                    if ((confirmation && !identity) || !agentVisitAwaitsReview(review, identity, decisions, choices)) throw new Error(notApplied);
                    const reopened = await reopenForApplication(review, signal);
                    const known = patient && versions.get(patient.id);
                    const expectedVersion = known?.reviewed === patient?.version ? known?.committed : patient?.version;
                    const current = patient ? { ...reopened, patient: { ...patient, version: expectedVersion } } : reopened;
                    const receipt = await apply(current, signal, identity, decisions, choices);
                    if (patient?.version) versions.set(patient.id, { reviewed: patient.version, committed: receipt.patientVersion });
                    appliedCount++;
                    const drafts = { ...snapshot.drafts };
                    delete drafts[id];
                    publish({ ...snapshot, visits: snapshot.visits.filter(value => value !== review), drafts });
                } catch (error) {
                    if (signal.aborted) return;
                    const message = error instanceof Error ? error.message : notApplied;
                    if (batch) failures.set(id, message);
                    else publish({ ...snapshot, applicationError: { visitId: id, message } });
                }
            }
            if (batch) publish({ ...snapshot, batch: { processed: index + 1, total: ids.length } });
        }
    })();
    inFlight = task;
    try { await task; } finally { if (inFlight === task) inFlight = null; }
    if (signal.aborted) return;
    await refreshAgentIncoming(signal);
    if (batch && !signal.aborted) publish({ ...snapshot, batch: { result: summarizeAgentBatch(appliedCount, failures) } });
}

export function canDiscardIncomingAgentVisit(cassette: AgentCassetteIndexEntry): boolean {
    return cassette.archiveGeneration === clientArchiveGeneration();
}

export function stageNewAgentVisitItem(visitId: string, revision: number, itemId: string, decision: DraftAgentItemDecision | null): boolean {
    const review = snapshot.visits.find(({ visit }) => visit.cassette.id === visitId && visit.cassette.revision === revision);
    if (snapshot.busy || !review?.newPatient || !agentItemAwaitsDecision(review, itemId)
        || (decision && decision.decision !== 'discard' && !agentItemCanWrite(review))) return false;
    const existing = snapshot.drafts[visitId];
    const decisions = { ...(existing?.revision === revision ? existing.decisions : {}) };
    if (decision) decisions[itemId] = decision;
    else delete decisions[itemId];
    publish({ ...snapshot, drafts: { ...snapshot.drafts, [visitId]: { revision, decisions } },
        applicationError: snapshot.applicationError?.visitId === visitId ? null : snapshot.applicationError });
    return true;
}

export async function discardIncomingAgentVisit(cassette: AgentCassetteIndexEntry): Promise<void> {
    const signal = db.getSessionReadSignal();
    while (inFlight) await inFlight;
    if (signal.aborted) return;
    const { id: visitId, revision: cassetteRevision } = cassette;
    const message = 'La visita non è stata scartata. Aggiorna e riprova.';
    const task = (async () => {
        publish({ ...snapshot, busy: true, applicationError: null });
        try {
            const response = await fetch(inbox + '/items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visitId, cassetteRevision, decision: 'discard_visit' }), signal });
            if (!response.ok) throw new Error(message);
            const receipt: AgentVisitDiscardReceipt = await response.json();
            signal.throwIfAborted();
            if (receipt.status !== 'discarded' || receipt.visitId !== visitId || !receipt.eventId) throw new Error(message);
            const drafts = { ...snapshot.drafts };
            delete drafts[visitId];
            publish({ ...snapshot, drafts, visits: snapshot.visits.filter(({ visit }) => visit.cassette.id !== visitId),
                unreadableVisits: snapshot.unreadableVisits.filter(visit => visit.id !== visitId) });
        } catch {
            if (!signal.aborted) publish({ ...snapshot, applicationError: { visitId, message } });
        }
    })();
    inFlight = task;
    try { await task; } finally { if (inFlight === task) inFlight = null; }
    if (!signal.aborted) await refreshAgentIncoming(signal);
}

const notDecided = 'La voce non è stata decisa. Rileggi la visita.';
export async function decideAgentVisitItem(visitId: string, itemId: string, decision: AgentItemDecision, correction?: Record<string, string>): Promise<boolean> {
    const signal = db.getSessionReadSignal();
    while (inFlight) await inFlight;
    signal.throwIfAborted();
    let decided = false;
    const task = (async () => {
        publish({ ...snapshot, busy: true, applicationError: null });
        try {
            const review = snapshot.visits.find(value => value.visit.cassette.id === visitId);
            if (!review) throw new Error(notDecided);
            const reopened = decision === 'discard' ? review : await reopenForApplication(review, signal);
            const input = await prepareAgentItemDecision(reopened, itemId, decision, signal, correction);
            if (!input) throw new Error(notDecided);
            const response = await fetch(inbox + '/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
            if (!response.ok) throw new Error(notDecided);
            const receipt: AgentItemDecisionReceipt = await response.json();
            signal.throwIfAborted();
            if (receipt.status !== 'decided' || receipt.visitId !== visitId || receipt.itemId !== itemId || receipt.decision !== decision) throw new Error('Ricevuta non verificabile. Rileggi la visita.');
            if (decision !== 'discard') notifyDbChange();
            const patient = reopened.patient && receipt.patientVersion ? { ...reopened.patient, version: receipt.patientVersion } : reopened.patient;
            const updated: AgentVisitReview = { ...review, patient,
                appliedItemIds: decision === 'discard' ? reopened.appliedItemIds : [...new Set([...reopened.appliedItemIds, itemId])],
                discardedItemIds: decision === 'discard' ? [...new Set([...reopened.discardedItemIds, itemId])] : reopened.discardedItemIds,
                correctedItemIds: decision === 'correct' ? [...new Set([...reopened.correctedItemIds, itemId])] : reopened.correctedItemIds };
            publish({ ...snapshot, visits: snapshot.visits.map(value => value === review ? updated : value) });
            decided = true;
        } catch (error) {
            if (!signal.aborted) publish({ ...snapshot, applicationError: { visitId, itemId, message: error instanceof Error ? error.message : notDecided } });
        } finally { if (!signal.aborted) publish({ ...snapshot, busy: false }); }
    })();
    inFlight = task;
    try { await task; } finally { if (inFlight === task) inFlight = null; }
    if (!signal.aborted) await refreshAgentIncoming(signal);
    return decided;
}
