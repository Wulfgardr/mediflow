'use client';
/* @Codex: a read-only host-state projection; never accepts paths or executes provisioning. */
type PortableOption = Readonly<{ provider: string; state: string; provisioningState?: string; prerequisites?: readonly string[] }>;
const messages: Readonly<Record<string, string>> = Object.freeze({
    NEEDS_CONTEXT: 'Mancano runtime e pesi verificati: nessun motore portabile è attivo.',
    platform_unsupported: 'Questa piattaforma non è ammessa dal pacchetto locale.',
    model_not_provisioned: 'Pacchetto non ancora importato. È necessaria una preparazione locale esplicita.',
    needs_activation: 'Pacchetto importato e verificato, ma non ancora ammesso all’esecuzione.',
    admitted: 'Motore ammesso nelle impostazioni. Artefatto e autorizzazione saranno verificati alla richiesta.',
    revoked: 'Ammissione revocata. Questo artefatto non viene riattivato automaticamente.',
    artifact_tampered: 'Il controllo di integrità è fallito. Esecuzione bloccata; nessun modello alternativo.',
    license_missing: 'Documentazione di licenza incompleta: importazione bloccata.',
    manifest_invalid: 'Manifest non valido o incompleto: importazione bloccata.',
    interrupted: 'Preparazione interrotta. Serve un recupero esplicito da parte dell’operatore.',
    busy: 'Preparazione locale già in corso. Nessun secondo processo viene avviato.',
});
export function TreatmentReasoningPortableSetup({ option }: { option: PortableOption | undefined }) {
    if (option?.provider !== 'athena_transformers') return null;
    const state = option.provisioningState ?? 'NEEDS_CONTEXT';
    return <section aria-label="Preparazione Treatment Reasoning portabile" data-testid="treatment-portable-setup">
        <p role="status">{messages[state] ?? 'Stato non confermato: esecuzione bloccata.'}</p>
        <details><summary>Preparazione locale e limiti</summary>
            <p>ATHENA Transformers · CPU locale. L’operatore importa un pacchetto offline con manifest, pesi, runtime e licenze verificati; conferma poi separatamente l’ammissione. Nessun download viene avviato da questa schermata.</p>
            <p>L’ammissione non attiva il ragionamento terapeutico. L’interruttore della funzione e la scelta del modello restano decisioni separate.</p>
            <p>La configurazione non dimostra la qualità clinica o le prestazioni. Ogni risultato richiede revisione: nessuna scrittura clinica e nessun fallback implicito.</p>
            {!!option.prerequisites?.length && <p>Prerequisiti segnalati dall’host: {option.prerequisites.join(' · ')}</p>}
        </details>
    </section>;
}
