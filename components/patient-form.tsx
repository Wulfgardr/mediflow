'use client';

import { useForm, useFieldArray, Control, Controller, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, User, Phone, MapPin, HeartHandshake, FileText, Activity, Plus, Trash2, AlertTriangle, Calendar, Ticket } from 'lucide-react';
import ICDAutocomplete from '@/components/icd-autocomplete';
/* @Codex */
import ExemptionSelector from '@/components/exemption-selector';
import { estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';

import { patientSchema, PatientFormValues } from '@/lib/schemas';

interface PatientFormProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultValues?: any;
    onSubmit: (data: PatientFormValues) => Promise<void>;
    isSubmitting?: boolean;
    isEditMode?: boolean;
}

/* @Codex */
const FORM_SECTION_CLASS = 'glass-panel p-6 md:p-7 space-y-6';
/* @Codex */
const FORM_TITLE_CLASS = 'text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2';
/* @Codex */
const FORM_LABEL_CLASS = 'text-sm font-medium text-slate-700 dark:text-slate-300';
/* @Codex */
const FORM_INPUT_CLASS = 'w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 text-slate-900 outline-none transition-all focus:border-sky-300 focus:ring-2 focus:ring-sky-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-sky-500/30';

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
                <div key={field.id} className="relative flex flex-col items-start gap-3 rounded-[22px] border border-slate-200/80 bg-white/78 p-4 dark:border-white/10 dark:bg-white/5">
                    {/* Delete Button */}
                    <button
                        type="button"
                        onClick={() => remove(index)}
                        className="absolute right-3 top-3 rounded-full border border-slate-200 bg-white p-1.5 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500 dark:border-white/10 dark:bg-[#161b22] dark:text-slate-400 dark:hover:border-red-500/20 dark:hover:bg-red-900/10"
                        aria-label="Rimuovi diagnosi"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>

                    <div className="flex gap-3 w-full">
                        <div className="w-20 shrink-0">
                            <label className="section-kicker mb-1 block">Sistema</label>
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
                            <label className="section-kicker mb-1 block">Codice</label>
                            <input
                                {...register(`diagnoses.${index}.code`)}
                                placeholder="Codice"
                                className={`w-full rounded-2xl border p-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-sky-500/20 dark:text-white ${errors.diagnoses?.[index]?.code ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-slate-200/80 bg-white/90 dark:border-white/10 dark:bg-white/5'
                                    }`}
                            />
                        </div>

                        {/* Description / Autocomplete */}
                        <div className="flex-1 min-w-0 relative">
                            <label className="section-kicker mb-1 block">Patologia / Ricerca</label>
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
                className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-900/10 dark:text-sky-300 dark:hover:bg-sky-900/20"
            >
                <Plus className="w-4 h-4" />
                Aggiungi Diagnosi
            </button>
        </div>
    );
}

