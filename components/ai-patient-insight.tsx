'use client';

/* @Codex */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import PrivacyBlur from '@/components/privacy-blur';
import {
    AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
    isAiPatientInsightEnabledValue,
} from '@/lib/ai-patient-insight-kill-switch';
import {
    buildPatientInsightPreviewRequest,
    parsePatientInsightPreviewWireRoot,
    type PatientInsightPreviewWire,
} from '@/lib/ai-providers/fabric/patient-insight-preview-contract';
import { db, type Patient } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';

interface AIPatientInsightProps {
    patient: Patient;
    stale?: boolean;
}

type AvailablePreview = Extract<PatientInsightPreviewWire, { status: 'available' }>;

function safeError(preview: Exclude<PatientInsightPreviewWire, { status: 'available' }>): string {
    if (preview.code === 'kill_switch_disabled') {
        return 'Patient Insight è disabilitata localmente. Riattivala in Impostazioni per generare una nuova bozza.';
    }
    if (preview.code === 'source_stale') {
        return 'I dati clinici o la selezione sono cambiati durante la generazione. Riapri la scheda e riprova.';
    }
    if (preview.code === 'model_unavailable' || preview.code === 'provider_unready' || preview.code === 'provider_binding_denied') {
        return 'Il modello clinico locale non è disponibile. Verifica le Impostazioni AI.';
    }
    return preview.status === 'failed'
        ? 'La risposta del modello locale non ha superato i controlli clinici.'
        : 'Patient Insight non è disponibile in questo momento.';
}

function InsightList({ items, warning = false }: Readonly<{ items: readonly string[]; warning?: boolean }>) {
    if (items.length === 0) return null;
    return (
        <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
            {items.map((item, index) => (
                <li key={`${index}-${item}`} className="flex gap-2">
                    {warning ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        : <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />}
                    <PrivacyBlur intensity="sm">{item}</PrivacyBlur>
                </li>
            ))}
        </ul>
    );
}

