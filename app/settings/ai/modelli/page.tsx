'use client';

/* @Codex */
import Link from 'next/link';
import { Bot, Cpu, RefreshCw, Save } from 'lucide-react';
import { useAiSettingsController } from '@/lib/hooks/use-ai-settings-controller';
import AiRolloutGuardNotice from '@/components/settings/ai-rollout-guard-notice';
import { ModelSelector } from '@/components/settings/ai-model-selector';
import styles from '@/components/settings/guided-local-models.module.css';
import {
    SETTINGS_CARD_CLASS, SETTINGS_INPUT_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS,
    SETTINGS_SECONDARY_BUTTON_CLASS, SettingsSectionIntro,
} from '@/components/settings/settings-ui';

const recommended = [
    { name: 'qwen3.5:35b-a3b', desc: 'Qwen 3.5 35B A3B · predefinito' },
    { name: 'qwen2.5:32b', desc: 'Qwen 2.5 32B · compatibilità precedente' },
    { name: 'qwen2.5:14b', desc: 'Qwen 2.5 14B · profilo bilanciato' },
    { name: 'qwen2.5:7b', desc: 'Qwen 2.5 7B · profilo leggero' },
];

export default function SettingsAiModelsPage() {
    const { hardwareProfile, aiConfig, setAiConfig, isSavingAi, aiTestStatus, aiHealth,
        applyHardwareProfile, saveAiConfig, testAiConnection } = useAiSettingsController();

    return (
        <section className={styles.surface} data-testid="settings-ai-models-section">
            <SettingsSectionIntro kicker="Intelligenza locale" title="Modelli e hardware"
                description="Collega Ollama, scegli i modelli installati e salva. Le funzioni cliniche richiedono un’abilitazione separata e revisione delle proposte." />

            {/* @Codex: presets remain explicit draft changes through the existing controller. */}
            <div className={`${SETTINGS_CARD_CLASS} ${styles.card} ${styles.stack}`}>
                <h3 className="text-base font-semibold">Configurazioni consigliate</h3>
                <p>Scegli un punto di partenza in base alla memoria del computer, oppure mantieni i modelli già selezionati.</p>
                <div className={styles.presets}>
                    {([
                        ['low', 'Leggero · meno di 16 GB', 'Qwen 2.5 7B'],
                        ['medium', 'Bilanciato · 16–32 GB', 'Qwen 2.5 14B'],
                        ['high', 'Avanzato · oltre 32 GB', 'Qwen 3.5 35B A3B'],
                    ] as const).map(([profile, label, model]) => (
                        <button type="button" key={profile} className={styles.preset}
                            aria-pressed={hardwareProfile === profile} onClick={() => applyHardwareProfile(profile)}>
                            <span className="block font-semibold">{label}</span>
                            <span className={styles.hint}>{model}</span>
                            <span className={styles.presetAction}>Usa questa configurazione nella bozza</span>
                        </button>
                    ))}
                </div>
                <p className={styles.hint}>Il preset sostituisce le selezioni dei due ruoli con lo stesso modello. La modifica resta in bozza: verifica i modelli installati e premi «Salva Configurazione». Nessun download o salvataggio automatico.</p>
                <dl className={styles.roles}>
                    <div>
                        <dt className="font-semibold">Sintesi e organizzazione</dt>
                        <dd className={styles.hint}>Modello di testo generale per riassumere e organizzare le informazioni estratte dai documenti.</dd>
                    </div>
                    <div>
                        <dt className="font-semibold">Ragionamento testuale</dt>
                        <dd className={styles.hint}>Modello per elaborare e confrontare informazioni testuali. Puoi sceglierne uno diverso nel passo 2.</dd>
                    </div>
                </dl>
                <p className={styles.hint}>La memoria è un’indicazione orientativa, non una verifica di compatibilità o qualità. Questi preset riguardano il testo; non configurano l’estrazione OCR o la revisione terapeutica ATHENA.</p>
            </div>

            <div className={`${SETTINGS_CARD_CLASS} ${styles.card} ${styles.stack}`}>
                <h3 className="text-base font-semibold">1. Verifica la connessione</h3>
                <p>Ollama per i ruoli generali. Treatment Reasoning usa la lane locale ATHENA separata.</p>
                <label htmlFor="ollama-url">Indirizzo di Ollama sul computer</label>
                <input id="ollama-url" type="text" value={aiConfig.url}
                    onChange={event => setAiConfig(previous => ({ ...previous, url: event.target.value }))}
                    placeholder="http://127.0.0.1:11434/v1" aria-label="URL provider Ollama"
                    aria-describedby="ollama-connection-help" className={SETTINGS_INPUT_CLASS} />
                <p id="ollama-connection-help" className={styles.hint}>Ollama deve essere già installato e avviato. Il test legge l’elenco dei modelli: non genera testo e non abilita funzioni.</p>
                <div className={styles.actions}>
                    <button type="button" onClick={testAiConnection} disabled={aiTestStatus === 'testing' || !aiConfig.url}
                        className={SETTINGS_SECONDARY_BUTTON_CLASS}>
                        <RefreshCw aria-hidden="true" className="h-4 w-4" />
                        {aiTestStatus === 'testing' ? 'Verifica in corso…' : 'Test Connessione'}
                    </button>
                </div>
                <div role="status" className={styles.notice}>
                    {aiTestStatus === 'testing' ? 'Lettura dei modelli da Ollama…'
                        : aiHealth ? aiHealth.message : 'Connessione non ancora verificata per questa configurazione.'}
                </div>
            </div>

            <div className={`${SETTINGS_CARD_CLASS} ${styles.card} ${styles.stack}`}>
                <h3 className="text-base font-semibold">2. Scegli i modelli</h3>
                <p className={styles.hint}>L’elenco viene letto da Ollama all’apertura e quando lo aggiorni. La scelta modifica la configurazione da salvare.</p>
                <ModelSelector selectorId="clinical" label="Sintesi e organizzazione"
                    description="Per sintesi, insight e organizzazione del testo dopo l’estrazione locale."
                    icon={<Bot aria-hidden="true" className="h-5 w-5" />} value={aiConfig.model_clinical}
                    onChange={value => setAiConfig(previous => ({ ...previous, model_clinical: value }))}
                    recommended={[...recommended, { name: 'hf.co/unsloth/medgemma-1.5-4b-it-GGUF', desc: 'MedGemma 4B · alternativa da valutare, non predefinita' }]}
                    provider={aiConfig.provider} targetUrl={aiConfig.url} />
                <ModelSelector selectorId="reasoning" label="Ragionamento testuale"
                    description="Per riassunti narrativi e supporto testuale generale; non configura la revisione terapeutica ATHENA."
                    icon={<Cpu aria-hidden="true" className="h-5 w-5" />} value={aiConfig.model_reasoning}
                    onChange={value => setAiConfig(previous => ({ ...previous, model_reasoning: value }))}
                    recommended={[...recommended, { name: 'deepseek-r1:14b', desc: 'DeepSeek R1 14B · ragionamento testuale' }]}
                    provider={aiConfig.provider} targetUrl={aiConfig.url} />
                <AiRolloutGuardNotice selections={[
                    { roleId: 'clinical', roleLabel: 'Sintesi e organizzazione', model: aiConfig.model_clinical },
                    { roleId: 'reasoning', roleLabel: 'Ragionamento testuale', model: aiConfig.model_reasoning },
                ]} />
            </div>

            <div className={`${SETTINGS_CARD_CLASS} ${styles.card} ${styles.stack}`}>
                <h3 className="text-base font-semibold">3. Salva e verifica le funzioni</h3>
                <div className={styles.actions}>
                    <button type="button" onClick={saveAiConfig} disabled={isSavingAi} className={SETTINGS_PRIMARY_BUTTON_CLASS}>
                        <Save aria-hidden="true" className="h-4 w-4" />
                        {isSavingAi ? 'Salvataggio...' : 'Salva Configurazione'}
                    </button>
                    <Link href="/settings/ai/funzioni">Abilita le funzioni cliniche</Link>
                    <Link href="/settings/ai/fabric">Verifica lo stato delle funzioni</Link>
                    <Link href="/settings/ai/governance">Consulta le verifiche dei modelli</Link>
                </div>
                <p className={styles.hint}>I risultati restano proposte da rivedere prima dell’uso. Salvare il modello non equivale ad ammettere il provider o a verificare una funzione clinica.</p>
            </div>

            {/* Documentation only: privileged lifecycle control remains on the host (ADR 0122). */}
            <details className={`${SETTINGS_CARD_CLASS} ${styles.card}`} id="local-provider-admission">
                <summary>Modello configurato, funzione ancora bloccata?</summary>
                <div className={styles.stack}>
                    <p>Il test connessione legge i modelli disponibili. Per ammettere Ollama, l’operatore del computer esegue il comando locale dalla cartella di MediFlow, indicando la directory dati corretta.</p>
                    <pre className={styles.commands}><code>{'npm run setup:local-provider -- inspect --data-dir /percorso/dati\nnpm run setup:local-provider -- admit --data-dir /percorso/dati --confirm-local-change'}</code></pre>
                    <p className={styles.hint}>La verifica può caricare il modello già installato in memoria. Non scarica modelli, non genera testo e lascia le funzioni spente finché non le abiliti. ATHENA usa il proprio percorso separato.</p>
                </div>
            </details>
        </section>
    );
}
