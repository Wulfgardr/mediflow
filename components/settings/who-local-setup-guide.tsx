'use client';

/* @Codex: ordinary progressive guide. Host installation never runs in the Web app. */
import { useState } from 'react';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';

const steps = ['Prepara', 'Installa', 'Verifica'];
const command = './Setup_WHO.command';
export function WhoLocalSetupGuide({ status, onRefresh }: { status?: string; onRefresh?: () => void }) {
    const [step, setStep] = useState(0);
    const [copy, setCopy] = useState<'idle' | 'done' | 'error'>('idle');
    async function copyCommand() {
        try { await navigator.clipboard.writeText(command); setCopy('done'); }
        catch { setCopy('error'); }
    }
    return <details className="mt-5 text-sm" data-testid="who-local-setup-guide">
        <summary className="cursor-pointer font-medium">Configura WHO sul Mac</summary>
        <nav aria-label="Passaggi configurazione WHO" className="mt-3 flex flex-wrap gap-2">
            {steps.map((title, index) => <button type="button" key={title} aria-current={step === index ? 'step' : undefined} className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => setStep(index)}>{index + 1}. {title}</button>)}
        </nav>
        <div className="mt-4 space-y-3 leading-6" role="region" aria-label={steps[step]}>
            {step === 0 && <>
                <h3 className="font-medium">Prepara il Mac che ospita MediFlow</h3>
                <p>Serve un Mac Apple Silicon con Docker avviato. La procedura controlla i prerequisiti e ti indica cosa manca.</p>
                <p>Tieni disponibile la connessione per il primo download e spazio per il catalogo e le copie di recupero. Windows e Linux non sono ancora supportati da questa procedura.</p>
            </>}
            {step === 1 && <>
                <h3 className="font-medium">Apri la procedura di installazione</h3>
                <p>Nella cartella MediFlow, apri <strong>Setup_WHO.command</strong>. In alternativa, esegui questo comando nel terminale del Mac:</p>
                <div className="rounded-lg border border-[color:var(--lume-border)] p-3">
                    <code className="block break-all text-sm">{command}</code>
                    <button type="button" className={`${SETTINGS_SECONDARY_BUTTON_CLASS} mt-2`} onClick={() => void copyCommand()}>Copia comando</button>
                    {copy !== 'idle' && <p className="mt-2 text-xs" role="status">{copy === 'done' ? 'Copiato. Eseguilo sul Mac che ospita MediFlow.' : 'Copia non disponibile: seleziona il comando.'}</p>}
                </div>
                <p>La procedura ti chiede di accettare i termini WHO per ICD-11 2026-01 in inglese, scarica la versione prevista e controlla avvio e recupero. Se un controllo fallisce, conserva il lavoro e spiega come riprendere.</p>
            </>}
            {step === 2 && <>
                <h3 className="font-medium">Apri MediFlow e prova WHO</h3>
                <p>Al termine scegli l’avvio di MediFlow proposto dalla procedura. Per riaprirlo con WHO, puoi usare di nuovo <strong>Setup_WHO.command</strong>.</p>
                <p>Se MediFlow è già aperto, la procedura lo lascia in esecuzione: usa la procedura al prossimo avvio.</p>
                {status && <p className="font-medium" role="status">{status === 'loading' ? 'Lettura dello stato WHO…' : status === 'error' ? 'Impossibile leggere lo stato WHO. Riprova.' : ['available', 'configured'].includes(status) ? 'Configurazione WHO caricata. Prova la ricerca qui sopra.' : status === 'unavailable' ? 'WHO non risponde. Riapri la procedura sul Mac per controllarlo.' : 'La configurazione WHO non è ancora caricata in questa sessione.'}</p>}
                <div className="flex flex-wrap gap-2">
                    {onRefresh && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={onRefresh}>Rileggi stato WHO</button>}
                    <a className={`${SETTINGS_SECONDARY_BUTTON_CLASS} inline-block`} href="#who-setup">Vai alla ricerca di prova</a>
                </div>
            </>}
        </div>
        <div className="mt-4 flex gap-2">
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={step === 0} onClick={() => setStep(value => value - 1)}>Indietro</button>
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={step === steps.length - 1} onClick={() => setStep(value => value + 1)}>Avanti</button>
        </div>
    </details>;
}
