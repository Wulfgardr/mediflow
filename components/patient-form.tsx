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

/* @Codex WUL-229: patient form sections now inherit the vitreous tier directly */
const FORM_SECTION_CLASS = 'patient-detail-section mf-section p-7 md:p-9 space-y-7 relative overflow-hidden';
/* @Codex */
const FORM_TITLE_CLASS = 'text-lg md:text-xl font-semibold tracking-tight flex items-center gap-3';
/* @Codex */
const FORM_LABEL_CLASS = 'mf-field-label';
/* @Codex */
const FORM_INPUT_CLASS = 'mf-input';

function DiagnosesFieldArray({ control, register, errors, setValue, watch }: { control: Control<PatientFormValues>, register: UseFormRegister<PatientFormValues>, errors: FieldErrors<PatientFormValues>, setValue: UseFormSetValue<PatientFormValues>, watch: UseFormWatch<PatientFormValues> }) {
    const { fields, append, remove } = useFieldArray({
        control,
        name: "diagnoses"
    });

    return (
        <div className="space-y-4">
            {fields.length === 0 && (
                <div className="mf-section mf-section-tight flex flex-col items-center justify-center py-8 px-6 border-dashed text-center">
                    <Activity className="w-7 h-7 mb-2" style={{ color: 'var(--mf-muted)' }} />
                    <p className="text-sm font-medium" style={{ color: 'var(--mf-muted)' }}>Nessuna diagnosi registrata.</p>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4">
                {fields.map((field, index) => (
                    <div key={field.id} className="mf-section mf-section-tight relative group">
                        <button
                            type="button"
                            onClick={() => remove(index)}
                            className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 transition-all mf-btn-secondary p-2 z-10"
                            aria-label="Rimuovi diagnosi"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>

                        <div className="flex flex-col md:flex-row gap-5 items-end">
                            <div className="w-full md:w-24 shrink-0">
                                <label className="mf-field-label">Sistema</label>
                                {(() => {
                                    const sys = watch(`diagnoses.${index}.system`) || 'ICD-11';
                                    const isV11 = sys === 'ICD-11';
                                    return (
                                        <div className={`patient-code-pill ${isV11 ? 'patient-code-pill-primary' : 'patient-code-pill-plum'} w-full justify-center py-2 text-xs font-bold`}>
                                            {sys}
                                        </div>
                                    );
                                })()}
                                <input type="hidden" {...register(`diagnoses.${index}.system`)} />
                            </div>

                            <div className="w-full md:w-28 shrink-0">
                                <label className="mf-field-label">Codice</label>
                                <input
                                    {...register(`diagnoses.${index}.code`)}
                                    placeholder="Es. 8A80.0"
                                    className="mf-input mf-input-sm font-mono font-bold"
                                    aria-invalid={!!errors.diagnoses?.[index]?.code}
                                />
                            </div>

                            <div className="flex-1 w-full min-w-0">
                                <label className="section-kicker mb-1.5 block">Diagnosi o ricerca clinica</label>
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
                                    <span className="mf-field-error block">Campo obbligatorio</span>
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
                className="mf-btn-secondary w-full md:w-auto"
            >
                <Plus className="w-4 h-4" />
                Aggiungi diagnosi
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
                <div className="mf-section mf-section-tight flex flex-col items-center justify-center py-8 px-6 border-dashed text-center">
                    <Calendar className="w-7 h-7 mb-2" style={{ color: 'var(--mf-muted)' }} />
                    <p className="text-sm font-medium" style={{ color: 'var(--mf-muted)' }}>Nessun passaggio programmato.</p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Pianifica PRIAMO, valutazioni, visite o follow-up.</p>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4">
                {fields.map((field, index) => (
                    <div key={field.id} className="mf-section mf-section-tight relative group">
                        <button
                            type="button"
                            onClick={() => removeField(index)}
                            className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 transition-all mf-btn-secondary p-2 z-10"
                            aria-label="Rimuovi pianificazione"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>

                        <div className="flex flex-col md:flex-row gap-5 items-end">
                            <div className="w-full md:w-40 shrink-0">
                                <label className="mf-field-label">Data prevista</label>
                                <input
                                    type="date"
                                    {...register(`checkups.${index}.date`)}
                                    className="mf-input mf-input-sm dark:[color-scheme:dark]"
                                    aria-invalid={!!errors.checkups?.[index]?.date}
                                />
                            </div>

                            <div className="flex-1 w-full">
                                <label className="mf-field-label">Prossimo passaggio</label>
                                <input
                                    {...register(`checkups.${index}.title`)}
                                    placeholder="Es. PRIAMO, valutazione ADL, visita programmata, ECG..."
                                    className="mf-input mf-input-sm"
                                    aria-invalid={!!errors.checkups?.[index]?.title}
                                />
                            </div>
                        </div>
                        <div className="mt-4">
                            <label className="mf-field-label">Note operative</label>
                            <textarea
                                {...register(`checkups.${index}.notes`)}
                                placeholder="Materiali, scale da somministrare, contesto utile per il prossimo passaggio..."
                                rows={2}
                                className="mf-input resize-y leading-relaxed"
                            />
                        </div>
                        <input type="hidden" {...register(`checkups.${index}.status`)} />
                        <input type="hidden" {...register(`checkups.${index}.source`)} />
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={() => append({ date: new Date(), title: '', notes: '', status: 'pending', source: 'manual' })}
                className="mf-btn-secondary w-full md:w-auto"
            >
                <Plus className="w-4 h-4" />
                Aggiungi passaggio
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
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 graphite-divider pb-5 mb-2">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(15, 123, 104, 0.1)' }}>
                            <User className="w-5 h-5" style={{ color: 'var(--mf-primary)' }} />
                        </div>
                        <div>
                            <p className="mf-eyebrow">Dati anagrafici</p>
                            <h3 className={FORM_TITLE_CLASS}>Profilo paziente</h3>
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
                        {errors.firstName && <p className="mf-field-error">{errors.firstName.message}</p>}
                    </div>

                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Cognome <span className="text-red-500">*</span></label>
                        <input
                            {...register('lastName')}
                            className={FORM_INPUT_CLASS}
                            placeholder="Es. Rossi"
                        />
                        {errors.lastName && <p className="mf-field-error">{errors.lastName.message}</p>}
                    </div>

                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Codice fiscale <span className="text-red-500">*</span></label>
                        <input
                            {...register('taxCode')}
                            className={`${FORM_INPUT_CLASS} uppercase font-mono font-bold tracking-wider`}
                            placeholder="RSSMRA80A01H501U"
                            maxLength={16}
                        />
                        {errors.taxCode && <p className="mf-field-error">{errors.taxCode.message}</p>}
                    </div>

                    <div className="space-y-1">
                        <div className="flex justify-between items-center mb-1.5">
                            <label className="mf-field-label mb-0">Data di nascita</label>
                            {estimatedAge !== null && (
                                <span className="apple-chip">Stima età ~{estimatedAge} anni ({estimatedYear})</span>
                            )}
                        </div>
                        <input
                            type="date"
                            {...register('birthDate')}
                            className={`${FORM_INPUT_CLASS} dark:[color-scheme:dark]`}
                        />
                        {errors.birthDate && <p className="mf-field-error">{errors.birthDate.message}</p>}
                    </div>
                </div>
            </div>

            {/* Contact Info Section */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 graphite-divider pb-5 mb-2">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(63, 122, 76, 0.12)' }}>
                        <MapPin className="w-5 h-5" style={{ color: 'var(--mf-success)' }} />
                    </div>
                    <div>
                        <p className="mf-eyebrow">Reperibilità</p>
                        <h3 className={FORM_TITLE_CLASS}>Contatti e recapiti</h3>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Indirizzo di residenza</label>
                        <input
                            {...register('address')}
                            className={FORM_INPUT_CLASS}
                            placeholder="Es. Via Roma 1, Milano"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Cellulare / Telefono</label>
                        <div className="relative">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                            <input
                                {...register('phone')}
                                className={`${FORM_INPUT_CLASS} pl-11`}
                                placeholder="Es. +39 333 1234567"
                            />
                        </div>
                    </div>

                    <div className="col-span-full space-y-1">
                        <label className={FORM_LABEL_CLASS}>Caregiver o riferimento</label>
                        <div className="relative">
                            <HeartHandshake className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-plum)' }} />
                            <input
                                {...register('caregiver')}
                                className={`${FORM_INPUT_CLASS} pl-11`}
                                placeholder="Es. Maria Rossi, figlia, +39..."
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Diagnosi & Patologie */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 graphite-divider pb-5 mb-2">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(163, 58, 47, 0.1)' }}>
                        <Activity className="w-5 h-5" style={{ color: 'var(--mf-critical)' }} />
                    </div>
                    <div>
                        <p className="mf-eyebrow">Codifica clinica</p>
                        <h3 className={FORM_TITLE_CLASS}>Diagnosi e problemi attivi</h3>
                    </div>
                </div>

                <DiagnosesFieldArray register={register} control={control} errors={errors} setValue={setValue} watch={watch} />
            </div>

            {/* Pianificazione operativa */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 graphite-divider pb-5 mb-2">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(94, 53, 95, 0.12)' }}>
                        <Calendar className="w-5 h-5" style={{ color: 'var(--mf-plum)' }} />
                    </div>
                    <div>
                        <p className="mf-eyebrow">Agenda clinica</p>
                        <h3 className={FORM_TITLE_CLASS}>Prossimi passaggi</h3>
                        <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>PRIAMO, valutazioni, visite programmate, follow-up.</p>
                    </div>
                </div>
                <CheckupsFieldArray register={register} control={control} errors={errors} />
            </div>

            {/* @Codex */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 graphite-divider pb-5 mb-2">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(197, 138, 47, 0.14)' }}>
                        <Ticket className="w-5 h-5" style={{ color: 'var(--mf-warning)' }} />
                    </div>
                    <div>
                        <p className="mf-eyebrow">Assetto amministrativo</p>
                        <h3 className={FORM_TITLE_CLASS}>Esenzioni</h3>
                    </div>
                </div>

                <div className="mf-section mf-section-tight border-dashed">
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
                    <div className="mt-3 mf-alert mf-alert-warning text-[11px]" role="note">
                        <span className="inline-flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            I codici selezionati verranno salvati in modo cifrato nella scheda del paziente.
                        </span>
                    </div>
                </div>
            </div>

            {/* Clinical Profile Section */}
            <div className={FORM_SECTION_CLASS}>
                <div className="flex items-center gap-4 graphite-divider pb-5 mb-2">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(15, 123, 104, 0.1)' }}>
                        <FileText className="w-5 h-5" style={{ color: 'var(--mf-primary)' }} />
                    </div>
                    <div>
                        <p className="mf-eyebrow">Profilo assistenziale</p>
                        <h3 className={FORM_TITLE_CLASS}>Inquadramento clinico</h3>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-8">
                    <div className="mf-section mf-section-tight flex flex-col md:flex-row gap-8">
                        <div className="flex items-center gap-4 px-2">
                            <input
                                type="checkbox"
                                id="adi"
                                {...register('isAdi')}
                                className="peer h-5 w-5 rounded-md cursor-pointer"
                                style={{ accentColor: 'var(--mf-primary)' }}
                            />
                            <label htmlFor="adi" className="font-semibold cursor-pointer select-none" style={{ color: 'var(--mf-ink)' }}>
                                Paziente in ADI
                                <span className="block text-[11px] font-normal" style={{ color: 'var(--mf-muted)' }}>Assistenza Domiciliare Integrata</span>
                            </label>
                        </div>

                        <div className="flex-1 space-y-2">
                            <label className={FORM_LABEL_CLASS}>Tipo di presa in carico</label>
                            <div className="relative">
                                <select
                                    {...register('monitoringProfile')}
                                    className={`mf-input appearance-none cursor-pointer pr-10 font-semibold ${currentStatus === 'taken_in_charge' ? 'graphite-chip-tone-success' : 'graphite-chip-tone-warning'}`}
                                >
                                    <option value="taken_in_charge">Continuativa</option>
                                    <option value="extemporaneous">Episodica</option>
                                </select>
                                <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                                    <ChevronDown className="h-4 w-4" style={{ color: 'var(--mf-muted)' }} />
                                </div>
                            </div>

                            {hasStatusChanged && isEditMode && (
                                <div className="animate-in fade-in slide-in-from-top-2 pt-2">
                                    <label className="mf-field-label flex items-center gap-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--mf-warning)' }} />
                                        Motivo cambio stato (obbligatorio)
                                    </label>
                                    <textarea
                                        {...register('statusReason')}
                                        required
                                        className="mf-input resize-y leading-relaxed"
                                        placeholder="Specificare il motivo del cambio di profilo (es. trasferimento, fine cure…)"
                                        rows={2}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className={FORM_LABEL_CLASS}>Note cliniche e contesto</label>
                        <textarea
                            {...register('notes')}
                            className={`${FORM_INPUT_CLASS} min-h-[140px] leading-relaxed`}
                            placeholder="Informazioni utili, contesto familiare, accessi, preferenze del paziente..."
                        />
                    </div>
                </div>
            </div>

            <div className="pt-6 flex flex-col md:flex-row items-center justify-between gap-6 graphite-divider">
                <p className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
                    Campi obbligatori per creare la scheda: <span style={{ color: 'var(--mf-critical)' }}>*</span>.
                </p>
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="ui-btn-primary w-full md:w-auto px-8 py-3.5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Save className="w-5 h-5" />
                    {isSubmitting ? 'Salvataggio in corso…' : (isEditMode ? 'Aggiorna scheda' : 'Crea scheda')}
                </button>
            </div>
        </form>
    );
}
