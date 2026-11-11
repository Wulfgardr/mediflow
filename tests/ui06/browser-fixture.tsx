/* @Codex UI06: isolated real-component fixture. It does not start Next.js or any backend. */
import { useState } from 'react';
import { ViewState } from '../../components/ui/view-state';
import { CollapsibleSection } from '../../components/kree8/collapsible-section';
import { RuntimeTwinFolderContext } from '../../components/runtime-twin-design';
import sectionRecipe from '../../components/ink-section.module.css';
import { createRoot } from 'react-dom/client';
import ScaleEngine from '../../components/scale-engine';
import { ConfirmProvider, useConfirm } from '../../components/ui/confirm-dialog';
import { RuntimeTwinDesignProvider, useRuntimeTwinDesign } from '../../components/runtime-twin-design';
import { PatientClinicalSignals } from '../../components/patient-clinical-signals';
import { PatientIdentityLens } from '../../components/patient-identity-lens';
import SettingsLayout from '../../app/settings/layout';
import DocumentSynthesisFabricReviewCard from '../../components/document-synthesis-fabric-review-card';
import type { Patient } from '../../lib/db';
import type { ScaleResult } from '../../lib/scale-validation';
import { syntheticScale } from './synthetic-scale';
import { boundaryState } from './browser-boundaries';
import Timeline from '../../components/timeline';
import type { TimelineEntryData } from '../../components/timeline-entry-card';
import { notifyDbChange, useLiveQueryState } from '../../lib/live-query';
import ServicePrescriptionManager from '../../components/service-prescription-manager';
import ProstheticPrescriptionManager from '../../components/prosthetic-prescription-manager';
import SissHandoffDiary from '../../components/siss-handoff-diary';
import TherapyManager from '../../components/therapy-manager';
import { observeArchiveGeneration } from '../../lib/security/client-auth-api';

