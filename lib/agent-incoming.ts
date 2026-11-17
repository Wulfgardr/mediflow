'use client';

import { clientArchiveGeneration } from './security/client-auth-api';
import { db } from './db';
import { notifyDbChange } from './live-query';
import { inspectAgentVisit, prepareAgentApplication, type AgentVisitReview, type IncomingAgentCassette } from './agent-visit-review';
import type { AgentApplicationReceipt } from './agent-visit-application-contract';

const empty = { visits: [] as AgentVisitReview[], busy: false, error: null as string | null };
let snapshot = empty;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
export const agentIncomingSnapshot = () => snapshot;
export const agentIncomingServerSnapshot = () => empty;
export function subscribeAgentIncoming(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(value: typeof empty) { snapshot = value; for (const listener of listeners) listener(); }
async function apply(review: AgentVisitReview, phase: 'automatic' | 'review', signal: AbortSignal) {
    const input = await prepareAgentApplication(review, phase, signal);
    if (!input) return review;
    signal.throwIfAborted();
    const response = await fetch('/api/agent-mandates/incoming', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input), signal });
    if (!response.ok) throw new Error('La visita non è stata applicata. Rileggi la cassetta.');
    const receipt: AgentApplicationReceipt = await response.json();
    signal.throwIfAborted();
    if (receipt.status !== 'applied' || receipt.visitId !== input.visitId || receipt.phase !== phase || receipt.itemCount !== input.items.length) throw new Error('Ricevuta non verificabile. Rileggi la cassetta.');
    notifyDbChange();
    return { ...review, patient: review.patient ? { ...review.patient, version: receipt.patientVersion } : null,
        appliedItemIds: [...new Set([...review.appliedItemIds, ...input.items.map(item => item.id)])] };
}
export async function refreshAgentIncoming(signal = db.getSessionReadSignal()): Promise<void> {
    if (inFlight) return inFlight;
    const task = (async () => {
        publish({ ...snapshot, busy: true, error: null });
        try {
            signal.throwIfAborted();
            const response = await fetch('/api/agent-mandates/incoming', { cache: 'no-store', signal });
            if (!response.ok) throw new Error('Cassetta non disponibile. Riprova.');
            const rows: IncomingAgentCassette[] = await response.json();
            if (!rows.length) { signal.throwIfAborted(); publish(empty); return; }
            const [patients, profileResponse, exemptions] = await Promise.all([db.patients.toArray({ signal, rejectAuthUnavailable: true }),
                fetch('/api/auth/profile', { cache: 'no-store', signal }), db.exemptions.toArray({ signal, rejectAuthUnavailable: true })]);
            if (!profileResponse.ok) throw new Error('Profilo medico non disponibile.');
            const profile: { doctorTaxCode?: string } = await profileResponse.json();
            const codes = new Set(exemptions.map(value => value.code));
            const visits: AgentVisitReview[] = [];
            let unreadable = false;
            for (const row of rows) {
                signal.throwIfAborted();
                let review: AgentVisitReview;
                try { review = await inspectAgentVisit(row, patients, profile.doctorTaxCode ?? null, signal, undefined, codes); }
                catch (error) { if (signal.aborted) throw error; unreadable = true; continue; }
                if (row.archiveGeneration !== clientArchiveGeneration()) review = { ...review, blockers: [...review.blockers, 'Visita da un archivio precedente. Apri i PDF per recuperarla nella scheda.'] };
                if (review.appliedItemIds.length === review.visit.items.length) continue;
                let current = review;
                if (row.status === 'closed' && !review.blockers.length) {
                    try { current = await apply(review, 'automatic', signal); }
                    catch (error) {
                        if (signal.aborted) throw error;
                        current = { ...review, blockers: [...review.blockers, 'Applicazione non riuscita. Rileggi la cassetta.'] };
                    }
                }
                if (current.appliedItemIds.length < current.visit.items.length) visits.push(current);
            }
            signal.throwIfAborted();
            publish({ visits, busy: false, error: unreadable ? 'Una visita non è leggibile. Riprova dopo lo sblocco.' : null });
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
        if (!signal.aborted) timer = setTimeout(() => { void run(); }, 5000);
    };
    void run();
    return () => { controller.abort(); clearTimeout(timer); publish(empty); };
}
export async function applyReviewedAgentVisits(ids: string[]): Promise<void> {
    const signal = db.getSessionReadSignal();
    if (inFlight) await inFlight;
    signal.throwIfAborted();
    const task = (async () => {
        publish({ ...snapshot, busy: true, error: null });
        try {
            for (const id of ids) {
                const review = snapshot.visits.find(value => value.visit.cassette.id === id);
                if (!review || review.blockers.length || review.proposalBlockers.length) continue;
                const applied = await apply(review, 'review', signal);
                publish({ ...snapshot, visits: snapshot.visits.map(value => value === review ? applied : value) });
            }
        } catch (error) {
            if (!signal.aborted) publish({ ...snapshot, error: error instanceof Error ? error.message : 'Visita non applicata.' });
        } finally { if (!signal.aborted) publish({ ...snapshot, busy: false }); }
    })();
    inFlight = task;
    try { await task; } finally { if (inFlight === task) inFlight = null; }
    const failure = snapshot.error;
    await refreshAgentIncoming(signal);
    if (failure && !signal.aborted) publish({ ...snapshot, error: failure });
}
