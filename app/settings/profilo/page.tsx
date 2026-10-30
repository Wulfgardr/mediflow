'use client';

// WUL-297 Profilo: moved from the monolithic settings page.

import { useState, useEffect, useRef } from 'react';
import { Save } from 'lucide-react';
import { Disclosure } from '@/components/disclosure';
import styles from '@/components/settings/account-pages.module.css';
import { useSecurity } from '@/components/security-provider';
import { AccountProfileDraftMemory } from '@/lib/security/account-profile-draft';
import { AccountProfileEditor, type ProfileEditorState } from '@/lib/security/account-profile-editor';
import { captureClientAccountAuthority, observeArchiveGeneration, subscribeClientAccountAuthority } from '@/lib/security/client-auth-api';
import { WorkProfileSettings } from '@/components/work-profile-onboarding';
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';
import {
    SETTINGS_INPUT_CLASS,
    SETTINGS_LABEL_CLASS,
    SETTINGS_PRIMARY_BUTTON_CLASS,
    SETTINGS_SECONDARY_BUTTON_CLASS,
} from '@/components/settings/settings-ui';

const pendingProfile = new AccountProfileDraftMemory();

export default function SettingsProfilePage() {
    const { user, updateUser } = useSecurity();
    const editor = useRef<AccountProfileEditor | null>(null);
    const updateUserRef = useRef(updateUser);
    useEffect(() => { updateUserRef.current = updateUser; }, [updateUser]);
    const [state, setState] = useState<ProfileEditorState>({
        draft: { doctorName: '', clinicName: '' }, current: null, busy: false, requiresRead: true, message: '',
    });
    const discarded = useRef(false);
    const userId = user?.id;
    useEffect(() => {
        if (!userId) return;
        const owner = new AccountProfileEditor(userId, captureClientAccountAuthority(), setState, (profile, isCurrent) => {
            observeArchiveGeneration(profile.archiveGeneration);
            updateUserRef.current({ id: profile.userId, displayName: profile.displayName ?? undefined, ambulatoryName: profile.ambulatoryName ?? undefined }, isCurrent);
        });
        editor.current = owner;
        setState(owner.state);
        const unsubscribe = subscribeClientAccountAuthority(() => owner.replaceAuthority(captureClientAccountAuthority()));
        let live = true;
        discarded.current = false;
        void owner.read().then(() => {
            if (!live || !owner.state.current) return;
            const draft = pendingProfile.resume(owner.state.current);
            if (draft) owner.resumeDraft(draft);
        });
        return () => {
            live = false;
            if (!discarded.current) pendingProfile.retain(owner.state.current, owner.state.draft);
            unsubscribe(); owner.dispose(); editor.current = null;
        };
    }, [userId]);
    const profile = state.draft;
    const [workProfileOpen, setWorkProfileOpen] = useState(false);
    useRuntimeTwinPendingForm(state.current !== null
        && (profile.doctorName !== (state.current.displayName ?? '')
            || profile.clinicName !== (state.current.ambulatoryName ?? '')), async () => {
            discarded.current = true;
            pendingProfile.discard();
        });

    return (
        <section className={styles.page} data-testid="settings-profile-section">
            <header className={styles.intro}>
                <h2>Profilo</h2>
                <p>Identità mostrata nei documenti generati: intestazione, ricette e referti.</p>
            </header>
            <section className={styles.section} aria-labelledby="settings-account-profile-title" aria-busy={state.busy}>
                <h3 id="settings-account-profile-title" className={styles.heading}>Nome medico e ambulatorio</h3>
                <div className={styles.form}>
                    <div>
                        <label htmlFor="doctor-name" className={SETTINGS_LABEL_CLASS}>
                            Nome medico
                        </label>
                        <input
                            id="doctor-name"
                            name="doctorName"
                            type="text"
                            value={profile.doctorName}
                            onChange={(e) => editor.current?.edit({ ...profile, doctorName: e.target.value })}
                            disabled={state.busy || !state.current}
                            maxLength={200}
                            placeholder="es. Dr. Mario Rossi"
                            autoComplete="name"
                            className={SETTINGS_INPUT_CLASS}
                        />
                    </div>

                    <div>
                        <label htmlFor="clinic-name" className={SETTINGS_LABEL_CLASS}>
                            Nome ambulatorio
                        </label>
                        <input
                            id="clinic-name"
                            name="clinicName"
                            type="text"
                            value={profile.clinicName}
                            onChange={(e) => editor.current?.edit({ ...profile, clinicName: e.target.value })}
                            disabled={state.busy || !state.current}
                            maxLength={200}
                            placeholder="es. Studio Medico Centro"
                            autoComplete="organization"
                            className={SETTINGS_INPUT_CLASS}
                        />
                    </div>

                    {state.busy && !state.current && <p role="status" className={styles.feedback}>Caricamento del profilo…</p>}
                    {state.message && <p role="status" className={styles.feedback}>{state.message}</p>}
                    {state.current && state.message && <p className="text-sm">
                        Valori salvati: {state.current.displayName || 'Nome medico vuoto'} · {state.current.ambulatoryName || 'Nome ambulatorio vuoto'}
                    </p>}
                    <div className={styles.actions}>
                        <button
                            onClick={() => void editor.current?.save()}
                            disabled={state.busy || state.requiresRead || !state.current}
                            className={workProfileOpen ? SETTINGS_SECONDARY_BUTTON_CLASS : SETTINGS_PRIMARY_BUTTON_CLASS}
                            data-settings-primary={!workProfileOpen ? true : undefined}
                        >
                            <Save className="w-4 h-4" />
                            {state.busy ? 'Attendi...' : 'Salva profilo'}
                        </button>
                        <button type="button" onClick={() => void editor.current?.read()} disabled={state.busy}
                            className={SETTINGS_SECONDARY_BUTTON_CLASS}>Rileggi profilo mantenendo la bozza</button>
                    </div>
                </div>
            </section>
            <Disclosure title="Il tuo modo di lavorare" headingLevel={3} className={styles.section}
                open={workProfileOpen} onOpenChange={setWorkProfileOpen}>
                <WorkProfileSettings showHeading={false} />
            </Disclosure>
        </section>
    );
}
