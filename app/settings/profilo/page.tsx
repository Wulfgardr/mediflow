'use client';

// WUL-297 Profilo: moved from the monolithic settings page.

import { useState, useEffect } from 'react';
import { Save, User } from 'lucide-react';
import { useSecurity } from '@/components/security-provider';
import { useToast } from '@/components/ui/toast-provider';
import {
    SETTINGS_CARD_CLASS,
    SETTINGS_INPUT_CLASS,
    SETTINGS_LABEL_CLASS,
    SETTINGS_PRIMARY_BUTTON_CLASS,
    SettingsSectionIntro,
} from '@/components/settings/settings-ui';

export default function SettingsProfilePage() {
    // --- Profile State ---
    const { user, updateUser } = useSecurity();
    const { showToast } = useToast();
    const [profile, setProfile] = useState({
        doctorName: '',
        clinicName: ''
    });
    const [isSavingProfile, setIsSavingProfile] = useState(false);

    // Sync profile with user context
    useEffect(() => {
        if (user) {
            setProfile({
                doctorName: user.displayName || '',
                clinicName: user.ambulatoryName || ''
            });
        }
    }, [user]);

    const saveProfile = async () => {
        if (!user) return;
        setIsSavingProfile(true);
        try {
            const res = await fetch('/api/auth/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.id,
                    displayName: profile.doctorName,
                    ambulatoryName: profile.clinicName
                })
            });

            if (!res.ok) throw new Error("Update failed");

            updateUser({
                displayName: profile.doctorName,
                ambulatoryName: profile.clinicName
            });

            showToast({ tone: 'success', title: 'Profilo aggiornato' });
        } catch (e) {
            console.error(e);
            showToast({ tone: 'error', title: 'Errore durante il salvataggio del profilo' });
        } finally {
            setIsSavingProfile(false);
        }
    };

    return (
        <section className="space-y-4" data-testid="settings-profile-section">
            <SettingsSectionIntro
                kicker="Generale"
                title="Profilo"
                description="Identità mostrata nei documenti generati: intestazione, ricette e referti."
            />

            <div className={SETTINGS_CARD_CLASS}>
                {/* @Codex WUL-229: header icon disc + ink copy mapped to MediFlow tokens */}
                <div className="mb-5 flex items-start gap-3">
                    <div className="rounded-2xl p-2" style={{ background: 'rgba(15, 23, 42, 0.06)', color: 'var(--lume-ink)' }}>
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
                            onChange={(e) => setProfile({ ...profile, doctorName: e.target.value })}
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
                            onChange={(e) => setProfile({ ...profile, clinicName: e.target.value })}
                            placeholder="es. Studio Medico Centro"
                            autoComplete="organization"
                            className={SETTINGS_INPUT_CLASS}
                        />
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={saveProfile}
                            disabled={isSavingProfile}
                            className={SETTINGS_PRIMARY_BUTTON_CLASS}
                        >
                            <Save className="w-4 h-4" />
                            {isSavingProfile ? 'Salvataggio...' : 'Salva profilo'}
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
