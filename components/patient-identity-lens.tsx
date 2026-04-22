'use client';

import type { ReactNode } from 'react';
import { Calendar, MapPin, Phone } from 'lucide-react';

import PrivacyBlur from '@/components/privacy-blur';
import { StatusGlyph } from '@/components/status-glyph';
import type { Diagnosis, Patient } from '@/lib/db';

interface PatientIdentityLensProps {
    /* @Codex */
    variant?: 'atlas' | 'reader';
    patient: Patient;
    ageLabel: string;
    birthDateLabel: string;
    diagnoses: Diagnosis[];
    exemptions: string[];
    actions: ReactNode;
    /* @Codex */
    summary?: string;
    /* @Codex */
    nextStep?: string;
}

export function PatientIdentityLens({
    variant = 'atlas',
    patient,
    ageLabel,
    birthDateLabel,
    diagnoses,
    exemptions,
    actions,
    summary,
    nextStep,
}: PatientIdentityLensProps) {
    if (variant === 'reader') {
        return (
            <section className="patient-identity-lens patient-identity-lens-reader relative overflow-hidden rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.9)] p-5 shadow-[0_18px_36px_rgba(35,27,22,0.08)] backdrop-blur-xl md:p-6">
                <div className="absolute inset-y-5 left-0 w-1 rounded-r-full bg-[linear-gradient(180deg,var(--mf-primary),var(--mf-accent),var(--mf-plum))]" />

                <div className="relative z-10 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_340px] xl:items-start">
                    <div className="min-w-0 space-y-3">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--mf-muted)]">
                                Patient Header
                            </p>
                            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--mf-ink)] md:text-3xl">
                                <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                            </h1>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[color:var(--mf-muted)]">
                                <span className="font-mono text-[12px] tracking-tight">
                                    <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                                </span>
                                <span>{ageLabel}</span>
                                <span className="inline-flex items-center gap-1.5">
                                    <Calendar className="h-3.5 w-3.5" />
                                    {birthDateLabel}
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <StatusGlyph
                                kind={patient.isArchived ? 'archived' : patient.isAdi ? 'active' : 'follow-up'}
                                label={patient.isArchived ? 'Archiviato' : patient.isAdi ? 'Attivo' : 'Follow-up'}
                            />
                            {exemptions.length > 0 ? <StatusGlyph kind="completed" label={`${exemptions.length} esenzioni`} /> : null}
                            {diagnoses.length > 0 ? <StatusGlyph kind="review" label={`${diagnoses.length} diagnosi`} /> : null}
                        </div>
                    </div>

                    <div className="rounded-[16px] border border-[color:rgba(112,106,100,0.12)] bg-white/76 p-4 dark:bg-white/4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            In Due Righe
                        </p>
                        <p className="mt-3 text-sm leading-6 text-[color:var(--mf-ink)]">
                            {summary ?? 'Caso pronto per revisione clinica locale.'}
                        </p>
                        {nextStep ? (
                            <p className="mt-3 text-sm leading-6 text-[color:var(--mf-muted)]">
                                <span className="font-semibold text-[color:var(--mf-ink)]">Prossimo step:</span> {nextStep}
                            </p>
                        ) : null}
                    </div>

                    <div className="space-y-3">
                        <div className="rounded-[16px] border border-[color:rgba(112,106,100,0.12)] bg-white/76 p-4 dark:bg-white/4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                Contesto rapido
                            </p>
                            <div className="mt-3 space-y-2 text-sm text-[color:var(--mf-ink)]">
                                <p className="inline-flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-[color:var(--mf-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.phone || 'Telefono non disponibile'}</PrivacyBlur>
                                </p>
                                <p className="inline-flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5 text-[color:var(--mf-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.address || 'Indirizzo non disponibile'}</PrivacyBlur>
                                </p>
                            </div>
                        </div>
                        {actions}
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="patient-identity-lens relative overflow-hidden rounded-[34px] border border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] p-6 shadow-[var(--glass-panel-shadow)] backdrop-blur-3xl md:p-8">
            <div className="absolute inset-y-6 left-0 w-1 rounded-r-full bg-[linear-gradient(180deg,var(--mf-primary),var(--mf-accent),var(--mf-plum))]" />

            <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 space-y-4">
                    <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--mf-muted)]">
                            Identity Lens
                        </p>
                        <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--mf-ink)] md:text-4xl">
                            <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                        </h1>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[color:var(--mf-muted)]">
                            <span className="font-mono text-[12px] tracking-tight">
                                <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                            </span>
                            <span>{ageLabel}</span>
                            <span className="inline-flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5" />
                                {birthDateLabel}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <StatusGlyph
                            kind={patient.isArchived ? 'archived' : patient.isAdi ? 'active' : 'follow-up'}
                            label={patient.isArchived ? 'Archiviato' : patient.isAdi ? 'Attivo' : 'Follow-up'}
                        />
                        <StatusGlyph kind="review" label="Percorso clinico" />
                        {exemptions.length > 0 ? (
                            <StatusGlyph kind="completed" label={`${exemptions.length} esenzioni`} />
                        ) : null}
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                        <div className="identity-lens-pane rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-white/70 p-4 dark:bg-white/4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                Quadro clinico
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {diagnoses.length > 0 ? (
                                    diagnoses.map((diagnosis) => (
                                        <span
                                            key={`${diagnosis.system}-${diagnosis.code}`}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-[color:rgba(94,53,95,0.14)] bg-[color:rgba(94,53,95,0.08)] px-3 py-1 text-[12px] font-medium text-[color:var(--mf-ink)]"
                                        >
                                            <span className="font-semibold text-[color:var(--mf-plum)]">{diagnosis.code}</span>
                                            {diagnosis.description}
                                        </span>
                                    ))
                                ) : (
                                    <p className="text-sm text-[color:var(--mf-muted)]">
                                        Nessuna diagnosi strutturata in primo piano.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="identity-lens-pane rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-white/70 p-4 dark:bg-white/4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                Contesto rapido
                            </p>
                            <div className="mt-3 space-y-2 text-sm text-[color:var(--mf-ink)]">
                                <p className="inline-flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-[color:var(--mf-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.phone || 'Telefono non disponibile'}</PrivacyBlur>
                                </p>
                                <p className="inline-flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5 text-[color:var(--mf-muted)]" />
                                    <PrivacyBlur intensity="sm">{patient.address || 'Indirizzo non disponibile'}</PrivacyBlur>
                                </p>
                                <p>
                                    {exemptions.length > 0 ? `Esenzioni attive: ${exemptions.slice(0, 4).join(', ')}.` : 'Nessuna esenzione strutturata registrata.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="xl:w-[360px] xl:max-w-[360px]">
                    {actions}
                </div>
            </div>
        </section>
    );
}
