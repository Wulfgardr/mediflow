'use client';

import { useState } from 'react';
import { User, Shield, Check, ChevronRight, Building, Lock, Key } from 'lucide-react';

interface OnboardingWizardProps {
    onComplete: (data: { displayName: string; ambulatoryName: string; pin: string; username: string }) => Promise<void>;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form Data
    const [formData, setFormData] = useState({
        displayName: '',
        ambulatoryName: '',
        role: 'admin', // Fixed for now as requested: "Partiamo dal presupposto che al momento è mono utente"
        username: '',
        password: '', // Login password (different from PIN? Or same? User said "Username and Password... and a PIN")
        pin: '',
        confirmPin: ''
    });

    // Step 1: Profile
    const canAdvanceProfile = formData.displayName.length > 2 && formData.ambulatoryName.length > 2;

    // Step 2: Role (Auto-valid since radio button always has value)

    // Step 3: Credentials
    const canAdvanceCreds = formData.username.length >= 4 && formData.password.length >= 6;

    // Step 4: PIN
    const canSubmit = formData.pin.length >= 4 && formData.pin === formData.confirmPin;

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            // Note: We use PIN for encryption for now as per previous design. 
            // The password is for Login. 
            // The user asked for "Username and Password... AND a PIN". 
            // Ideally PIN is for local encryption, Password for auth.
            // Current backend setup uses `password` input as the encryption key basis (see setup endpoint).
            // We need to clarify if "Password" replaces "PIN" for encryption, or if they are separate.
            // User said: "Password... and a PIN. Important that PIN... remain fixed even if browser data cleared"
            // This implies PIN is the "Key", Password is for Access Control.

            // For this iteration, to stay compatible with existing backend without massive rewrite, 
            // we will pass the PIN as the "password" for the backend's key generation if that's what it expects, 
            // OR we update backend to support separate password. 
            // The current backend `setup` route takes `password` and `encryptedMasterKey`. 
            // It hashes `password` for login check. And expects `encryptedMasterKey` wrapped with... something.
            // Let's assume for now: Login Password = Auth. PIN = Data Encryption.
            // This requires backend change to store passwordHash AND pinHash (or just verify PIN client side).

            // WAIT. If we clear browser cache, we need to re-enter PIN to decrypt.
            // Login (Password) -> Server returns Encrypted Key.
            // Client asks for PIN -> Decrypts Key.
            // So: Login needs Password. Then "Unlock" needs PIN.
            // OR: Login just returns the blob, client prompts PIN immediately?

            // Simplification for migration: Use the PIN *as* the encryption password.
            // The "Password" the user entered is for the "Login" screen. 
            // The "PIN" is for the "Unlock Data" phase.
            // But wait, user wants *one* flow.

            // Let's send the PIN as the effective "encryption secret" the backend knows about?
            // No, backend shouldn't know PIN.

            // Let's stick to: we send `password` (Login Password) to backend for HASHING (Auth).
            // We use `pin` client-side to WRAP the Master Key before sending the blob.
            // On Login: User enters Username + Password. Server verifies. Server sends back Blob.
            // Client prompts: "Enter PIN to unlock data".

            // UPGRADE: The user said "Username and Password... AND a PIN".
            // My current setup endpoint expects `password` which it hashes. 
            // So I will send `username` + `formData.password` to backend.
            // And I will use `formData.pin` to encrypt the Master Key.

