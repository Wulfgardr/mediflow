'use client';

/* @Codex */
import { useState } from 'react';
import Link from 'next/link';
import {
    EMPTY_WORK_PROFILE_ANSWERS, recommendWorkProfile, WORK_PROFILES, WORK_PROFILE_LABELS,
    workProfilePreview, type WorkProfileAnswers, type WorkProfileDraft,
} from '@/lib/work-profile';
import { useWorkProfile, type WorkProfileController } from '@/lib/hooks/use-work-profile';
import styles from './onboarding-experience.module.css';

const QUESTIONS: { key: keyof WorkProfileAnswers; title: string; options: { value: string; label: string }[] }[] = [
    { key: 'activity', title: 'Quale attività vuoi organizzare?', options: [
        { value: 'records', label: 'Consultare e compilare cartelle' },
        { value: 'organization', label: 'Organizzare il lavoro della postazione' },
        { value: 'repetitive', label: 'Preparare attività ripetitive da rivedere' },
    ] },
    { key: 'interaction', title: 'Come preferisci lavorare?', options: [
        { value: 'screens', label: 'Usare direttamente le schermate' },
        { value: 'delegate', label: 'Preparare il lavoro con un agente' },
        { value: 'mixed', label: 'Alternare schermate e agente' },
        { value: 'unsure', label: 'Devo ancora scegliere' },
    ] },
    { key: 'platform', title: 'Su quale sistema lavori?', options: [
        { value: 'macos', label: 'macOS' }, { value: 'windows', label: 'Windows' },
        { value: 'linux', label: 'Linux' }, { value: 'other', label: 'Altro o non so' },
    ] },
];

// Presentation copy only. The radio name remains the existing profile label.
const PROFILE_DESCRIPTIONS: Record<(typeof WORK_PROFILES)[number], string> = {
    interactive: 'Usa direttamente le schermate della cartella.',
    agent: 'Organizza il supporto di un agente, da collegare separatamente.',
    both: 'Alterna schermate e supporto di un agente, quando configurato.',
};

function newDraft(): WorkProfileDraft {
    return { profile: 'interactive', source: 'guided', answers: { ...EMPTY_WORK_PROFILE_ANSWERS }, step: 0 };
}