function CheckupsFieldArray({ control, register, errors }: { control: Control<PatientFormValues>, register: UseFormRegister<PatientFormValues>, errors: FieldErrors<PatientFormValues> }) {
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
                <div key={field.id} className="relative flex flex-col items-start gap-3 rounded-[22px] border border-slate-200/80 bg-white/78 p-4 dark:border-white/10 dark:bg-white/5">
                    {/* Delete Button */}
                    <button
                        type="button"
                        onClick={() => removeField(index)}
                        className="absolute right-3 top-3 rounded-full border border-slate-200 bg-white p-1.5 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500 dark:border-white/10 dark:bg-[#161b22] dark:text-slate-400 dark:hover:border-red-500/20 dark:hover:bg-red-900/10"
                        aria-label="Rimuovi controllo"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>

                    <div className="flex gap-3 w-full">
                        {/* Date */}
                        <div className="w-32 shrink-0">
                            <label className="section-kicker mb-1 block">Data</label>
                            <input
                                type="date"
                                {...register(`checkups.${index}.date`)}
                                className={`w-full rounded-2xl border p-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/20 dark:text-white dark:[color-scheme:dark] ${errors.checkups?.[index]?.date ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-slate-200/80 bg-white/90 dark:border-white/10 dark:bg-white/5'}`}
                            />
                        </div>

                        {/* Title */}
                        <div className="flex-1">
                            <label className="section-kicker mb-1 block">Motivo / Titolo</label>
                            <input
                                {...register(`checkups.${index}.title`)}
                                placeholder="Esempio: Controllo Cardiologico"
                                className={`w-full rounded-2xl border p-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/20 dark:text-white ${errors.checkups?.[index]?.title ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-slate-200/80 bg-white/90 dark:border-white/10 dark:bg-white/5'}`}
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
                className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-900/10 dark:text-sky-300 dark:hover:bg-sky-900/20"
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
        /* @Codex */
        exemptions: Array.isArray(defaultValues.exemptions) ? defaultValues.exemptions : [],
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
            /* @Codex */
            exemptions: [],
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
            <div className={FORM_SECTION_CLASS}>
                <div>
                    <p className="section-kicker">Dati base</p>
                    <h3 className={`${FORM_TITLE_CLASS} mt-1`}>
                    <User className="w-5 h-5 text-blue-500" />
                    Dati Anagrafici
                    </h3>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                        <label className={FORM_LABEL_CLASS}>Nome <span className="text-red-500">*</span></label>
                        <input
                            {...register('firstName')}
                            className={FORM_INPUT_CLASS}
                            placeholder="Mario"
                        />
                        {errors.firstName && <p className="text-sm text-red-500">{errors.firstName.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className={FORM_LABEL_CLASS}>Cognome <span className="text-red-500">*</span></label>
                        <input
                            {...register('lastName')}
                            className={FORM_INPUT_CLASS}
                            placeholder="Rossi"
                        />
                        {errors.lastName && <p className="text-sm text-red-500">{errors.lastName.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <label className={FORM_LABEL_CLASS}>Codice Fiscale <span className="text-red-500">*</span></label>
                        <input
                            {...register('taxCode')}
                            className={`${FORM_INPUT_CLASS} uppercase font-mono`}
                            placeholder="RSSMRA80A01H501U"
                            maxLength={16}
                        />
                        {errors.taxCode && <p className="text-sm text-red-500">{errors.taxCode.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className={FORM_LABEL_CLASS}>Data di Nascita</label>
                            {estimatedAge !== null && (
                                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">
                                    Stima: ~{estimatedAge} anni ({estimatedYear})
                                </span>
                            )}
                        </div>
                        <input
                            type="date"
                            {...register('birthDate')}
                            className={`${FORM_INPUT_CLASS} dark:[color-scheme:dark]`}
                        />
                        {errors.birthDate && <p className="text-sm text-red-500">{errors.birthDate.message}</p>}
                    </div>
                </div>
            </div>

            {/* Contact Info Section */}
            <div className={FORM_SECTION_CLASS}>
                <div>
                    <p className="section-kicker">Recapiti</p>
                    <h3 className={`${FORM_TITLE_CLASS} mt-1`}>
                    <MapPin className="w-5 h-5 text-green-500" />
                    Contatti & Recapiti
                    </h3>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                        <label className={FORM_LABEL_CLASS}>Indirizzo</label>
                        <input
                            {...register('address')}
                            className={FORM_INPUT_CLASS}
                            placeholder="Via Roma 1, Milano"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className={`${FORM_LABEL_CLASS} flex items-center gap-2`}>
                            <Phone className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                            Cellulare / Telefono
                        </label>
                        <input
                            {...register('phone')}
                            className={FORM_INPUT_CLASS}
                            placeholder="+39 333 1234567"
                        />
                    </div>

                    <div className="col-span-full space-y-2">
                        <label className={`${FORM_LABEL_CLASS} flex items-center gap-2`}>
                            <HeartHandshake className="w-4 h-4 text-pink-500" />
                            Caregiver / Riferimento Familiare
                        </label>
                        <input
                            {...register('caregiver')}
                            className={FORM_INPUT_CLASS}
                            placeholder="Nome Cognome (figlio/a) - Tel..."
                        />
                    </div>
                </div>
            </div>

            {/* Diagnosi & Patologie (ICD-9/10) */}


            <div className={FORM_SECTION_CLASS}>
                <div>
                    <p className="section-kicker">Codifica clinica</p>
                    <h3 className={`${FORM_TITLE_CLASS} mt-1`}>
                    <Activity className="w-5 h-5 text-red-500" />
                    Patologie e Diagnosi (ICD-11)
                    </h3>
                </div>

                <DiagnosesFieldArray register={register} control={control} errors={errors} setValue={setValue} watch={watch} />
            </div>

            {/* Prossimi Controlli */}
            <div className={FORM_SECTION_CLASS}>
                <div>
                    <p className="section-kicker">Agenda clinica</p>
                    <h3 className={`${FORM_TITLE_CLASS} mt-1`}>
                    <Calendar className="w-5 h-5 text-indigo-500" />
                    Prossimi Controlli
                    </h3>
                </div>
                <CheckupsFieldArray register={register} control={control} errors={errors} />
            </div>

            {/* @Codex */}
            <div className={FORM_SECTION_CLASS}>
                <div>
                    <p className="section-kicker">Assetto amministrativo</p>
                    <h3 className={`${FORM_TITLE_CLASS} mt-1`}>
                    <Ticket className="w-5 h-5 text-indigo-500" />
                    Codici Esenzione
                    </h3>
                </div>
                <Controller
                    name="exemptions"
                    control={control}
                    render={({ field }) => (
                        <ExemptionSelector
                            value={Array.isArray(field.value) ? field.value : []}
                            onChange={field.onChange}
                        />
                    )}
                />
                <p className="text-xs text-gray-500 dark:text-[#8b949e]">
                    Seleziona i codici da associare al paziente: verranno salvati in modo cifrato nella scheda.
                </p>
            </div>

            {/* Clinical Profile Section */}
            <div className={FORM_SECTION_CLASS}>
                <div>
                    <p className="section-kicker">Profilo assistenziale</p>
                    <h3 className={`${FORM_TITLE_CLASS} mt-1`}>
                    <FileText className="w-5 h-5 text-purple-500" />
                    Profilo Assistenziale
                    </h3>
                </div>

                <div className="grid grid-cols-1 gap-6">
                    <div className="rounded-[24px] border border-slate-200/80 bg-white/78 p-4 dark:border-white/10 dark:bg-white/5 flex flex-col md:flex-row gap-6">
                        <div className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                id="adi"
                                {...register('isAdi')}
                                className="h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500 dark:border-white/10 dark:bg-white/5"
                            />
                            <label htmlFor="adi" className="font-medium text-slate-800 dark:text-white">Paziente in ADI (Assistenza Domiciliare Integrata)</label>
                        </div>

                        <div className="flex-1 space-y-2">
                            <label className={FORM_LABEL_CLASS}>Profilo Monitoraggio</label>
                            <select
                                {...register('monitoringProfile')}
                                className={`w-full appearance-none rounded-2xl border px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-sky-500/20 ${currentStatus === 'taken_in_charge'
                                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-900/10 dark:text-emerald-300'
                                    : 'border-orange-200 bg-orange-50/70 text-orange-800 dark:border-orange-500/20 dark:bg-orange-900/10 dark:text-orange-300'
                                    }`}
                            >
                                <option value="taken_in_charge">Presa in Carico (Continua)</option>
                                <option value="extemporaneous">Estemporanea (One Shot)</option>
                            </select>

                            {/* Conditional Reason Field */}
                            {hasStatusChanged && isEditMode && (
                                <div className="animate-in slide-in-from-top-2 pt-2">
                                    <label className="section-kicker mb-1 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3 text-orange-500" />
                                        Motivo Cambio Stato (Richiesto)
                                    </label>
                                    <textarea
                                        {...register('statusReason')}
                                        required
                                        className="w-full rounded-2xl border border-orange-200 bg-orange-50 p-3 text-sm outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-orange-500/20 dark:bg-orange-900/10 dark:text-orange-100"
                                        placeholder="Perché stai cambiando lo stato? (es. Trasferito ad altro ente...)"
                                        rows={2}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className={FORM_LABEL_CLASS}>Note Globali (Anamnesi Sociale / Memo)</label>
                        <textarea
                            {...register('notes')}
                            className={`${FORM_INPUT_CLASS} min-h-[100px]`}
                            placeholder="Informazioni aggiuntive, contesto sociale, codici accesso..."
                        />
                    </div>
                </div>
            </div>

            <div className="pt-2 flex justify-end">
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#0A84FF] px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#0077ED] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Save className="w-5 h-5" />
                    {isSubmitting ? 'Salvataggio...' : (isEditMode ? 'Aggiorna Paziente' : 'Crea Paziente')}
                </button>
            </div>
        </form>
    );
}
