'use client';

/* @Codex: disclosure and fresh UI acknowledgement only. Installation/consent records remain host-owned. */
import { useEffect, useRef, useState } from 'react';
import sidecarManifest from '@/docs/who-local-sidecar.manifest.json';
import releaseLock from '@/docs/who-local-release-lock.json';
import { whoSetupGuideStatus } from '@/lib/reference-data/who-local-setup-guide-state';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';

const steps = ['Prepara', 'Licenza', 'Installa e avvia', 'Verifica', 'Recupera'];
const commandStyle = { minHeight: 44, minWidth: 44 };
export function WhoLocalSetupGuide({ status, onRefresh }: { status?: string; onRefresh?: () => void }) {
    const [step, setStep] = useState(0);
    const [accepted, setAccepted] = useState(false);
    const [copy, setCopy] = useState<{ command: string; message: string } | null>(null);
    const details = useRef<HTMLDetailsElement>(null);
    const summary = useRef<HTMLElement>(null);
    const copyGeneration = useRef(0);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; ++copyGeneration.current; };
    }, []);
    function selectStep(index: number) {
        ++copyGeneration.current;
        setCopy(null);
        setStep(index);
    }
    function resetGuide() {
        selectStep(0);
        setAccepted(false); // Not stored, shared, or inferred from a previous user's acceptance.
    }
    async function copyCommand(command: string) {
        const generation = ++copyGeneration.current;
        let message: string;
        try { await navigator.clipboard.writeText(command); message = 'Comando copiato. Non è stato eseguito.'; }
        catch { message = 'Copia non disponibile: seleziona il comando e copialo manualmente.'; }
        if (mounted.current && generation === copyGeneration.current) setCopy({ command, message });
    }
    function commandBlock(command: string) {
        return <div className="rounded-lg border border-[color:var(--lume-border)] p-3">
            <code className="block break-all text-sm">{command}</code>
            <button type="button" style={commandStyle} className={`${SETTINGS_SECONDARY_BUTTON_CLASS} mt-2`} onClick={() => void copyCommand(command)}>Copia {command}</button>
            {copy?.command === command && <p className="mt-2 text-xs" role="status">{copy.message}</p>}
        </div>;
    }
    return <details ref={details} className="mt-5 text-sm" data-testid="who-local-setup-guide" onToggle={event => {
        if (!event.currentTarget.open) resetGuide();
    }}>
        <summary ref={summary} className="min-h-11 cursor-pointer content-center font-medium">Configura WHO sul Mac</summary>
        <p className="mt-3 leading-6">Questa pagina guida i passaggi, ma non installa, avvia o arresta servizi sul computer.</p>
        <nav aria-label="Passaggi configurazione WHO" className="mt-3 flex flex-wrap gap-2">
            {steps.map((title, index) => <button type="button" key={title} style={commandStyle} aria-current={step === index ? 'step' : undefined}
                disabled={index === 2 && !accepted} className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => selectStep(index)}>{index + 1}. {title}</button>)}
        </nav>
        <div className="mt-4 space-y-3 leading-6" role="region" aria-label={steps[step]}>
            {step === 0 && <>
                <h3 className="font-medium">Prepara il Mac che ospita MediFlow</h3>
                <p>Servono macOS su Apple Silicon, Node.js 24 e un runtime Docker locale già avviato con motore Linux ARM64. La procedura controlla contesto locale e porta 8382 senza cambiare il runtime scelto.</p>
                <p>Per il primo download serve una connessione. Controlla sul Mac lo spazio libero per immagine, catalogo e copie di recupero: questa pagina non lo misura e non dichiara i prerequisiti soddisfatti.</p>
                <p>Windows e Linux non sono supportati da questo percorso. Se la porta è occupata o esiste un servizio diverso, non cancellarlo: consulta il gestore.</p>
            </>}
            {step === 1 && <>
                <h3 className="font-medium">Leggi e accetta i termini WHO</h3>
                <p>WHO ICD API {releaseLock.version} · ICD-11 MMS {releaseLock.include.split('_')[0]} · inglese. La versione è quella prevista dal pacchetto, non una ricerca dell’ultima versione online.</p>
                <p><a href={sidecarManifest.license.url} target="_blank" rel="noopener noreferrer" className="underline">Apri i termini WHO per ICD-11</a></p>
                <label className="flex min-h-11 items-start gap-3">
                    <input type="checkbox" className="mt-2" checked={accepted} onChange={event => {
                        ++copyGeneration.current; setCopy(null); setAccepted(event.target.checked);
                    }} />
                    <span>Ho letto e accetto i termini WHO per proseguire con questa guida.</span>
                </label>
                <p>Questa conferma non viene salvata né inviata al server e non sostituisce il consenso sul Mac. Per una nuova installazione, la procedura locale richiede di scrivere <strong>ACCETTO</strong> prima di scaricare o creare il servizio.</p>
                <p>Una risposta diversa da ACCETTO annulla la nuova installazione. L’accettazione di un utente precedente non preseleziona questa casella.</p>
            </>}
            {step === 2 && <>
                <h3 className="font-medium">Installa e avvia dal Mac</h3>
                {accepted ? <>
                    <p>Nella cartella MediFlow, apri <strong>Setup_WHO.command</strong>, oppure esegui dal terminale del Mac:</p>
                    {commandBlock('./Setup_WHO.command')}
                    <p>La procedura usa il pin distribuito, richiede il consenso locale, avvia il solo servizio creato da essa e verifica catalogo, riavvio offline e ripristino. Se un controllo fallisce, non considerare WHO pronto.</p>
                    <p>Al termine scegli esplicitamente l’avvio di MediFlow proposto. Se MediFlow è già aperto, non viene interrotto: usa il launcher WHO al prossimo avvio. Per avviare un’installazione già qualificata:</p>
                    {commandBlock('./Setup_WHO.command start')}
                </> : <p>Torna a Licenza e conferma la lettura e accettazione prima di proseguire.</p>}
            </>}
            {step === 3 && <>
                <h3 className="font-medium">Verifica nel processo MediFlow corrente</h3>
                <p role="status">{whoSetupGuideStatus(status)}</p>
                <p>Rileggere lo stato non avvia il servizio e non installa il catalogo. Usa poi la ricerca di esempio qui sopra: una risposta dalla cache non dimostra che il servizio risponda adesso.</p>
                <div className="flex flex-wrap gap-2">
                    {onRefresh && <button type="button" style={commandStyle} className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={status === 'loading'} onClick={onRefresh}>Rileggi stato WHO</button>}
                    <a className={`${SETTINGS_SECONDARY_BUTTON_CLASS} inline-block`} style={commandStyle} href="#who-setup">Vai alla ricerca di prova</a>
                </div>
            </>}
            {step === 4 && <>
                <h3 className="font-medium">Recupera senza eliminare i dati</h3>
                <p>Controlla per prima cosa il servizio sul Mac. Questo comando legge lo stato; non scarica e non avvia WHO:</p>
                {commandBlock('./Setup_WHO.command status')}
                <p>Se Docker non risponde, avvia il runtime già scelto. Se un download non è riuscito, riapri la procedura e conferma la ripresa. Una qualifica incompleta mantiene WHO disabilitato e conserva le prove disponibili.</p>
                {accepted ? <>
                    <p>Per ripetere le verifiche del solo servizio registrato, con conferma nel terminale:</p>
                    {commandBlock('./Setup_WHO.command qualify')}
                </> : <p>Per i comandi che riprendono installazione e verifiche, torna prima al passaggio Licenza.</p>}
                <p>Porta occupata, registrazione incoerente, servizio non riconosciuto o recupero fallito richiedono il gestore. Non rimuovere container, copie o lock e non copiare prove da un altro computer.</p>
                <p>Chiudere questa guida non interrompe un’installazione già avviata sul Mac. Non è disponibile un arresto dal browser.</p>
            </>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" style={commandStyle} className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={step === 0} onClick={() => selectStep(step - 1)}>Indietro</button>
            <button type="button" style={commandStyle} className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={step === steps.length - 1 || (step === 1 && !accepted)} onClick={() => selectStep(step + 1)}>Avanti</button>
            <button type="button" style={commandStyle} className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => {
                resetGuide(); if (details.current) details.current.open = false; summary.current?.focus();
            }}>Annulla guida</button>
        </div>
    </details>;
}
