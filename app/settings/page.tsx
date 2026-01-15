'use client';

import { Shield, Database, Trash2, RefreshCcw, AlertTriangle } from 'lucide-react';
import { db } from '@/lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { differenceInDays } from 'date-fns';
import DrugDbManager from '@/components/settings/drug-db-manager';

export default function SettingsPage() {
    const deletedPatients = useLiveQuery(async () => {
        // Filter manually since we want all deleted ones
        return await db.patients
            .filter(p => p.deletedAt !== undefined)
            .toArray();
    });

    const restorePatient = async (id: string) => {
        if (confirm("Vuoi ripristinare questo paziente?")) {
            await db.patients.update(id, {
                deletedAt: undefined,
                deletionReason: undefined,
                updatedAt: new Date()
            });
        }
    };

    const permanentDelete = async (id: string) => {
        if (confirm("SEI SICURO? Questa azione è irreversibile e cancellerà tutti i dati associati (visite, file, terapie).")) {
            await db.transaction('rw', db.patients, db.entries, db.attachments, db.therapies, async () => {
                await db.entries.where('patientId').equals(id).delete();
                await db.attachments.where('patientId').equals(id).delete();
                await db.therapies.where('patientId').equals(id).delete();
                await db.patients.delete(id);
            });
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-gray-800">Impostazioni</h1>
                <p className="text-gray-500 mt-1">Gestisci le preferenze della tua applicazione e la privacy.</p>
            </div>

            {/* General Settings */}
            <div className="glass-panel p-6 space-y-6">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-blue-600" />
                    Sicurezza & Privacy
                </h2>

                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-white/50 rounded-xl border border-gray-100">
                        <div>
                            <h3 className="font-medium text-gray-800">Crittografia Dati</h3>
                            <p className="text-sm text-gray-500">I dati sono salvati in locale. Abilita la crittografia per maggiore sicurezza.</p>
                        </div>
                        <button className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium text-sm">
                            Configura
                        </button>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-white/50 rounded-xl border border-gray-100">
                        <div>
                            <h3 className="font-medium text-gray-800">Backup Automatico</h3>
                            <p className="text-sm text-gray-500">Esporta periodicamente i tuoi dati in un file criptato.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" aria-label="Abilita backup automatico" />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                </div>
            </div>

            {/* Database Management */}
            <div className="glass-panel p-6 space-y-6">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <Database className="w-5 h-5 text-purple-600" />
                    Gestione Database
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button className="p-4 rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:border-blue-500 hover:bg-blue-50 transition-colors group">
                        <Database className="w-8 h-8 text-gray-400 group-hover:text-blue-500" />
                        <span className="font-medium text-gray-700">Esporta Dati (JSON)</span>
                    </button>
                    <button className="p-4 rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:border-red-500 hover:bg-red-50 transition-colors group">
                        <Database className="w-8 h-8 text-gray-400 group-hover:text-red-500" />
                        <span className="font-medium text-gray-700">Reset Totale</span>
                    </button>
                </div>
            </div>

            {/* AIFA Drug Database */}
            <DrugDbManager />

            {/* Trash Management */}
            <div className="glass-panel p-6 space-y-6">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <Trash2 className="w-5 h-5 text-red-600" />
                    Cestino Pazienti
                </h2>

                <div className="p-4 bg-orange-50 border border-orange-100 rounded-xl text-sm text-orange-800 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <p>
                        I pazienti in questo elenco verranno eliminati definitivamente dopo 30 giorni dalla data di cancellazione.
                        L'eliminazione definitiva è irreversibile.
                    </p>
                </div>

                <div className="space-y-4">
                    {deletedPatients?.map(patient => {
                        const daysLeft = 30 - differenceInDays(new Date(), patient.deletedAt!);
                        const isExpired = daysLeft <= 0;

                        return (
                            <div key={patient.id} className="flex items-center justify-between p-4 bg-white/50 rounded-xl border border-gray-100">
                                <div>
                                    <h3 className="font-bold text-gray-800">{patient.firstName} {patient.lastName}</h3>
                                    <p className="text-xs text-gray-500 font-mono">{patient.taxCode}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-md font-medium">
                                            Eliminato il {patient.deletedAt?.toLocaleDateString()}
                                        </span>
                                        <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${isExpired ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                                            {isExpired ? 'Scaduto' : `${daysLeft} giorni rimanenti`}
                                        </span>
                                    </div>
                                    {patient.deletionReason && (
                                        <p className="text-xs text-gray-500 mt-1 italic">"{patient.deletionReason}"</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => restorePatient(patient.id)}
                                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors tooltip-trigger"
                                        title="Ripristina"
                                    >
                                        <RefreshCcw className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => permanentDelete(patient.id)}
                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Elimina Definitivamente"
                                    >
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {(!deletedPatients || deletedPatients.length === 0) && (
                        <div className="text-center py-8 text-gray-400 italic">
                            Il cestino è vuoto.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