export default function AIPatientInsight({ patient, stale = false }: AIPatientInsightProps) {
    const patientKey = `${patient.id}:${patient.version ?? 'unknown'}`;
    const [storedPreview, setPreview] = useState<Readonly<{ patientKey: string; value: AvailablePreview }> | null>(null);
    const [storedError, setStoredError] = useState<Readonly<{ patientKey: string; value: string | null }> | null>(null);
    const [generation, setGeneration] = useState<Readonly<{ patientKey: string; active: boolean }>>({ patientKey, active: false });
    const [progress, setProgress] = useState('');
    const abortControllerRef = useRef<AbortController | null>(null);
    const killSwitch = useLiveQuery(
        () => db.settings.get(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY),
        [], undefined, ['settings'],
    );
    const enabled = isAiPatientInsightEnabledValue(killSwitch?.value);
    const preview = storedPreview?.patientKey === patientKey ? storedPreview.value : null;
    const error = storedError?.patientKey === patientKey ? storedError.value : null;
    const isGenerating = generation.patientKey === patientKey && generation.active;
    const setError = (value: string | null) => setStoredError({ patientKey, value });

    useEffect(() => {
        return () => abortControllerRef.current?.abort();
    }, [patientKey]);

    const generateInsight = async () => {
        if (!enabled) {
            setError('Patient Insight è disabilitata localmente. Riattivala in Impostazioni per generare una nuova bozza.');
            return;
        }
        const controller = new AbortController(); abortControllerRef.current = controller;
        setGeneration({ patientKey, active: true }); setPreview(null); setError(null); setProgress('Raccolta del contesto clinico minimo…');
        try {
            const [entries, therapies] = await Promise.all([
                db.entries.query({ patientId: patient.id, orderBy: 'date', orderDir: 'desc', limit: 12 }).toArray(),
                db.therapies.query({ patientId: patient.id, limit: 12 }).toArray(),
            ]);
            if (controller.signal.aborted) return;
            const request = buildPatientInsightPreviewRequest({
                patient, entries, therapies,
                requestId: `pi_${crypto.randomUUID()}`,
                capturedAt: new Date().toISOString(),
            });
            setProgress('Verifica autenticata di selezione e currentness…');
            const response = await fetch('/api/ai/patient-insight/preview', {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
            });
            if (controller.signal.aborted) return;
            if (!response.ok) {
                setError(response.status === 401 ? 'La sessione non è più disponibile. Accedi di nuovo.' : 'Patient Insight non è disponibile in questo momento.');
                return;
            }
            setProgress('Controllo della proposta clinica…');
            const root = parsePatientInsightPreviewWireRoot(await response.json());
            if (!root) { setError('La risposta di Patient Insight non ha superato i controlli locali.'); return; }
            const result = root.preview;
            if (result.status !== 'available') { setError(safeError(result)); return; }
            if (result.writesPerformed !== 0 || result.apply !== 'denied' || result.proposal.reviewOnly !== true) {
                setError('La proposta non rispetta il contratto review-only.'); return;
            }
            setPreview({ patientKey, value: result });
        } catch {
            if (!controller.signal.aborted) setError('Patient Insight non è disponibile in questo momento.');
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null; setGeneration({ patientKey, active: false }); setProgress('');
            }
        }
    };

    const stopGeneration = () => {
        abortControllerRef.current?.abort(); abortControllerRef.current = null;
        setGeneration({ patientKey, active: false }); setProgress(''); setError('Generazione interrotta. Nessuna modifica è stata applicata.');
    };

    if (!patient.aiSummary && !preview && !isGenerating && !enabled) {
        return (
            <div className="patient-ai-insight-panel lume-panel overflow-hidden border-red-200/70 p-6 dark:border-red-500/20" data-testid="patient-insight-disabled-card">
                <div className="flex flex-col items-center space-y-5 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-300"><AlertTriangle className="h-8 w-8" /></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500">Funzione AI disattivata</p><h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Patient Insight disabilitata</h3>
                        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">La scheda resta consultabile, ma nessuna nuova proposta viene generata finché l&apos;interruttore non viene riattivato.</p></div>
                    <Link href="/settings/ai/funzioni" className="lume-press rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-900">Apri Impostazioni AI</Link>
                </div>
            </div>
        );
    }

    if (!patient.aiSummary && !preview && !isGenerating) {
        return (
            <div className="patient-ai-insight-panel lume-panel overflow-hidden p-6">
                <div className="flex flex-col items-center space-y-5 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-slate-900 text-white dark:bg-white dark:text-slate-900"><Sparkles className="h-8 w-8" /></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Supporto clinico locale</p><h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Genera una proposta da revisionare</h3>
                        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">La proposta resta temporanea: non aggiorna la scheda e non può essere applicata automaticamente.</p></div>
                    {error && <div className="max-w-sm rounded-[20px] border border-red-100 bg-red-50 p-3 text-xs text-red-600">{error}</div>}
                    <button type="button" onClick={generateInsight} className="lume-press inline-flex items-center gap-2 rounded-full bg-slate-900 px-8 py-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-900"><Sparkles className="h-4 w-4" />Avvia supporto</button>
                </div>
            </div>
        );
    }

    return (
        <div className="patient-ai-insight-panel lume-panel overflow-hidden p-0">
            <div className="border-b border-slate-200/50 p-5 dark:border-white/5">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200"><Sparkles className="h-5 w-5" /></div>
                        <div><h3 className="text-base font-bold text-slate-900 dark:text-white">Supporto al ragionamento clinico</h3><p className="text-[10px] font-medium uppercase tracking-tight text-slate-400">Generazione manuale · proposta locale</p></div></div>
                    <button type="button" onClick={generateInsight} disabled={isGenerating || !enabled} className="flex h-9 items-center gap-2 rounded-full border border-slate-200/80 bg-white/80 px-4 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-white/10 dark:bg-white/10 dark:text-slate-200"><RefreshCw className="h-3.5 w-3.5" />{isGenerating ? 'Analisi…' : enabled ? 'Nuova bozza' : 'Disabilitata'}</button>
                </div>
            </div>
            <div className="space-y-5 p-5">
                {error && <div className="flex items-center gap-2 rounded-[20px] border border-red-200 bg-red-50 p-3 text-xs text-red-600"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
                {!enabled && <div data-testid="patient-insight-disabled-banner" className="rounded-[20px] border border-red-200 bg-red-50 p-3 text-xs text-red-700">La consultazione resta disponibile; nuove generazioni bloccate dal kill switch locale.</div>}
                {isGenerating && <div className="space-y-4 py-10 text-center"><Sparkles className="mx-auto h-7 w-7 text-slate-500" /><p className="text-sm font-bold text-slate-700">Analisi in corso</p><p className="text-[10px] font-medium uppercase tracking-widest text-slate-500">{progress}</p><button type="button" onClick={stopGeneration} className="text-[10px] font-bold uppercase tracking-wider text-red-500">Interrompi</button></div>}

                {!isGenerating && preview && (
                    <section className="space-y-5" data-testid="patient-insight-review-proposal">
                        <div className="flex flex-wrap gap-2"><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-800">Bozza da revisionare</span><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-800">0 scritture</span><span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-bold uppercase text-sky-900">Applicazione non consentita</span></div>
                        {preview.proposal.summary && <div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sintesi proposta</p><p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200"><PrivacyBlur intensity="sm">{preview.proposal.summary}</PrivacyBlur></p></div>}
                        {preview.proposal.currentState.length > 0 && <div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Quadro attuale</p><InsightList items={preview.proposal.currentState} /></div>}
                        {preview.proposal.alerts.length > 0 && <div className="rounded-[22px] border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/20 dark:bg-amber-950/10"><p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Attenzioni proposte</p><InsightList items={preview.proposal.alerts} warning /></div>}
                        {preview.proposal.nextSteps.length > 0 && <div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Follow-up proposto</p><InsightList items={preview.proposal.nextSteps} /></div>}
                        {preview.proposal.gaps.length > 0 && <div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dati mancanti</p><InsightList items={preview.proposal.gaps} /></div>}
                        <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4 text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                            <div className="mb-3 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" />Receipt, provenance e currentness</div>
                            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2"><div><dt className="text-slate-400">Esecuzione</dt><dd>{preview.receipt.provider} · {preview.receipt.model} · {preview.receipt.venue} · egress {preview.receipt.egress}</dd></div><div><dt className="text-slate-400">Provenance</dt><dd>{preview.provenance.preprocessing.join(' → ')}</dd></div><div><dt className="text-slate-400">Currentness</dt><dd>epoch {preview.proposal.currentness.selectionEpoch} · revisione {preview.proposal.currentness.patientRevision}</dd></div><div><dt className="text-slate-400">Cattura / verifica</dt><dd>{new Date(preview.proposal.currentness.capturedAt).toLocaleString('it-IT')} · {new Date(preview.proposal.currentness.verifiedAt).toLocaleString('it-IT')}</dd></div></dl>
                        </div>
                    </section>
                )}

                {!isGenerating && !preview && patient.aiSummary && (
                    <section className="space-y-3" data-testid="patient-insight-historical-summary"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-bold uppercase text-sky-900">Riepilogo storico salvato · sola lettura</span>{stale && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase text-amber-700">Dati modificati dopo la generazione</span>}</div>
                        <div className="prose prose-sm max-w-none text-slate-700 dark:prose-invert"><PrivacyBlur intensity="sm"><ReactMarkdown>{patient.aiSummary}</ReactMarkdown></PrivacyBlur></div>
                        <p className="text-[10px] text-slate-400">Le nuove generazioni non sostituiscono né aggiornano automaticamente questo contenuto.</p>
                    </section>
                )}
            </div>
        </div>
    );
}
