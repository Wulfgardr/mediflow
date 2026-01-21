'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { ShieldCheck, User, Building, ArrowRight, Check } from 'lucide-react';
import { useSecurity } from './security-provider';

export default function OnboardingWizard() {
    const { requiresSetup } = useSecurity(); // We use this to detect if it's first run ever
    // Actually, we should check if profile exists. 
    // If PIN setup is required, likely profile is missing too.

    // Check if profile is already set
    const profile = useLiveQuery(async () => {
        const name = await db.settings.get('doctorName');
        return name;
    });

    const [step, setStep] = useState<1 | 2>(1);
    const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
    const [doctorName, setDoctorName] = useState('');
    const [clinicName, setClinicName] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // If profile exists or we are not in "requiresSetup" mode (meaning PIN is set), 
    // maybe we shouldn't show this? 
    // BUT we want to capture profile even if PIN was set in previous version (v0.2).
    // So we check: !profile && isAuthenticated. 
    // Wait, if !profile, we show this. 

    // Logic: 
    // Show if: Profile is Missing AND (User is Authenticated OR User Needs Setup)
    // Actually, best place is inside LockScreen or covering Layout.

    // Let's assume this component is rendered by specific logic in Layout or SecurityProvider.
    // Here we just handle the UI behavior.

    const handleSaveProfile = async () => {
        setIsSaving(true);
        try {
            await db.settings.bulkPut([
                { key: 'doctorName', value: doctorName },
                { key: 'clinicName', value: clinicName },
                { key: 'onboardingCompleted', value: 'true' }
            ]);
            // Force reload to apply changes to sidebar context etc
            window.location.reload();
        } catch (e) {
            console.error(e);
            setIsSaving(false);
        }
    };

    if (profile !== undefined && profile) {
        return null; // Already onboarding done
    }

    // Loading state for query
    if (profile === undefined) return null;

    return (
        <div className="fixed inset-0 z-[60] bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#161b22] w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 dark:border-[#30363d] overflow-hidden">
                <div className="h-2 bg-blue-600 w-full" />

                <div className="p-8">
                    <div className="mb-8 text-center">
                        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <ShieldCheck className="w-8 h-8" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Benvenuto in MediFlow</h2>
                        <p className="text-gray-500 dark:text-gray-400 mt-2">Configura la tua cartella clinica personale.</p>
                    </div>

                    {step === 1 && (
                        <div className="space-y-6">
                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 p-4 rounded-xl">
                                <h3 className="font-bold text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4" />
                                    Privacy & GDPR
                                </h3>
                                <p className="text-sm text-amber-700 dark:text-amber-300 text-justify">
                                    Questa applicazione adotta un approccio <strong>Local-First Best Practice</strong> per la gestione dei dati.
                                    Le informazioni sono salvate <strong>esclusivamente</strong> sul disco di questo dispositivo, cifrate e protette.
                                    Non esiste cloud. Sebbene progettata con principi di Privacy by Design, l'applicazione richiede una tua validazione formale per la piena compliance GDPR in ambito professionale.
                                    Tu sei l'unico Titolare del Trattamento.
                                </p>
                            </div>

                            <label className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors">
                                <input
                                    type="checkbox"
                                    className="mt-1 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    checked={acceptedPrivacy}
                                    onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                                />
                                <span className="text-sm text-gray-600 dark:text-gray-300">
                                    Ho compreso che i dati sono salvati in locale e accetto la responsabilità della loro gestione in conformità con le normative vigenti.
                                </span>
                            </label>

                            <button
                                onClick={() => setStep(2)}
                                disabled={!acceptedPrivacy}
                                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                            >
                                Continua <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome e Cognome (Medico)</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Es. Dr. Mario Rossi"
                                        className="w-full pl-10 p-3 rounded-xl border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#0d1117] focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                        value={doctorName}
                                        onChange={(e) => setDoctorName(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome Ambulatorio / Clinica</label>
                                <div className="relative">
                                    <Building className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Es. Studio Medico Centro"
                                        className="w-full pl-10 p-3 rounded-xl border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#0d1117] focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                        value={clinicName}
                                        onChange={(e) => setClinicName(e.target.value)}
                                    />
                                </div>
                            </div>

                            <button
                                onClick={handleSaveProfile}
                                disabled={!doctorName || !clinicName || isSaving}
                                className="w-full mt-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:shadow-lg hover:shadow-blue-500/30 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                            >
                                {isSaving ? 'Salvataggio...' : <>Inizia <Check className="w-4 h-4" /></>}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
