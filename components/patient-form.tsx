'use client';

import { useForm, useFieldArray, Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, User, Phone, MapPin, HeartHandshake, FileText, Activity, Plus, Trash2, AlertTriangle, Calendar } from 'lucide-react';
import ICDAutocomplete from '@/components/icd-autocomplete';
import { estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';

import { patientSchema, PatientFormValues } from '@/lib/schemas';

interface PatientFormProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultValues?: any;
    onSubmit: (data: PatientFormValues) => Promise<void>;
    isSubmitting?: boolean;
    isEditMode?: boolean;
}

function DiagnosesFieldArray({ control, register, errors, setValue, watch }: { control: Control<PatientFormValues>, register: UseFormRegister<PatientFormValues>, errors: FieldErrors<PatientFormValues>, setValue: UseFormSetValue<PatientFormValues>, watch: UseFormWatch<PatientFormValues> }) {
    const { fields, append, remove } = useFieldArray({
        control,
        name: "diagnoses"
    });

    return (
        <div className="space-y-3">
            {fields.length === 0 && (
                <p className="text-sm text-gray-400 italic">Nessuna diagnosi registrata.</p>
            )}

            {fields.map((field, index) => (
                <div key={field.id} className="flex flex-col md:flex-row gap-3 items-start p-3 bg-red-50/50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-white/5 relative group animate-in fade-in focus-within:z-50">
                    {/* Delete Button */}
                    <button
                        type="button"
                        onClick={() => remove(index)}
                        className="absolute -right-2 -top-2 p-1.5 bg-white shadow-sm border border-gray-200 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all opacity-0 group-hover:opacity-100 z-10"
                        aria-label="Rimuovi diagnosi"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>

                    <div className="flex gap-3 w-full">
                        <div className="w-20 shrink-0">
                            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Sistema</label>
                            {(() => {
                                const sys = watch(`diagnoses.${index}.system`) || 'ICD-11';
                                const isV11 = sys === 'ICD-11';
                                return (
                                    <div className={`w-full py-2.5 px-3 text-xs font-bold text-center rounded-lg border font-mono ${isV11 ? 'border-blue-200 bg-blue-100 text-blue-700' : 'border-purple-200 bg-purple-100 text-purple-700'
                                        }`}>
                                        {sys}
                                    </div>
                                );
                            })()}
                            <input type="hidden" {...register(`diagnoses.${index}.system`)} />
                        </div>

                        {/* Code Input (Read-onlyish but editable) */}
                        <div className="w-24 shrink-0">
                            <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1 block">Codice</label>
                            <input
                                {...register(`diagnoses.${index}.code`)}
                                placeholder="Codice"
                                className={`w-full p-2.5 text-sm rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none font-mono dark:text-white ${errors.diagnoses?.[index]?.code ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-white/10 bg-white dark:bg-black/20'
                                    }`}
                            />
                        </div>

                        {/* Description / Autocomplete */}
                        <div className="flex-1 min-w-0 relative">
                            <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1 block">Patologia / Ricerca</label>
                            <div className="relative">
                                <ICDAutocomplete
                                    value={{
                                        code: watch(`diagnoses.${index}.code`) || "",
                                        description: watch(`diagnoses.${index}.description`) || "",
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        system: (watch(`diagnoses.${index}.system`) as any) || "ICD-11"
                                    }}
                                    onChange={(val) => {
                                        setValue(`diagnoses.${index}.code`, val.code);
                                        setValue(`diagnoses.${index}.description`, val.description);
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        setValue(`diagnoses.${index}.system`, val.system as any);
                                    }}
                                />
                                {/* Hidden input to ensure 'description' is registered for validation if needed, 
                                    though setValue should handle it. 
                                    Actually, we need to register it so handleSubmit includes it.
                                    But ICDAutocomplete doesn't accept 'register'.
                                    Solution: Keep a hidden input for description sync?
                                    No, we just need to ensure the register ref is connected? 
                                    Or just populate the invisible input?
                                */}
                                <input
                                    type="hidden"
                                    {...register(`diagnoses.${index}.description`)}
                                />
                            </div>
                            {errors.diagnoses?.[index]?.description && (
                                <span className="text-[10px] text-red-500 absolute -bottom-4 left-0">Campo obbligatorio</span>
                            )}
                        </div>
                    </div>

                    <input type="hidden" {...register(`diagnoses.${index}.date`)} value={new Date().toISOString()} />
                </div>
            ))}

            <button
                type="button"
                onClick={() => append({ code: '', description: '', system: 'ICD-11', date: new Date() })}
                className="text-sm text-blue-600 font-medium flex items-center gap-1 hover:underline mt-2"
            >
                <Plus className="w-4 h-4" />
                Aggiungi Diagnosi
            </button>
        </div>
    );
}

