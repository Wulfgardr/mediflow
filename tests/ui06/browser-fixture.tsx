/* @Codex UI06: isolated real-component fixture. It does not start Next.js or any backend. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ScaleEngine from '../../components/scale-engine';
import { ConfirmProvider } from '../../components/ui/confirm-dialog';
import { RuntimeTwinDesignProvider, useRuntimeTwinDesign } from '../../components/runtime-twin-design';
import { PatientClinicalSignals } from '../../components/patient-clinical-signals';
import { PatientIdentityLens } from '../../components/patient-identity-lens';
import SettingsLayout from '../../app/settings/layout';
import DocumentSynthesisFabricReviewCard from '../../components/document-synthesis-fabric-review-card';
import type { Patient } from '../../lib/db';
import type { ScaleResult } from '../../lib/scale-validation';
import { syntheticScale } from './synthetic-scale';
import { boundaryState } from './browser-boundaries';

const scaleState = { calls: 0, cancelled: 0, results: [] as ScaleResult[], settle: null as null | ((failure: boolean) => void) };
Object.assign(window, { ui06: { scale: scaleState, document: boundaryState } });
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
function App() {
    const pathname = window.location.pathname;
    if (pathname.startsWith('/settings')) return <SettingsFixture />;
    if (pathname === '/signals') return <SignalsFixture />;
    if (pathname === '/identity') return <IdentityFixture />;
    if (pathname === '/synthesis') return <DocumentSynthesisFabricReviewCard patientId="ui06-patient" attachmentId="ui06-attachment" attachmentName="Documento inventato UI06.txt" enabled={!new URLSearchParams(window.location.search).has('disabled')} />;
    return <ScaleFixture />;
}
const root = document.getElementById('root');
if (!root) throw new Error('UI06 fixture root missing');
createRoot(root).render(<App />);
