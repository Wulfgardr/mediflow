'use client';

/* @Codex */
import { useState } from 'react';
import Link from 'next/link';
import {
    EMPTY_WORK_PROFILE_ANSWERS, recommendWorkProfile, WORK_PROFILES, WORK_PROFILE_LABELS,
    workProfilePreview, type WorkProfileAnswers, type WorkProfileDraft,
} from '@/lib/work-profile';
import { useWorkProfile, type WorkProfileController } from '@/lib/hooks/use-work-profile';
import {
    SETTINGS_CARD_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS,
} from '@/components/settings/settings-ui';

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
        <div className="space-y-5">
            {state.active && !state.draft ? (
                <>
                    <p role="status">Profilo salvato: <strong>{WORK_PROFILE_LABELS[state.active.profile]}</strong>.</p>
                    <p>All’apertura: {workProfilePreview(state.active).areaLabel}.</p>
                    <p className="text-sm" style={{ color: 'var(--lume-ink-muted)' }}>{workProfilePreview(state.active).agentNote}</p>
                    <div className="flex flex-wrap gap-3">
                        <button type="button" disabled={disabled} className={SETTINGS_PRIMARY_BUTTON_CLASS}
                            onClick={() => saveDraft({ ...state.active!, step: 3 })}>Cambia profilo di lavoro</button>
                        <button type="button" disabled={disabled} className={SETTINGS_SECONDARY_BUTTON_CLASS}
                            onClick={() => saveDraft(newDraft())}>Ripeti le domande</button>
                        <Link className={SETTINGS_SECONDARY_BUTTON_CLASS} href={`/?area=${workProfilePreview(state.active).area}`}>Apri il tuo spazio di lavoro</Link>
                    </div>
                </>
            ) : (
                <>
                    {draft.step < 3 ? (
                        <>
                            <p className="mf-eyebrow">Domanda {draft.step + 1} di 3</p>
                            <fieldset className="space-y-3" disabled={disabled}>
                                <legend className="mb-3 text-lg font-semibold">{question.title}</legend>
                                {question.options.map((option) => (
                                    <label key={option.value} className={`mf-option-card ${draft.answers[question.key] === option.value ? 'is-active' : ''}`}
                                        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <input type="radio" name={question.key} value={option.value}
                                            checked={draft.answers[question.key] === option.value}
                                            onChange={() => setDraft({ ...draft, answers: { ...draft.answers, [question.key]: option.value } })} />
                                        <span>{option.label}</span>
                                    </label>
                                ))}
                            </fieldset>
                            <p className="text-sm" style={{ color: 'var(--lume-ink-muted)' }}>
                                Solo preferenze di lavoro, senza informazioni cliniche. Ogni avanzamento salva le risposte sul nodo locale.
                                Il sistema dichiarato orienta le note e non verifica le integrazioni.
                            </p>
                            <div className="flex flex-wrap gap-3">
                                {draft.step > 0 && <button type="button" disabled={disabled} className={SETTINGS_SECONDARY_BUTTON_CLASS}
                                    onClick={() => saveDraft({ ...draft, step: draft.step - 1 })}>Indietro</button>}
                                <button type="button" disabled={disabled || !draft.answers[question.key]}
                                    className={SETTINGS_PRIMARY_BUTTON_CLASS}
                                    onClick={() => saveDraft({ ...draft, step: draft.step + 1,
                                        profile: draft.step === 2 ? recommendation.profile : draft.profile })}>
                                    {draft.step === 2 ? 'Mostra anteprima' : 'Salva e continua'}
                                </button>
                                <button type="button" disabled={disabled} className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={manual}>
                                    Scegli manualmente
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <h3 className="text-lg font-semibold">Anteprima del profilo</h3>
                            {draft.source === 'guided' ? (
                                <div className="space-y-2">
                                    <p>Consigliato: <strong>{WORK_PROFILE_LABELS[recommendation.profile]}</strong>. {recommendation.reason}</p>
                                    <p className="text-sm" style={{ color: 'var(--lume-ink-muted)' }}>Raccomandazione calcolata con regole locali dalle tue risposte, senza un modello AI.</p>
                                </div>
                            ) : <p>Percorso manuale: scegli il profilo con cui iniziare.</p>}
                            <fieldset className="space-y-3" disabled={disabled}>
                                <legend className="mb-2 font-semibold">Profilo da confermare</legend>
                                {WORK_PROFILES.map((profile) => (
                                    <label key={profile} className={`mf-option-card ${draft.profile === profile ? 'is-active' : ''}`}
                                        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <input type="radio" name="work-profile" checked={draft.profile === profile}
                                            onChange={() => {
                                                // The radio responds immediately; confirmation waits for the persisted reread.
                                                setDraft({ ...draft, profile });
                                                saveDraft({ ...draft, profile });
                                            }} />
                                        <span>{WORK_PROFILE_LABELS[profile]}{profile === 'both' ? ' · Interactive e Agent' : ''}</span>
                                    </label>
                                ))}
                            </fieldset>
                            <ul className="list-disc pl-5 space-y-2 text-sm" aria-label="Azioni da confermare">
                                <li>Salvare la preferenza {WORK_PROFILE_LABELS[draft.profile]} per questa postazione.</li>
                                <li>Aprire {preview.areaLabel} all’ingresso, mantenendo i collegamenti diretti alle altre aree.</li>
                                <li>Conservare la scelta precedente per poterla ripristinare dalle impostazioni.</li>
                            </ul>
                            <p className="text-sm">Account, PIN, chiavi, dati clinici e impostazioni di sicurezza restano invariati.</p>
                            <p className="text-sm">{preview.agentNote}</p>
                            <p className="text-sm" style={{ color: 'var(--lume-ink-muted)' }}>{preview.platformNote}</p>
                            <div className="flex flex-wrap gap-3">
                                <button type="button" disabled={disabled} className={SETTINGS_PRIMARY_BUTTON_CLASS}
                                    onClick={() => void change('confirm')}>Conferma profilo di lavoro</button>
                                <button type="button" disabled={disabled} className={SETTINGS_SECONDARY_BUTTON_CLASS}
                                    onClick={() => saveDraft({ ...draft, source: 'guided', step: 0 })}>Rivedi le risposte</button>
                                {draft.source === 'guided' && <button type="button" disabled={disabled} className={SETTINGS_SECONDARY_BUTTON_CLASS}
                                    onClick={manual}>Scegli manualmente</button>}
                            </div>
                        </>
                    )}
                    {state.draft && <div className="flex flex-wrap items-center gap-3">
                        {!busy && !error && <p className="text-sm" role="status">Bozza salvata. Puoi interrompere e riprendere da qui.</p>}
                        <button type="button" disabled={disabled} className={SETTINGS_SECONDARY_BUTTON_CLASS}
                            onClick={() => void change('discard-draft')}>Scarta la bozza</button>
                    </div>}
                </>
            )}
            {state.canRollback && (
                <div className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--lume-border)' }}>
                    {rollbackPreview ? (
                        <>
                            <p>Ripristino previsto: <strong>{state.previous ? WORK_PROFILE_LABELS[state.previous.profile] : 'Nessun profilo scelto'}</strong>.
                                La bozza corrente sarà scartata. Il setup dell’app e della sicurezza resta invariato.</p>
                            <div className="flex flex-wrap gap-3">
                                <button type="button" disabled={disabled} className={SETTINGS_PRIMARY_BUTTON_CLASS}
                                    onClick={() => void change('rollback')}>Conferma ripristino del profilo</button>
                                <button type="button" disabled={disabled} className={SETTINGS_SECONDARY_BUTTON_CLASS}
                                    onClick={() => setRollbackPreview(false)}>Annulla ripristino</button>
                            </div>
                        </>
                    ) : <button type="button" disabled={disabled} className={SETTINGS_SECONDARY_BUTTON_CLASS}
                        onClick={() => setRollbackPreview(true)}>Ripristina la scelta precedente</button>}
                </div>
            )}
        </div>
    );
}

