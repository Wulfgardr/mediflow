/* @Codex */
'use client';

import { useEffect, useRef, useState } from 'react';
import PrivacyBlur from '@/components/privacy-blur';
import { createSmartImportReviewBrowserController } from '@/lib/security/smart-import-review-browser-controller';
import type { SmartImportPreviewWireRoot } from '@/lib/smart-import-preview-wire';

export function PatientSmartImportFabricPreviewCard({ patientId, captureInput, enabled }: { patientId: string; captureInput: unknown; enabled: boolean }) {
    const [controller] = useState(() => createSmartImportReviewBrowserController());
    const generation = useRef(0); const handler = useRef(false);
    const [proposal, setProposal] = useState<Readonly<{ ambulatoryId: string }> | null>(null); const [confirmed, setConfirmed] = useState(false);
    const [result, setResult] = useState<SmartImportPreviewWireRoot | null>(null); const [error, setError] = useState<string | null>(null); const [phase, setPhase] = useState<'idle' | 'loading' | 'confirm' | 'running' | 'terminal'>('idle');
    const reset = () => { generation.current += 1; handler.current = false; controller.reset(); setProposal(null); setConfirmed(false); setResult(null); setError(null); setPhase('idle'); };
    useEffect(() => () => { generation.current += 1; controller.reset(); }, [controller]);
    useEffect(() => { reset(); }, [controller, patientId, captureInput]);
    const load = async () => {
        if (phase !== 'idle' || handler.current || !enabled) return; handler.current = true; const token = ++generation.current; setPhase('loading'); setError(null);
        try { const value = await controller.readProposal(); if (token !== generation.current) return; setProposal(value); setPhase('confirm'); }
        catch { if (token !== generation.current) return; setError('Contesto non disponibile. Ricaricalo manualmente.'); setPhase('terminal'); }
        finally { if (token === generation.current) handler.current = false; }
    };
    const run = async () => {
        if (phase !== 'confirm' || !proposal || !confirmed || handler.current || !enabled) return; handler.current = true; const token = ++generation.current; const currentProposal = proposal; setPhase('running'); setError(null);
        try { const value = await controller.run({ patientId, proposal: currentProposal, captureInput }, true); if (token !== generation.current) return; setResult(value); setProposal(null); setConfirmed(false); setPhase('terminal'); }
        catch { if (token !== generation.current) return; setProposal(null); setConfirmed(false); setError('Anteprima non disponibile. Usa Reset anteprima per ripartire.'); setPhase('terminal'); }
        finally { if (token === generation.current) handler.current = false; }
    };
    const preview = result?.preview;
    return (
        <section className="m-5 rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-accent)_25%,transparent)] p-4" data-testid="fabric-preview-card">
            <p className="text-xs font-bold">Fabric · anteprima sola lettura</p>
            {phase === 'idle' && <button type="button" disabled={!enabled} onClick={load}>Carica contesto</button>}
            {phase === 'loading' && <p className="mt-2">Caricamento contesto…</p>}
            {phase === 'confirm' && proposal && (
                <div className="mt-2 space-y-2">
                    <p>ID ambulatorio: <code>{proposal.ambulatoryId}</code></p>
                    <label>
                        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                        {' '}Confermo di generare solo un’anteprima, senza scritture.
                    </label>
                    <button type="button" disabled={!enabled || !confirmed} onClick={run}>Genera anteprima (sola lettura)</button>
                </div>
            )}
            {phase === 'running' && <p className="mt-2">Generazione anteprima…</p>}
            {phase === 'terminal' && (
                <>
                    <div className="mt-3 space-y-3">
                        {preview?.status === 'available' && (
                            <>
                                <div>
                                    <p>0 scritture · applicazione non consentita</p>
                                    <PrivacyBlur intensity="sm">{preview.proposal.summary}</PrivacyBlur>
                                    <p>{preview.proposal.diagnoses.length} diagnosi · {preview.proposal.therapies.length} terapie · {preview.proposal.servicePrescriptions.length} prestazioni</p>
                                </div>
                                <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]" data-testid="smart-import-fabric-disclosure">
                                    <dt>Receipt</dt>
                                    <dd>{preview.receipt.provider} · {preview.receipt.model} · {preview.receipt.venue}</dd>
                                    <dt>Egress</dt>
                                    <dd>{preview.receipt.egressProfile.egress} · fallback {preview.receipt.fallbackCount}</dd>
                                    <dt>Provenienza</dt>
                                    <dd>{preview.provenance.preprocessing.join(' → ')}</dd>
                                    <dt>Review</dt>
                                    <dd className="break-all font-mono text-[10px]">{preview.reviewRef}</dd>
                                </dl>
                            </>
                        )}
                        {preview && preview.status !== 'available' && <p>Anteprima non disponibile come proposta utilizzabile.</p>}
                        {error && <p>{error}</p>}
                    </div>
                    <button className="mt-2" type="button" onClick={reset}>Reset anteprima</button>
                </>
            )}
        </section>
    );
}
