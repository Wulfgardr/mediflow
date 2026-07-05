'use client';

/* @Codex */

import { useEffect, useRef, useState } from 'react';
import {
    Activity,
    ArrowLeft,
    ArrowRight,
    Brain,
    ClipboardList,
    Ruler,
    Search,
    UserPlus,
    type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';
import { SCALES } from '@/lib/scale-definitions';

type ScaleCatalogItem = {
    id: string;
    category: string;
    icon: LucideIcon;
};

const SCALE_CATALOG: ScaleCatalogItem[] = [
    { id: 'mmse', category: 'Cognitivo e umore', icon: Brain },
    { id: 'gds', category: 'Cognitivo e umore', icon: Activity },
    { id: 'tinetti', category: 'Autonomia e mobilità', icon: Ruler },
    { id: 'adl', category: 'Autonomia e mobilità', icon: ClipboardList },
    { id: 'iadl', category: 'Autonomia e mobilità', icon: ClipboardList },
].filter((item) => Boolean(SCALES[item.id]));

const SCALE_NAV_BASE = [{ href: '#catalogo', label: 'Catalogo', meta: `${SCALE_CATALOG.length} attive` }];
const GROUPED_SCALE_CATALOG = Array.from(
    SCALE_CATALOG.reduce((groups, item) => {
        const current = groups.get(item.category) ?? [];
        current.push(item);
        groups.set(item.category, current);
        return groups;
    }, new Map<string, ScaleCatalogItem[]>()).entries()
);

export default function ScalesLibraryPage() {
    const router = useRouter();
    const [selectedScale, setSelectedScale] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const catalogSectionRef = useRef<HTMLElement | null>(null);
    const patientSectionRef = useRef<HTMLElement | null>(null);
    const patientSearchRef = useRef<HTMLInputElement | null>(null);

    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    const selectedScaleDefinition = selectedScale ? SCALES[selectedScale] : null;
    const navItems = selectedScaleDefinition
        ? [...SCALE_NAV_BASE, { href: '#paziente', label: 'Paziente', meta: 'avvio scala' }]
        : SCALE_NAV_BASE;

    const patients = useLiveQuery(
        () => {
            if (!selectedScaleDefinition) return Promise.resolve([]);
            return db.patients
                .filter((patient) => {
                    if (!normalizedSearchTerm) return true;
                    const haystack = `${patient.firstName} ${patient.lastName} ${patient.taxCode}`.toLowerCase();
                    return haystack.includes(normalizedSearchTerm);
                })
                .limit(8)
                .toArray();
        },
        [normalizedSearchTerm, selectedScaleDefinition]
    );

    useEffect(() => {
        if (!selectedScaleDefinition) return;
        window.requestAnimationFrame(() => {
            patientSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (window.matchMedia('(pointer: fine)').matches) {
                patientSearchRef.current?.focus({ preventScroll: true });
            }
        });
    }, [selectedScaleDefinition]);

    const handleScaleChoice = (scaleId: string) => {
        setSelectedScale(scaleId);
    };

    const handleClearScale = () => {
        setSelectedScale(null);
        setSearchTerm('');
        window.requestAnimationFrame(() => {
            catalogSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    };

    const handleSelectPatient = (patientId: string) => {
        if (!selectedScaleDefinition) return;
        router.push(`/patients/${patientId}/scales/${selectedScaleDefinition.id}`);
    };

    return (
        <Kree8WorkspaceShell
            eyebrow="Scale"
            title="Scale cliniche"
            subtitle="Il punteggio viene registrato nella cartella del paziente."
            backHref="/?area=incarico"
            backLabel="Torna ai pazienti"
            statusLabel={selectedScaleDefinition
                ? `${selectedScaleDefinition.title}: manca la scheda paziente.`
                : 'Sono elencate solo le scale già digitalizzate.'}
            navItems={navItems}
        >
            <section id="catalogo" ref={catalogSectionRef} className="patient-detail-section mf-section p-6 md:p-8 space-y-6 scroll-mt-40">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                        <p className="mf-eyebrow">Catalogo scale</p>
                        <h2 className="text-xl font-semibold tracking-tight text-slate-950">
                            Scale pronte alla somministrazione
                        </h2>
                    </div>
                    <span className="apple-chip w-fit">{SCALE_CATALOG.length} scale attive</span>
                </div>

                <div className="space-y-6">
                    {GROUPED_SCALE_CATALOG.map(([category, items]) => (
                        <div key={category} className="space-y-3">
                            <h3 className="section-kicker px-1">{category}</h3>
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {items.map((item) => {
                                    const scale = SCALES[item.id];
                                    const Icon = item.icon;
                                    const isSelected = selectedScale === item.id;

                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => handleScaleChoice(item.id)}
                                            aria-pressed={isSelected}
                                            className={`group flex min-h-[170px] flex-col justify-between rounded-[22px] border p-5 text-left transition-[border-color,background-color,box-shadow,transform] active:scale-[0.99] ${
                                                isSelected
                                                    ? 'border-slate-300 bg-slate-50 shadow-[0_12px_28px_rgba(15,23,42,0.08)]'
                                                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                                            }`}
                                        >
                                            <span className="flex items-start justify-between gap-3">
                                                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition-colors group-hover:bg-white">
                                                    <Icon className="h-5 w-5" />
                                                </span>
                                            </span>
                                            <span className="space-y-2">
                                                <strong className="block text-lg font-semibold leading-tight text-slate-950">
                                                    {scale.title}
                                                </strong>
                                                <span className="block text-sm leading-relaxed text-slate-600">
                                                    {scale.description}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {selectedScaleDefinition && (
                <section id="paziente" ref={patientSectionRef} className="patient-detail-section mf-section p-6 md:p-8 space-y-5 scroll-mt-40">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                            <p className="mf-eyebrow">Avvio scala</p>
                            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
                                Scegli il paziente
                            </h2>
                            <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
                                Hai scelto <strong className="font-semibold text-slate-950">{selectedScaleDefinition.title}</strong>.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleClearScale}
                            className="mf-btn-secondary w-fit"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Cambia scala
                        </button>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            ref={patientSearchRef}
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Cerca per nome o codice fiscale"
                            className="mf-input pl-11"
                        />
                    </div>

                    <div className="grid gap-3">
                        {patients?.map((patient) => (
                            <button
                                key={patient.id}
                                type="button"
                                onClick={() => handleSelectPatient(patient.id)}
                                aria-label={`Avvia ${selectedScaleDefinition.title} per ${patient.lastName} ${patient.firstName}`}
                                className="flex items-center justify-between gap-4 rounded-[18px] border border-slate-200 bg-white p-4 text-left transition-[border-color,background-color] hover:border-slate-300 hover:bg-slate-50"
                            >
                                <span className="min-w-0">
                                    <strong className="block truncate text-sm font-semibold text-slate-950">
                                        {patient.lastName} {patient.firstName}
                                    </strong>
                                    <span className="mt-1 block truncate text-xs text-slate-500">{patient.taxCode}</span>
                                </span>
                                <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-600">
                                    Avvia
                                    <ArrowRight className="h-4 w-4" />
                                </span>
                            </button>
                        ))}

                        {patients?.length === 0 && (
                            <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                                Nessuna scheda corrisponde alla ricerca.
                            </div>
                        )}

                        {patients && patients.length >= 8 && (
                            <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                                Affina la ricerca per vedere altre schede.
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end border-t border-slate-100 pt-5">
                        <button
                            type="button"
                            onClick={() => router.push('/patients/new')}
                            className="mf-btn-secondary"
                        >
                            <UserPlus className="h-4 w-4" />
                            Crea nuova scheda
                        </button>
                    </div>
                </section>
            )}
        </Kree8WorkspaceShell>
    );
}
