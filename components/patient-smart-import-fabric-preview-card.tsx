/* @Codex */
'use client';

import { useEffect, useRef, useState } from 'react';
import PrivacyBlur from '@/components/privacy-blur';
import { createSmartImportReviewBrowserController } from '@/lib/security/smart-import-review-browser-controller';
import type { SmartImportPreviewWireRoot } from '@/lib/smart-import-preview-wire';

export function PatientSmartImportFabricPreviewCard({ patientId, captureInput, enabled }: { patientId: string; captureInput: unknown; enabled: boolean }) {
    const controller = useRef(createSmartImportReviewBrowserController()).current;
    const [proposal, setProposal] = useState<Readonly<{ ambulatoryId: string }> | null>(null); const [confirmed, setConfirmed] = useState(false);
    const [result, setResult] = useState<SmartImportPreviewWireRoot | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
    useEffect(() => () => controller.reset(), [controller]);
    useEffect(() => { controller.reset(); setProposal(null); setConfirmed(false); setResult(null); setError(null); }, [controller, patientId, captureInput]);
    const load = async () => { setBusy(true); setError(null); try { setProposal(await controller.readProposal()); } catch { setError('Contesto non disponibile. Ricaricalo manualmente.'); } finally { setBusy(false); } };
    const run = async () => { if (!proposal) return; setBusy(true); setError(null); try { setResult(await controller.run({ patientId, proposal, captureInput }, true)); setProposal(null); setConfirmed(false); } catch { setError('Anteprima non disponibile. Ricarica manualmente il contesto.'); } finally { setBusy(false); } };
    const preview = result?.preview;
    return <section className="m-5 rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-accent)_25%,transparent)] p-4" data-testid="fabric-preview-card">
        <p className="text-xs font-bold">Fabric · anteprima sola lettura</p>
        {!proposal ? <button type="button" disabled={!enabled || busy} onClick={load}>Carica contesto</button> : <div className="mt-2 space-y-2"><p>ID ambulatorio: <code>{proposal.ambulatoryId}</code></p><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confermo di generare solo un’anteprima, senza scritture.</label><button type="button" disabled={!enabled || busy || !confirmed} onClick={run}>Genera anteprima (sola lettura)</button></div>}
        {preview?.status === 'available' && <div className="mt-3"><p>0 scritture · applicazione non consentita</p><PrivacyBlur intensity="sm">{preview.proposal.summary}</PrivacyBlur><p>{preview.proposal.diagnoses.length} diagnosi · {preview.proposal.therapies.length} terapie · {preview.proposal.servicePrescriptions.length} prestazioni</p></div>}
        {preview && preview.status !== 'available' && <p className="mt-3">Anteprima non disponibile come proposta utilizzabile.</p>}
        {error && <p className="mt-3">{error}</p>}
    </section>;
}
