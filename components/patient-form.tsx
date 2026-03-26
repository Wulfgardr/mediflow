'use client';

import { useForm, useFieldArray, Control, Controller, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Save, User, Phone, MapPin, HeartHandshake, FileText, Activity, Plus, Trash2, AlertTriangle, Calendar, Ticket, ChevronDown } from 'lucide-react';
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
const FORM_SECTION_CLASS = 'glass-panel p-8 md:p-10 rounded-[32px] space-y-8 relative overflow-hidden transition-all hover:shadow-2xl hover:shadow-blue-500/5';
/* @Codex */
const FORM_TITLE_CLASS = 'text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3';
/* @Codex */
const FORM_LABEL_CLASS = 'text-[13px] font-semibold text-slate-500 dark:text-slate-400 ml-1 mb-1.5 block';
/* @Codex */
const FORM_INPUT_CLASS = 'w-full rounded-2xl border border-slate-200/60 bg-white px-4 py-3.5 text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-blue-500/40';

function DiagnosesFieldArray({ control, register, errors, setValue, watch }: { control: Control<PatientFormValues>, register: UseFormRegister<PatientFormValues>, errors: FieldErrors<PatientFormValues>, setValue: UseFormSetValue<PatientFormValues>, watch: UseFormWatch<PatientFormValues> }) {
    const { fields, append, remove } = useFieldArray({
        control,
        name: "diagnoses"
    });

    return (
        <div className="space-y-4">
            {fields.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 px-6 rounded-[24px] border border-dashed border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/2">
                    <Activity className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                    <p className="text-sm text-slate-400 font-medium">Nessuna diagnosi registrata.</p>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4">
                {fields.map((field, index) => (
                    <div key={field.id} className="apple-subsection relative group transition-all hover:border-blue-200 dark:hover:border-blue-500/30">
                        {/* Delete Button */}
                        <button
                            type="button"
                            onClick={() => remove(index)}
                            className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 transition-all rounded-full bg-white dark:bg-slate-800 p-2 shadow-lg border border-slate-100 dark:border-white/10 text-slate-400 hover:text-red-500 hover:scale-110 z-10"
                            aria-label="Rimuovi diagnosi"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>

                        <div className="flex flex-col md:flex-row gap-5 items-end">
                            <div className="w-full md:w-24 shrink-0">
                                <label className="section-kicker mb-1.5 block">Sistema</label>
                                {(() => {
                                    const sys = watch(`diagnoses.${index}.system`) || 'ICD-11';
                                    const isV11 = sys === 'ICD-11';
                                    return (
                                        <div className={`w-full py-2.5 px-3 text-xs font-bold text-center rounded-xl border transition-colors ${
                                            isV11 
                                                ? 'border-blue-100 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:border-blue-500/30 dark:text-blue-400' 
                                                : 'border-purple-100 bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:border-purple-500/30 dark:text-purple-400'
                                        }`}>
                                            {sys}
                                        </div>
                                    );
                                })()}
                                <input type="hidden" {...register(`diagnoses.${index}.system`)} />
                            </div>

                            <div className="w-full md:w-28 shrink-0">
                                <label className="section-kicker mb-1.5 block">Codice</label>
                                <input
                                    {...register(`diagnoses.${index}.code`)}
                                    placeholder="Es. 8A80.0"
                                    className={`w-full rounded-xl border p-2.5 text-sm font-mono font-bold outline-none transition-all focus:ring-4 focus:ring-blue-500/10 dark:text-white ${
                                        errors.diagnoses?.[index]?.code 
                                            ? 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-500/40' 
                                            : 'border-slate-200 bg-white dark:border-white/10 dark:bg-white/5'
                                    }`}
                                />
                            </div>

                            <div className="flex-1 w-full min-w-0">
                                <label className="section-kicker mb-1.5 block">Patologia / Ricerca Clinica</label>
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
                                    <input type="hidden" {...register(`diagnoses.${index}.description`)} />
                                </div>
                                {errors.diagnoses?.[index]?.description && (
                                    <span className="text-[10px] font-semibold text-red-500 mt-1 block">Campo obbligatorio</span>
                                )}
                            </div>
                        </div>

                        <input type="hidden" {...register(`diagnoses.${index}.date`)} value={new Date().toISOString()} />
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={() => append({ code: '', description: '', system: 'ICD-11', date: new Date() })}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 transition-all hover:bg-slate-50 dark:hover:bg-white/10 hover:border-blue-300 dark:hover:border-blue-500/30 hover:text-blue-600 dark:hover:text-blue-400 active:scale-95 shadow-sm"
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
        <div className="space-y-4">
            {fields.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 px-6 rounded-[24px] border border-dashed border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/2">
                    <Calendar className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                    <p className="text-sm text-slate-400 font-medium">Nessun controllo programmato.</p>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4">
                {fields.map((field, index) => (
                    <div key={field.id} className="apple-subsection relative group transition-all hover:border-blue-200 dark:hover:border-blue-500/30">
                        {/* Delete Button */}
                        <button
                            type="button"
                            onClick={() => removeField(index)}
                            className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 transition-all rounded-full bg-white dark:bg-slate-800 p-2 shadow-lg border border-slate-100 dark:border-white/10 text-slate-400 hover:text-red-500 hover:scale-110 z-10"
                            aria-label="Rimuovi controllo"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>

                        <div className="flex flex-col md:flex-row gap-5 items-end">
                            <div className="w-full md:w-40 shrink-0">
                                <label className="section-kicker mb-1.5 block">Data Controllo</label>
                                <input
                                    type="date"
                                    {...register(`checkups.${index}.date`)}
                                    className={`w-full rounded-xl border p-2.5 text-sm font-medium outline-none transition-all focus:ring-4 focus:ring-blue-500/10 dark:text-white dark:[color-scheme:dark] ${
                                        errors.checkups?.[index]?.date 
                                            ? 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-500/40' 
                                            : 'border-slate-200 bg-white dark:border-white/10 dark:bg-white/5'
                                    }`}
                                />
                            </div>

                            <div className="flex-1 w-full">
                                <label className="section-kicker mb-1.5 block">Motivazione / Esame</label>
                                <input
                                    {...register(`checkups.${index}.title`)}
                                    placeholder="Es. Controllo pressione, ECG, Emocromo..."
                                    className={`w-full rounded-xl border p-2.5 text-sm font-medium outline-none transition-all focus:ring-4 focus:ring-blue-500/10 dark:text-white ${
                                        errors.checkups?.[index]?.title 
                                            ? 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-500/40' 
                                            : 'border-slate-200 bg-white dark:border-white/10 dark:bg-white/5'
                                    }`}
                                />
                            </div>
                        </div>
                        <input type="hidden" {...register(`checkups.${index}.status`)} />
                        <input type="hidden" {...register(`checkups.${index}.source`)} />
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={() => append({ date: new Date(), title: '', status: 'pending', source: 'manual' })}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 transition-all hover:bg-slate-50 dark:hover:bg-white/10 hover:border-blue-300 dark:hover:border-blue-500/30 hover:text-blue-600 dark:hover:text-blue-400 active:scale-95 shadow-sm"
            >
                <Plus className="w-4 h-4" />
                Pianifica Controllo
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
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-10">

            {/* Personal Info Section */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-white/10 pb-6 mb-2">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                            <User className="w-6 h-6 text-blue-500" />
                        </div>
                        <div>
                            <p className="section-kicker">Dati anagrafici</p>
                            <h3 className={FORM_TITLE_CLASS}>Profilo Paziente</h3>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Nome <span className="text-red-500">*</span></label>
                        <input
                            {...register('firstName')}
                            className={FORM_INPUT_CLASS}
                            placeholder="Es. Mario"
                        />
                        {errors.firstName && <p className="text-[11px] font-semibold text-red-500 mt-1.5 ml-1">{errors.firstName.message}</p>}
                    </div>

                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Cognome <span className="text-red-500">*</span></label>
                        <input
                            {...register('lastName')}
                            className={FORM_INPUT_CLASS}
                            placeholder="Es. Rossi"
                        />
                        {errors.lastName && <p className="text-[11px] font-semibold text-red-500 mt-1.5 ml-1">{errors.lastName.message}</p>}
                    </div>

                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Codice Fiscale <span className="text-red-500">*</span></label>
                        <input
                            {...register('taxCode')}
                            className={`${FORM_INPUT_CLASS} uppercase font-mono font-bold tracking-wider`}
                            placeholder="RSSMRA80A01H501U"
                            maxLength={16}
                        />
                        {errors.taxCode && <p className="text-[11px] font-semibold text-red-500 mt-1.5 ml-1">{errors.taxCode.message}</p>}
                    </div>

                    <div className="space-y-1">
                        <div className="flex justify-between items-center mb-1.5">
                            <label className="text-[13px] font-semibold text-slate-500 dark:text-slate-400 ml-1">Data di Nascita</label>
                            {estimatedAge !== null && (
                                <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-600 dark:border-blue-500/20 dark:bg-blue-900/30 dark:text-blue-300">
                                    Stima eta ~{estimatedAge} anni ({estimatedYear})
                                </span>
                            )}
                        </div>
                        <input
                            type="date"
                            {...register('birthDate')}
                            className={`${FORM_INPUT_CLASS} dark:[color-scheme:dark]`}
                        />
                        {errors.birthDate && <p className="text-[11px] font-semibold text-red-500 mt-1.5 ml-1">{errors.birthDate.message}</p>}
                    </div>
                </div>
            </div>

            {/* Contact Info Section */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 border-b border-slate-100 dark:border-white/10 pb-6 mb-2">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                        <MapPin className="w-6 h-6 text-emerald-500" />
                    </div>
                    <div>
                        <p className="section-kicker">Reperibilità</p>
                        <h3 className={FORM_TITLE_CLASS}>Contatti & Recapiti</h3>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Indirizzo di Residenza</label>
                        <input
                            {...register('address')}
                            className={FORM_INPUT_CLASS}
                            placeholder="Es. Via Roma 1, Milano"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Cellulare / Telefono</label>
                        <div className="relative">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                {...register('phone')}
                                className={`${FORM_INPUT_CLASS} pl-11`}
                                placeholder="Es. +39 333 1234567"
                            />
                        </div>
                    </div>

                    <div className="col-span-full space-y-1">
                        <label className={FORM_LABEL_CLASS}>Caregiver / Riferimento Familiare</label>
                        <div className="relative">
                            <HeartHandshake className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-pink-400" />
                            <input
                                {...register('caregiver')}
                                className={`${FORM_INPUT_CLASS} pl-11`}
                                placeholder="Es. Nome Cognome (figlio/a) - Tel..."
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Diagnosi & Patologie */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 border-b border-slate-100 dark:border-white/10 pb-6 mb-2">
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
                        <Activity className="w-6 h-6 text-red-500" />
                    </div>
                    <div>
                        <p className="section-kicker">Codifica clinica</p>
                        <h3 className={FORM_TITLE_CLASS}>Patologie e Diagnosi (ICD-11)</h3>
                    </div>
                </div>

                <DiagnosesFieldArray register={register} control={control} errors={errors} setValue={setValue} watch={watch} />
            </div>

            {/* Prossimi Controlli */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 border-b border-slate-100 dark:border-white/10 pb-6 mb-2">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
                        <Calendar className="w-6 h-6 text-indigo-500" />
                    </div>
                    <div>
                        <p className="section-kicker">Agenda clinica</p>
                        <h3 className={FORM_TITLE_CLASS}>Prossimi Controlli</h3>
                    </div>
                </div>
                <CheckupsFieldArray register={register} control={control} errors={errors} />
            </div>

            {/* @Codex */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 border-b border-slate-100 dark:border-white/10 pb-6 mb-2">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                        <Ticket className="w-6 h-6 text-amber-500" />
                    </div>
                    <div>
                        <p className="section-kicker">Assetto amministrativo</p>
                        <h3 className={FORM_TITLE_CLASS}>Codici Esenzione</h3>
                    </div>
                </div>
                
                <div className="apple-subsection bg-slate-50/50 dark:bg-white/2 border-dashed">
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
                    <div className="mt-4 flex items-start gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        I codici selezionati verranno salvati in modo cifrato nella scheda del paziente.
                    </div>
                </div>
            </div>

            {/* Clinical Profile Section */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 border-b border-slate-100 dark:border-white/10 pb-6 mb-2">
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center">
                        <FileText className="w-6 h-6 text-purple-500" />
                    </div>
                    <div>
                        <p className="section-kicker">Profilo assistenziale</p>
                        <h3 className={FORM_TITLE_CLASS}>Inquadramento Clinico</h3>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-8">
                    <div className="apple-subsection flex flex-col md:flex-row gap-8">
                        <div className="flex items-center gap-4 px-2">
                            <div className="relative flex items-center">
                                <input
                                    type="checkbox"
                                    id="adi"
                                    {...register('isAdi')}
                                    className="peer h-6 w-6 rounded-lg border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-white/10 dark:bg-white/5 transition-all cursor-pointer"
                                />
                            </div>
                            <label htmlFor="adi" className="font-bold text-slate-800 dark:text-white cursor-pointer select-none">
                                Paziente in ADI
                                <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">Assistenza Domiciliare Integrata</span>
                            </label>
                        </div>

                        <div className="flex-1 space-y-2">
                            <label className={FORM_LABEL_CLASS}>Profilo Monitoraggio</label>
                            <div className="relative">
                                <select
                                    {...register('monitoringProfile')}
                                    className={`w-full appearance-none rounded-2xl border px-4 py-3.5 text-sm font-bold outline-none transition-all focus:ring-4 focus:ring-blue-500/10 cursor-pointer ${
                                        currentStatus === 'taken_in_charge'
                                            ? 'border-emerald-200 bg-emerald-50/50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-900/10 dark:text-emerald-400'
                                            : 'border-orange-200 bg-orange-50/50 text-orange-700 dark:border-orange-500/20 dark:bg-orange-900/10 dark:text-orange-400'
                                    }`}
                                >
                                    <option value="taken_in_charge">Presa in Carico (Continua)</option>
                                    <option value="extemporaneous">Estemporanea (One Shot)</option>
                                </select>
                                <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                                    <ChevronDown className="h-4 w-4 text-slate-400" />
                                </div>
                            </div>

                            {/* Conditional Reason Field */}
                            {hasStatusChanged && isEditMode && (
                                <div className="animate-in fade-in slide-in-from-top-2 pt-2">
                                    <label className="text-[11px] font-bold text-orange-600 dark:text-orange-400 mb-1.5 flex items-center gap-1.5 ml-1">
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        MOTIVO CAMBIO STATO (OBBLIGATORIO)
                                    </label>
                                    <textarea
                                        {...register('statusReason')}
                                        required
                                        className="w-full rounded-2xl border border-orange-200 bg-orange-50/50 p-4 text-sm font-medium outline-none transition-all focus:ring-4 focus:ring-orange-500/10 dark:border-orange-500/30 dark:bg-orange-900/10 dark:text-orange-100 placeholder:text-orange-300 dark:placeholder:text-orange-900/40"
                                        placeholder="Specificare il motivo del cambio di profilo (es. Trasferimento, fine cure...)"
                                        rows={2}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Note Globali & Anamnesi Sociale</label>
                        <textarea
                            {...register('notes')}
                            className={`${FORM_INPUT_CLASS} min-h-[140px] leading-relaxed`}
                            placeholder="Informazioni aggiuntive, contesto familiare, codici accesso, preferenze del paziente..."
                        />
                    </div>
                </div>
            </div>

            <div className="pt-6 flex flex-col md:flex-row items-center justify-between gap-6 border-t border-slate-200 dark:border-white/10">
                <p className="text-xs text-slate-400 font-medium">
                    I campi contrassegnati con <span className="text-red-500">*</span> sono obbligatori per la corretta gestione clinica.
                </p>
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full md:w-auto inline-flex items-center justify-center gap-3 rounded-[24px] bg-blue-600 px-10 py-4 text-sm font-bold text-white transition-all hover:bg-blue-700 hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 shadow-xl shadow-blue-500/20"
                >
                    <Save className="w-5 h-5" />
                    {isSubmitting ? 'Salvataggio in corso...' : (isEditMode ? 'Aggiorna Scheda Paziente' : 'Crea Nuova Scheda')}
                </button>
            </div>
        </form>
    );
}
