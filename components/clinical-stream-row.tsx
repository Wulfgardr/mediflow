'use client';

import Link from 'next/link';
import { ArrowUpRight, Building2, Clock3, FileSearch, UserRound } from 'lucide-react';

import PrivacyBlur from '@/components/privacy-blur';
import { StatusGlyph } from '@/components/status-glyph';
import type { Diagnosis, Patient } from '@/lib/db';
import { cn, estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';

interface ClinicalStreamRowProps {
    /* @Codex */
    variant?: 'atlas' | 'mailbox';
    patient: Patient;
    ambulatoryName?: string;
    isSelected: boolean;
    isMarked?: boolean;
    onSelect: (id: string) => void;
    onToggleMark?: (id: string) => void;
}

function getAgeLabel(patient: Patient): string {
    const birthYear = patient.birthDate
        ? new Date(patient.birthDate).getFullYear()
        : estimateBirthYearFromTaxCode(patient.taxCode);

    return birthYear ? `${calculateAge(birthYear)} anni` : 'Età n/d';
}

function getLeadDiagnosis(patient: Patient): Diagnosis | null {
    return Array.isArray(patient.diagnoses) && patient.diagnoses.length > 0
        ? patient.diagnoses[0]
        : null;
}

function getStatusKind(patient: Patient) {
    if (patient.isArchived) return { kind: 'archived' as const, label: 'Archiviato' };
    if (patient.isAdi) return { kind: 'active' as const, label: 'Attivo' };
    return { kind: 'follow-up' as const, label: 'Follow-up' };
}

/* @Codex */
function getPreviewText(patient: Patient, leadDiagnosis: Diagnosis | null) {
    if (leadDiagnosis) return `${leadDiagnosis.code} · ${leadDiagnosis.description}`;
    if (patient.isArchived) return 'Percorso chiuso, pronto a riapertura o conferma archivio.';
    if (patient.isAdi) return 'Percorso territoriale attivo con continuità domiciliare.';
    return 'Scheda pronta per revisione, diario ed evidenze contestuali.';
}

/* @Codex */
function formatLastTouched(patient: Patient) {
    const rawDate = patient.updatedAt || patient.createdAt;
    if (!rawDate) return 'Nessun aggiornamento';
    const date = new Date(rawDate);
    return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit',
        month: 'short',
    }).format(date);
}

