'use client';

// WUL-297 Profilo: moved from the monolithic settings page.

import { useState, useEffect, useRef } from 'react';
import { Save, User } from 'lucide-react';
import { useSecurity } from '@/components/security-provider';
import { AccountProfileEditor, type ProfileEditorState } from '@/lib/security/account-profile-editor';
import { captureClientAccountAuthority, observeArchiveGeneration, subscribeClientAccountAuthority } from '@/lib/security/client-auth-api';
import { WorkProfileSettings } from '@/components/work-profile-onboarding';
import {
    SETTINGS_CARD_CLASS,
    SETTINGS_INPUT_CLASS,
    SETTINGS_LABEL_CLASS,
    SETTINGS_PRIMARY_BUTTON_CLASS,
    SETTINGS_SECONDARY_BUTTON_CLASS,
    SettingsSectionIntro,
} from '@/components/settings/settings-ui';

export default function SettingsProfilePage() {
    const { user, updateUser } = useSecurity();
    const editor = useRef<AccountProfileEditor | null>(null);
    const updateUserRef = useRef(updateUser);
    useEffect(() => { updateUserRef.current = updateUser; }, [updateUser]);
    const [state, setState] = useState<ProfileEditorState>({
        draft: { doctorName: '', clinicName: '' }, current: null, busy: false, requiresRead: true, message: '',
    });
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
        void owner.read();
        return () => { unsubscribe(); owner.dispose(); editor.current = null; };
    }, [userId]);
    const profile = state.draft;

    return (
        <section className="space-y-4" data-testid="settings-profile-section">
            <SettingsSectionIntro
                kicker="Generale"
                title="Profilo"
                description="Identità mostrata nei documenti generati: intestazione, ricette e referti."
            />

            <div className={SETTINGS_CARD_CLASS}>
                {/* WUL-229: header icon disc + ink copy mapped to MediFlow tokens */}
                <div className="mb-5 flex items-start gap-3">
                    <div className="rounded-2xl p-2" style={{ background: 'color-mix(in srgb, var(--lume-ink) 6%, transparent)', color: 'var(--lume-ink)' }}>
                        <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <p className="section-kicker">Profilo</p>
                        <h2 className="mt-1 text-base font-semibold" style={{ color: 'var(--lume-ink)' }}>Nome medico e ambulatorio</h2>
                        <p className="mt-1 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>Mostrati in intestazione, ricette e referti generati.</p>
                    </div>
                </div>

                <div className="space-y-4">
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

                    {state.message && <p role="status" className="text-sm">{state.message}</p>}
                    {state.current && state.message && <p className="text-sm">
                        Valori salvati: {state.current.displayName || 'Nome medico vuoto'} · {state.current.ambulatoryName || 'Nome ambulatorio vuoto'}
                    </p>}
                    <div className="flex flex-wrap gap-3 pt-2">
                        <button
                            onClick={() => void editor.current?.save()}
                            disabled={state.busy || state.requiresRead || !state.current}
                            className={SETTINGS_PRIMARY_BUTTON_CLASS}
                        >
                            <Save className="w-4 h-4" />
                            {state.busy ? 'Attendi...' : 'Salva profilo'}
                        </button>
                        <button type="button" onClick={() => void editor.current?.read()} disabled={state.busy}
                            className={SETTINGS_SECONDARY_BUTTON_CLASS}>Rileggi profilo mantenendo la bozza</button>
                    </div>
                </div>
            </div>
            <WorkProfileSettings />
        </section>
    );
}
