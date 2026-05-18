'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronRight, Clock } from 'lucide-react';

import { db, type Checkup, type Patient } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import {
    classifyCheckupAgendaStatus,
    filterCheckupAgendaByStatus,
    sortCheckupAgenda,
    type CheckupAgendaStatus,
} from '@/lib/checkup-agenda';

interface PatientAgendaWorklistProps {
    patients: Patient[];
}

type AgendaFilter = 'active' | CheckupAgendaStatus;

const FILTER_OPTIONS: { value: AgendaFilter; label: string }[] = [
    { value: 'active', label: 'Attivi' },
    { value: 'overdue', label: 'In ritardo' },
    { value: 'today', label: 'Oggi' },
    { value: 'upcoming', label: 'In arrivo' },
];

const STATUS_BADGES: Record<CheckupAgendaStatus, { label: string; className: string }> = {
    overdue: {
        label: 'In ritardo',
        className: 'bg-[color:rgba(193,68,68,0.12)] text-[color:rgb(159,42,42)] dark:bg-[color:rgba(232,110,96,0.16)] dark:text-[color:rgb(244,170,158)]',
    },
    today: {
        label: 'Oggi',
        className: 'bg-[color:rgba(15,123,104,0.12)] text-[color:var(--mf-primary)] dark:bg-[color:rgba(94,199,177,0.16)] dark:text-[color:rgb(150,224,204)]',
    },
    upcoming: {
        label: 'In arrivo',
        className: 'bg-[color:rgba(112,106,100,0.12)] text-[color:var(--mf-ink)] dark:bg-[color:rgba(255,255,255,0.06)]',
    },
    completed: {
        label: 'Completato',
        className: 'bg-[color:rgba(112,106,100,0.08)] text-[color:var(--mf-muted)] dark:bg-[color:rgba(255,255,255,0.04)]',
    },
    cancelled: {
        label: 'Annullato',
        className: 'bg-[color:rgba(112,106,100,0.08)] text-[color:var(--mf-muted)] dark:bg-[color:rgba(255,255,255,0.04)]',
    },
};

const MAX_VISIBLE_ITEMS = 6;

function formatItalianDate(value: Date): string {
    return new Date(value).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'short',
    });
}

