'use client';

import { InkState } from '@/components/ui/ink-state';
import type { PatientSmartImportProjectionCaptureInput } from '@/lib/domain/documents/patient-smart-import-projection-capture';
import styles from './patient-smart-import.module.css';
import { Disclosure } from '@/components/disclosure';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ChoiceField } from '@/components/choice-field';
import { FunctionModelPicker, useFunctionModelPicker } from '@/components/function-models/function-model-picker';
import PrivacyBlur from '@/components/privacy-blur';
import { createSmartImportReviewBrowserController } from '@/lib/security/smart-import-review-browser-controller';
import type { SmartImportPreviewWireRoot } from '@/lib/smart-import-preview-wire';
import { SmartImportContextProposalBrowserAdapterError, type SmartImportContextProposal, type SmartImportAmbulatoryChoice } from '@/lib/security/smart-import-patient-context-browser-adapter';
import disclosure from '@/components/patient-disclosure.module.css';

export function PatientSmartImportSummary({ hasProposal }: { hasProposal: boolean }) {
    return <div className={styles.summary} data-testid="smart-import-proposal-summary">
        <span>Smart Import · {hasProposal ? '1 proposta da rivedere' : 'Nessuna proposta da rivedere'}</span>
        <a href="#smart-import">Vai alle fonti e alle proposte</a>
    </div>;
}