const scaleState = { calls: 0, cancelled: 0, results: [] as ScaleResult[], settle: null as null | ((failure: boolean) => void) };
/* Each diary read takes the next outcome from ?reads=fail,ok,...; once the list is spent, reads succeed. */
const diaryState = { calls: 0, plan: (new URLSearchParams(window.location.search).get('reads') ?? '').split(',').filter(Boolean) };
Object.assign(window, { ui06: { scale: scaleState, document: boundaryState, diary: diaryState } });
function CompositionControl() {
    const { composition, setComposition, pendingForms } = useRuntimeTwinDesign();
    return <div><button onClick={() => setComposition(composition === 'stream' ? 'workbench' : 'stream')}>Cambia composizione fixture</button><output aria-label="Bozza pendente">{String(pendingForms)}</output></div>;
}
function ScaleFixture() {
    const params = new URLSearchParams(window.location.search);
    const deferred = params.get('mode') === 'deferred';
    const [cancelled, setCancelled] = useState(false);
    return <RuntimeTwinDesignProvider><ConfirmProvider>
        <CompositionControl />
        {cancelled ? <p>Compilazione chiusa</p> : <ScaleEngine scale={syntheticScale} onCancel={() => { scaleState.cancelled += 1; setCancelled(true); }} onComplete={async result => {
            scaleState.calls += 1; scaleState.results.push(structuredClone(result));
            if (deferred) await new Promise<void>((resolve, reject) => { scaleState.settle = failure => { if (failure) reject(new Error('Errore sintetico')); else resolve(); }; });
        }} />}
    </ConfirmProvider></RuntimeTwinDesignProvider>;
}
function ConfirmationFixture() {
    const confirm = useConfirm();
    const [result, setResult] = useState('Nessuna decisione');
    return <><button onClick={async () => {
        const choice = await confirm({ title: 'Eliminare la terapia «Farmaco sintetico»?', message: 'La terapia verrà spostata nel cestino.', tone: 'danger', requireReason: true, confirmLabel: 'Elimina' });
        setResult(choice.confirmed ? `Eliminazione: ${choice.reason}` : 'Annullata');
    }}>Apri conferma sintetica</button><output aria-label="Decisione">{result}</output></>;
}
function SignalsFixture() {
    const empty = new URLSearchParams(window.location.search).has('empty');
    return <PatientClinicalSignals signals={empty ? [] : [
        { label: 'Documenti disponibili per revisione', value: 123456789, hint: 'Contesto completo inventato che deve restare leggibile anche nella colonna stretta senza essere troncato.' },
        { label: 'Terapie attive', value: 0, hint: 'Nessuna terapia registrata nella fixture' },
        { label: 'Dato non disponibile', value: 'n/d' },
    ]} />;
}
function IdentityFixture() {
    const requested = new URLSearchParams(window.location.search).get('domain');
    const domain = requested === 'clinica' || requested === 'amministrazione' ? requested : 'anagrafica';
    const patient = { id: 'ui06-patient', firstName: 'NomeSintetico', lastName: 'CognomeSintetico', taxCode: 'IDENTIFICATORE-INVENTATO', phone: '', address: '' } as Patient;
    return <PatientIdentityLens variant="reader" domain={domain} patient={patient} ageLabel="Età sintetica" birthDateLabel="Data sintetica" diagnoses={[{ code: 'SYNTHETIC', description: 'Diagnosi inventata UI06', system: 'TEST', date: new Date(2026, 0, 1, 12) }]} exemptions={['xx-sintetico']} exemptionDetails={[{ code: 'XX-SINTETICO', description: 'Esenzione inventata UI06' }]} />;
}
function SettingsFixture() {
    const [draft, setDraft] = useState('');
    return <SettingsLayout><label>Campo locale fixture<input value={draft} onChange={event => setDraft(event.currentTarget.value)} /></label></SettingsLayout>;
}
function SectionsFixture() {
    const [draft, setDraft] = useState<string | null>(null);
    return <RuntimeTwinDesignProvider><RuntimeTwinFolderContext.Provider value="parametri">
        <main className={sectionRecipe.sections}>
            <CollapsibleSection id="parametri" title="Misure" count="0 misure" keepMounted
                headerAction={<button onClick={() => setDraft(draft === null ? '' : null)}>Nuova misura</button>}>
                {draft === null ? <ViewState state="empty" title="Nessuna misura registrata." />
                    : <label>Bozza sintetica<input value={draft} onChange={event => setDraft(event.currentTarget.value)} /></label>}
            </CollapsibleSection>
            <ViewState state="empty" title="Nessuna terapia registrata." action={{ label: 'Nuova terapia', onClick: () => setDraft('terapia sintetica') }} />
            <ViewState state="loading" title="Lettura delle misure in corso…" />
            <ViewState state="error" title="Impossibile leggere le misure." />
            <ViewState state="unavailable" title="La lettura delle misure non è disponibile." />
        </main>
    </RuntimeTwinFolderContext.Provider></RuntimeTwinDesignProvider>;
}
const syntheticDiaryEntry = { id: 'ui06-entry', patientId: 'ui06-patient', type: 'visit', title: 'Visita sintetica UI06',
    content: '<p>Testo inventato UI06</p>', date: new Date(2026, 0, 1, 12), attachments: [], version: 1 } as unknown as TimelineEntryData;
/* Same wiring as the patient sheet: useLiveQueryState feeds entries, error and refresh to Timeline. */
function DiaryFixture() {
    const { data: entries, error, refresh } = useLiveQueryState(async () => {
        diaryState.calls += 1;
        if (diaryState.plan.shift() === 'fail') throw new Error('Lettura sintetica del diario non riuscita');
        return [syntheticDiaryEntry];
    }, [], undefined, ['entries']);
    return <RuntimeTwinDesignProvider><ConfirmProvider>
        <button onClick={() => notifyDbChange('entries')}>Rileggi il diario fixture</button>
        <Timeline entries={entries} readFailed={Boolean(error)} onRetry={refresh} patientDiary
            section={{ id: 'diario', kicker: 'Diario', title: 'Diario clinico', keepMounted: true, defaultOpen: true }} />
    </ConfirmProvider></RuntimeTwinDesignProvider>;
}
/* The panels below read through the real ApiTable; only window.fetch is replaced.
   Each read of the panel's list takes the next outcome from ?reads=fail,ok,...; once the list is spent, reads succeed. */
