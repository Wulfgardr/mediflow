'use client';

import { clientArchiveGeneration } from './security/client-auth-api';
import { db } from './db';
import { notifyDbChange } from './live-query';
import { openAgentVisit } from './agent-cassette-client';
import { agentVisitAwaitsReview, inspectAgentVisit, prepareAgentApplication, reopenReviewedAgentItems, type AgentVisitReview } from './agent-visit-review';
import { agentVisitPresentation, sealVisitConfirmationPresentation } from './agent-visit-confirmation-browser';
import type { VisitConfirmationTicket } from './agent-visit-confirmation-contract';
import type { AgentApplicationReceipt, AgentCassetteIndexPage, IncomingAgentCassette } from './agent-visit-application-contract';
import { publishAgentIncomingCount } from './agent-incoming-count';

const empty = {
    visits: [] as AgentVisitReview[],
    busy: false,
    error: null as string | null,
    applicationError: null as { visitId: string | null; message: string } | null,
};
let snapshot = empty;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
export const agentIncomingSnapshot = () => snapshot;
export const agentIncomingServerSnapshot = () => empty;
export function subscribeAgentIncoming(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(value: typeof empty) { snapshot = value; publishAgentIncomingCount(value.visits.length); for (const listener of listeners) listener(); }
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
    if (row.id !== id || row.revision !== revision || row.status !== 'closed' || row.archiveGeneration !== clientArchiveGeneration()) throw new Error(notApplied);
    const items = await reopenReviewedAgentItems(review, row);
    signal.throwIfAborted();
    if (!items) throw new Error(notApplied);
    return { ...review, appliedItemIds: row.appliedItemIds, visit: { ...review.visit, items } };
}
async function apply(review: AgentVisitReview, signal: AbortSignal) {
    const input = await prepareAgentApplication(review, signal);
    if (!input) throw new Error(notApplied);
    signal.throwIfAborted();
    const response = await fetch(inbox, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input), signal });
    if (!response.ok) throw new Error(notApplied);
    const receipt: AgentApplicationReceipt = await response.json();
    signal.throwIfAborted();
    if (receipt.status !== 'applied' || receipt.visitId !== input.visitId || receipt.phase !== input.phase || receipt.itemCount !== input.items.length) throw new Error('Ricevuta non verificabile. Rileggi la cassetta.');
    notifyDbChange();
    return { ...review, patient: review.patient ? { ...review.patient, version: receipt.patientVersion } : null,
        appliedItemIds: [...new Set([...review.appliedItemIds, ...input.items.map(item => item.id)])] };
}
export async function attemptNativeConfirmation(signal: AbortSignal, readPdf?: Parameters<typeof inspectAgentVisit>[4]) {
    const endpoint = '/api/agent-mandates/confirmation';
    const offer = await fetch(endpoint, { cache: 'no-store', signal });
    if (!offer.ok) return;
    const ticket: VisitConfirmationTicket | null = await offer.json();
    if (!ticket) return;
    const existing = snapshot.visits.find(review => review.visit.cassette.id === ticket.visitId && review.visit.cassette.revision === ticket.revision);
    if (!existing?.patient?.version || existing.blockers.length || existing.proposalBlockers.length) return;
    const send = (input: unknown) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal, body: JSON.stringify(input) });
    const reference = ticket.reference;
    const prepare = await send({ action: 'prepare', reference, patientId: existing.patient.id, patientVersion: existing.patient.version });
    if (!prepare.ok) return;
    try {
        const { agreementPublicKey } = await prepare.json();
        const [row, patients, profile, exemptions] = await Promise.all([
            fetchIncoming<IncomingAgentCassette>('?visit=' + ticket.visitId, signal),
            db.patients.toArray({ signal, rejectAuthUnavailable: true }),
            fetch('/api/auth/profile', { cache: 'no-store', signal }),
            db.exemptions.toArray({ signal, rejectAuthUnavailable: true }),
        ]);
        if (!profile.ok || row.id !== ticket.visitId || row.revision !== ticket.revision || row.archiveGeneration !== clientArchiveGeneration()
            || row.status !== 'closed') return;
        const { doctorTaxCode } = await profile.json();
        const review = await inspectAgentVisit(row, patients, doctorTaxCode ?? null, signal, readPdf, new Set(exemptions.map(value => value.code)));
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
                publish({ ...empty, applicationError: snapshot.applicationError });
                return;
            }
            const [patients, profileResponse, exemptions] = await Promise.all([db.patients.toArray({ signal, rejectAuthUnavailable: true }),
                fetch('/api/auth/profile', { cache: 'no-store', signal }), db.exemptions.toArray({ signal, rejectAuthUnavailable: true })]);
            if (!profileResponse.ok) throw new Error('Profilo medico non disponibile.');
            const profile: { doctorTaxCode?: string } = await profileResponse.json();
            const codes = new Set(exemptions.map(value => value.code));
            const visits: AgentVisitReview[] = [];
            let unreadable = false;
            for (;;) {
                for (const summary of page.visits) {
                    signal.throwIfAborted();
                    let review: AgentVisitReview;
                    try {
                        const row = await fetchIncoming<IncomingAgentCassette>('?visit=' + summary.id, signal);
                        review = await inspectAgentVisit(row, patients, profile.doctorTaxCode ?? null, signal, readPdf, codes);
                    } catch (error) {
                        if (signal.aborted) throw error;
                        unreadable = true;
                        continue;
                    }
                    const { id, archiveGeneration, status, revision, depositedAt } = review.visit.cassette;
                    if (archiveGeneration !== clientArchiveGeneration()) review = { ...review, blockers: [...review.blockers, 'Visita da un archivio precedente. Apri i PDF per recuperarla nella scheda.'] };
                    if (review.visit.items.every(item => review.appliedItemIds.includes(item.id))) continue;
                    visits.push({ ...review, documents: [], visit: { ...review.visit, cassette: { id, archiveGeneration, status, revision, depositedAt },
                        items: review.visit.items.map(item => item.kind === 'pdf' ? { ...item, value: { name: item.value.name } } : item) } });
                }
                if (!page.next) break;
                page = await fetchIncoming<AgentCassetteIndexPage>('?after=' + page.next, signal);
            }
            signal.throwIfAborted();
            publish({ ...snapshot, visits, busy: false, error: unreadable ? 'Una visita non è leggibile. Riprova dopo lo sblocco.' : null });
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
export async function applyReviewedAgentVisits(ids: string[]): Promise<void> {
    const signal = db.getSessionReadSignal();
    while (inFlight) await inFlight;
    signal.throwIfAborted();
    const task = (async () => {
        publish({ ...snapshot, busy: true, applicationError: null });
        const versions = new Map<string, { reviewed: number; committed: number }>();
        try {
            for (const id of ids) {
                if (signal.aborted) return;
                const review = snapshot.visits.find(value => value.visit.cassette.id === id);
                const patient = review?.patient;
                if (!review) continue;
                try {
                    if (!patient?.version || !agentVisitAwaitsReview(review)) throw new Error(notApplied);
                    const known = versions.get(patient.id);
                    const expectedVersion = known?.reviewed === patient.version ? known.committed : patient.version;
                    const reopened = await reopenForApplication(review, signal);
                    const current = expectedVersion === patient.version ? reopened : { ...reopened, patient: { ...patient, version: expectedVersion } };
                    const applied = await apply(current, signal);
                    if (!applied.patient?.version) throw new Error(notApplied);
                    versions.set(patient.id, { reviewed: patient.version, committed: applied.patient.version });
                    publish({ ...snapshot, visits: snapshot.visits.map(value => value === review ? { ...applied, visit: review.visit } : value) });
                } catch (error) {
                    if (!signal.aborted && !snapshot.applicationError) {
                        publish({ ...snapshot, applicationError: {
                            visitId: ids.length === 1 ? id : null,
                            message: error instanceof Error ? error.message : notApplied,
                        } });
                    }
                }
            }
        } finally { if (!signal.aborted) publish({ ...snapshot, busy: false }); }
    })();
    inFlight = task;
    try { await task; } finally { if (inFlight === task) inFlight = null; }
    if (signal.aborted) return;
    await refreshAgentIncoming(signal);
}
