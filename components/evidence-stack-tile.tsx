'use client';

import { CalendarDays, FileText, Microscope, ShieldCheck } from 'lucide-react';

import { StatusGlyph } from '@/components/status-glyph';
import type { DocumentInsight, DocumentQualityLevel } from '@/lib/db';
import { LumeFilo } from '@/components/ui/lume-filo';

interface EvidenceStackTileProps {
    insight: DocumentInsight;
}

function formatDate(date: Date) {
    return new Date(date).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function getQualityGlyph(level?: DocumentQualityLevel) {
    if (level === 'green') return { kind: 'completed' as const, label: 'Verified' };
    if (level === 'red') return { kind: 'high' as const, label: 'Critical' };
    return { kind: 'review' as const, label: 'In review' };
}

export function EvidenceStackTile({ insight }: EvidenceStackTileProps) {
    const quality = getQualityGlyph(insight.quality?.level);
    const diagnosisCount = Array.isArray(insight.extractedData?.diagnoses) ? insight.extractedData.diagnoses.length : 0;
    const medicationCount = Array.isArray(insight.extractedData?.medications) ? insight.extractedData.medications.length : 0;

    return (
        <article className="evidence-stack-tile rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-white/68 p-4 shadow-[0_14px_28px_rgba(35,27,22,0.05)] dark:bg-white/4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-[color:rgba(15,123,104,0.08)] text-[color:var(--mf-primary)]">
                        <FileText className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-[color:var(--mf-ink)]">{insight.fileName}</p>
                        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[color:var(--mf-muted)]">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {formatDate(insight.date)}
                        </div>
                    </div>
                </div>
                <StatusGlyph kind={quality.kind} label={quality.label} />
            </div>

            <div className="relative mt-4 pl-5">
                <LumeFilo variant="connettore" fill={100} className="absolute left-0 top-0 h-4 w-5" />
                <p className="text-sm leading-6 text-[color:var(--mf-muted)] line-clamp-3">
                    {insight.summary || 'Documento acquisito e pronto per revisione contestuale.'}
                </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:rgba(112,106,100,0.12)] bg-white/82 px-3 py-1 text-[11px] font-semibold text-[color:var(--mf-muted)] dark:bg-white/6">
                    <Microscope className="h-3.5 w-3.5 text-[color:var(--mf-plum)]" />
                    {diagnosisCount} diagnosi
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:rgba(112,106,100,0.12)] bg-white/82 px-3 py-1 text-[11px] font-semibold text-[color:var(--mf-muted)] dark:bg-white/6">
                    <ShieldCheck className="h-3.5 w-3.5 text-[color:var(--mf-accent)]" />
                    {medicationCount} terapie
                </span>
            </div>
        </article>
    );
}