function CheckupsFieldArray({ control, register, errors, watch, remove }: { control: Control<PatientFormValues>, register: UseFormRegister<PatientFormValues>, errors: FieldErrors<PatientFormValues>, watch: UseFormWatch<PatientFormValues>, remove: (index: number) => void, append: (val: any) => void }) {
    // We pass append/remove from parent or utilize useFieldArray here if we want isolation
    // But since DiagnosesFieldArray used internal useFieldArray, let's do the same for consistency
    const { fields, append, remove: removeField } = useFieldArray({
        control,
        name: "checkups"
    });

    return (
        <div className="space-y-3">
            {fields.length === 0 && (
                <p className="text-sm text-gray-400 italic">Nessun controllo programmato.</p>
            )}

            {fields.map((field, index) => (
                <div key={field.id} className="flex flex-col md:flex-row gap-3 items-start p-3 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-lg border border-indigo-100 dark:border-white/5 relative group animate-in fade-in">
                    {/* Delete Button */}
                    <button
                        type="button"
                        onClick={() => removeField(index)}
                        className="absolute -right-2 -top-2 p-1.5 bg-white shadow-sm border border-gray-200 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all opacity-0 group-hover:opacity-100 z-10"
                        aria-label="Rimuovi controllo"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>

                    <div className="flex gap-3 w-full">
                        {/* Date */}
                        <div className="w-32 shrink-0">
                            <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1 block">Data</label>
                            <input
                                type="date"
                                {...register(`checkups.${index}.date`)}
                                className={`w-full p-2 text-sm rounded-lg border focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white dark:[color-scheme:dark] ${errors.checkups?.[index]?.date ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-white/10 bg-white dark:bg-black/20'}`}
                            />
                        </div>

                        {/* Title */}
                        <div className="flex-1">
                            <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1 block">Motivo / Titolo</label>
                            <input
                                {...register(`checkups.${index}.title`)}
                                placeholder="Esempio: Controllo Cardiologico"
                                className={`w-full p-2 text-sm rounded-lg border focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white ${errors.checkups?.[index]?.title ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-white/10 bg-white dark:bg-black/20'}`}
                            />
                        </div>

                        {/* Status (Optional visual, usually pending for new ones) */}
                        <input type="hidden" {...register(`checkups.${index}.status`)} />
                        <input type="hidden" {...register(`checkups.${index}.source`)} />
                    </div>
                </div>
            ))}

            <button
                type="button"
                onClick={() => append({ date: new Date(), title: '', status: 'pending', source: 'manual' })}
                className="text-sm text-indigo-600 font-medium flex items-center gap-1 hover:underline mt-2"
            >
                <Plus className="w-4 h-4" />
                Aggiungi Controllo
            </button>
        </div>
    );
}