export function WorkProfileOnboarding({ controller }: { controller: WorkProfileController }) {
    const { state, busy, error, reload } = controller;
    return (
        <section className={`${SETTINGS_CARD_CLASS} space-y-5`} aria-labelledby="work-profile-title" data-testid="work-profile-onboarding" aria-busy={busy}>
            <div className="space-y-2">
                <p className="mf-eyebrow">Preferenze della postazione</p>
                <h2 id="work-profile-title" className="text-2xl font-semibold">Il tuo modo di lavorare</h2>
                <p>Tre domande per scegliere da dove iniziare. Puoi cambiare profilo in Impostazioni → Profilo.</p>
                <p className="text-sm" style={{ color: 'var(--lume-ink-muted)' }}>Nessun account AI, Codex, cloud, costo o download richiesto dalla guida. Nessun privilegio dipende dalle risposte.</p>
            </div>
            {error && <div role="alert" className="space-y-3">
                <p>{error}</p>
                <button type="button" disabled={busy} className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => void reload()}>Rileggi lo stato</button>
            </div>}
            {busy && <p role="status">Lettura o salvataggio del profilo…</p>}
            {state && <ProfileEditor key={state.revision} controller={controller} />}
            <nav className="flex flex-wrap gap-4 text-sm" aria-label="Percorsi sempre disponibili">
                <Link className="underline" href="/?area=turno">Apri la cartella manualmente</Link>
                <Link className="underline" href="/settings/ai/fabric">Configurazione AI facoltativa</Link>
                <Link className="underline" href="/settings/diagnostica">Diagnostica della postazione</Link>
            </nav>
        </section>
    );
}

export function WorkProfileSettings() {
    const controller = useWorkProfile();
    return <WorkProfileOnboarding controller={controller} />;
}