const panelState = { calls: 0, unexpected: [] as string[], plan: (new URLSearchParams(window.location.search).get('reads') ?? '').split(',').filter(Boolean) };
const panelRows: Record<string, { endpoint: string; row: Record<string, unknown>; extra?: Record<string, unknown> }> = {
    '/panel/service': { endpoint: '/api/service-prescriptions', row: { id: 'ui06-service', patientId: 'ui06-patient', serviceName: 'Ecografia sintetica UI06',
        status: 'prescribed', prescribedAt: '2026-01-01T12:00:00.000Z', version: 1 } },
    '/panel/prosthetic': { endpoint: '/api/prosthetic-prescriptions', row: { id: 'ui06-prosthetic', patientId: 'ui06-patient', description: 'Deambulatore sintetico UI06',
        category: 'mobility', status: 'prescribed', prescribedAt: '2026-01-01T12:00:00.000Z', version: 1 } },
    '/panel/siss': { endpoint: '/api/siss-handoffs', row: { id: 'ui06-siss', patientId: 'ui06-patient', moduleLabel: 'Passaggio sintetico UI06',
        outcome: 'completed', startedAt: '2026-01-01T12:00:00.000Z', version: 1 } },
    '/panel/therapy': { endpoint: '/api/therapies', row: { id: 'ui06-therapy', patientId: 'ui06-patient', drugName: 'Farmaco sintetico UI06',
        dosage: '1 compressa al giorno', status: 'active', createdAt: '2026-01-01T12:00:00.000Z', version: 1 },
        extra: { '/api/patients/ui06-patient': { id: 'ui06-patient', firstName: 'Paziente', lastName: 'Inventato', birthDate: '1950-01-01T00:00:00.000Z', version: 1 } } },
};
function installPanelFetch(endpoint: string, row: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    window.fetch = async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
        if (url.pathname === endpoint) {
            panelState.calls += 1;
            if (panelState.plan.shift() === 'fail') return new Response('{}', { status: 500 });
            return Response.json([row]);
        }
        if (url.pathname in extra) return Response.json(extra[url.pathname]);
        if (url.pathname.startsWith('/api/')) return Response.json([]);
        panelState.unexpected.push(url.pathname);
        throw new Error(`UI06: unexpected fetch ${url.pathname}`);
    };
}
function PanelFixture({ pathname }: { pathname: string }) {
    const target = panelRows[pathname];
    installPanelFetch(target.endpoint, target.row, target.extra);
    /* The therapy manager recovers status commands from the real journal (empty storage) under a synthetic archive generation. */
    if (pathname === '/panel/therapy') observeArchiveGeneration('00000000-0000-4000-8000-000000000006');
    const panel = pathname === '/panel/service' ? <ServicePrescriptionManager patientId="ui06-patient" />
        : pathname === '/panel/therapy' ? <TherapyManager patientId="ui06-patient" />
        : pathname === '/panel/prosthetic' ? <ProstheticPrescriptionManager patientId="ui06-patient" />
        : <SissHandoffDiary patientId="ui06-patient" />;
    return <RuntimeTwinDesignProvider><ConfirmProvider>
        <button onClick={() => notifyDbChange()}>Rileggi il pannello fixture</button>
        <section aria-label="Pannello fixture">{panel}</section>
    </ConfirmProvider></RuntimeTwinDesignProvider>;
}
Object.assign((window as unknown as { ui06: object }).ui06, { panel: panelState });
function App() {
    const pathname = window.location.pathname;
    if (pathname in panelRows) return <PanelFixture pathname={pathname} />;
    if (pathname === '/sections') return <SectionsFixture />;
    if (pathname === '/diary') return <DiaryFixture />;
    if (pathname.startsWith('/settings')) return <SettingsFixture />;
    if (pathname === '/confirm') return <ConfirmProvider><ConfirmationFixture /></ConfirmProvider>;
    if (pathname === '/signals') return <SignalsFixture />;
    if (pathname === '/identity') return <IdentityFixture />;
    if (pathname === '/synthesis') return <DocumentSynthesisFabricReviewCard patientId="ui06-patient" attachmentId="ui06-attachment" attachmentName="Documento inventato UI06.txt" enabled={!new URLSearchParams(window.location.search).has('disabled')} />;
    return <ScaleFixture />;
}
const root = document.getElementById('root');
if (!root) throw new Error('UI06 fixture root missing');
createRoot(root).render(<App />);