export function PatientSmartImportFabricPreviewCard({ patientId, captureInput, enabled, onProposalChange }: {
    patientId: string;
    captureInput: PatientSmartImportProjectionCaptureInput;
    enabled: boolean;
    onProposalChange?: (capture: PatientSmartImportProjectionCaptureInput | null) => void;
}) {
    const picker = useFunctionModelPicker('smart_import', patientId, captureInput, enabled);
    const [controller] = useState(() => createSmartImportReviewBrowserController({ fetch: picker.client.fetch }));
    const generation = useRef(0); const handler = useRef(false);
    const [proposal, setProposal] = useState<SmartImportContextProposal | null>(null);
    const [ambulatory, setAmbulatory] = useState<SmartImportAmbulatoryChoice | null>(null); const [confirmed, setConfirmed] = useState(false);
    const [result, setResult] = useState<{ wire: SmartImportPreviewWireRoot; capture: PatientSmartImportProjectionCaptureInput } | null>(null); const [error, setError] = useState<string | null>(null); const [phase, setPhase] = useState<'idle' | 'loading' | 'confirm' | 'running' | 'terminal'>('idle');
    const reset = () => { generation.current += 1; handler.current = false; controller.reset(); setProposal(null); setAmbulatory(null); setConfirmed(false); setResult(null); setError(null); setPhase('idle'); };
    const resetFromContext = useEffectEvent(reset);
    const resetFromChoice = useEffectEvent(() => { if (phase === 'running') reset(); else { setResult(null); setConfirmed(false); } });
    useEffect(() => () => { generation.current += 1; controller.reset(); }, [controller]);
    useEffect(() => { resetFromContext(); }, [controller, patientId, captureInput, picker.active, picker.view.blocked]);
    useEffect(() => { resetFromChoice(); }, [picker.view.choice]);
    const load = async () => {
        if (phase !== 'idle' || handler.current || !enabled) return; handler.current = true; const token = ++generation.current; setPhase('loading'); setError(null);
        try { const value = await controller.readProposal(patientId); if (token !== generation.current) return; setProposal(value); setAmbulatory(null); setPhase('confirm'); }
        catch (loadError) { if (token !== generation.current) return; setError(loadError instanceof SmartImportContextProposalBrowserAdapterError && loadError.code === 'context_missing'
            ? 'Aggiungi un ambulatorio nelle impostazioni, poi riprova.' : 'Impossibile leggere paziente e ambulatori. Controlla la sessione e riprova.'); setPhase('terminal'); }
        finally { if (token === generation.current) handler.current = false; }
    };
    const run = async () => {
        if (phase !== 'confirm' || !proposal || !ambulatory || !confirmed || handler.current || !enabled) return; handler.current = true; const token = ++generation.current; const currentProposal = proposal; setPhase('running'); setError(null);
        try { const modelToken = await picker.client.begin(); const value = await controller.run({ patientId, proposal: currentProposal, ambulatory, captureInput }, true); if (token !== generation.current || !picker.client.isCurrent(modelToken)) return; setResult({ wire: value, capture: captureInput }); setProposal(null); setAmbulatory(null); setConfirmed(false); setPhase('terminal'); }
        catch { if (token !== generation.current) return; setProposal(null); setConfirmed(false); setError('Anteprima non disponibile. Scegli Ricomincia per ripartire.'); setPhase('terminal'); }
        finally { if (token === generation.current) handler.current = false; }
    };
    const preview = picker.active && result?.capture === captureInput ? result.wire.preview : undefined;
    useEffect(() => {
        onProposalChange?.(preview?.status === 'available' ? captureInput : null);
        return () => onProposalChange?.(null);
    }, [captureInput, onProposalChange, preview?.status]);
    return (
        <section className={`${disclosure.synthesis} space-y-4`} aria-label="Importazione assistita" data-testid="fabric-preview-card">
            <p>Raccogli dalle fonti della cartella una proposta di diagnosi, terapie e prestazioni da rivedere.</p>
            <FunctionModelPicker picker={picker} />
            {phase === 'idle' && <button type="button" className="ui-btn-secondary" disabled={!enabled || !picker.active} onClick={load}>Prepara proposta</button>}
            {phase === 'loading' && <p className="mt-2">Caricamento contesto…</p>}
            {phase === 'confirm' && proposal && (
                <div className="mt-2 space-y-2">
                    <p><PrivacyBlur>Paziente: {proposal.patientName}</PrivacyBlur></p>
                    <ChoiceField label="Ambulatorio per questa proposta" value={ambulatory?.ambulatoryId ?? ''}
                            onChange={event => { setAmbulatory(proposal.ambulatories.find(row => row.ambulatoryId === event.target.value) ?? null); setConfirmed(false); }}>
                            <option value="">Scegli l’ambulatorio</option>
                            {proposal.ambulatories.map(row => <option key={row.ambulatoryId} value={row.ambulatoryId}>{row.name}{row.address ? ` · ${row.address}` : ''}</option>)}
                        </ChoiceField>
                    <label className="flex min-h-11 items-start gap-3 py-2">
                        <input className="mt-1 h-4 w-4" type="checkbox" disabled={!ambulatory} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                        Confermo paziente e ambulatorio per una proposta da rivedere. La cartella resta invariata.
                    </label>
                    <div className="flex flex-wrap gap-3"><button type="button" className="ui-btn-primary" disabled={!enabled || !ambulatory || !confirmed || !picker.canGenerate} onClick={run}>Conferma e genera proposta</button>
                    <button type="button" className="ui-btn-secondary" onClick={reset}>Annulla</button></div>
                </div>
            )}
            {phase === 'running' && <p className="mt-2">Generazione anteprima…</p>}
            {phase === 'terminal' && (
                <>
                    <div className="mt-3 space-y-3">
                        {preview?.status === 'available' && (
                            <>
                                <div className={styles.proposal} data-testid="smart-import-review-proposal">
                                    <h4><InkState state="pencil">Proposta · da rivedere</InkState></h4>
                                    <p>0 scritture · applicazione non consentita</p>
                                    <PrivacyBlur intensity="sm">{preview.proposal.summary}</PrivacyBlur>
                                    <p>{preview.proposal.diagnoses.length} diagnosi · {preview.proposal.therapies.length} terapie · {preview.proposal.servicePrescriptions.length} prestazioni</p>
                                </div>
                                <div>
                                    <h4>Fonti raccolte per la proposta</h4>
                                    <ul className={styles.sources}>
                                        {result!.capture.sources.map(source => <li key={source.originKey}>
                                            <a href={source.kind === 'patient-notes' ? '#quadro' : source.kind === 'clinical-entry' ? '#diario' : '#documenti'}>{source.label}</a>
                                        </li>)}
                                    </ul>
                                    <p>Confronta la proposta con le fonti prima di registrare dati nella cartella.</p>
                                </div>
                                <p>Modello usato: {preview.receipt.provider} · {preview.receipt.model}</p>
                                <Disclosure className={disclosure.disclosure} title="Dettagli di verifica">
                                <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]" data-testid="smart-import-fabric-disclosure">
                                    <dt>Esecuzione</dt>
                                    <dd>{preview.receipt.provider} · {preview.receipt.model} · {preview.receipt.venue}</dd>
                                    <dt>Egress</dt>
                                    <dd>{preview.receipt.provider === 'chatgpt_subscription' ? 'Testo redatto inviato a OpenAI con consenso · nessun provider alternativo' : <>{preview.receipt.egressProfile.egress} · fallback {preview.receipt.fallbackCount}</>}</dd>
                                    <dt>Provenienza</dt>
                                    <dd>{preview.provenance.preprocessing.join(' → ')}</dd>
                                    <dt>Review</dt>
                                    <dd className="break-all type-code">{preview.reviewRef}</dd>
                                </dl>
                                </Disclosure>
                            </>
                        )}
                        {preview && preview.status !== 'available' && <p>Anteprima non disponibile come proposta utilizzabile.</p>}
                        {error && <p>{error}</p>}
                    </div>
                    <button className="ui-btn-secondary mt-2" type="button" onClick={() => { picker.client.reset(picker.active); reset(); }}>Ricomincia</button>
                </>
            )}
        </section>
    );
}