function ProfileEditor({ controller }: { controller: WorkProfileController }) {
    const { state, busy, error, change } = controller;
    const [draft, setDraft] = useState<WorkProfileDraft>(() => state?.draft ?? newDraft());
    const [rollbackPreview, setRollbackPreview] = useState(false);
    if (!state) return null;
    const disabled = busy || !!error;
    const recommendation = recommendWorkProfile(draft.answers);
    const preview = workProfilePreview(draft);
    const question = QUESTIONS[draft.step];

    const saveDraft = (next: WorkProfileDraft) => { void change('save-draft', next); };
    const manual = () => saveDraft({ ...newDraft(), source: 'manual', step: 3 });

    return (
        <div className={styles.stack}>
            {state.active && !state.draft ? (
                <>
                    <div className={styles.heading}>
                        <p role="status">Profilo salvato: <strong>{WORK_PROFILE_LABELS[state.active.profile]}</strong>.</p>
                        <p>All’apertura: {workProfilePreview(state.active).areaLabel}.</p>
                    </div>
                    <div className={styles.actions}>
                        <Link className={rollbackPreview || error ? styles.secondaryAction : styles.primaryAction}
                            href={`/?area=${workProfilePreview(state.active).area}`}>Apri il tuo spazio di lavoro</Link>
                        <button type="button" disabled={disabled} className={styles.secondaryAction}
                            onClick={() => saveDraft({ ...state.active!, step: 3 })}>Cambia profilo di lavoro</button>
                        <button type="button" disabled={disabled} className={styles.secondaryAction}
                            onClick={() => saveDraft(newDraft())}>Ripeti le domande</button>
                    </div>
                </>
            ) : (
                <>
                    {draft.step < 3 ? (
                        <>
                            <div className={styles.heading}>
                                <p className={styles.progress} aria-label="Avanzamento guida">Domanda {draft.step + 1} di 3</p>
                                <fieldset className={styles.question} disabled={disabled}>
                                    <legend>{question.title}</legend>
                                    <div className={styles.options}>
                                        {question.options.map((option) => (
                                            <label key={option.value} className={`${styles.option} ${draft.answers[question.key] === option.value ? styles.selected : ''}`}>
                                                <input type="radio" name={question.key} value={option.value}
                                                    checked={draft.answers[question.key] === option.value}
                                                    onChange={() => setDraft({ ...draft, answers: { ...draft.answers, [question.key]: option.value } })} />
                                                <span>{option.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            </div>
                            <p className={styles.hint}>Ogni avanzamento salva le risposte su questa postazione.</p>
                            <div className={styles.actions}>
                                {draft.step > 0 && <button type="button" disabled={disabled} className={styles.secondaryAction}
                                    onClick={() => saveDraft({ ...draft, step: draft.step - 1 })}>Indietro</button>}
                                <button type="button" disabled={disabled || !draft.answers[question.key]}
                                    className={rollbackPreview || error ? styles.secondaryAction : styles.primaryAction}
                                    onClick={() => saveDraft({ ...draft, step: draft.step + 1,
                                        profile: draft.step === 2 ? recommendation.profile : draft.profile })}>
                                    {draft.step === 2 ? 'Mostra anteprima' : 'Salva e continua'}
                                </button>
                                <button type="button" disabled={disabled} className={styles.secondaryAction} onClick={manual}>
                                    Scegli manualmente
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className={styles.heading}>
                                <h3 className={styles.previewTitle}>Anteprima del profilo</h3>
                                {draft.source === 'guided' ? (
                                    <p>Consigliato: <strong>{WORK_PROFILE_LABELS[recommendation.profile]}</strong>.</p>
                                ) : <p>Percorso manuale: scegli il profilo con cui iniziare.</p>}
                            </div>
                            <fieldset className={styles.question} disabled={disabled}>
                                <legend>Profilo da confermare</legend>
                                <div className={styles.options}>
                                    {WORK_PROFILES.map((profile) => (
                                        <label key={profile} className={`${styles.option} ${draft.profile === profile ? styles.selected : ''}`}>
                                            <input type="radio" name="work-profile" checked={draft.profile === profile}
                                                aria-labelledby={`work-profile-${profile}-label`}
                                                aria-describedby={`work-profile-${profile}-description`}
                                                onChange={() => {
                                                    // The radio responds immediately; confirmation waits for the persisted reread.
                                                    setDraft({ ...draft, profile });
                                                    saveDraft({ ...draft, profile });
                                                }} />
                                            <span className={styles.optionCopy}>
                                                <strong id={`work-profile-${profile}-label`}>{WORK_PROFILE_LABELS[profile]}{profile === 'both' ? ' · Interactive e Agent' : ''}</strong>
                                                <span id={`work-profile-${profile}-description`} className={styles.hint}>{PROFILE_DESCRIPTIONS[profile]}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                            <ul className={styles.confirmation} aria-label="Azioni da confermare">
                                <li>Salvare la preferenza {WORK_PROFILE_LABELS[draft.profile]} per questa postazione.</li>
                                <li>Aprire {preview.areaLabel} all’ingresso, mantenendo i collegamenti diretti alle altre aree.</li>
                                <li>Conservare la scelta precedente per poterla ripristinare dalle impostazioni.</li>
                            </ul>
                            <p className={styles.hint}>Il profilo non installa app e non attiva agenti.</p>
                            <div className={styles.actions}>
                                <button type="button" disabled={disabled} className={rollbackPreview || error ? styles.secondaryAction : styles.primaryAction}
                                    onClick={() => void change('confirm')}>Conferma profilo di lavoro</button>
                                <button type="button" disabled={disabled} className={styles.secondaryAction}
                                    onClick={() => saveDraft({ ...draft, source: 'guided', step: 0 })}>Rivedi le risposte</button>
                                {draft.source === 'guided' && <button type="button" disabled={disabled} className={styles.secondaryAction}
                                    onClick={manual}>Scegli manualmente</button>}
                            </div>
                        </>
                    )}
                    {state.draft && <div className={styles.draftActions}>
                        {!busy && !error && <p className={styles.draftStatus} role="status">Bozza salvata. Puoi interrompere e riprendere da qui.</p>}
                        <button type="button" disabled={disabled} className={styles.secondaryAction}
                            onClick={() => void change('discard-draft')}>Scarta la bozza</button>
                    </div>}
                </>
            )}
            {state.canRollback && (
                <div className={styles.rollback}>
                    {rollbackPreview ? (
                        <>
                            <p>Ripristino previsto: <strong>{state.previous ? WORK_PROFILE_LABELS[state.previous.profile] : 'Nessun profilo scelto'}</strong>.
                                La bozza corrente sarà scartata. Il setup dell’app e della sicurezza resta invariato.</p>
                            <div className={styles.actions}>
                                <button type="button" disabled={disabled} className={error ? styles.secondaryAction : styles.primaryAction}
                                    onClick={() => void change('rollback')}>Conferma ripristino del profilo</button>
                                <button type="button" disabled={disabled} className={styles.secondaryAction}
                                    onClick={() => setRollbackPreview(false)}>Annulla ripristino</button>
                            </div>
                        </>
                    ) : <button type="button" disabled={disabled} className={styles.secondaryAction}
                        onClick={() => setRollbackPreview(true)}>Ripristina la scelta precedente</button>}
                </div>
            )}
            <details className={styles.disclosure}>
                <summary>Dettagli del profilo</summary>
                <div className={styles.detailBody}>
                    {state.active && !state.draft ? (
                        <>
                            <p>{workProfilePreview(state.active).agentNote}</p>
                            <p>{workProfilePreview(state.active).platformNote}</p>
                        </>
                    ) : (
                        <>
                            {draft.source === 'guided' && draft.step === 3 && (
                                <>
                                    <p>{recommendation.reason}</p>
                                    <p>Raccomandazione calcolata con regole locali dalle tue risposte, senza un modello AI.</p>
                                </>
                            )}
                            <p>{preview.agentNote}</p>
                            <p>{preview.platformNote}</p>
                        </>
                    )}
                    <p>Solo preferenze di lavoro, senza informazioni cliniche. Il sistema dichiarato orienta le note e non verifica le integrazioni.</p>
                    <p>Account, PIN, chiavi, dati clinici e impostazioni di sicurezza restano invariati.</p>
                    <p>Puoi cambiare profilo in Impostazioni → Profilo. Nessun privilegio dipende dalle risposte.</p>
                </div>
            </details>
        </div>
    );
}

export function WorkProfileOnboarding({ controller }: { controller: WorkProfileController }) {
    const { state, busy, error, reload } = controller;
    return (
        <section className={`${styles.experience} ${styles.profile}`} aria-labelledby="work-profile-title" data-testid="work-profile-onboarding" aria-busy={busy}>
            <header className={styles.heading}>
                <h2 id="work-profile-title">Il tuo modo di lavorare</h2>
                <p>Scegli da dove iniziare. Puoi usare la cartella senza AI.</p>
                <nav className={styles.links} aria-label="Percorsi sempre disponibili">
                    <Link className={styles.textAction} href="/?area=turno">Apri la cartella manualmente</Link>
                </nav>
            </header>
            {error && <div role="alert" className={styles.alert}>
                <p className={styles.errorText}>{error}</p>
                <button type="button" disabled={busy} className={styles.primaryAction} onClick={() => void reload()}>Rileggi lo stato</button>
            </div>}
            {busy && <p className={styles.hint} role="status">Lettura o salvataggio del profilo…</p>}
            {state && <ProfileEditor key={`${state.revision}:${controller.snapshotVersion}`} controller={controller} />}
            <nav className={styles.links} aria-label="Configurazione facoltativa">
                <Link className={styles.textAction} href="/settings/ai/fabric">Configurazione AI facoltativa</Link>
                <Link className={styles.textAction} href="/settings/diagnostica">Diagnostica della postazione</Link>
            </nav>
        </section>
    );
}

export function WorkProfileSettings() {
    const controller = useWorkProfile();
    return <WorkProfileOnboarding controller={controller} />;
}