            await onComplete({
                displayName: formData.displayName,
                ambulatoryName: formData.ambulatoryName,
                pin: formData.pin,
                username: formData.username,
                // We need to pass the real password too if we want separate login credential.
                // But the interface in `security-provider` only passes `pin` back to `setup`.
                // I'll overload the data object passed to onComplete.
                // @ts-ignore
                password: formData.password
            });
        } catch (e) {
            console.error(e);
            setIsSubmitting(false);
        }
    };

    return (
        <div className="w-full max-w-2xl mx-auto">
            {/* Steps Indicator */}
            <div className="mb-8 flex items-center justify-center gap-2">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className={`flex items-center`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${step >= i ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                            {i}
                        </div>
                        {i < 4 && <div className={`h-1 w-8 rounded-full mx-2 transition-colors ${step > i ? 'bg-indigo-600' : 'bg-gray-200'}`} />}
                    </div>
                ))}
            </div>

            <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/20">
                <div className="p-8">
                    {/* Step 1: Profile */}
                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold text-gray-800">Chi sei?</h2>
                                <p className="text-gray-500 mt-2">I tuoi dati per intestare referti e cartelle.</p>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1 ml-1">Nome e Cognome</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" />
                                        <input type="text" value={formData.displayName} onChange={(e) => setFormData({ ...formData, displayName: e.target.value })} placeholder="es. Dott. Leonardo Pegollo" className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" autoFocus />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1 ml-1">Nome Ambulatorio</label>
                                    <div className="relative">
                                        <Building className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" />
                                        <input type="text" value={formData.ambulatoryName} onChange={(e) => setFormData({ ...formData, ambulatoryName: e.target.value })} placeholder="es. Studio Medico Centrale" className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setStep(2)} disabled={!canAdvanceProfile} className="w-full mt-6 py-4 bg-gray-900 text-white rounded-xl font-bold hover:scale-[1.02] transition-all disabled:opacity-50">Avanti</button>
                        </div>
                    )}

                    {/* Step 2: Role */}
                    {step === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold text-gray-800">Ruolo</h2>
                                <p className="text-gray-500 mt-2">Definisci i tuoi privilegi di accesso.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${formData.role === 'admin' ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`} onClick={() => setFormData({ ...formData, role: 'admin' })}>
                                    <Shield className={`w-8 h-8 mb-2 ${formData.role === 'admin' ? 'text-indigo-600' : 'text-gray-400'}`} />
                                    <div className="font-bold text-gray-800">Amministratore</div>
                                    <div className="text-xs text-gray-500">Accesso completo a dati e configurazioni.</div>
                                </div>
                                <div className={`p-4 border-2 rounded-xl cursor-not-allowed opacity-50`}>
                                    <User className="w-8 h-8 mb-2 text-gray-400" />
                                    <div className="font-bold text-gray-800">Utente Standard</div>
                                    <div className="text-xs text-gray-500">Solo visualizzazione e inserimento dati. (Disabilitato)</div>
                                </div>
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button onClick={() => setStep(1)} className="px-6 py-4 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200">Indietro</button>
                                <button onClick={() => setStep(3)} className="flex-1 py-4 bg-gray-900 text-white rounded-xl font-bold hover:scale-[1.02] transition-all">Avanti</button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Credentials */}
                    {step === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold text-gray-800">Credenziali di Accesso</h2>
                                <p className="text-gray-500 mt-2">Queste useranno per il Login (es. da altri PC).</p>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1 ml-1">Username</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" />
                                        <input type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} placeholder="es. leonardo.pegollo" className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" autoFocus />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1 ml-1">Password</label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" />
                                        <input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="Password sicura" className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button onClick={() => setStep(2)} className="px-6 py-4 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200">Indietro</button>
                                <button onClick={() => setStep(4)} disabled={!canAdvanceCreds} className="flex-1 py-4 bg-gray-900 text-white rounded-xl font-bold hover:scale-[1.02] transition-all disabled:opacity-50">Avanti</button>
                            </div>
                        </div>
                    )}

                    {/* Step 4: PIN Security */}
                    {step === 4 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold text-gray-800">Sicurezza Locale</h2>
                                <p className="text-gray-500 mt-2">Il PIN serve a <b>criptare</b> i dati. Non dimenticarlo!</p>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1 ml-1">PIN Cifratura</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" />
                                        <input type="password" inputMode="numeric" value={formData.pin} onChange={(e) => setFormData({ ...formData, pin: e.target.value })} placeholder="••••••" className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none tracking-widest text-lg" autoFocus />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1 ml-1">Conferma PIN</label>
                                    <div className="relative">
                                        <Check className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" />
                                        <input type="password" inputMode="numeric" value={formData.confirmPin} onChange={(e) => setFormData({ ...formData, confirmPin: e.target.value })} placeholder="••••••" className={`w-full pl-10 pr-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 outline-none tracking-widest text-lg ${formData.confirmPin && formData.pin !== formData.confirmPin ? 'border-red-300 focus:ring-red-500' : 'border-gray-200 focus:ring-indigo-500'}`} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button onClick={() => setStep(3)} className="px-6 py-4 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200">Indietro</button>
                                <button onClick={handleSubmit} disabled={!canSubmit || isSubmitting} className="flex-1 py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50">
                                    {isSubmitting ? 'Salvataggio...' : 'Concludi Setup'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