export default function PatientForm({ defaultValues, onSubmit, isSubmitting = false, isEditMode = false }: PatientFormProps) {
    // Format date for input if it's a Date object
    const formattedDefaults = defaultValues ? {
        ...defaultValues,
        birthDate: (defaultValues.birthDate instanceof Date && !isNaN(defaultValues.birthDate.getTime()))
            ? defaultValues.birthDate.toISOString().split('T')[0]
            : defaultValues.birthDate,
        checkups: defaultValues.checkups?.map((c: any) => ({
            ...c,
            date: (c.date instanceof Date && !isNaN(c.date.getTime())) ? c.date.toISOString().split('T')[0] : c.date
        }))
    } : undefined;

    const { register, control, handleSubmit, setValue, watch, formState: { errors } } = useForm<PatientFormValues>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolver: zodResolver(patientSchema) as any,
        defaultValues: formattedDefaults || {
            isAdi: false,
            monitoringProfile: 'taken_in_charge',
            diagnoses: [],
            checkups: [],
            statusReason: ''
        }
    });

    // eslint-disable-next-line react-hooks/incompatible-library
    const currentStatus = watch('monitoringProfile');
    const initialStatus = formattedDefaults?.monitoringProfile || 'taken_in_charge';
    const hasStatusChanged = currentStatus !== initialStatus;

    const watchedTaxCode = watch('taxCode');
    const watchedBirthDate = watch('birthDate');
    const estimatedYear = !watchedBirthDate && watchedTaxCode ? estimateBirthYearFromTaxCode(watchedTaxCode) : null;
    const estimatedAge = estimatedYear ? calculateAge(estimatedYear) : null;

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">

            {/* Personal Info Section */}
            <div className="glass-panel p-6 space-y-6 dark:bg-[#161b22] dark:border-[#30363d]">
                <h3 className="text-lg font-bold text-gray-800 dark:text-[#c9d1d9] flex items-center gap-2 border-b border-gray-100 dark:border-[#30363d] pb-2">
                    <User className="w-5 h-5 text-blue-500" />
                    Dati Anagrafici
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-[#8b949e]">Nome <span className="text-red-500">*</span></label>
                        <input
                            {...register('firstName')}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#010409] border border-transparent dark:border-[#30363d] focus:bg-white dark:focus:bg-[#0d1117] focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none dark:text-[#c9d1d9]"
                            placeholder="Mario"
                        />
                        {errors.firstName && <p className="text-sm text-red-500">{errors.firstName.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-[#8b949e]">Cognome <span className="text-red-500">*</span></label>
                        <input
                            {...register('lastName')}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#010409] border border-transparent dark:border-[#30363d] focus:bg-white dark:focus:bg-[#0d1117] focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none dark:text-[#c9d1d9]"
                            placeholder="Rossi"
                        />
                        {errors.lastName && <p className="text-sm text-red-500">{errors.lastName.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-[#8b949e]">Codice Fiscale <span className="text-red-500">*</span></label>
                        <input
                            {...register('taxCode')}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#010409] border border-transparent dark:border-[#30363d] focus:bg-white dark:focus:bg-[#0d1117] focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none uppercase font-mono dark:text-[#c9d1d9]"
                            placeholder="RSSMRA80A01H501U"
                            maxLength={16}
                        />
                        {errors.taxCode && <p className="text-sm text-red-500">{errors.taxCode.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-medium text-gray-700 dark:text-[#8b949e]">Data di Nascita</label>
                            {estimatedAge !== null && (
                                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-md animate-pulse">
                                    Stima: ~{estimatedAge} anni ({estimatedYear})
                                </span>
                            )}
                        </div>
                        <input
                            type="date"
                            {...register('birthDate')}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#010409] border border-transparent dark:border-[#30363d] focus:bg-white dark:focus:bg-[#0d1117] focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none dark:text-[#c9d1d9] dark:[color-scheme:dark]"
                        />
                        {errors.birthDate && <p className="text-sm text-red-500">{errors.birthDate.message}</p>}
                    </div>
                </div>
            </div>

            {/* Contact Info Section */}
            <div className="glass-panel p-6 space-y-6 dark:bg-[#161b22] dark:border-[#30363d]">
                <h3 className="text-lg font-bold text-gray-800 dark:text-[#c9d1d9] flex items-center gap-2 border-b border-gray-100 dark:border-[#30363d] pb-2">
                    <MapPin className="w-5 h-5 text-green-500" />
                    Contatti & Recapiti
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Indirizzo</label>
                        <input
                            {...register('address')}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-transparent focus:bg-white dark:focus:bg-black/20 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none dark:text-white"
                            placeholder="Via Roma 1, Milano"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <Phone className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                            Cellulare / Telefono
                        </label>
                        <input
                            {...register('phone')}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-transparent focus:bg-white dark:focus:bg-black/20 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none dark:text-white"
                            placeholder="+39 333 1234567"
                        />
                    </div>

                    <div className="col-span-full space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <HeartHandshake className="w-4 h-4 text-pink-500" />
                            Caregiver / Riferimento Familiare
                        </label>
                        <input
                            {...register('caregiver')}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#010409] border border-transparent dark:border-[#30363d] focus:bg-white dark:focus:bg-[#0d1117] focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none dark:text-[#c9d1d9]"
                            placeholder="Nome Cognome (figlio/a) - Tel..."
                        />
                    </div>
                </div>
            </div>

            {/* Diagnosi & Patologie (ICD-9/10) */}


            <div className="glass-panel p-6 space-y-6 relative z-50 dark:bg-[#161b22] dark:border-[#30363d]">
                <h3 className="text-lg font-bold text-gray-800 dark:text-[#c9d1d9] flex items-center gap-2 border-b border-gray-100 dark:border-[#30363d] pb-2">
                    <Activity className="w-5 h-5 text-red-500" />
                    Patologie e Diagnosi (ICD-11)
                </h3>

                <DiagnosesFieldArray register={register} control={control} errors={errors} setValue={setValue} watch={watch} />
            </div>

            {/* Prossimi Controlli */}
            <div className="glass-panel p-6 space-y-6 relative z-40 dark:bg-[#161b22] dark:border-[#30363d]">
                <h3 className="text-lg font-bold text-gray-800 dark:text-[#c9d1d9] flex items-center gap-2 border-b border-gray-100 dark:border-[#30363d] pb-2">
                    <Calendar className="w-5 h-5 text-indigo-500" />
                    Prossimi Controlli
                </h3>
                <CheckupsFieldArray register={register} control={control} errors={errors} watch={watch} remove={() => { }} append={() => { }} />
            </div>

            {/* Clinical Profile Section */}
            <div className="glass-panel p-6 space-y-6 dark:bg-[#161b22] dark:border-[#30363d]">
                <h3 className="text-lg font-bold text-gray-800 dark:text-[#c9d1d9] flex items-center gap-2 border-b border-gray-100 dark:border-[#30363d] pb-2">
                    <FileText className="w-5 h-5 text-purple-500" />
                    Profilo Assistenziale
                </h3>

                <div className="grid grid-cols-1 gap-6">
                    <div className="p-4 bg-blue-50/50 dark:bg-[#0d1117] rounded-xl border border-blue-100 dark:border-[#30363d] flex flex-col md:flex-row gap-6">
                        <div className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                id="adi"
                                {...register('isAdi')}
                                {...register('isAdi')}
                                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:bg-[#161b22] dark:border-[#30363d]"
                            />
                            <label htmlFor="adi" className="font-medium text-gray-800 dark:text-[#c9d1d9]">Paziente in ADI (Assistenza Domiciliare Integrata)</label>
                        </div>

                        <div className="flex-1 space-y-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-[#8b949e]">Profilo Monitoraggio</label>
                            <select
                                {...register('monitoringProfile')}
                                className={`w-full px-4 py-2 rounded-lg bg-white dark:bg-[#161b22] dark:text-[#c9d1d9] border-0 ring-1 focus:ring-2 appearance-none ${currentStatus === 'taken_in_charge'
                                    ? 'ring-green-200 focus:ring-green-500 text-green-800 dark:text-green-400 font-medium'
                                    : 'ring-orange-200 focus:ring-orange-500 text-orange-800 dark:text-orange-400 font-medium'
                                    }`}
                            >
                                <option value="taken_in_charge">Presa in Carico (Continua)</option>
                                <option value="extemporaneous">Estemporanea (One Shot)</option>
                            </select>

                            {/* Conditional Reason Field */}
                            {hasStatusChanged && isEditMode && (
                                <div className="animate-in slide-in-from-top-2 pt-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1 mb-1">
                                        <AlertTriangle className="w-3 h-3 text-orange-500" />
                                        Motivo Cambio Stato (Richiesto)
                                    </label>
                                    <textarea
                                        {...register('statusReason')}
                                        required
                                        className="w-full p-2 text-sm border border-orange-200 dark:border-white/10 bg-orange-50 dark:bg-orange-900/10 dark:text-orange-100 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none"
                                        placeholder="Perché stai cambiando lo stato? (es. Trasferito ad altro ente...)"
                                        rows={2}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-[#8b949e]">Note Globali (Anamnesi Sociale / Memo)</label>
                        <textarea
                            {...register('notes')}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#010409] border border-transparent dark:border-[#30363d] focus:bg-white dark:focus:bg-[#0d1117] focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none min-h-[100px] dark:text-[#c9d1d9]"
                            placeholder="Informazioni aggiuntive, contesto sociale, codici accesso..."
                        />
                    </div>
                </div>
            </div>

            <div className="pt-2 flex justify-end">
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Save className="w-5 h-5" />
                    {isSubmitting ? 'Salvataggio...' : (isEditMode ? 'Aggiorna Paziente' : 'Crea Paziente')}
                </button>
            </div>
        </form>
    );
}