export function PatientAgendaWorklist({ patients }: PatientAgendaWorklistProps) {
    const [filter, setFilter] = useState<AgendaFilter>('active');

    const visibleIds = useMemo(() => new Set(patients.map((patient) => patient.id)), [patients]);
    const visibleIdsKey = useMemo(() => Array.from(visibleIds).sort().join('|'), [visibleIds]);

    const checkups = useLiveQuery<Checkup[]>(
        async () => {
            if (visibleIds.size === 0) return [];
            const items = await db.checkups
                .filter((checkup: Checkup) => (
                    visibleIds.has(checkup.patientId)
                    && checkup.status !== 'completed'
                    && checkup.status !== 'cancelled'
                ))
                .toArray();
            return items;
        },
        [visibleIdsKey],
    );

    const now = new Date();
    const ranked = sortCheckupAgenda(checkups ?? [], now);
    const filtered = filter === 'active'
        ? ranked
        : filterCheckupAgendaByStatus(ranked, new Set([filter]), now);

    const patientById = useMemo(() => {
        const map = new Map<string, Patient>();
        patients.forEach((patient) => map.set(patient.id, patient));
        return map;
    }, [patients]);

    if (!checkups || checkups.length === 0) return null;

    const visibleItems = filtered.slice(0, MAX_VISIBLE_ITEMS);
    const hiddenCount = filtered.length - visibleItems.length;
    const overdueCount = ranked.filter((item) => classifyCheckupAgendaStatus(item, now) === 'overdue').length;
    const todayCount = ranked.filter((item) => classifyCheckupAgendaStatus(item, now) === 'today').length;

    return (
        <section
            className="patient-agenda-worklist rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.78)] p-4 shadow-[0_12px_24px_rgba(35,27,22,0.05)] backdrop-blur-xl dark:border-[color:rgba(255,247,240,0.08)] dark:bg-[color:rgba(26,22,26,0.86)] dark:shadow-[0_16px_30px_rgba(6,5,7,0.42)]"
            data-testid="patient-agenda-panel"
        >
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                    <p className="section-kicker">Agenda operativa</p>
                    <h2 className="flex items-center gap-2 text-base font-semibold text-[color:var(--mf-ink)]">
                        <CalendarClock className="h-4 w-4 text-[color:var(--mf-accent)]" />
                        Prossimi passaggi per i casi visibili
                    </h2>
                    <p className="text-[12px] text-[color:var(--mf-muted)]">
                        {overdueCount > 0 ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-[color:rgb(159,42,42)] dark:text-[color:rgb(244,170,158)]">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {overdueCount} in ritardo
                            </span>
                        ) : null}
                        {overdueCount > 0 && todayCount > 0 ? <span className="px-1.5">·</span> : null}
                        {todayCount > 0 ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-[color:var(--mf-primary)]">
                                <Clock className="h-3.5 w-3.5" />
                                {todayCount} oggi
                            </span>
                        ) : null}
                        {overdueCount === 0 && todayCount === 0 ? (
                            <span>{ranked.length} voci attive tra PRIAMO, valutazioni e visite.</span>
                        ) : null}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    {FILTER_OPTIONS.map((option) => {
                        const isActive = filter === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setFilter(option.value)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                    isActive
                                        ? 'border-[color:rgba(15,123,104,0.32)] bg-[color:rgba(15,123,104,0.12)] text-[color:var(--mf-primary)] dark:border-[color:rgba(94,199,177,0.36)] dark:bg-[color:rgba(94,199,177,0.14)] dark:text-[color:rgb(150,224,204)]'
                                        : 'border-[color:rgba(112,106,100,0.16)] bg-white/72 text-[color:var(--mf-muted)] hover:text-[color:var(--mf-ink)] dark:border-[color:rgba(255,247,240,0.12)] dark:bg-[color:rgba(255,255,255,0.04)] dark:hover:bg-[color:rgba(255,255,255,0.07)]'
                                }`}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {visibleItems.length === 0 ? (
                <p className="mt-3 rounded-[14px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-3 py-3 text-center text-[12px] text-[color:var(--mf-muted)] dark:border-[color:rgba(255,247,240,0.14)]">
                    Nessuna voce in questo filtro.
                </p>
            ) : (
                <ul className="mt-3 divide-y divide-[color:rgba(112,106,100,0.1)] overflow-hidden rounded-[14px] border border-[color:rgba(112,106,100,0.1)] bg-white/68 dark:divide-[color:rgba(255,247,240,0.06)] dark:border-[color:rgba(255,247,240,0.08)] dark:bg-[color:rgba(255,255,255,0.03)]">
                    {visibleItems.map((checkup) => {
                        const status = classifyCheckupAgendaStatus(checkup, now);
                        const badge = STATUS_BADGES[status];
                        const patient = patientById.get(checkup.patientId);
                        const patientLabel = patient
                            ? `${patient.lastName} ${patient.firstName}`.trim()
                            : 'Paziente';
                        return (
                            <li key={checkup.id} data-testid="patient-agenda-item">
                                <Link
                                    href={`/patients/${checkup.patientId}`}
                                    data-testid="patient-agenda-open-patient"
                                    className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[color:rgba(15,123,104,0.05)] dark:hover:bg-[color:rgba(94,199,177,0.08)]"
                                >
                                    <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--mf-muted)]">
                                        {formatItalianDate(checkup.date)}
                                    </span>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ${badge.className}`}>
                                        {badge.label}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] font-semibold text-[color:var(--mf-ink)]">
                                            {checkup.title || 'Prossimo passaggio'}
                                        </p>
                                        <p className="truncate text-[11px] text-[color:var(--mf-muted)]">
                                            {patientLabel}
                                            {checkup.notes ? <span className="text-[color:rgba(112,106,100,0.6)] dark:text-[color:rgba(255,247,240,0.5)]"> · {checkup.notes}</span> : null}
                                        </p>
                                    </div>
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:rgba(112,106,100,0.4)] transition-colors group-hover:text-[color:var(--mf-primary)] dark:text-[color:rgba(255,247,240,0.34)] dark:group-hover:text-[color:rgb(150,224,204)]" />
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}

            {hiddenCount > 0 ? (
                <p className="mt-2 text-right text-[11px] font-medium text-[color:var(--mf-muted)]">
                    +{hiddenCount} altre voci · apri la cartella per il dettaglio
                </p>
            ) : null}
        </section>
    );
}
