'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Search, UserPlus, FileText, Users, Archive } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { estimateBirthYearFromTaxCode, calculateAge } from '@/lib/utils';
import PrivacyBlur from '@/components/privacy-blur';

export default function PatientList() {
    const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');
    const [search, setSearch] = useState('');

    const patients = useLiveQuery(
        async () => {
            let collection = db.patients.orderBy('lastName');

            // Filter out deleted and then by archive status
            collection = collection.filter(p => !p.deletedAt);

            if (viewMode === 'active') {
                collection = collection.filter(p => !p.isArchived);
            } else {
                collection = collection.filter(p => !!p.isArchived);
            }

            if (search) {
                const lowerSearch = search.toLowerCase();
                return await collection.filter(p =>
                    p.lastName.toLowerCase().includes(lowerSearch) ||
                    p.firstName.toLowerCase().includes(lowerSearch) ||
                    p.taxCode.toLowerCase().includes(lowerSearch)
                ).toArray();
            }
            return collection.toArray();
        },
        [search, viewMode]
    );

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white tracking-tight">Pazienti</h1>
                    <div className="flex items-center gap-2 mt-2">
                        <button
                            onClick={() => setViewMode('active')}
                            className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${viewMode === 'active'
                                ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500/20 dark:bg-blue-500/20 dark:text-blue-300 dark:ring-1 dark:ring-blue-500/50'
                                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'
                                }`}
                        >
                            Attivi
                        </button>
                        <button
                            onClick={() => setViewMode('archived')}
                            className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${viewMode === 'archived'
                                ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-500/20 dark:bg-amber-500/20 dark:text-amber-300 dark:ring-1 dark:ring-amber-500/50'
                                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'
                                }`}
                        >
                            Archiviati
                        </button>
                    </div>
                </div>

                <Link
                    href="/patients/new"
                    className="flex items-center gap-2 px-5 py-2.5 bg-white text-blue-600 font-medium rounded-xl shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                    <UserPlus className="w-5 h-5" />
                    Nuovo Paziente
                </Link>
            </div>

            {/* Search Bar */}
            <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                <input
                    type="text"
                    className="block w-full pl-10 pr-3 py-3 border-none rounded-2xl bg-white/60 backdrop-blur-sm shadow-sm ring-1 ring-black/5 focus:ring-2 focus:ring-blue-500 focus:bg-white/80 transition-all text-gray-800 placeholder-gray-400"
                    placeholder="Cerca per nome, cognome o codice fiscale..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {/* Patient Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {patients?.map((patient) => (
                    <Link href={`/patients/${patient.id}`} key={patient.id} className="block group">
                        <div className={`glass-card h-full p-6 relative overflow-hidden ${patient.isArchived ? 'opacity-75 grayscale-[0.3]' : ''}`}>
                            <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100 transition-opacity">
                                <FileText className="w-16 h-16 text-blue-500/10 transform group-hover:scale-110 transition-transform duration-500" />
                            </div>

                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shadow-inner ${patient.isArchived
                                        ? 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400'
                                        : 'bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-700 dark:from-blue-900/40 dark:to-indigo-900/40 dark:text-blue-300'
                                        }`}>
                                        {patient.firstName[0]}{patient.lastName[0]}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
                                            <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                                        </h3>
                                        <div className="flex items-center gap-2">
                                            <p className="text-xs font-mono text-gray-500">
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

                                <div className="space-y-2 text-sm text-gray-600">
                                    <div className="flex justify-between border-b border-gray-100 pb-2">
                                        <span>Età</span>
                                        <span className="font-medium text-gray-800">
                                            {(() => {
                                                const age = patient.birthDate && !isNaN(new Date(patient.birthDate).getTime())
                                                    ? new Date().getFullYear() - new Date(patient.birthDate).getFullYear()
                                                    : (patient.taxCode ? calculateAge(estimateBirthYearFromTaxCode(patient.taxCode) || 0) : null);

                                                // Handle the case where estimate returns null/0 (invalid tax code)
                                                // If age > 200 it's probably wrong (0 case), so check validity.
                                                // Actually calculateAge(null) would be currentYear - 0 = 2024. 
                                                // let's be more precise.

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
                                            <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-600 text-xs border border-amber-100">
                                                {patient.archiveReason === 'deceased' ? 'Deceduto' :
                                                    patient.archiveReason === 'assigned_mmg' ? 'MMG' : 'Archiviato'}
                                            </span>
                                        ) : patient.isAdi ? (
                                            <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold border border-green-200">ADI Attiva</span>
                                        ) : (
                                            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-500 text-xs border border-gray-200 dark:bg-white/10 dark:text-gray-400 dark:border-white/5">Ambulatoriale</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}

                {!patients?.length && (
                    <div className="col-span-full py-20 text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4 text-gray-400">
                            {viewMode === 'active' ? <UserPlus className="w-8 h-8" /> : <Archive className="w-8 h-8" />}
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">
                            {viewMode === 'active' ? 'Nessun paziente attivo' : 'Nessun paziente in archivio'}
                        </h3>
                        <p className="text-gray-500 mt-1">
                            {viewMode === 'active'
                                ? 'Inizia aggiungendo un nuovo paziente al tuo archivio.'
                                : 'I pazienti archiviati compariranno qui.'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