export function ClinicalStreamRow({
    variant = 'atlas',
    patient,
    ambulatoryName,
    isSelected,
    isMarked = false,
    onSelect,
    onToggleMark,
}: ClinicalStreamRowProps) {
    const leadDiagnosis = getLeadDiagnosis(patient);
    const status = getStatusKind(patient);
    const isMailbox = variant === 'mailbox';

    if (isMailbox) {
        return (
            <article
                className={cn(
                    'clinical-stream-row clinical-stream-row-mailbox relative border-b border-[color:rgba(112,106,100,0.08)] bg-transparent px-3 py-3 transition-[background-color,border-color,box-shadow] duration-200 last:border-b-0',
                    isSelected
                        ? 'rounded-[16px] border-[color:rgba(15,123,104,0.16)] bg-[color:rgba(15,123,104,0.08)] shadow-[0_8px_18px_rgba(15,123,104,0.08)]'
                        : 'hover:bg-[color:rgba(255,255,255,0.68)] dark:hover:bg-white/5',
                )}
            >
                <button
                    type="button"
                    onClick={() => onSelect(patient.id)}
                    className="absolute inset-0 rounded-[16px]"
                    aria-label={`Seleziona il caso di ${patient.firstName} ${patient.lastName}`}
                />

                <div className="relative z-10 flex items-start gap-3">
                    {onToggleMark ? (
                        <div className="flex items-start pt-2">
                            <input
                                type="checkbox"
                                checked={isMarked}
                                onChange={() => onToggleMark(patient.id)}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Seleziona ${patient.firstName} ${patient.lastName}`}
                                className="h-4 w-4 cursor-pointer rounded border-[color:rgba(112,106,100,0.28)] text-[color:var(--mf-primary)]"
                            />
                        </div>
                    ) : null}

                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(255,249,240,0.72))] text-sm font-semibold text-[color:var(--mf-primary)] shadow-[0_8px_18px_rgba(35,27,22,0.06)] dark:border-white/10 dark:bg-white/6">
                        {patient.firstName?.[0]}
                        {patient.lastName?.[0]}
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <h2 className="truncate text-[15px] font-semibold text-[color:var(--mf-ink)]">
                                        <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                    </h2>
                                    <StatusGlyph kind={status.kind} label={status.label} />
                                    {patient.isAdi ? <StatusGlyph kind="review" label="Territorio" /> : null}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[color:var(--mf-muted)]">
                                    <span className="font-mono tracking-tight">
                                        <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                                    </span>
                                    <span>{getAgeLabel(patient)}</span>
                                    {ambulatoryName ? (
                                        <span className="inline-flex items-center gap-1">
                                            <Building2 className="h-3 w-3" />
                                            {ambulatoryName}
                                        </span>
                                    ) : null}
                                </div>
                            </div>

                            <div className="flex shrink-0 flex-col items-end gap-2">
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--mf-muted)]">
                                    <Clock3 className="h-3 w-3" />
                                    {formatLastTouched(patient)}
                                </span>
                                <Link
                                    href={`/patients/${patient.id}`}
                                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-[color:var(--mf-primary)] transition-colors hover:bg-[color:rgba(15,123,104,0.08)]"
                                >
                                    Apri
                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                </Link>
                            </div>
                        </div>

                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[color:var(--mf-ink)]">
                            {getPreviewText(patient, leadDiagnosis)}
                        </p>
                    </div>
                </div>
            </article>
        );
    }

    return (
        <article
            className={cn(
                'clinical-stream-row relative rounded-[26px] border p-4 transition-[border-color,background-color,box-shadow,transform] duration-200',
                isSelected
                    ? 'border-[color:rgba(15,123,104,0.26)] bg-white/78 shadow-[0_24px_42px_rgba(35,27,22,0.08)] dark:bg-white/8'
                    : 'border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,249,240,0.72)] hover:-translate-y-0.5 hover:border-[color:rgba(94,53,95,0.18)] hover:bg-white/82 hover:shadow-[0_18px_34px_rgba(35,27,22,0.06)] dark:bg-white/4',
            )}
        >
            <button
                type="button"
                onClick={() => onSelect(patient.id)}
                className="absolute inset-0 rounded-[26px]"
                aria-label={`Seleziona il caso di ${patient.firstName} ${patient.lastName}`}
            />

            <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-4">
                    {onToggleMark ? (
                        <div className="flex items-start pt-1">
                            <input
                                type="checkbox"
                                checked={isMarked}
                                onChange={() => onToggleMark(patient.id)}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Seleziona ${patient.firstName} ${patient.lastName}`}
                                className="h-4 w-4 cursor-pointer rounded border-[color:rgba(112,106,100,0.28)] text-[color:var(--mf-primary)]"
                            />
                        </div>
                    ) : null}
                    <div className="clinical-stream-row-avatar flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.92),rgba(255,249,240,0.68))] text-base font-semibold text-[color:var(--mf-primary)] shadow-[0_12px_24px_rgba(35,27,22,0.06)] dark:border-white/10 dark:bg-white/6">
                        {patient.firstName?.[0]}
                        {patient.lastName?.[0]}
                    </div>

                    <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                                <UserRound className="h-4 w-4 shrink-0 text-[color:var(--mf-muted)]" />
                                <h2 className="truncate text-lg font-semibold text-[color:var(--mf-ink)]">
                                    <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                </h2>
                            </div>
                            <StatusGlyph kind={status.kind} label={status.label} />
                            {patient.isAdi ? <StatusGlyph kind="review" label="Territorio" /> : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[color:var(--mf-muted)]">
                            <span className="font-mono text-[12px] tracking-tight">
                                <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                            </span>
                            <span>{getAgeLabel(patient)}</span>
                            {ambulatoryName ? (
                                <span className="inline-flex items-center gap-1.5">
                                    <Building2 className="h-3.5 w-3.5" />
                                    {ambulatoryName}
                                </span>
                            ) : null}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                            <div className="clinical-stream-row-cell rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/66 px-3 py-2 dark:bg-white/4">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                    Condizione
                                </p>
                                <p className="mt-1 text-sm text-[color:var(--mf-ink)]">
                                    {getPreviewText(patient, leadDiagnosis)}
                                </p>
                            </div>
                            <div className="clinical-stream-row-cell rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/66 px-3 py-2 dark:bg-white/4">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                    Prossimo passaggio
                                </p>
                                <p className="mt-1 text-sm text-[color:var(--mf-ink)]">
                                    {patient.isArchived
                                        ? 'Riapri storico o conferma chiusura del percorso.'
                                        : patient.isAdi
                                            ? 'Verifica stato domiciliare e sincronizza i controlli.'
                                            : 'Apri il caso e aggiorna diario, esenzioni e insight.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="relative z-10 flex items-center gap-2 self-start">
                    <div className="clinical-stream-row-utility hidden rounded-full border border-[color:rgba(112,106,100,0.12)] bg-white/72 px-3 py-2 text-[11px] font-semibold text-[color:var(--mf-muted)] md:inline-flex md:items-center md:gap-1.5 dark:bg-white/6">
                        <FileSearch className="h-3.5 w-3.5 text-[color:var(--mf-plum)]" />
                        Case Lens
                    </div>
                    <Link
                        href={`/patients/${patient.id}`}
                        className="clinical-stream-row-link inline-flex items-center gap-2 rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/84 px-3.5 py-2 text-[13px] font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,123,104,0.26)] hover:text-[color:var(--mf-primary)] dark:bg-white/6"
                    >
                        Apri caso
                        <ArrowUpRight className="h-4 w-4" />
                    </Link>
                </div>
            </div>
        </article>
    );
}
