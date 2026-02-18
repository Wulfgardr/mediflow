'use client';

import { useLiveQuery } from '@/lib/live-query';
import { db, Ambulatory, Patient } from '@/lib/db';
import { Search, UserPlus, FileText, Archive, Copy, Scissors, Activity, RefreshCw, Users, Building2 } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';
import PrivacyBlur from '@/components/privacy-blur';
import { usePatientClipboard } from '@/hooks/use-patient-clipboard';
import { notifyDbChange } from '@/lib/live-query';

function useCookie(name: string) {
    const [value, setValue] = useState<string | null>(null);
    useEffect(() => {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        if (match && match[2] !== value) setValue(match[2]);
    }, [name, value]);
    return value;
}

// Deterministic color palette for ambulatories
const AMBULATORY_COLORS = [
    { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dark: 'dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300', dot: 'bg-blue-500' },
    { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dark: 'dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300', dot: 'bg-emerald-500' },
    { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', dark: 'dark:bg-violet-900/20 dark:border-violet-800 dark:text-violet-300', dot: 'bg-violet-500' },
    { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dark: 'dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300', dot: 'bg-amber-500' },
    { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', dark: 'dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300', dot: 'bg-rose-500' },
    { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', dark: 'dark:bg-cyan-900/20 dark:border-cyan-800 dark:text-cyan-300', dot: 'bg-cyan-500' },
    { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dark: 'dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300', dot: 'bg-orange-500' },
    { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', text: 'text-fuchsia-700', dark: 'dark:bg-fuchsia-900/20 dark:border-fuchsia-800 dark:text-fuchsia-300', dot: 'bg-fuchsia-500' },
];

function getAmbulatoryColor(id: string): typeof AMBULATORY_COLORS[0] {
    // Simple hash function to get consistent color index
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash) + id.charCodeAt(i);
        hash |= 0;
    }
    return AMBULATORY_COLORS[Math.abs(hash) % AMBULATORY_COLORS.length];
}

interface PatientGroup {
    ambulatory: Ambulatory | null;
    patients: Patient[];
    color: typeof AMBULATORY_COLORS[0];
}

export default function PatientList() {
    const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');
    const [search, setSearch] = useState('');
    /* @Codex */
    const [sortMode, setSortMode] = useState<'alpha' | 'recent'>('recent');

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isMoving, setIsMoving] = useState(false);
    const [targetAmbulatory, setTargetAmbulatory] = useState<string>('');
    const [showMoveModal, setShowMoveModal] = useState(false);
    const { copy, cut, paste, clipboard } = usePatientClipboard();
    const currentAmbulatoryId = useCookie('ambulatory_id');

    const ambulatories = useLiveQuery(() => db.ambulatories.toArray());

    /* @Codex */
    const sortPatients = (items: Patient[]) => {
        const sorted = [...items];
        if (sortMode === 'alpha') {
            sorted.sort((a, b) => {
                const last = a.lastName.localeCompare(b.lastName);
                if (last !== 0) return last;
                return a.firstName.localeCompare(b.firstName);
            });
            return sorted;
        }
        sorted.sort((a, b) => {
            const aTime = (a.updatedAt || a.createdAt) ? new Date(a.updatedAt || a.createdAt).getTime() : 0;
            const bTime = (b.updatedAt || b.createdAt) ? new Date(b.updatedAt || b.createdAt).getTime() : 0;
            return bTime - aTime;
        });
        return sorted;
    };

    const patients = useLiveQuery(
        async () => {
            let collection = db.patients.orderBy('lastName');

            // 2. Status Filter
            if (viewMode === 'active') {
                collection = collection.filter(p => !p.isArchived);
            } else {
                collection = collection.filter(p => !!p.isArchived);
            }

            // 3. Search Filter
            if (search) {
                const terms = search.toLowerCase().trim().split(/\s+/);
                const results = await collection.filter(p => {
                    const searchableText = `${p.lastName} ${p.firstName} ${p.taxCode || ''}`.toLowerCase();
                    return terms.every(term => searchableText.includes(term));
                }).toArray();
                /* @Codex */
                return sortPatients(results);
            }
            const results = await collection.toArray();
            /* @Codex */
            return sortPatients(results);
        },
        [search, viewMode, currentAmbulatoryId, sortMode]
    );

    // Group patients by ambulatory for Global View
    const patientGroups = useMemo<PatientGroup[]>(() => {
        if (!patients || !ambulatories || currentAmbulatoryId) return [];

        const groups = new Map<string, Patient[]>();
        const unassigned: Patient[] = [];

        patients.forEach(p => {
            if (p.ambulatoryId) {
                const existing = groups.get(p.ambulatoryId) || [];
                existing.push(p);
                groups.set(p.ambulatoryId, existing);
            } else {
                unassigned.push(p);
            }
        });

        const result: PatientGroup[] = [];

        // Sort ambulatories: parents first, then children
        const sortedAmbs = [...ambulatories].sort((a, b) => {
            if (!a.parentId && b.parentId) return -1;
            if (a.parentId && !b.parentId) return 1;
            return a.name.localeCompare(b.name);
        });

        sortedAmbs.forEach(amb => {
            const patientsInAmb = groups.get(amb.id);
            if (patientsInAmb && patientsInAmb.length > 0) {
                result.push({
                    ambulatory: amb,
                    patients: patientsInAmb,
                    color: getAmbulatoryColor(amb.id)
                });
            }
        });

        // Add unassigned patients at the end
        if (unassigned.length > 0) {
            result.push({
                ambulatory: null,
                patients: unassigned,
                color: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', dark: 'dark:bg-gray-900/20 dark:border-gray-800 dark:text-gray-300', dot: 'bg-gray-400' }
            });
        }

        return result;
    }, [patients, ambulatories, currentAmbulatoryId]);

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleSelectAll = useCallback(() => {
        if (!patients) return;
        if (selectedIds.size === patients.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(patients.map(p => p.id)));
        }
    }, [patients, selectedIds]);

    // HOTKEYS
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

            const isCtrl = e.metaKey || e.ctrlKey;

            if (isCtrl && e.key === 'a') {
                e.preventDefault();
                handleSelectAll();
            }

            if (isCtrl && e.key === 'c') {
                e.preventDefault();
                if (selectedIds.size > 0 && currentAmbulatoryId) {
                    copy(Array.from(selectedIds), currentAmbulatoryId);
                    console.log(`Copiati ${selectedIds.size} pazienti`);
                }
            }

            if (isCtrl && e.key === 'x') {
                e.preventDefault();
                if (selectedIds.size > 0 && currentAmbulatoryId) {
                    cut(Array.from(selectedIds), currentAmbulatoryId);
                    console.log(`Tagliati ${selectedIds.size} pazienti`);
                }
            }

            if (isCtrl && e.key === 'v') {
                e.preventDefault();
                if (clipboard.patientIds.length > 0 && currentAmbulatoryId) {
                    const isTest = ambulatories?.find(a => a.id === currentAmbulatoryId)?.type === 'test';
                    const opName = clipboard.operation === 'copy' ? 'Copia' : 'Sposta';
                    if (confirm(`${opName} di ${clipboard.patientIds.length} pazienti qui?`)) {
                        const success = await paste(currentAmbulatoryId, !!isTest);
                        if (success) {
                            if (clipboard.operation === 'cut') setSelectedIds(new Set());
                            notifyDbChange(); // @Codex
                        }
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds, currentAmbulatoryId, clipboard, copy, cut, paste, ambulatories, handleSelectAll]);

    const handleMove = async () => {
        if (!targetAmbulatory) return;
        setIsMoving(true);
        try {
            const res = await fetch('/api/patients/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientIds: Array.from(selectedIds),
                    targetAmbulatoryId: targetAmbulatory,
                    /* @Codex */
                    sourceAmbulatoryId: currentAmbulatoryId
                })
            });

            if (!res.ok) throw new Error("Move failed");

            setSelectedIds(new Set());
            setShowMoveModal(false);
            setTargetAmbulatory('');
            notifyDbChange(); // @Codex
        } catch (error) {
            console.error(error);
            alert("Errore durante lo spostamento");
        } finally {
            setIsMoving(false);
        }
    };

    // Render a single patient card
    const renderPatientCard = (patient: Patient, color?: typeof AMBULATORY_COLORS[0]) => (
        <div key={patient.id} className="relative group">
            <div className={`absolute top-4 left-4 z-20 transition-all ${selectedIds.size > 0 || selectedIds.has(patient.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                <input
                    type="checkbox"
                    checked={selectedIds.has(patient.id)}
                    onChange={() => toggleSelection(patient.id)}
                    aria-label={`Seleziona paziente ${patient.firstName || ''} ${patient.lastName || patient.id}`}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shadow-sm cursor-pointer"
                />
            </div>

            <Link href={`/patients/${patient.id}`} className="block h-full">
                <div className={`glass-card h-full p-6 relative overflow-hidden transition-all ${selectedIds.has(patient.id)
                    ? 'ring-2 ring-blue-500 bg-blue-50/50 dark:bg-blue-900/20'
                    : ''
                    } ${patient.isArchived ? 'opacity-75 grayscale-[0.3]' : ''} ${color ? `border-l-4 ${color.border}` : ''} dark:bg-[#161b22] dark:border-[#30363d] dark:hover:border-[#58a6ff]/50`}>
                    <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100 transition-opacity">
                        <FileText className="w-16 h-16 text-blue-500/10 transform group-hover:scale-110 transition-transform duration-500" />
                    </div>

                    <div className="relative z-10 pl-2">
                        <div className="flex items-center gap-3 mb-4">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shadow-inner ${patient.isArchived
                                ? 'bg-gray-100 text-gray-500 dark:bg-[#21262d] dark:text-[#8b949e]'
                                : 'bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-700 dark:from-[#1f6feb]/20 dark:to-[#58a6ff]/20 dark:text-[#58a6ff]'
                                }`}>
                                {patient.firstName[0]}{patient.lastName[0]}
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-gray-800 dark:text-[#c9d1d9] group-hover:text-blue-700 dark:group-hover:text-[#58a6ff] transition-colors">
                                    <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                </h3>
                                <div className="flex items-center gap-2">
                                    <p className="text-xs font-mono text-gray-500 dark:text-[#8b949e]">
                                        <PrivacyBlur intensity="sm">{patient.taxCode}</PrivacyBlur>
                                    </p>
                                    {patient.isArchived && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-md">
                                            ARCHIVIO
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 text-sm text-gray-600 dark:text-[#8b949e]">
                            <div className="flex justify-between border-b border-gray-100 dark:border-[#30363d] pb-2">
                                <span>Età</span>
                                <span className="font-medium text-gray-800">
                                    {(() => {
                                        const estYear = estimateBirthYearFromTaxCode(patient.taxCode);
                                        const finalAge = patient.birthDate && !isNaN(new Date(patient.birthDate).getTime())
                                            ? new Date().getFullYear() - new Date(patient.birthDate).getFullYear()
                                            : (estYear ? calculateAge(estYear) : null);
                                        return finalAge !== null ? `${finalAge} anni` : '--';
                                    })()}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span>Stato</span>
                                {patient.isArchived ? (
                                    <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-600 text-xs border border-amber-100">Archiviato</span>
                                ) : patient.isAdi ? (
                                    <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">ADI Attiva</span>
                                ) : (
                                    <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-500 text-xs border border-gray-200 dark:bg-[#21262d] dark:text-[#8b949e] dark:border-[#30363d]">Ambulatoriale</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </Link>
        </div>
    );

    // Check if we're in Global View mode
    const isGlobalView = !currentAmbulatoryId;

    return (
        <div className="space-y-6">
            {/* Header Section with Context */}
            <div className="flex flex-col gap-4">
                {/* @Codex: align header actions and improve visual rhythm */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 dark:border-white/5 pb-6">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            {/* Color dot for current ambulatory */}
                            {currentAmbulatoryId && (
                                <div className={`w-3.5 h-3.5 rounded-full shadow-sm ${(() => {
                                    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-fuchsia-500'];
                                    let hash = 0;
                                    for (let i = 0; i < currentAmbulatoryId.length; i++) { hash = ((hash << 5) - hash) + currentAmbulatoryId.charCodeAt(i); hash |= 0; }
                                    return colors[Math.abs(hash) % colors.length];
                                })()}`}></div>
                            )}
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${isGlobalView
                                ? 'bg-gradient-to-r from-blue-50 to-violet-50 text-violet-600 border-violet-200 dark:from-violet-900/30 dark:to-blue-900/30 dark:text-violet-400 dark:border-violet-800/50'
                                : 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50'
                                }`}>
                                {isGlobalView ? "Vista Globale Cumulativa" : "Reparto Operativo"}
                            </span>
                        </div>
                        <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight leading-tight mb-1">
                            {currentAmbulatoryId
                                ? (ambulatories?.find(a => a.id === currentAmbulatoryId)?.name || 'Caricamento...')
                                : 'Tutti i Reparti'}
                        </h1>
                        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-lg font-light mt-1">
                            {currentAmbulatoryId ? (
                                <>
                                    <span className="opacity-60 text-sm uppercase tracking-wide font-bold">In:</span>
                                    {(() => {
                                        const current = ambulatories?.find(a => a.id === currentAmbulatoryId);
                                        const parent = current?.parentId ? ambulatories?.find(a => a.id === current.parentId) : null;
                                        return parent ? (
                                            <span className="font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
                                                {parent.name}
                                                <span className="text-gray-400">/</span>
                                                {current?.name}
                                            </span>
                                        ) : (
                                            <span className="font-medium">Sede Principale</span>
                                        );
                                    })()}
                                </>
                            ) : (
                                <span className="flex items-center gap-2">
                                    <Building2 className="w-4 h-4" />
                                    {patientGroups.length} ambulatori • {patients?.length || 0} pazienti totali
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Link href="/analytics" className="group flex items-center gap-2 h-10 px-4 bg-white/70 dark:bg-white/5 border border-white/70 dark:border-white/10 rounded-2xl backdrop-blur hover:border-blue-300 dark:hover:border-blue-700 transition-all shadow-sm">
                            <Activity className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
                            <span className="text-sm font-medium text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white">Statistiche</span>
                        </Link>
                        <button
                            onClick={() => window.location.reload()}
                            className="h-10 w-10 flex items-center justify-center text-gray-400 hover:text-blue-600 bg-white/60 hover:bg-blue-50 dark:bg-white/5 dark:hover:bg-blue-900/20 rounded-2xl transition-all"
                            title="Aggiorna Lista"
                        >
                            <RefreshCw className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Selection & Filters Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        {selectedIds.size > 0 ? (
                            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-lg border border-blue-100 animate-in fade-in">
                                <span className="font-bold text-sm">{selectedIds.size} selezionati</span>
                                <div className="h-4 w-px bg-blue-200 mx-1"></div>
                                <button onClick={() => setShowMoveModal(true)} className="text-sm font-medium hover:underline flex items-center gap-1">Sposta...</button>
                                <button onClick={() => currentAmbulatoryId && copy(Array.from(selectedIds), currentAmbulatoryId)} className="ml-2 text-sm font-medium hover:underline flex items-center gap-1" title="Copia (Ctrl+C)"><Copy className="w-3 h-3" /></button>
                                <button onClick={() => currentAmbulatoryId && cut(Array.from(selectedIds), currentAmbulatoryId)} className="ml-2 text-sm font-medium hover:underline flex items-center gap-1" title="Taglia (Ctrl+X)"><Scissors className="w-3 h-3" /></button>
                                <button onClick={() => setSelectedIds(new Set())} className="ml-2 text-xs text-blue-400 hover:text-blue-600">Annulla</button>
                            </div>
                        ) : (
                            <>
                                {/* @Codex: clearer filter chips */}
                                <button onClick={() => setViewMode('active')} className={`h-9 px-4 rounded-full text-sm font-medium transition-all ${viewMode === 'active' ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500/20 dark:bg-blue-500/20 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'}`}>Attivi</button>
                                <button onClick={() => setViewMode('archived')} className={`h-9 px-4 rounded-full text-sm font-medium transition-all ${viewMode === 'archived' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-500/20 dark:bg-amber-500/20 dark:text-amber-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'}`}>Archiviati</button>
                            </>
                        )}
                    </div>
                    {/* @Codex */}
                    {selectedIds.size === 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ordina</span>
                            <button
                                onClick={() => setSortMode('alpha')}
                                className={`h-8 px-3 rounded-full text-xs font-medium transition-all ${sortMode === 'alpha' ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500/20 dark:bg-blue-500/20 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'}`}
                            >
                                A-Z
                            </button>
                            <button
                                onClick={() => setSortMode('recent')}
                                className={`h-8 px-3 rounded-full text-xs font-medium transition-all ${sortMode === 'recent' ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500/20 dark:bg-blue-500/20 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'}`}
                            >
                                Recenti
                            </button>
                        </div>
                    )}
                </div>

                {/* @Codex: align primary actions */}
                <div className="flex gap-2">
                    {patients && patients.length > 0 && (
                        <button onClick={handleSelectAll} className="h-10 px-4 bg-gray-100 text-gray-700 font-medium rounded-2xl hover:bg-gray-200 transition-colors text-sm">
                            {selectedIds.size === patients.length ? 'Deseleziona Tutto' : 'Seleziona Tutto'}
                        </button>
                    )}
                    <Link href="/patients/new" className="flex items-center gap-2 h-10 px-5 bg-white/70 text-blue-600 font-medium rounded-2xl shadow-sm border border-white/70 hover:bg-white transition-colors">
                        <UserPlus className="w-5 h-5" />
                        <span className="hidden sm:inline">Nuovo</span>
                    </Link>
                </div>
            </div>

            {/* Move Modal */}
            {showMoveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-gray-100 dark:border-gray-700">
                        <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">Sposta Pazienti</h3>
                        <p className="text-sm text-gray-500 mb-4">Seleziona l&apos;ambulatorio di destinazione per <strong>{selectedIds.size}</strong> pazienti.</p>
                        <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
                            {ambulatories?.map(amb => (
                                <label key={amb.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors">
                                    <input type="radio" name="targetAmb" value={amb.id} checked={targetAmbulatory === amb.id} onChange={(e) => setTargetAmbulatory(e.target.value)} className="h-4 w-4 text-blue-600" />
                                    <div className={`w-3 h-3 rounded-full ${getAmbulatoryColor(amb.id).dot}`}></div>
                                    <div>
                                        <p className="font-bold text-sm text-gray-800">{amb.name}</p>
                                        <div className="flex items-center gap-2">
                                            {amb.type === 'test' && <span className="text-[10px] items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase font-bold">TEST</span>}
                                            <p className="text-xs text-gray-500">{amb.address || "Nessun indirizzo"}</p>
                                        </div>
                                    </div>
                                </label>
                            ))}
                        </div>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowMoveModal(false)} disabled={isMoving} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">Annulla</button>
                            <button onClick={handleMove} disabled={!targetAmbulatory || isMoving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2">{isMoving ? 'Spostamento...' : 'Conferma Spostamento'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Search Bar */}
            <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                {/* @Codex: softer glass search field */}
                <input
                    type="text"
                    className="block w-full pl-10 pr-3 py-3.5 border-none rounded-2xl bg-white/70 dark:bg-[#0d1117] backdrop-blur-sm shadow-sm ring-1 ring-black/5 dark:ring-[#30363d] focus:ring-2 focus:ring-blue-500 focus:bg-white/90 dark:focus:bg-[#161b22] transition-all text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-[#8b949e]"
                    placeholder="Cerca per nome, cognome o codice fiscale..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {/* Patient Display: Clustered or Flat */}
            {isGlobalView && patientGroups.length > 0 ? (
                // CLUSTERED VIEW
                <div className="space-y-8">
                    {patientGroups.map((group) => (
                        <div key={group.ambulatory?.id || 'unassigned'} className={`rounded-2xl border-2 ${group.color.border} ${group.color.bg} ${group.color.dark} p-6 transition-all`}>
                            {/* Section Header */}
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className={`w-4 h-4 rounded-full ${group.color.dot} shadow-lg`}></div>
                                    <h2 className={`text-xl font-bold ${group.color.text}`}>
                                        {group.ambulatory?.name || 'Non Assegnati'}
                                    </h2>
                                    {group.ambulatory?.parentId && (
                                        <span className="text-xs opacity-60 ml-1">
                                            (sotto-ambulatorio)
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-sm opacity-70">
                                    <Users className="w-4 h-4" />
                                    <span className="font-bold">{group.patients.length}</span>
                                    <span>pazienti</span>
                                </div>
                            </div>

                            {/* Patient Grid within Section */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {group.patients.map(patient => renderPatientCard(patient, group.color))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                // FLAT VIEW (Single Ambulatory Selected)
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {patients?.map(patient => renderPatientCard(patient))}

                    {!patients?.length && (
                        <div className="col-span-full py-20 text-center">
                            {/* Color-coded empty state for focused ambulatory */}
                            <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 ${(() => {
                                if (!currentAmbulatoryId) return 'bg-gray-100 text-gray-400';
                                const colors = [
                                    'bg-blue-100 text-blue-500',
                                    'bg-emerald-100 text-emerald-500',
                                    'bg-violet-100 text-violet-500',
                                    'bg-amber-100 text-amber-500',
                                    'bg-rose-100 text-rose-500',
                                    'bg-cyan-100 text-cyan-500',
                                    'bg-orange-100 text-orange-500',
                                    'bg-fuchsia-100 text-fuchsia-500'
                                ];
                                let hash = 0;
                                for (let i = 0; i < currentAmbulatoryId.length; i++) { hash = ((hash << 5) - hash) + currentAmbulatoryId.charCodeAt(i); hash |= 0; }
                                return colors[Math.abs(hash) % colors.length];
                            })()}`}>
                                {viewMode === 'active' ? <UserPlus className="w-10 h-10" /> : <Archive className="w-10 h-10" />}
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                                {currentAmbulatoryId
                                    ? `${ambulatories?.find(a => a.id === currentAmbulatoryId)?.name || 'Ambulatorio'} è vuoto`
                                    : (viewMode === 'active' ? 'Nessun paziente attivo' : 'Nessun paziente in archivio')
                                }
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
                                {currentAmbulatoryId
                                    ? 'Questo reparto non ha ancora pazienti assegnati. Aggiungi un nuovo paziente o sposta pazienti esistenti qui.'
                                    : (viewMode === 'active' ? 'Inizia aggiungendo un nuovo paziente.' : 'I pazienti archiviati compariranno qui.')
                                }
                            </p>
                            {currentAmbulatoryId && viewMode === 'active' && (
                                <Link
                                    href="/patients/new"
                                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl shadow-lg shadow-blue-500/25 hover:bg-blue-700 transition-all"
                                >
                                    <UserPlus className="w-5 h-5" />
                                    Aggiungi Primo Paziente
                                </Link>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Empty State for Global View with no groups */}
            {isGlobalView && patientGroups.length === 0 && patients?.length === 0 && (
                <div className="py-20 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4 text-gray-400">
                        <Building2 className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900">Nessun paziente in nessun ambulatorio</h3>
                    <p className="text-gray-500 mt-1">Aggiungi pazienti o seleziona un ambulatorio specifico dalla sidebar.</p>
                </div>
            )}
        </div>
    );
}
