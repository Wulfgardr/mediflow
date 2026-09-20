'use client';

/* @Codex */
import { FunctionModelPicker, useFunctionModelPicker } from '@/components/function-models/function-model-picker';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import PrivacyBlur from '@/components/privacy-blur';
import disclosure from '@/components/patient-disclosure.module.css';
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

/* @Codex: scoped control geometry overrides the legacy shared button chrome. */
const actionStyle = { borderRadius: 'var(--lume-control-radius, 12px)', fontSize: '0.875rem', minHeight: 44 };

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
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[color:var(--lume-ink)]">
            {items.map((item, index) => (
                <li key={`${index}-${item}`} className="flex gap-2">
                    {warning ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--lume-signal-warning)]" aria-hidden="true" />
                        : <span className="mt-0.5 shrink-0 text-[color:var(--lume-ink-muted)]" aria-hidden="true">·</span>}
                    <PrivacyBlur intensity="sm">{item}</PrivacyBlur>
                </li>
            ))}
        </ul>
    );
}

export default function AIPatientInsight({ patient, stale = false }: AIPatientInsightProps) {
    const patientKey = `${patient.id}:${patient.version ?? 'unknown'}`;
    const picker = useFunctionModelPicker('patient_insight', patientKey, stale);
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
    const preview = picker.active && storedPreview?.patientKey === patientKey ? storedPreview.value : null;
    const error = storedError?.patientKey === patientKey ? storedError.value : null;
    const isGenerating = generation.patientKey === patientKey && generation.active;
    const setError = (value: string | null) => setStoredError({ patientKey, value });

    useEffect(() => {
        abortControllerRef.current?.abort(); setPreview(null); setGeneration({ patientKey, active: false });
        return () => abortControllerRef.current?.abort();
    }, [patientKey, picker.active, picker.view.choice, picker.view.blocked]);

    const generateInsight = async () => {
        if (!enabled) {
            setError('Patient Insight è disabilitata localmente. Riattivala in Impostazioni per generare una nuova bozza.');
            return;
        }
        const controller = new AbortController(); abortControllerRef.current = controller;
        setGeneration({ patientKey, active: true }); setPreview(null); setError(null); setProgress('Raccolta del contesto clinico minimo…');
        try {
            const modelToken = await picker.client.begin();
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
            const response = await picker.client.fetch('/api/ai/patient-insight/preview', {
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
            if (controller.signal.aborted || !picker.client.isCurrent(modelToken)) return;
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
        picker.client.reset(picker.active);
        abortControllerRef.current?.abort(); abortControllerRef.current = null;
        setGeneration({ patientKey, active: false }); setProgress(''); setError('Generazione interrotta. Nessuna modifica è stata applicata.');
    };

    if (!patient.aiSummary && !preview && !isGenerating && !enabled) {
        return (
            /* @Codex: a disabled function is a compact state with an explicit recovery action. */
            <section className="min-w-0 space-y-4 py-3 text-sm leading-relaxed text-[color:var(--lume-ink)]" data-testid="patient-insight-disabled-card">
                <h3 className="text-base font-semibold">Patient Insight disabilitata</h3>
                <p className="text-[color:var(--lume-ink-muted)]">La scheda resta consultabile. Riattiva la funzione per generare una nuova bozza.</p>
                <Link href="/settings/ai/funzioni" className="ui-btn-secondary" style={actionStyle}>Apri Impostazioni AI</Link>
            </section>
        );
    }

    if (!patient.aiSummary && !preview && !isGenerating) {
        return (
            <section className="min-w-0 space-y-4 py-3 text-sm leading-relaxed text-[color:var(--lume-ink)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-64">
                        <h3 className="text-base font-semibold">Genera una proposta da revisionare</h3>
                        <p className="mt-1 text-[color:var(--lume-ink-muted)]">Un riepilogo temporaneo da confrontare con i dati in cartella. Nessun aggiornamento automatico.</p>
                    </div>
                    <button type="button" onClick={generateInsight} disabled={!picker.canGenerate} className="ui-btn-primary" style={actionStyle}><Sparkles className="h-4 w-4" aria-hidden="true" />Avvia supporto</button>
                </div>
                {error && <p role="alert" className="text-[color:var(--lume-signal-critical)]">{error}</p>}
                <FunctionModelPicker picker={picker} />
            </section>
        );
    }

    return (
        /* @Codex: one reading plane, visible clinical content and collapsed technical evidence. */
        <section className="min-w-0 space-y-5 py-3 text-sm leading-relaxed text-[color:var(--lume-ink)] [overflow-wrap:anywhere]">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-64">
                    <h3 className="text-base font-semibold">Supporto al ragionamento clinico</h3>
                    <p className="mt-1 text-[color:var(--lume-ink-muted)]">{picker.view.remote ? 'Generazione manuale · OpenAI con redazione locale' : 'Generazione manuale · proposta locale'}</p>
                </div>
                <button type="button" onClick={generateInsight} disabled={isGenerating || !enabled || !picker.canGenerate} className="ui-btn-secondary" style={actionStyle}><RefreshCw className="h-4 w-4" aria-hidden="true" />{isGenerating ? 'Analisi…' : enabled ? 'Nuova bozza' : 'Disabilitata'}</button>
            </header>
            <FunctionModelPicker picker={picker} />
            {error && <p role="alert" className="flex items-start gap-2 text-[color:var(--lume-signal-critical)]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p>}
            {!enabled && <p data-testid="patient-insight-disabled-banner" className="text-[color:var(--lume-ink-muted)]">La consultazione resta disponibile. La funzione è disabilitata per le nuove generazioni.</p>}
            {isGenerating && (
                <div className="flex flex-wrap items-center justify-between gap-3 py-4" role="status">
                    <div><p className="font-semibold">Analisi in corso</p><p className="mt-1 text-[color:var(--lume-ink-muted)]">{progress}</p></div>
                    <button type="button" onClick={stopGeneration} className="ui-btn-secondary" style={actionStyle}>Interrompi</button>
                </div>
            )}

            {!isGenerating && preview && (
                <section className="min-w-0 space-y-5" data-testid="patient-insight-review-proposal">
                    <div>
                        <h4 className="text-base font-semibold">Bozza da revisionare</h4>
                        <p className="mt-1 text-[color:var(--lume-ink-muted)]">La cartella resta invariata.</p>
                        <p className="mt-2"><span className="text-[color:var(--lume-ink-muted)]">Modello usato: </span>{preview.receipt.model} · {preview.receipt.provider}</p>
                    </div>
                    {preview.proposal.summary && <div><h4 className="font-semibold">Sintesi proposta</h4><p className="mt-2"><PrivacyBlur intensity="sm">{preview.proposal.summary}</PrivacyBlur></p></div>}
                    {preview.proposal.currentState.length > 0 && <div><h4 className="font-semibold">Quadro attuale</h4><InsightList items={preview.proposal.currentState} /></div>}
                    {preview.proposal.alerts.length > 0 && <div className="border-l-2 border-[color:var(--lume-signal-warning)] pl-4"><h4 className="font-semibold">Attenzioni proposte</h4><InsightList items={preview.proposal.alerts} warning /></div>}
                    {preview.proposal.nextSteps.length > 0 && <div><h4 className="font-semibold">Follow-up proposto</h4><InsightList items={preview.proposal.nextSteps} /></div>}
                    {preview.proposal.gaps.length > 0 && <div><h4 className="font-semibold">Dati mancanti</h4><InsightList items={preview.proposal.gaps} /></div>}
                    <div>
                        <h4 className="font-semibold">Dati di riferimento</h4>
                        <p className="mt-1 text-[color:var(--lume-ink-muted)]">Confronta i riferimenti della bozza con le informazioni in cartella.</p>
                        <nav aria-label="Dati in cartella per la revisione" className="mt-2 flex flex-wrap gap-2">
                            <Link href={`/patients/${patient.id}/modules#quadro`} className="ui-btn-secondary" style={actionStyle}>Quadro clinico</Link>
                            <Link href={`/patients/${patient.id}/modules#terapie`} className="ui-btn-secondary" style={actionStyle}>Terapie</Link>
                            <Link href={`/patients/${patient.id}/modules#diario`} className="ui-btn-secondary" style={actionStyle}>Diario</Link>
                        </nav>
                    </div>
                    <details className={disclosure.disclosure}>
                        <summary>Dettagli di verifica</summary>
                        <div className="space-y-3 pb-4 text-sm text-[color:var(--lume-ink-muted)]">
                            <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Receipt, provenance e currentness</p>
                            <p>0 scritture · Applicazione non consentita</p>
                            <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                                <div><dt>Esecuzione</dt><dd className="text-[color:var(--lume-ink)]">{preview.receipt.provider} · {preview.receipt.model} · {preview.receipt.venue} · egress {preview.receipt.egress}</dd></div>
                                <div><dt>Provenance</dt><dd className="text-[color:var(--lume-ink)]">{preview.provenance.preprocessing.join(' → ')}</dd></div>
                                <div><dt>Currentness</dt><dd className="text-[color:var(--lume-ink)]">epoch {preview.proposal.currentness.selectionEpoch} · revisione {preview.proposal.currentness.patientRevision}</dd></div>
                                <div><dt>Cattura / verifica</dt><dd className="text-[color:var(--lume-ink)]">{new Date(preview.proposal.currentness.capturedAt).toLocaleString('it-IT')} · {new Date(preview.proposal.currentness.verifiedAt).toLocaleString('it-IT')}</dd></div>
                            </dl>
                        </div>
                    </details>
                </section>
            )}

            {!isGenerating && !preview && patient.aiSummary && (
                <section className="space-y-3" data-testid="patient-insight-historical-summary">
                    <h4 className="font-semibold">Riepilogo storico salvato · sola lettura</h4>
                    {stale && <p className="text-[color:var(--lume-ink-muted)]">Dati modificati dopo la generazione</p>}
                    <div className="prose prose-sm max-w-none text-[color:var(--lume-ink)] prose-headings:text-[color:var(--lume-ink)] prose-strong:text-[color:var(--lume-ink)]"><PrivacyBlur intensity="sm"><ReactMarkdown>{patient.aiSummary}</ReactMarkdown></PrivacyBlur></div>
                    <p className="text-[color:var(--lume-ink-muted)]">Le nuove generazioni non sostituiscono né aggiornano automaticamente questo contenuto.</p>
                </section>
            )}
        </section>
    );
}
